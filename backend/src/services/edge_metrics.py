from __future__ import annotations

from math import asin, cos, isfinite, radians, sin, sqrt
from typing import Any

from config.operational_constants import (
    AVERAGE_SPEED_KMH,
    DISTANCE_COST_FACTOR,
    ROAD_DISTANCE_FACTOR,
    TIME_COST_FACTOR,
)


def node_value(node: dict[str, Any], key: str, default: Any = 0) -> Any:
    return node.get(key, default) if hasattr(node, "get") else default


def center_from_node(node: dict[str, Any]) -> list[float] | None:
    center = node.get("center")
    if isinstance(center, list) and len(center) == 2:
        lat = float(center[0])
        lon = float(center[1])
    elif node.get("lat") is not None and node.get("lon") is not None:
        lat = float(node["lat"])
        lon = float(node["lon"])
    else:
        return None
    if not isfinite(lat) or not isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        return None
    return [lat, lon]


def haversine_km(a: list[float], b: list[float]) -> float:
    lat1, lon1 = a
    lat2, lon2 = b
    radius = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    rlat1 = radians(lat1)
    rlat2 = radians(lat2)
    h = sin(dlat / 2) ** 2 + cos(rlat1) * cos(rlat2) * sin(dlon / 2) ** 2
    return 2 * radius * asin(sqrt(h))


def traffic_factor(source: dict[str, Any], target: dict[str, Any]) -> float:
    interruptions = max(
        int(node_value(source, "interrupciones", 0) or 0),
        int(node_value(target, "interrupciones", 0) or 0),
    )
    duration = max(
        float(node_value(source, "duracion_promedio_horas", 0) or 0),
        float(node_value(target, "duracion_promedio_horas", 0) or 0),
    )
    demand = max(
        float(node_value(source, "peso_demanda_familiar", 0) or 0),
        float(node_value(target, "peso_demanda_familiar", 0) or 0),
    )
    priority = max(
        float(node_value(source, "prioridad_score", 0) or 0),
        float(node_value(target, "prioridad_score", 0) or 0),
    )
    criticality = {"critica": 1.2, "alta": 1.12, "media": 1.06, "baja": 1.0}
    crit_source = str(node_value(source, "criticidad", "baja")).lower()
    crit_target = str(node_value(target, "criticidad", "baja")).lower()
    return (
        max(criticality.get(crit_source, 1.0), criticality.get(crit_target, 1.0))
        + min(0.25, interruptions / 12000)
        + min(0.15, duration / 240)
        + min(0.10, demand * 0.10)
        + min(0.08, priority * 0.08)
    )


def build_edge_metrics(source: dict[str, Any], target: dict[str, Any]) -> dict[str, float]:
    source_center = center_from_node(source)
    target_center = center_from_node(target)
    if not source_center or not target_center:
        raise ValueError("No se pueden calcular metricas sin coordenadas validas.")
    distance_km = haversine_km(source_center, target_center)
    road_distance_km = distance_km * ROAD_DISTANCE_FACTOR
    traffic = traffic_factor(source, target)
    duration_min = (road_distance_km / AVERAGE_SPEED_KMH) * 60 * traffic
    operational_cost = road_distance_km * DISTANCE_COST_FACTOR + duration_min * TIME_COST_FACTOR
    return {
        "distance_km": round(distance_km, 6),
        "road_distance_km": round(road_distance_km, 6),
        "duration_min": round(duration_min, 6),
        "operational_cost": round(operational_cost, 6),
        "traffic_factor": round(traffic, 6),
        "distance_weight": round(road_distance_km, 6),
        "time_weight": round(duration_min, 6),
        "cost_weight": round(operational_cost, 6),
    }


def criterion_to_weight_field(criterion: str) -> str:
    normalized = str(criterion or "").strip().lower()
    aliases = {
        "distance": "distancia",
        "time": "tiempo",
        "cost": "costo",
    }
    normalized = aliases.get(normalized, normalized)
    mapping = {
        "distancia": "distance_weight",
        "tiempo": "time_weight",
        "costo": "cost_weight",
    }
    if normalized not in mapping:
        raise ValueError("Criterio Dijkstra no permitido.")
    return mapping[normalized]


def normalize_criterion(criterion: str) -> str:
    normalized = str(criterion or "").strip().lower()
    return {"distance": "distancia", "time": "tiempo", "cost": "costo"}.get(normalized, normalized)
