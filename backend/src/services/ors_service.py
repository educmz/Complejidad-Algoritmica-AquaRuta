from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from contextlib import contextmanager
import hashlib
import json
import logging
import math
import os
import sqlite3
import threading
import time

import requests

from config.operational_constants import (
    CONCEPTUAL_ROUTE_MIN_DISTANCE_KM,
    CONCEPTUAL_ROUTE_SOURCE,
    CONCEPTUAL_ROUTE_WARNING,
    DEFAULT_CONCEPTUAL_ROUTE_SPEED_KMH,
    DEFAULT_TIMEOUT_SECONDS,
    DISTANCE_COST_FACTOR,
    ORS_MAX_ALTERNATIVE_ROUTES,
    LOCAL_ROUTE_SOURCE,
    LOCAL_ROUTE_WARNING,
    TIME_COST_FACTOR,
    TRAFFIC_ESTIMATED_SOURCE,
    TRAFFIC_MODE_ESTIMATED,
)
from services.traffic import TrafficService

logger = logging.getLogger("aquaruta.ors")
STRATEGY_VERSION = "fragility-v1"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def clamp(value, low=0.0, high=1.0) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return low
    return max(low, min(high, numeric))


def calcular_costo_operativo(distancia_km, duracion_min, stop_count=1) -> float:
    return round(
        float(distancia_km or 0) * DISTANCE_COST_FACTOR
        + float(duracion_min or 0) * TIME_COST_FACTOR
        + max(0, int(stop_count or 0)) * 8,
        2,
    )


@dataclass
class RouteConfig:
    api_key: str | None
    base_url: str
    timeout_seconds: float
    max_retries: int
    alternative_target_count: int
    cache_ttl_hours: float
    max_operational_distance_km: float
    max_operational_duration_min: float
    max_operational_cost: float
    cache_path: Path
    cooldown_seconds: float

    @classmethod
    def from_env(cls, root: Path) -> "RouteConfig":
        return cls(
            api_key=os.getenv("ORS_API_KEY"),
            base_url=os.getenv(
                "ORS_BASE_URL",
                "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
            ),
            timeout_seconds=float(os.getenv("ORS_TIMEOUT_SECONDS", os.getenv("ROUTE_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)))),
            max_retries=int(os.getenv("ORS_MAX_RETRIES", "2")),
            alternative_target_count=max(1, min(int(os.getenv("ORS_ALTERNATIVE_TARGET_COUNT", str(ORS_MAX_ALTERNATIVE_ROUTES))), ORS_MAX_ALTERNATIVE_ROUTES)),
            cache_ttl_hours=float(os.getenv("ORS_CACHE_TTL_HOURS", "168")),
            max_operational_distance_km=float(os.getenv("MAX_OPERATIONAL_DISTANCE_KM", "80")),
            max_operational_duration_min=float(os.getenv("MAX_OPERATIONAL_DURATION_MIN", "180")),
            max_operational_cost=float(os.getenv("MAX_OPERATIONAL_COST", "600")),
            cache_path=Path(os.getenv("ORS_CACHE_PATH", str(root / "data/cache/ors_routes.sqlite3"))),
            cooldown_seconds=float(os.getenv("ROUTE_COOLDOWN_SECONDS", "1.5")),
        )


class ORSService:
    def __init__(self, config: RouteConfig, traffic_service=None):
        self.config = config
        self.traffic_service = traffic_service or TrafficService()
        self.config.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._last_request_at = 0.0
        self._init_cache()

    @contextmanager
    def _connect(self):
        conn = sqlite3.connect(self.config.cache_path, timeout=5)
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_cache(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS ors_route_cache (
                    cache_key TEXT PRIMARY KEY,
                    origin TEXT NOT NULL,
                    destination TEXT NOT NULL,
                    profile TEXT NOT NULL,
                    target_count INTEGER NOT NULL,
                    strategy_version TEXT NOT NULL,
                    response_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                )
                """
            )

    def _cache_key(self, coordinates, target_count, view_mode="road"):
        origin = coordinates[0]
        destination = coordinates[-1]
        payload = {
            "origin": [round(float(origin[0]), 5), round(float(origin[1]), 5)],
            "destination": [round(float(destination[0]), 5), round(float(destination[1]), 5)],
            "profile": "driving-car",
            "target_count": int(target_count),
            "strategy": STRATEGY_VERSION,
            "view_mode": view_mode,
        }
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
        return digest, payload

    def _get_cached(
        self,
        cache_key: str,
        allow_expired: bool = False,
        requested_mode: str = "road",
    ):
        try:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT response_json, expires_at FROM ors_route_cache WHERE cache_key = ?",
                    (cache_key,),
                ).fetchone()
        except sqlite3.Error as exc:
            logger.warning("ors_cache_read_failed error=%s", exc)
            return None
        if not row:
            return None
        response = json.loads(row[0])
        if not self._cache_matches_mode(response, requested_mode):
            logger.info(
                "ors_cache_ignored requested_mode=%s cached_route_type=%s reason=mode_mismatch",
                requested_mode,
                response.get("routeType", "legacy"),
            )
            return None
        expired = datetime.fromisoformat(row[1]) < _utc_now()
        if expired and not allow_expired:
            return None
        return self._mark_cached(response, expired=expired)

    def _cache_matches_mode(self, response, requested_mode):
        route_type = response.get("routeType")
        source = response.get("source")
        edge_type = response.get("edge_type")
        if requested_mode == "local":
            return route_type == "local"
        if route_type == "road":
            return True
        if route_type in {"conceptual", "local", "not_required"}:
            return False
        if source in {CONCEPTUAL_ROUTE_SOURCE, LOCAL_ROUTE_SOURCE}:
            return False
        if edge_type in {"conceptual_route", "local_connection", "route_not_required"}:
            return False
        return any(
            self._normalize_ors_feature(feature) is not None
            for feature in response.get("features", [])
        )

    def _save_cache(self, cache_key, key_payload, response):
        now = _utc_now()
        expires_at = now + timedelta(hours=self.config.cache_ttl_hours)
        try:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO ors_route_cache
                    (cache_key, origin, destination, profile, target_count, strategy_version, response_json, created_at, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        cache_key,
                        json.dumps(key_payload["origin"]),
                        json.dumps(key_payload["destination"]),
                        key_payload["profile"],
                        key_payload["target_count"],
                        key_payload["strategy"],
                        json.dumps(response, ensure_ascii=False),
                        now.isoformat(),
                        expires_at.isoformat(),
                    ),
                )
        except sqlite3.Error as exc:
            logger.warning("ors_cache_write_failed error=%s", exc)

    def _mark_cached(self, response, expired=False):
        copied = dict(response)
        primary = self._route_with_traffic(copied.get("primaryRoute"))
        alternatives = [
            self._route_with_traffic(route)
            for route in copied.get("alternatives", [])
        ]
        if primary and copied.get("edge_type") == "road_route":
            copied.setdefault("routeAvailable", True)
            copied.setdefault("routeType", "road")
            copied.setdefault("routeMode", "ors")
            copied.setdefault("requestedSource", copied.get("source"))
            copied["source"] = "openrouteservice"
            primary.setdefault("routeType", "road")
            primary.setdefault("routeMode", "ors")
            primary.setdefault("source", "openrouteservice")
            for route in alternatives:
                route.setdefault("routeType", "road")
                route.setdefault("routeMode", "ors")
                route.setdefault("source", "openrouteservice")
        copied["primaryRoute"] = primary
        copied["alternatives"] = alternatives
        metrics = dict(copied.get("metrics", {}))
        if primary:
            traffic = dict(primary["traffic"])
            metrics.update({**traffic, "traffic": traffic})
        metrics.update(
            {
                "route_metrics_cached": True,
                "cached": True,
                "route_metrics_source": "cache" if not expired else "fallback",
                "source": "cache" if not expired else "fallback",
                "cacheExpired": bool(expired),
            }
        )
        copied["metrics"] = metrics
        return copied

    def _route_with_traffic(self, route):
        if not isinstance(route, dict):
            return route
        copied = dict(route)
        if not isinstance(copied.get("traffic"), dict):
            copied["traffic"] = self._traffic_metrics(copied.get("durationMin", 0))
        return copied

    def _rate_limit(self):
        with self._lock:
            elapsed = time.monotonic() - self._last_request_at
            if elapsed < self.config.cooldown_seconds:
                time.sleep(self.config.cooldown_seconds - elapsed)
            self._last_request_at = time.monotonic()

    def route(
        self,
        coordinates,
        alternative_routes=None,
        source=None,
        target=None,
        view_mode="road",
    ):
        view_mode = "local" if view_mode == "local" else "road"
        target_count = self._target_count(alternative_routes)
        cache_key, key_payload = self._cache_key(
            coordinates, target_count, view_mode=view_mode
        )
        logger.info(
            "route_request mode=%s origin_lon_lat=%s destination_lon_lat=%s",
            view_mode,
            coordinates[0] if coordinates else None,
            coordinates[-1] if coordinates else None,
        )
        cached = self._get_cached(cache_key, requested_mode=view_mode)
        if cached:
            logger.info("ors_cache_hit key=%s", cache_key[:10])
            return cached

        if view_mode == "local":
            local_response = self._local_response(source, target, coordinates)
            if local_response is None:
                return self._unavailable_response(source, target, "unavailable")
            self._save_cache(cache_key, key_payload, local_response)
            return local_response

        if not self.config.api_key:
            stale = self._get_cached(
                cache_key, allow_expired=True, requested_mode=view_mode
            )
            if stale:
                return stale
            logger.warning("ors_unavailable reason=missing_api_key")
            return self._unavailable_response(
                source,
                target,
                "unavailable",
                coordinates=coordinates,
                fallback_reason="missing_api_key",
            )

        body = {
            "coordinates": coordinates,
            "alternative_routes": {
                "target_count": target_count,
                "weight_factor": float((alternative_routes or {}).get("weight_factor", 1.6)),
                "share_factor": float((alternative_routes or {}).get("share_factor", 0.6)),
            },
        }
        last_error = None
        for attempt in range(self.config.max_retries + 1):
            try:
                self._rate_limit()
                response = requests.post(
                    self.config.base_url,
                    json=body,
                    headers={"Authorization": self.config.api_key, "Content-Type": "application/json"},
                    timeout=self.config.timeout_seconds,
                )
                logger.info(
                    "ors_response mode=%s status_code=%s origin_lon_lat=%s destination_lon_lat=%s",
                    view_mode,
                    response.status_code,
                    coordinates[0],
                    coordinates[-1],
                )
                response.raise_for_status()
                payload = response.json()
                logger.info(
                    "ors_payload mode=%s features=%s routes=%s",
                    view_mode,
                    len(payload.get("features", []) or []),
                    len(payload.get("routes", []) or []),
                )
                normalized = self._normalize_geojson(
                    payload,
                    source=source,
                    target=target,
                    coordinates=coordinates,
                )
                if normalized.get("routeType") == "road":
                    self._save_cache(cache_key, key_payload, normalized)
                else:
                    logger.info(
                        "ors_cache_skipped mode=road route_type=%s",
                        normalized.get("routeType"),
                    )
                return normalized
            except (requests.RequestException, ValueError) as exc:
                last_error = exc
                logger.warning("ors_request_failed attempt=%s error=%s", attempt + 1, exc)
                if attempt < self.config.max_retries:
                    time.sleep(0.5 * (attempt + 1))
        stale = self._get_cached(
            cache_key, allow_expired=True, requested_mode=view_mode
        )
        if stale:
            return stale
        logger.warning("ors_unavailable_after_retries error=%s", last_error)
        return self._unavailable_response(
            source,
            target,
            "unavailable",
            coordinates=coordinates,
            fallback_reason="request_error",
        )

    def batch(self, routes):
        results = []
        for index, route in enumerate(routes):
            try:
                results.append(
                    {
                        "index": index,
                        "ok": True,
                        "result": self.route(
                            route.get("coordinates", []),
                            route.get("alternative_routes"),
                            route.get("source"),
                            route.get("target"),
                            route.get("view_mode", "road"),
                        ),
                    }
                )
            except Exception as exc:
                logger.warning("ors_batch_item_failed index=%s error=%s", index, exc)
                results.append({"index": index, "ok": False, "error": "error al consultar"})
        return {"routes": results}

    def _target_count(self, alternative_routes):
        if alternative_routes and isinstance(alternative_routes, dict):
            requested = int(alternative_routes.get("target_count", self.config.alternative_target_count))
        else:
            requested = self.config.alternative_target_count
        return max(1, min(requested, self.config.alternative_target_count, ORS_MAX_ALTERNATIVE_ROUTES))

    def _normalize_ors_feature(self, feature):
        if not isinstance(feature, dict):
            return None
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict):
            return None
        coordinates = geometry.get("coordinates")
        geometry_type = geometry.get("type")
        if geometry_type == "LineString":
            valid_geometry = isinstance(coordinates, list) and len(coordinates) >= 2
        elif geometry_type == "MultiLineString":
            valid_geometry = (
                isinstance(coordinates, list)
                and sum(len(line) for line in coordinates if isinstance(line, list)) >= 2
            )
        else:
            valid_geometry = False
        if not valid_geometry:
            return None

        properties = dict(feature.get("properties") or {})
        summary = dict(properties.get("summary") or feature.get("summary") or {})
        if summary.get("distance") is None or summary.get("duration") is None:
            segments = properties.get("segments") or feature.get("segments") or []
            if isinstance(segments, list):
                if summary.get("distance") is None:
                    summary["distance"] = sum(
                        float(segment.get("distance", 0) or 0)
                        for segment in segments
                        if isinstance(segment, dict)
                    )
                if summary.get("duration") is None:
                    summary["duration"] = sum(
                        float(segment.get("duration", 0) or 0)
                        for segment in segments
                        if isinstance(segment, dict)
                    )
        try:
            distance = float(summary.get("distance"))
            duration = float(summary.get("duration"))
        except (TypeError, ValueError):
            return None
        if (
            not math.isfinite(distance)
            or not math.isfinite(duration)
            or distance < 0
            or duration < 0
        ):
            return None
        properties["summary"] = {"distance": distance, "duration": duration}
        return {
            **feature,
            "type": feature.get("type", "Feature"),
            "geometry": geometry,
            "properties": properties,
        }

    def _extract_ors_features(self, payload):
        raw_features = payload.get("features") or []
        if not raw_features and isinstance(payload.get("routes"), list):
            raw_features = [
                {
                    "type": "Feature",
                    "geometry": route.get("geometry"),
                    "properties": {
                        "summary": route.get("summary"),
                        "segments": route.get("segments"),
                    },
                }
                for route in payload["routes"]
                if isinstance(route, dict)
            ]
        return [
            normalized
            for feature in raw_features
            if (normalized := self._normalize_ors_feature(feature)) is not None
        ]

    def _normalize_geojson(self, payload, source=None, target=None, coordinates=None):
        features = self._extract_ors_features(payload)
        features.sort(key=lambda feature: feature["properties"]["summary"]["duration"])
        if not features:
            raw_count = len(payload.get("features") or payload.get("routes") or [])
            return self._unavailable_response(
                source,
                target,
                "unavailable",
                coordinates=coordinates,
                fallback_reason=(
                    "empty_response" if raw_count == 0 else "invalid_geometry"
                ),
            )
        primary = self._route_from_feature(features[0])
        alternatives = [self._route_from_feature(feature) for feature in features[1:]]
        for feature in features:
            properties = feature.setdefault("properties", {})
            properties["routeType"] = "road"
            properties["routeMode"] = "ors"
        primary.update(
            {
                "routeType": "road",
                "routeMode": "ors",
                "source": "openrouteservice",
            }
        )
        for route in alternatives:
            route.update(
                {
                    "routeType": "road",
                    "routeMode": "ors",
                    "source": "openrouteservice",
                }
            )
        metrics = self._metrics_from_routes(primary, alternatives)
        now = _utc_now().isoformat()
        metrics.update(
            {
                "route_metrics_source": "openrouteservice",
                "route_metrics_cached": False,
                "route_metrics_updated_at": now,
                "source": "openrouteservice",
                "cached": False,
                "updatedAt": now,
            }
        )
        return {
            "type": "FeatureCollection",
            "features": features,
            "source": "openrouteservice",
            "requestedSource": source,
            "target": target,
            "edge_type": "road_route",
            "routeAvailable": True,
            "routeType": "road",
            "routeMode": "ors",
            "primaryRoute": primary,
            "alternatives": alternatives,
            "metrics": metrics,
        }

    def _route_from_feature(self, feature):
        summary = feature["properties"]["summary"]
        distance_km = float(summary.get("distance", 0)) / 1000
        duration_min = float(summary.get("duration", 0)) / 60
        traffic = self._traffic_metrics(duration_min)
        return {
            "geometry": feature.get("geometry"),
            "distanceKm": round(distance_km, 3),
            "durationMin": round(duration_min, 2),
            "operationalCost": calcular_costo_operativo(distance_km, duration_min),
            "traffic": traffic,
        }

    def _local_response(self, source, target, coordinates):
        response = self._conceptual_response(source, target, coordinates)
        if response is None or response.get("routeType") == "not_required":
            return response

        response["source"] = LOCAL_ROUTE_SOURCE
        response["edge_type"] = "local_connection"
        response["routeType"] = "local"
        response["routeMode"] = "local_estimated"
        response["warning"] = LOCAL_ROUTE_WARNING
        for feature in response.get("features", []):
            properties = feature.setdefault("properties", {})
            properties["routeType"] = "local"
            properties["routeMode"] = "local_estimated"
        routes = [
            response.get("primaryRoute"),
            *response.get("alternatives", []),
        ]
        for route in routes:
            if not isinstance(route, dict):
                continue
            route.update(
                {
                    "routeType": "local",
                    "routeMode": "local_estimated",
                    "source": LOCAL_ROUTE_SOURCE,
                    "warning": LOCAL_ROUTE_WARNING,
                }
            )
        metrics = response.get("metrics", {})
        metrics["route_metrics_source"] = LOCAL_ROUTE_SOURCE
        metrics["source"] = LOCAL_ROUTE_SOURCE
        return response

    def _traffic_metrics(self, base_duration_min):
        service = getattr(self, "traffic_service", None) or TrafficService()
        try:
            return service.get_route_metrics(base_duration_min).to_dict()
        except Exception as exc:
            logger.warning("estimated_traffic_failed error=%s", exc)
            return TrafficService().get_route_metrics(0).to_dict()

    def _metrics_from_routes(self, primary, alternatives):
        valid_count = 1 + len(alternatives)
        quantity_penalty = 1.0 if valid_count <= 1 else 0.5 if valid_count == 2 else 0.15
        primary_duration = max(float(primary["durationMin"]), 0.0001)
        if alternatives:
            second_increase = clamp((alternatives[0]["durationMin"] - primary_duration) / primary_duration)
            quality_penalty = second_increase
        else:
            second_increase = None
            quality_penalty = 1.0
        fragility = clamp(0.60 * quantity_penalty + 0.40 * quality_penalty)
        operational_cost = calcular_costo_operativo(primary["distanceKm"], primary["durationMin"])
        edge_weight = clamp(
            0.20 * clamp(primary["distanceKm"] / self.config.max_operational_distance_km)
            + 0.35 * clamp(primary["durationMin"] / self.config.max_operational_duration_min)
            + 0.15 * clamp(operational_cost / self.config.max_operational_cost)
            + 0.30 * fragility
        )
        traffic = dict(primary.get("traffic") or self._traffic_metrics(primary["durationMin"]))
        return {
            "cantidad_rutas_validas": valid_count,
            "cantidad_rutas_alternativas": len(alternatives),
            "duracion_principal_min": primary["durationMin"],
            "duracion_segunda_min": alternatives[0]["durationMin"] if alternatives else None,
            "distancia_principal_km": primary["distanceKm"],
            "incremento_segunda_ruta": None if second_increase is None else round(second_increase, 4),
            "penalizacion_fragilidad_ruta": round(fragility, 4),
            "peso_operativo_arista": round(edge_weight, 4),
            "alternativeRouteCount": len(alternatives),
            "secondRouteIncrease": None if second_increase is None else round(second_increase, 4),
            "routeFragilityPenalty": round(fragility, 4),
            "edgeOperationalWeight": round(edge_weight, 4),
            "operationalCost": operational_cost,
            **traffic,
            "traffic": traffic,
        }

    def _unavailable_response(
        self,
        source,
        target,
        route_source,
        coordinates=None,
        fallback_reason="unavailable",
    ):
        logger.warning(
            "conceptual_fallback reason=%s origin_lon_lat=%s destination_lon_lat=%s",
            fallback_reason,
            coordinates[0] if coordinates else None,
            coordinates[-1] if coordinates else None,
        )
        conceptual = self._conceptual_response(source, target, coordinates)
        if conceptual is not None:
            return conceptual

        now = _utc_now().isoformat()
        warning = (
            "No hay ruta vial disponible; el tráfico estimado no pudo calcularse "
            "sobre una duración base."
        )
        traffic = {
            "baseDurationMin": None,
            "liveDurationMin": None,
            "trafficDelayMin": None,
            "trafficFactor": None,
            "trafficSource": TRAFFIC_ESTIMATED_SOURCE,
            "trafficMode": TRAFFIC_MODE_ESTIMATED,
            "trafficUpdatedAt": now,
            "trafficIsStale": False,
            "trafficWarning": warning,
        }
        return {
            "type": "FeatureCollection",
            "features": [],
            "source": source,
            "target": target,
            "edge_type": "road_route",
            "primaryRoute": None,
            "alternatives": [],
            "metrics": {
                "cantidad_rutas_validas": 0,
                "cantidad_rutas_alternativas": 0,
                "incremento_segunda_ruta": None,
                "penalizacion_fragilidad_ruta": None,
                "peso_operativo_arista": None,
                "route_metrics_source": route_source,
                "route_metrics_cached": False,
                "route_metrics_updated_at": now,
                "alternativeRouteCount": 0,
                "secondRouteIncrease": None,
                "routeFragilityPenalty": None,
                "edgeOperationalWeight": None,
                "source": route_source,
                "cached": False,
                "updatedAt": now,
                **traffic,
                "traffic": traffic,
            },
        }

    def _conceptual_response(self, source, target, coordinates):
        endpoints = self._valid_endpoints(coordinates)
        if endpoints is None:
            return None

        origin, destination = endpoints
        distance_km = self._haversine_km(origin, destination)
        if not math.isfinite(distance_km):
            return None
        if distance_km <= CONCEPTUAL_ROUTE_MIN_DISTANCE_KM:
            return self._not_required_response(source, target)

        speed_kmh = float(DEFAULT_CONCEPTUAL_ROUTE_SPEED_KMH)
        if not math.isfinite(speed_kmh) or speed_kmh <= 0:
            return None
        duration_min = round((distance_km / speed_kmh) * 60, 2)
        distance_km = round(distance_km, 3)
        traffic = self._traffic_metrics(duration_min)
        geometry = {
            "type": "LineString",
            "coordinates": [origin, destination],
        }
        feature = {
            "type": "Feature",
            "geometry": geometry,
            "properties": {
                "routeType": "conceptual",
                "routeMode": "fallback",
                "summary": {
                    "distance": round(distance_km * 1000, 3),
                    "duration": round(duration_min * 60, 2),
                },
            },
        }
        route = {
            "geometry": geometry,
            "distanceKm": distance_km,
            "durationMin": duration_min,
            "operationalCost": calcular_costo_operativo(
                distance_km, duration_min
            ),
            "routeType": "conceptual",
            "routeMode": "fallback",
            "source": CONCEPTUAL_ROUTE_SOURCE,
            "warning": CONCEPTUAL_ROUTE_WARNING,
            "traffic": traffic,
        }
        metrics = {
            "cantidad_rutas_validas": 1,
            "cantidad_rutas_alternativas": 1,
            "duracion_principal_min": duration_min,
            "distancia_principal_km": distance_km,
            "operationalCost": route["operationalCost"],
            "route_metrics_source": CONCEPTUAL_ROUTE_SOURCE,
            "route_metrics_cached": False,
            "source": CONCEPTUAL_ROUTE_SOURCE,
            "cached": False,
            "updatedAt": traffic["trafficUpdatedAt"],
            **traffic,
            "traffic": traffic,
        }
        return {
            "type": "FeatureCollection",
            "features": [feature],
            "source": CONCEPTUAL_ROUTE_SOURCE,
            "requestedSource": source,
            "target": target,
            "edge_type": "conceptual_route",
            "routeAvailable": True,
            "routeType": "conceptual",
            "routeMode": "fallback",
            "warning": CONCEPTUAL_ROUTE_WARNING,
            "primaryRoute": route,
            "alternatives": [dict(route)],
            "metrics": metrics,
            "traffic": traffic,
        }

    def _not_required_response(self, source, target):
        traffic = self._traffic_metrics(0)
        message = (
            "La EPS de referencia se encuentra en la misma zona destino. "
            "No se requiere ruta vial."
        )
        return {
            "type": "FeatureCollection",
            "features": [],
            "source": CONCEPTUAL_ROUTE_SOURCE,
            "requestedSource": source,
            "target": target,
            "edge_type": "route_not_required",
            "routeAvailable": False,
            "routeType": "not_required",
            "routeMode": "fallback",
            "message": message,
            "primaryRoute": None,
            "alternatives": [],
            "traffic": traffic,
            "metrics": {
                "cantidad_rutas_validas": 0,
                "cantidad_rutas_alternativas": 0,
                "duracion_principal_min": 0,
                "distancia_principal_km": 0,
                "operationalCost": 0,
                "route_metrics_source": CONCEPTUAL_ROUTE_SOURCE,
                "route_metrics_cached": False,
                "source": CONCEPTUAL_ROUTE_SOURCE,
                "cached": False,
                "updatedAt": traffic["trafficUpdatedAt"],
                **traffic,
                "traffic": traffic,
            },
        }

    @staticmethod
    def _valid_endpoints(coordinates):
        if not isinstance(coordinates, (list, tuple)) or len(coordinates) < 2:
            return None
        endpoints = []
        for point in (coordinates[0], coordinates[-1]):
            if not isinstance(point, (list, tuple)) or len(point) != 2:
                return None
            try:
                lon, lat = float(point[0]), float(point[1])
            except (TypeError, ValueError):
                return None
            if (
                not math.isfinite(lon)
                or not math.isfinite(lat)
                or not -180 <= lon <= 180
                or not -90 <= lat <= 90
            ):
                return None
            endpoints.append([lon, lat])
        return endpoints

    @staticmethod
    def _haversine_km(origin, destination):
        lon1, lat1 = map(math.radians, origin)
        lon2, lat2 = map(math.radians, destination)
        delta_lat = lat2 - lat1
        delta_lon = lon2 - lon1
        value = (
            math.sin(delta_lat / 2) ** 2
            + math.cos(lat1)
            * math.cos(lat2)
            * math.sin(delta_lon / 2) ** 2
        )
        value = max(0.0, min(1.0, value))
        return 6371.0088 * 2 * math.atan2(
            math.sqrt(value), math.sqrt(1 - value)
        )
