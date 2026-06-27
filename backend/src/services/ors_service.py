from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
import hashlib
import json
import logging
import os
import sqlite3
import threading
import time

import requests

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
        float(distancia_km or 0) * 4.6
        + float(duracion_min or 0) * 0.85
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
            timeout_seconds=float(os.getenv("ORS_TIMEOUT_SECONDS", os.getenv("ROUTE_TIMEOUT_SECONDS", "12"))),
            max_retries=int(os.getenv("ORS_MAX_RETRIES", "2")),
            alternative_target_count=max(1, min(int(os.getenv("ORS_ALTERNATIVE_TARGET_COUNT", "3")), 3)),
            cache_ttl_hours=float(os.getenv("ORS_CACHE_TTL_HOURS", "168")),
            max_operational_distance_km=float(os.getenv("MAX_OPERATIONAL_DISTANCE_KM", "80")),
            max_operational_duration_min=float(os.getenv("MAX_OPERATIONAL_DURATION_MIN", "180")),
            max_operational_cost=float(os.getenv("MAX_OPERATIONAL_COST", "600")),
            cache_path=Path(os.getenv("ORS_CACHE_PATH", str(root / "data/cache/ors_routes.sqlite3"))),
            cooldown_seconds=float(os.getenv("ROUTE_COOLDOWN_SECONDS", "1.5")),
        )


class ORSService:
    def __init__(self, config: RouteConfig):
        self.config = config
        self.config.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._last_request_at = 0.0
        self._init_cache()

    def _connect(self):
        return sqlite3.connect(self.config.cache_path, timeout=5)

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

    def _cache_key(self, coordinates, target_count):
        origin = coordinates[0]
        destination = coordinates[-1]
        payload = {
            "origin": [round(float(origin[0]), 5), round(float(origin[1]), 5)],
            "destination": [round(float(destination[0]), 5), round(float(destination[1]), 5)],
            "profile": "driving-car",
            "target_count": int(target_count),
            "strategy": STRATEGY_VERSION,
        }
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
        return digest, payload

    def _get_cached(self, cache_key: str, allow_expired: bool = False):
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
        expired = datetime.fromisoformat(row[1]) < _utc_now()
        if expired and not allow_expired:
            return None
        return self._mark_cached(response, expired=expired)

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
        metrics = dict(copied.get("metrics", {}))
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

    def _rate_limit(self):
        with self._lock:
            elapsed = time.monotonic() - self._last_request_at
            if elapsed < self.config.cooldown_seconds:
                time.sleep(self.config.cooldown_seconds - elapsed)
            self._last_request_at = time.monotonic()

    def route(self, coordinates, alternative_routes=None, source=None, target=None):
        target_count = self._target_count(alternative_routes)
        cache_key, key_payload = self._cache_key(coordinates, target_count)
        cached = self._get_cached(cache_key)
        if cached:
            logger.info("ors_cache_hit key=%s", cache_key[:10])
            return cached

        if not self.config.api_key:
            stale = self._get_cached(cache_key, allow_expired=True)
            if stale:
                return stale
            logger.warning("ors_unavailable reason=missing_api_key")
            return self._unavailable_response(source, target, "unavailable")

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
                response.raise_for_status()
                normalized = self._normalize_geojson(response.json(), source=source, target=target)
                self._save_cache(cache_key, key_payload, normalized)
                return normalized
            except (requests.RequestException, ValueError) as exc:
                last_error = exc
                logger.warning("ors_request_failed attempt=%s error=%s", attempt + 1, exc)
                if attempt < self.config.max_retries:
                    time.sleep(0.5 * (attempt + 1))
        stale = self._get_cached(cache_key, allow_expired=True)
        if stale:
            return stale
        logger.warning("ors_unavailable_after_retries error=%s", last_error)
        return self._unavailable_response(source, target, "unavailable")

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
        return max(1, min(requested, self.config.alternative_target_count, 3))

    def _valid_feature(self, feature):
        summary = feature.get("properties", {}).get("summary", {})
        return bool(
            feature.get("geometry")
            and summary.get("distance") is not None
            and summary.get("duration") is not None
        )

    def _normalize_geojson(self, payload, source=None, target=None):
        features = [feature for feature in payload.get("features", []) if self._valid_feature(feature)]
        features.sort(key=lambda feature: feature["properties"]["summary"]["duration"])
        if not features:
            return self._unavailable_response(source, target, "unavailable")
        primary = self._route_from_feature(features[0])
        alternatives = [self._route_from_feature(feature) for feature in features[1:]]
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
            "source": source,
            "target": target,
            "edge_type": "road_route",
            "primaryRoute": primary,
            "alternatives": alternatives,
            "metrics": metrics,
        }

    def _route_from_feature(self, feature):
        summary = feature["properties"]["summary"]
        distance_km = float(summary.get("distance", 0)) / 1000
        duration_min = float(summary.get("duration", 0)) / 60
        return {
            "geometry": feature.get("geometry"),
            "distanceKm": round(distance_km, 3),
            "durationMin": round(duration_min, 2),
            "operationalCost": calcular_costo_operativo(distance_km, duration_min),
        }

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
        }

    def _unavailable_response(self, source, target, route_source):
        now = _utc_now().isoformat()
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
            },
        }
