from __future__ import annotations

import json
import logging
import math
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from algorithms.backtracking import solve_backtracking
from config.algorithm_limits import MAX_BACKTRACKING_NODES, MAX_BACKTRACKING_VISITS
from services.edge_metrics import build_edge_metrics, center_from_node, normalize_criterion


logger = logging.getLogger("aquaruta.backtracking")

MAX_DISTANCE = 2000.0
MAX_DURATION = 5000.0
MAX_OPERATIONAL_COST = 50000.0


class BacktrackingServiceError(ValueError):
    pass


def normalize_backtracking_criterion(value: str) -> str:
    criterion = normalize_criterion(value)
    if criterion == "priority":
        criterion = "prioridad"
    if criterion not in {"distancia", "tiempo", "costo", "prioridad"}:
        raise BacktrackingServiceError("Criterio Backtracking no permitido.")
    return criterion


def _finite_optional(value: Any, field_name: str, maximum: float):
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise BacktrackingServiceError(f"{field_name} debe ser numerico.") from exc
    if not math.isfinite(number) or number < 0 or number > maximum:
        raise BacktrackingServiceError(f"{field_name} esta fuera de rango.")
    return number


def _clean_origin(origin: dict[str, Any]) -> dict[str, Any]:
    center = center_from_node(origin)
    if not center:
        raise BacktrackingServiceError("El origen EPS no tiene coordenadas validas.")
    return {
        "id": origin["id"],
        "nombre": origin.get("prestador", origin["id"]),
        "center": center,
        "isEpsNode": True,
        "interrupciones": 0,
        "criticidad": "baja",
        "duracion_promedio_horas": 0,
        "peso_demanda_familiar": 0,
        "prioridad_score": 0,
    }


def _clean_destination(node: dict[str, Any]) -> dict[str, Any]:
    center = center_from_node(node)
    if not center:
        raise BacktrackingServiceError(f"El destino {node.get('id')} no tiene coordenadas validas.")
    return {
        "id": node["id"],
        "nombre": node.get("nombre", node.get("distrito", node["id"])),
        "center": center,
        "interrupciones": int(node.get("interrupciones", 0) or 0),
        "criticidad": node.get("criticidad", "baja"),
        "duracion_promedio_horas": float(node.get("duracion_promedio_horas", 0) or 0),
        "personas_afectadas_estimadas": int(node.get("personas_afectadas_estimadas", 0) or 0),
        "peso_demanda_familiar": float(node.get("peso_demanda_familiar", 0) or 0),
        "prioridad_score": float(node.get("prioridad_score", 0) or 0),
    }


class BacktrackingService:
    def __init__(
        self,
        root: Path,
        districts: list[dict[str, Any]] | None = None,
        eps_origins: list[dict[str, Any]] | None = None,
    ):
        self.root = root
        self._static_districts = districts
        self._static_eps_origins = eps_origins
        self._districts_cache = None
        self._districts_mtime = None
        self._eps_cache = None
        self._eps_mtime = None

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
            raise BacktrackingServiceError(f"{filename} debe contener una lista.")
        setattr(self, cache_attr, payload)
        setattr(self, mtime_attr, mtime)
        return list(payload)

    def _districts(self):
        return self._load_json_list("districts_summary.json", "_districts_cache", "_districts_mtime", self._static_districts)

    def _eps_origins(self):
        return self._load_json_list("eps_origins.json", "_eps_cache", "_eps_mtime", self._static_eps_origins)

    def _resolve_origin(self, origin_id: str):
        origins = {origin.get("id"): origin for origin in self._eps_origins()}
        origin = origins.get(origin_id)
        if not origin:
            raise BacktrackingServiceError("Origen EPS no encontrado.")
        return _clean_origin(origin)

    def _resolve_destinations(self, destination_ids: list[str], max_destinations: int):
        if len(destination_ids) != len(set(destination_ids)):
            raise BacktrackingServiceError("La lista de destinos contiene ids duplicados.")
        if len(destination_ids) > max_destinations:
            raise BacktrackingServiceError(f"Solo se permiten hasta {max_destinations} destinos.")
        districts = {district.get("id"): district for district in self._districts()}
        missing = [destination_id for destination_id in destination_ids if destination_id not in districts]
        if missing:
            raise BacktrackingServiceError(f"Destinos no encontrados: {', '.join(missing)}.")
        return [_clean_destination(districts[destination_id]) for destination_id in destination_ids]

    def _normalize_constraints(self, constraints: dict[str, Any] | None, destination_count: int):
        constraints = dict(constraints or {})
        max_visits = constraints.get("maxVisits", constraints.get("max_visits"))
        if max_visits is None:
            max_visits = min(destination_count, 4)
        max_visits = int(max_visits)
        if max_visits < 1 or max_visits > MAX_BACKTRACKING_VISITS:
            raise BacktrackingServiceError(f"maxVisits debe estar entre 1 y {MAX_BACKTRACKING_VISITS}.")
        return {
            "max_distance_km": _finite_optional(
                constraints.get("maxDistanceKm", constraints.get("max_distance_km")),
                "maxDistanceKm",
                MAX_DISTANCE,
            ),
            "max_duration_min": _finite_optional(
                constraints.get("maxDurationMin", constraints.get("max_duration_min")),
                "maxDurationMin",
                MAX_DURATION,
            ),
            "max_operational_cost": _finite_optional(
                constraints.get("maxOperationalCost", constraints.get("max_operational_cost")),
                "maxOperationalCost",
                MAX_OPERATIONAL_COST,
            ),
            "max_visits": min(max_visits, destination_count),
        }

    def _build_metrics_matrix(self, origin: dict[str, Any], destinations: list[dict[str, Any]]):
        nodes = [origin, *destinations]
        matrix = []
        for source in nodes:
            row = []
            for target in nodes:
                if source["id"] == target["id"]:
                    row.append(
                        {
                            "distance_km": 0.0,
                            "road_distance_km": 0.0,
                            "duration_min": 0.0,
                            "operational_cost": 0.0,
                            "traffic_factor": 1.0,
                            "distance_weight": 0.0,
                            "time_weight": 0.0,
                            "cost_weight": 0.0,
                        }
                    )
                else:
                    row.append(build_edge_metrics(source, target))
            matrix.append(row)
        return matrix

    def run(
        self,
        origin_id: str,
        destination_ids: list[str],
        criterion: str = "distancia",
        constraints: dict[str, Any] | None = None,
        max_exact_nodes: int = MAX_BACKTRACKING_NODES,
    ):
        started = time.perf_counter()
        criterion = normalize_backtracking_criterion(criterion)
        if max_exact_nodes < 1 or max_exact_nodes > MAX_BACKTRACKING_NODES:
            raise BacktrackingServiceError(f"maxExactNodes debe estar entre 1 y {MAX_BACKTRACKING_NODES}.")

        origin = self._resolve_origin(origin_id)
        destination_ids = [str(item) for item in destination_ids]
        if origin["id"] in destination_ids:
            raise BacktrackingServiceError("El origen no puede repetirse como destino.")
        if not destination_ids:
            elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
            return self._empty_response(origin, criterion, elapsed_ms)

        destinations = self._resolve_destinations(destination_ids, max_destinations=60)
        applied_constraints = self._normalize_constraints(constraints, len(destinations))
        used_fallback = False
        candidate_destinations = destinations
        if len(destinations) > max_exact_nodes:
            used_fallback = True
            candidate_destinations = sorted(
                destinations,
                key=lambda node: node.get("prioridad_score", 0),
                reverse=True,
            )[:max_exact_nodes]
            applied_constraints["max_visits"] = min(applied_constraints["max_visits"], max_exact_nodes)

        matrix = self._build_metrics_matrix(origin, candidate_destinations)
        result = solve_backtracking(
            origin,
            candidate_destinations,
            matrix,
            constraints=applied_constraints,
            criterion=criterion,
            used_fallback=used_fallback,
        )
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        response = self._response_from_result(
            origin,
            destinations,
            candidate_destinations,
            matrix,
            criterion,
            applied_constraints,
            result,
            elapsed_ms,
        )
        logger.info(
            "Backtracking run: destinations=%s criterion=%s constraints=%s explored=%s pruned=%s backtracks=%s feasible=%s fallback=%s elapsed_ms=%s",
            len(destinations),
            criterion,
            {key: value for key, value in applied_constraints.items() if value is not None},
            response["summary"]["exploredStates"],
            response["summary"]["prunedBranches"],
            response["summary"]["backtracks"],
            response["feasible"],
            response["summary"]["usedFallback"],
            elapsed_ms,
        )
        return response

    def _empty_response(self, origin, criterion, elapsed_ms):
        return {
            "origin": origin,
            "criterion": criterion,
            "objective": "maximize_visits_then_minimize_distancia",
            "feasible": False,
            "sequence": [],
            "edges": [],
            "routePoints": [origin["center"]],
            "unvisitedDestinations": [],
            "summary": {
                "visitedDestinations": 0,
                "totalDistanceKm": 0.0,
                "totalDurationMin": 0.0,
                "totalOperationalCost": 0.0,
                "objectiveValue": 0.0,
                "exploredStates": 0,
                "prunedBranches": 0,
                "backtracks": 0,
                "usedFallback": False,
            },
            "metadata": {
                "algorithm": "backtracking",
                "implementation": "python",
                "generatedAt": datetime.now().replace(microsecond=0).isoformat(),
                "executionMs": elapsed_ms,
            },
        }

    def _response_from_result(
        self,
        origin,
        all_destinations,
        candidate_destinations,
        matrix,
        criterion,
        constraints,
        result,
        elapsed_ms,
    ):
        candidate_lookup = {destination["id"]: index + 1 for index, destination in enumerate(candidate_destinations)}
        sequence = []
        edges = []
        route_points = [origin["center"]]
        accumulated_distance = 0.0
        accumulated_duration = 0.0
        accumulated_cost = 0.0
        previous_index = 0
        previous_id = origin["id"]
        selected_ids = set()
        for order, node in enumerate(result.get("sequence", []), start=1):
            node_index = candidate_lookup[node["id"]]
            transition = matrix[previous_index][node_index]
            accumulated_distance += transition["distance_km"]
            accumulated_duration += transition["duration_min"]
            accumulated_cost += transition["operational_cost"]
            selected_ids.add(node["id"])
            route_points.append(node["center"])
            sequence.append(
                {
                    "order": order,
                    "nodeId": node["id"],
                    "nombre": node.get("nombre", node["id"]),
                    "center": node.get("center"),
                    "transitionDistanceKm": transition["distance_km"],
                    "transitionDurationMin": transition["duration_min"],
                    "transitionOperationalCost": transition["operational_cost"],
                    "accumulatedDistanceKm": round(accumulated_distance, 6),
                    "accumulatedDurationMin": round(accumulated_duration, 6),
                    "accumulatedCost": round(accumulated_cost, 6),
                    "priorityScore": node.get("prioridad_score", 0),
                    "personasAfectadasEstimadas": node.get("personas_afectadas_estimadas", 0),
                }
            )
            edges.append(
                {
                    "source": previous_id,
                    "target": node["id"],
                    "distanceKm": transition["distance_km"],
                    "durationMin": transition["duration_min"],
                    "operationalCost": transition["operational_cost"],
                    "isSelected": True,
                    "edge_type": "logical",
                }
            )
            previous_index = node_index
            previous_id = node["id"]

        unvisited = [
            {
                "id": node["id"],
                "nombre": node.get("nombre", node["id"]),
                "center": node.get("center"),
            }
            for node in all_destinations
            if node["id"] not in selected_ids
        ]
        totals = result.get("totals", {})
        return {
            "origin": origin,
            "criterion": criterion,
            "objective": result["objective"],
            "constraints": {
                "maxDistanceKm": constraints["max_distance_km"],
                "maxDurationMin": constraints["max_duration_min"],
                "maxOperationalCost": constraints["max_operational_cost"],
                "maxVisits": constraints["max_visits"],
            },
            "feasible": bool(result["feasible"]),
            "sequence": sequence,
            "edges": edges,
            "routePoints": route_points,
            "unvisitedDestinations": unvisited,
            "summary": {
                "visitedDestinations": len(sequence),
                "totalDistanceKm": totals.get("distance_km", 0.0),
                "totalRoadDistanceKm": totals.get("road_distance_km", 0.0),
                "totalDurationMin": totals.get("duration_min", 0.0),
                "totalOperationalCost": totals.get("operational_cost", 0.0),
                "priorityTotal": result.get("priority_total", 0.0),
                "objectiveValue": result["objective_value"],
                "exploredStates": result["explored_states"],
                "prunedBranches": result["pruned_branches"],
                "backtracks": result["backtracks"],
                "usedFallback": bool(result["used_fallback"]),
                "finalStateRestored": bool(result.get("final_state_restored")),
            },
            "metadata": {
                "algorithm": "backtracking",
                "implementation": "python",
                "generatedAt": datetime.now().replace(microsecond=0).isoformat(),
                "executionMs": elapsed_ms,
            },
        }
