from collections import defaultdict
from math import asin, cos, floor, radians, sin, sqrt
from statistics import mean


DEFAULT_GROUPING_CONFIG = {
    "criterio": "combinado",
    "umbral_distancia_geografica_km": 25.0,
    "umbral_distancia_vial_km": 35.0,
    "umbral_tiempo_min": 75.0,
    "umbral_costo": 260.0,
    "velocidad_promedio_kmh": 28.0,
    "factor_vial": 1.35,
    "max_vecinos_candidatos": 12,
    "max_rechazos_por_nodo": 4,
    "max_rechazos_globales": 250,
}


def _zone_value(zone, key, default=None):
    if hasattr(zone, "get"):
        return zone.get(key, default)
    return getattr(zone, key, default)


def _zone_name(zone):
    return str(_zone_value(zone, "nombre", _zone_value(zone, "name", "Zona")))


def _zone_center(zone):
    center = _zone_value(zone, "center", None)
    if center and len(center) == 2:
        return float(center[0]), float(center[1])
    lat = _zone_value(zone, "lat", None)
    lon = _zone_value(zone, "lon", None)
    if lat is not None and lon is not None:
        return float(lat), float(lon)
    return None


def _distance_km(center_a, center_b):
    lat1, lon1 = center_a
    lat2, lon2 = center_b
    radius = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    rlat1 = radians(lat1)
    rlat2 = radians(lat2)
    h = sin(dlat / 2) ** 2 + cos(rlat1) * cos(rlat2) * sin(dlon / 2) ** 2
    return 2 * radius * asin(sqrt(h))


def _group_criticality(interruptions):
    if interruptions >= 500:
        return "critica"
    if interruptions >= 200:
        return "alta"
    if interruptions >= 50:
        return "media"
    return "baja"


def _traffic_factor(zone_a, zone_b):
    interruptions = max(
        int(_zone_value(zone_a, "interrupciones", 0) or 0),
        int(_zone_value(zone_b, "interrupciones", 0) or 0),
    )
    duration = max(
        float(_zone_value(zone_a, "duracion_promedio_horas", 0) or 0),
        float(_zone_value(zone_b, "duracion_promedio_horas", 0) or 0),
    )
    demand = max(
        float(_zone_value(zone_a, "peso_demanda_familiar", 0) or 0),
        float(_zone_value(zone_b, "peso_demanda_familiar", 0) or 0),
    )
    criticality = {"critica": 1.2, "alta": 1.12, "media": 1.06, "baja": 1.0}
    crit_a = str(_zone_value(zone_a, "criticidad", "baja")).lower()
    crit_b = str(_zone_value(zone_b, "criticidad", "baja")).lower()
    return (
        max(criticality.get(crit_a, 1.0), criticality.get(crit_b, 1.0))
        + min(0.25, interruptions / 12000)
        + min(0.15, duration / 240)
        + min(0.10, demand * 0.10)
    )


def _road_metrics(zone_a, zone_b, geo_distance_km, config):
    road_distance_km = geo_distance_km * float(config["factor_vial"])
    traffic = _traffic_factor(zone_a, zone_b)
    duration_min = (
        road_distance_km / max(float(config["velocidad_promedio_kmh"]), 1.0)
    ) * 60 * traffic
    cost = road_distance_km * 4.6 + duration_min * 0.85
    return {
        "distancia_geografica_km": round(geo_distance_km, 3),
        "distancia_vial_estimada_km": round(road_distance_km, 3),
        "tiempo_estimado_min": round(duration_min, 1),
        "costo_estimado": round(cost, 1),
        "factor_trafico": round(traffic, 3),
    }


def _is_close(metrics, config):
    criterion = config["criterio"]
    geo_ok = metrics["distancia_geografica_km"] <= config["umbral_distancia_geografica_km"]
    road_ok = metrics["distancia_vial_estimada_km"] <= config["umbral_distancia_vial_km"]
    if criterion == "geografico":
        return geo_ok, "distancia geografica dentro del umbral" if geo_ok else "distancia geografica fuera del umbral"
    if criterion == "vial":
        return road_ok, "distancia vial estimada dentro del umbral" if road_ok else "distancia vial estimada fuera del umbral"
    close = geo_ok or road_ok
    return close, "cercania geografica o vial valida" if close else "sin cercania suficiente"


def _has_connectivity(metrics, config):
    road_ok = metrics["distancia_vial_estimada_km"] <= config["umbral_distancia_vial_km"]
    time_ok = metrics["tiempo_estimado_min"] <= config["umbral_tiempo_min"]
    cost_ok = metrics["costo_estimado"] <= config["umbral_costo"]
    connected = road_ok or (time_ok and cost_ok)
    if connected:
        if road_ok:
            return True, "conexion vial valida por distancia de red"
        return True, "ruta razonable valida por tiempo y costo"
    reasons = []
    if not road_ok:
        reasons.append("distancia vial excede umbral")
    if not time_ok:
        reasons.append("tiempo excede umbral")
    if not cost_ok:
        reasons.append("costo excede umbral")
    return False, ", ".join(reasons)


def _build_rejection(source, target, reason, metrics):
    return {
        "source": _zone_value(source, "id"),
        "sourceName": _zone_name(source),
        "target": _zone_value(target, "id"),
        "targetName": _zone_name(target),
        "reason": reason,
        "metrics": metrics,
    }


class UFDS:
    def __init__(self, size: int):
        self.parent = list(range(size))
        self.rank = [0] * size

    def find(self, x: int) -> int:
        if self.parent[x] != x:
            self.parent[x] = self.find(self.parent[x])
        return self.parent[x]

    def union(self, a: int, b: int) -> bool:
        root_a = self.find(a)
        root_b = self.find(b)
        if root_a == root_b:
            return False
        if self.rank[root_a] < self.rank[root_b]:
            self.parent[root_a] = root_b
        elif self.rank[root_a] > self.rank[root_b]:
            self.parent[root_b] = root_a
        else:
            self.parent[root_b] = root_a
            self.rank[root_a] += 1
        return True


def _merge_config(**kwargs):
    config = dict(DEFAULT_GROUPING_CONFIG)
    for key, value in kwargs.items():
        if value is not None and key in config:
            config[key] = value
    if config["criterio"] not in {"geografico", "vial", "combinado"}:
        config["criterio"] = "combinado"
    return config


def _candidate_search_radius(config):
    road_as_geo = float(config["umbral_distancia_vial_km"]) / max(float(config["factor_vial"]), 1)
    return max(float(config["umbral_distancia_geografica_km"]), road_as_geo)


def _cell_for(center, cell_size_deg):
    return floor(center[0] / cell_size_deg), floor(center[1] / cell_size_deg)


def _nearby_cell_keys(cell):
    for drow in (-1, 0, 1):
        for dcol in (-1, 0, 1):
            yield cell[0] + drow, cell[1] + dcol


def _build_candidate_pairs(zones, centers, config):
    search_radius_km = _candidate_search_radius(config)
    cell_size_deg = max(search_radius_km / 111.0, 0.05)
    grid = defaultdict(list)
    for index, center in centers.items():
        grid[_cell_for(center, cell_size_deg)].append(index)
    pairs = set()
    neighbor_limit = int(config["max_vecinos_candidatos"])
    for index, center in centers.items():
        candidates = []
        for cell_key in _nearby_cell_keys(_cell_for(center, cell_size_deg)):
            for other_index in grid.get(cell_key, []):
                if other_index == index:
                    continue
                distance = _distance_km(center, centers[other_index])
                if distance <= search_radius_km:
                    candidates.append((distance, other_index))
        candidates.sort(key=lambda item: item[0])
        for _, other_index in candidates[:neighbor_limit]:
            pairs.add(tuple(sorted((index, other_index))))
    return sorted(pairs)


def _evaluate_connection(zone_a, zone_b, config):
    center_a = _zone_center(zone_a)
    center_b = _zone_center(zone_b)
    if center_a is None or center_b is None:
        return {
            "should_union": False,
            "reason": "uno o ambos nodos no tienen centro geografico",
            "metrics": {},
        }
    geo_distance = _distance_km(center_a, center_b)
    metrics = _road_metrics(zone_a, zone_b, geo_distance, config)
    close, close_reason = _is_close(metrics, config)
    connected, connectivity_reason = _has_connectivity(metrics, config)
    if close and connected:
        return {
            "should_union": True,
            "reason": f"{close_reason}; {connectivity_reason}",
            "close_reason": close_reason,
            "connectivity_reason": connectivity_reason,
            "metrics": metrics,
        }
    reason = f"{close_reason}; {connectivity_reason}" if not close and not connected else (
        close_reason if not close else connectivity_reason
    )
    return {
        "should_union": False,
        "reason": reason,
        "close_reason": close_reason,
        "connectivity_reason": connectivity_reason,
        "metrics": metrics,
    }


def should_connect(zone_a, zone_b, **kwargs):
    return _evaluate_connection(zone_a, zone_b, _merge_config(**kwargs))["should_union"]


def _node_summary(zone, union_count, candidate_count, rejected):
    has_unions = union_count > 0
    if not has_unions and not rejected:
        reason = (
            "no se encontraron vecinos cercanos dentro de los umbrales configurados"
            if candidate_count == 0
            else "no se encontro union valida con los vecinos candidatos evaluados"
        )
        rejected = [
            {
                "source": _zone_value(zone, "id"),
                "sourceName": _zone_name(zone),
                "target": None,
                "targetName": "Sin vecino candidato",
                "reason": reason,
                "metrics": {},
            }
        ]
    return {
        "id": _zone_value(zone, "id"),
        "nombre": _zone_name(zone),
        "center": list(_zone_center(zone)) if _zone_center(zone) else None,
        "criticidad": _zone_value(zone, "criticidad", "baja"),
        "interrupciones": int(_zone_value(zone, "interrupciones", 0) or 0),
        "personas_afectadas_estimadas": int(_zone_value(zone, "personas_afectadas_estimadas", 0) or 0),
        "peso_demanda_familiar": float(_zone_value(zone, "peso_demanda_familiar", 0) or 0),
        "prioridad_score": float(_zone_value(zone, "prioridad_score", 0) or 0),
        "uniones_validas": union_count,
        "candidatos_evaluados": candidate_count,
        "rechazos_muestra": rejected,
        "aislado": not has_unions,
    }


def _aggregate_group_metrics(group_zones):
    people = sum(int(_zone_value(zone, "personas_afectadas_estimadas", 0) or 0) for zone in group_zones)
    event_connections = sum(int(_zone_value(zone, "conexiones_afectadas_evento_max", 0) or 0) for zone in group_zones)
    if event_connections:
        avg_home = sum(
            float(_zone_value(zone, "promedio_integrantes_hogar", 3.45) or 3.45)
            * int(_zone_value(zone, "conexiones_afectadas_evento_max", 0) or 0)
            for zone in group_zones
        ) / event_connections
    else:
        avg_home = mean(
            float(_zone_value(zone, "promedio_integrantes_hogar", 3.45) or 3.45)
            for zone in group_zones
        )
    return {
        "personas_afectadas_estimadas": int(people),
        "peso_demanda_familiar": round(max(float(_zone_value(zone, "peso_demanda_familiar", 0) or 0) for zone in group_zones), 4),
        "prioridad_score": round(mean(float(_zone_value(zone, "prioridad_score", 0) or 0) for zone in group_zones), 4),
        "promedio_integrantes_hogar": round(avg_home, 2),
    }


def build_groups_from_ufds(zones, ufds: UFDS, explainability, config):
    grouped_indices = {}
    for index in range(len(zones)):
        grouped_indices.setdefault(ufds.find(index), []).append(index)

    groups = []
    union_edges = explainability["union_edges"]
    for group_number, indices in enumerate(grouped_indices.values(), start=1):
        group_zones = [zones[index] for index in indices]
        zone_ids = {_zone_value(zone, "id") for zone in group_zones}
        interruptions = sum(int(_zone_value(zone, "interrupciones", 0) or 0) for zone in group_zones)
        centers = [_zone_center(zone) for zone in group_zones if _zone_center(zone) is not None]
        center = (
            [
                round(sum(point[0] for point in centers) / len(centers), 6),
                round(sum(point[1] for point in centers) / len(centers), 6),
            ]
            if centers
            else None
        )
        departments = sorted({
            str(_zone_value(zone, "departamento", "")).strip()
            for zone in group_zones
            if str(_zone_value(zone, "departamento", "")).strip()
        })
        provinces = sorted({
            str(_zone_value(zone, "provincia", "")).strip()
            for zone in group_zones
            if str(_zone_value(zone, "provincia", "")).strip()
        })
        group_edges = [edge for edge in union_edges if edge["source"] in zone_ids and edge["target"] in zone_ids]
        nodes = [
            _node_summary(
                zone,
                explainability["per_node_union_count"].get(_zone_value(zone, "id"), 0),
                explainability["per_node_candidate_count"].get(_zone_value(zone, "id"), 0),
                explainability["per_node_rejections"].get(_zone_value(zone, "id"), []),
            )
            for zone in group_zones
        ]
        isolated_nodes = [node for node in nodes if node["aislado"]]
        metrics = _aggregate_group_metrics(group_zones)
        groups.append(
            {
                "id": f"grupo-{group_number}",
                "nombre": f"Grupo {group_number}",
                "zona_ids": [_zone_value(zone, "id") for zone in group_zones],
                "zonas": [_zone_name(zone) for zone in group_zones],
                "nodos": nodes,
                "cantidad_zonas": len(group_zones),
                "cantidad_nodos": len(nodes),
                "interrupciones": interruptions,
                "criticidad": _group_criticality(interruptions),
                "prioridad": group_number,
                "center": center,
                "departamentos": departments,
                "provincias": provinces,
                **metrics,
                "criterio_agrupacion": {
                    "algoritmo": "UFDS / Union-Find",
                    "regla": "union solo si existe cercania y conectividad operativa",
                    "regla_union": "cercania suficiente AND conectividad valida",
                    "criterio": config["criterio"],
                    "umbral_distancia_geografica_km": config["umbral_distancia_geografica_km"],
                    "umbral_distancia_vial_km": config["umbral_distancia_vial_km"],
                    "umbral_tiempo_min": config["umbral_tiempo_min"],
                    "umbral_costo": config["umbral_costo"],
                    "nota": "Departamento/provincia no se usan como condicion de union.",
                },
                "explicabilidad": {
                    "formado_por": "cercania + conectividad" if group_edges else "nodo aislado sin union valida",
                    "uniones_validas": len(group_edges),
                    "uniones": group_edges,
                    "nodos_aislados": isolated_nodes,
                    "cantidad_nodos_aislados": len(isolated_nodes),
                },
                "es_aislado": len(group_zones) == 1,
            }
        )
    groups = sorted(groups, key=lambda group: group["prioridad_score"], reverse=True)
    for index, group in enumerate(groups, start=1):
        group["id"] = f"grupo-{index}"
        group["nombre"] = f"Grupo {index}"
        group["prioridad"] = index
    return groups


def agrupar_zonas_operativas(
    zones,
    max_distance_km=None,
    same_department=None,
    same_province=None,
    same_criticality=None,
    criterio="combinado",
    max_geographic_distance_km=None,
    max_road_distance_km=None,
    max_time_min=None,
    max_cost=None,
    average_speed_kmh=None,
    road_factor=None,
    max_candidate_neighbors=None,
):
    zones = [zone for zone in zones if zone is not None]
    if not zones:
        return []
    config = _merge_config(
        criterio=criterio,
        umbral_distancia_geografica_km=max_geographic_distance_km or max_distance_km,
        umbral_distancia_vial_km=max_road_distance_km,
        umbral_tiempo_min=max_time_min,
        umbral_costo=max_cost,
        velocidad_promedio_kmh=average_speed_kmh,
        factor_vial=road_factor,
        max_vecinos_candidatos=max_candidate_neighbors,
    )
    ufds = UFDS(len(zones))
    centers = {index: _zone_center(zone) for index, zone in enumerate(zones) if _zone_center(zone) is not None}
    candidate_pairs = _build_candidate_pairs(zones, centers, config)
    explainability = {
        "candidate_pairs": len(candidate_pairs),
        "union_edges": [],
        "global_rejections": [],
        "per_node_union_count": defaultdict(int),
        "per_node_candidate_count": defaultdict(int),
        "per_node_rejections": defaultdict(list),
    }
    max_rejections_per_node = int(config["max_rechazos_por_nodo"])
    max_global_rejections = int(config["max_rechazos_globales"])
    for source_index, target_index in candidate_pairs:
        source = zones[source_index]
        target = zones[target_index]
        explainability["per_node_candidate_count"][_zone_value(source, "id")] += 1
        explainability["per_node_candidate_count"][_zone_value(target, "id")] += 1
        result = _evaluate_connection(source, target, config)
        if result["should_union"]:
            if ufds.union(source_index, target_index):
                edge = {
                    "source": _zone_value(source, "id"),
                    "sourceName": _zone_name(source),
                    "target": _zone_value(target, "id"),
                    "targetName": _zone_name(target),
                    "edge_type": "logical",
                    "reason": result["reason"],
                    "criterio_union": "cercania + conectividad",
                    "cercania": result["close_reason"],
                    "conectividad": result["connectivity_reason"],
                    "metrics": result["metrics"],
                }
                explainability["union_edges"].append(edge)
                explainability["per_node_union_count"][edge["source"]] += 1
                explainability["per_node_union_count"][edge["target"]] += 1
            continue
        rejection = _build_rejection(source, target, result["reason"], result["metrics"])
        if len(explainability["global_rejections"]) < max_global_rejections:
            explainability["global_rejections"].append(rejection)
        for node_id in (rejection["source"], rejection["target"]):
            if len(explainability["per_node_rejections"][node_id]) < max_rejections_per_node:
                explainability["per_node_rejections"][node_id].append(rejection)
    groups = build_groups_from_ufds(zones, ufds, explainability, config)
    isolated_groups = sum(1 for group in groups if group["es_aislado"])
    isolated_nodes = sum(group["explicabilidad"]["cantidad_nodos_aislados"] for group in groups)
    global_summary = {
        "total_nodos": len(zones),
        "total_grupos": len(groups),
        "grupos_aislados": isolated_groups,
        "grupos_pequenos_no_aislados": sum(
            1 for group in groups if not group["es_aislado"] and int(group.get("cantidad_nodos", 0) or 0) <= 2
        ),
        "nodos_sin_conexion_suficiente": isolated_nodes,
        "pares_candidatos_evaluados": explainability["candidate_pairs"],
        "uniones_validas": len(explainability["union_edges"]),
        "rechazos_muestra": explainability["global_rejections"],
    }
    for group in groups:
        group["resumen_ufds"] = global_summary
    return groups
