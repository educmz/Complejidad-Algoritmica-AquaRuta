from __future__ import annotations

import json
import logging
import math
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from algorithms.tsp_memorization import build_cost_matrix, solve_tsp_memoization


logger = logging.getLogger("aquaruta.tsp")
ALLOWED_CRITERIA = {"distancia", "tiempo", "costo", "distance", "time", "cost"}
CRITERION_ALIASES = {
    "distance": "distancia",
    "time": "tiempo",
    "cost": "costo",
}


class TspServiceError(ValueError):
    pass


def normalize_criterion(value: str) -> str:
    criterion = str(value or "").strip().lower()
    criterion = CRITERION_ALIASES.get(criterion, criterion)
    if criterion not in {"distancia", "tiempo", "costo"}:
        raise TspServiceError("Criterio TSP no permitido.")
    return criterion


def _finite_number(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise TspServiceError("Coordenada no finita.") from exc
    if not math.isfinite(number):
        raise TspServiceError("Coordenada no finita.")
    return number


def _center_from_node(node: dict[str, Any]) -> list[float]:
    center = node.get("center")
    if isinstance(center, list) and len(center) == 2:
        lat = _finite_number(center[0])
        lon = _finite_number(center[1])
    else:
        lat = _finite_number(node.get("lat"))
        lon = _finite_number(node.get("lon"))
    if not -90 <= lat <= 90 or not -180 <= lon <= 180:
        raise TspServiceError("Coordenadas fuera de rango.")
    return [lat, lon]


def _clean_destination(node: dict[str, Any]) -> dict[str, Any]:
    center = _center_from_node(node)
    return {
        "id": node["id"],
        "nombre": node.get("nombre", node.get("distrito", node["id"])),
        "center": center,
        "interrupciones": int(node.get("interrupciones", 0) or 0),
        "criticidad": node.get("criticidad", "baja"),
        "provincia": node.get("provincia", ""),
        "departamento": node.get("departamento", ""),
        "personas_afectadas_estimadas": int(node.get("personas_afectadas_estimadas", 0) or 0),
        "peso_demanda_familiar": float(node.get("peso_demanda_familiar", 0) or 0),
        "prioridad_score": float(node.get("prioridad_score", 0) or 0),
    }


class TspService:
    def __init__(
        self,
        root: Path,
        districts: list[dict[str, Any]] | None = None,
        eps_origins: list[dict[str, Any]] | None = None,
    ):
        self.root = root
        self._static_districts = districts
        self._static_eps_origins = eps_origins
        self._districts_cache: list[dict[str, Any]] | None = None
        self._districts_mtime: float | None = None
        self._eps_cache: list[dict[str, Any]] | None = None
        self._eps_mtime: float | None = None

    def _load_json_list(self, filename: str, cache_attr: str, mtime_attr: str, static_value):
        if static_value is not None:
            return list(static_value)
        path = self.root / "data" / "processed" / filename
        if not path.exists():
            return []
        mtime = path.stat().st_mtime
        cached = getattr(self, cache_attr)
        cached_mtime = getattr(self, mtime_attr)
        if cached is not None and cached_mtime == mtime:
            return list(cached)
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise TspServiceError(f"{filename} debe contener una lista.")
        setattr(self, cache_attr, payload)
        setattr(self, mtime_attr, mtime)
        return list(payload)

    def _districts(self) -> list[dict[str, Any]]:
        return self._load_json_list(
            "districts_summary.json",
            "_districts_cache",
            "_districts_mtime",
            self._static_districts,
        )

    def _eps_origins(self) -> list[dict[str, Any]]:
        return self._load_json_list(
            "eps_origins.json",
            "_eps_cache",
            "_eps_mtime",
            self._static_eps_origins,
        )

    def _resolve_origin(self, origin_id: str) -> dict[str, Any]:
        origins = {origin.get("id"): origin for origin in self._eps_origins()}
        origin = origins.get(origin_id)
        if not origin:
            raise TspServiceError("Origen EPS no encontrado.")
        center = _center_from_node(origin)
        return {
            "id": origin["id"],
            "nombre": origin.get("prestador", origin["id"]),
            "center": center,
            "isEpsNode": True,
        }

    def _resolve_destinations(self, destination_ids: list[str], max_destinations: int) -> list[dict[str, Any]]:
        if len(destination_ids) > max_destinations:
            raise TspServiceError(f"Solo se permiten hasta {max_destinations} destinos.")
        if len(destination_ids) != len(set(destination_ids)):
            raise TspServiceError("La lista de destinos contiene ids duplicados.")
        districts = {district.get("id"): district for district in self._districts()}
        destinations = []
        missing = []
        for destination_id in destination_ids:
            district = districts.get(destination_id)
            if not district:
                missing.append(destination_id)
                continue
            destinations.append(_clean_destination(district))
        if missing:
            raise TspServiceError(f"Destinos no encontrados: {', '.join(missing)}.")
        return destinations

    def run(
        self,
        origin_id: str,
        destination_ids: list[str],
        criterion: str = "distancia",
        max_exact_nodes: int = 12,
        max_destinations: int = 60,
    ) -> dict[str, Any]:
        started = time.perf_counter()
        criterion = normalize_criterion(criterion)
        if max_exact_nodes < 1 or max_exact_nodes > 12:
            raise TspServiceError("maxExactNodes debe estar entre 1 y 12.")
        if max_destinations < 1 or max_destinations > 100:
            raise TspServiceError("maxDestinations debe estar entre 1 y 100.")

        origin = self._resolve_origin(origin_id)
        destination_ids = [str(item) for item in destination_ids]
        if origin["id"] in destination_ids:
            raise TspServiceError("El origen no puede repetirse como destino.")
        destinations = self._resolve_destinations(destination_ids, max_destinations)

        if not destinations:
            elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
            return {
                "origin": origin,
                "criterion": criterion,
                "sequence": [],
                "edges": [],
                "routePoints": [origin["center"]],
                "summary": {
                    "totalCost": 0.0,
                    "visitedNodes": 0,
                    "exploredStates": 0,
                    "cacheHits": 0,
                    "cacheMisses": 0,
                    "usedFallback": False,
                },
                "metadata": {
                    "algorithm": "tsp_memoization",
                    "implementation": "python",
                    "generatedAt": datetime.now().replace(microsecond=0).isoformat(),
                    "executionMs": elapsed_ms,
                },
            }

        matrix = build_cost_matrix(origin["center"], destinations, criterion=criterion)
        result = solve_tsp_memoization(
            origin["center"],
            destinations,
            criterion=criterion,
            use_priority_bonus=False,
            return_to_origin=False,
            max_exact_nodes=max_exact_nodes,
        )
        ordered = result.get("best_order", [])
        index_by_id = {node["id"]: index + 1 for index, node in enumerate(destinations)}

        sequence = []
        edges = []
        accumulated = 0.0
        previous_index = 0
        previous_id = origin["id"]
        for order, node in enumerate(ordered, start=1):
            node_index = index_by_id[node["id"]]
            transition = matrix[previous_index][node_index]
            accumulated += transition
            sequence.append(
                {
                    "order": order,
                    "nodeId": node["id"],
                    "nombre": node.get("nombre", node["id"]),
                    "center": node.get("center"),
                    "transitionCost": round(transition, 6),
                    "accumulatedCost": round(accumulated, 6),
                    "priorityScore": node.get("prioridad_score", 0),
                    "personasAfectadasEstimadas": node.get("personas_afectadas_estimadas", 0),
                }
            )
            edges.append(
                {
                    "source": previous_id,
                    "target": node["id"],
                    "weight": round(transition, 6),
                    "isSequence": True,
                    "edge_type": "logical",
                }
            )
            previous_index = node_index
            previous_id = node["id"]

        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        logger.info(
            "TSP run: destinations=%s criterion=%s used_fallback=%s explored_states=%s elapsed_ms=%s",
            len(destinations),
            criterion,
            bool(result.get("used_fallback")),
            int(result.get("explored_states", 0) or 0),
            elapsed_ms,
        )
        return {
            "origin": origin,
            "criterion": criterion,
            "sequence": sequence,
            "edges": edges,
            "routePoints": result.get("route_points", []),
            "summary": {
                "totalCost": round(float(result.get("total_distance", 0) or 0), 6),
                "bestCost": round(float(result.get("best_cost", 0) or 0), 6),
                "visitedNodes": len(sequence),
                "exploredStates": int(result.get("explored_states", 0) or 0),
                "cacheHits": int(result.get("cache_hits", 0) or 0),
                "cacheMisses": int(result.get("cache_misses", 0) or 0),
                "usedFallback": bool(result.get("used_fallback")),
            },
            "metadata": {
                "algorithm": "tsp_memoization",
                "implementation": "python",
                "generatedAt": datetime.now().replace(microsecond=0).isoformat(),
                "executionMs": elapsed_ms,
            },
        }
