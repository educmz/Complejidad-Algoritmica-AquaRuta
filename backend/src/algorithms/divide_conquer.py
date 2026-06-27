from statistics import mean
import math


def _zone_value(zone, key, default=None):
    return zone.get(key, default) if hasattr(zone, "get") else getattr(zone, key, default)


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
    return 0.0, 0.0


def _sector_criticality(interruptions):
    if interruptions >= 2500:
        return "critica"
    if interruptions >= 1200:
        return "alta"
    if interruptions >= 450:
        return "media"
    return "baja"


def _split_by_geography(zones):
    latitudes = [_zone_center(zone)[0] for zone in zones]
    longitudes = [_zone_center(zone)[1] for zone in zones]
    axis = 1 if (max(longitudes) - min(longitudes) if longitudes else 0) >= (max(latitudes) - min(latitudes) if latitudes else 0) else 0
    ordered = sorted(zones, key=lambda zone: _zone_center(zone)[axis])
    middle = len(ordered) // 2
    return ordered[:middle], ordered[middle:]


def _split_axis(zones):
    latitudes = [_zone_center(zone)[0] for zone in zones]
    longitudes = [_zone_center(zone)[1] for zone in zones]
    lat_spread = max(latitudes) - min(latitudes) if latitudes else 0
    lon_spread = max(longitudes) - min(longitudes) if longitudes else 0
    return "longitude" if lon_spread >= lat_spread else "latitude"


def _stable_zone_id(zone):
    return str(_zone_value(zone, "id", _zone_name(zone)))


def _balanced_split(zones, criterion):
    if criterion == "carga":
        left, right = _split_by_load(zones)
        if left and right and len(left) < len(zones) and len(right) < len(zones):
            return left, right, "load"
    axis = _split_axis(zones)
    axis_index = 1 if axis == "longitude" else 0
    if criterion == "prioridad":
        ordered = sorted(
            zones,
            key=lambda zone: (-float(_zone_value(zone, "prioridad_score", 0) or 0), _stable_zone_id(zone)),
        )
        split_by = "priority"
    elif criterion == "mixto":
        ordered = sorted(
            zones,
            key=lambda zone: (_zone_center(zone)[axis_index], -_operational_load(zone), _stable_zone_id(zone)),
        )
        split_by = f"mixed_{axis}"
    else:
        ordered = sorted(zones, key=lambda zone: (_zone_center(zone)[axis_index], _stable_zone_id(zone)))
        split_by = axis
    middle = len(ordered) // 2
    left, right = ordered[:middle], ordered[middle:]
    if not left or not right or len(left) >= len(zones) or len(right) >= len(zones):
        ordered = sorted(zones, key=_stable_zone_id)
        middle = max(1, len(ordered) // 2)
        left, right = ordered[:middle], ordered[middle:]
        split_by = "stable_index"
    return left, right, split_by


def _operational_load(zone):
    return (
        float(_zone_value(zone, "interrupciones", 0) or 0)
        + float(_zone_value(zone, "personas_afectadas_estimadas", 0) or 0) / 100
        + float(_zone_value(zone, "prioridad_score", 0) or 0) * 250
    )


def _split_by_load(zones):
    ordered = sorted(zones, key=_operational_load, reverse=True)
    left, right = [], []
    left_load = 0.0
    right_load = 0.0
    for zone in ordered:
        load = _operational_load(zone)
        if left_load <= right_load:
            left.append(zone)
            left_load += load
        else:
            right.append(zone)
            right_load += load
    return left, right


def _aggregate(part):
    people = sum(int(_zone_value(zone, "personas_afectadas_estimadas", 0) or 0) for zone in part)
    event_connections = sum(int(_zone_value(zone, "conexiones_afectadas_evento_max", 0) or 0) for zone in part)
    if event_connections:
        avg_home = sum(
            float(_zone_value(zone, "promedio_integrantes_hogar", 3.45) or 3.45)
            * int(_zone_value(zone, "conexiones_afectadas_evento_max", 0) or 0)
            for zone in part
        ) / event_connections
    else:
        avg_home = mean(float(_zone_value(zone, "promedio_integrantes_hogar", 3.45) or 3.45) for zone in part)
    return {
        "personas_afectadas_estimadas": int(people),
        "peso_demanda_familiar": round(max(float(_zone_value(zone, "peso_demanda_familiar", 0) or 0) for zone in part), 4),
        "prioridad_score": round(mean(float(_zone_value(zone, "prioridad_score", 0) or 0) for zone in part), 4),
        "promedio_integrantes_hogar": round(avg_home, 2),
    }


def sectorizar_divide_conquer(zones, sector_count=4, criterion="geografico"):
    zones = [zone for zone in zones if zone is not None]
    if not zones:
        return []
    sector_count = max(1, min(int(sector_count), len(zones)))
    max_sector_size = max(1, math.ceil(len(zones) / sector_count))
    result = sectorize_divide_and_conquer(
        zones,
        max_sector_size=max_sector_size,
        split_criterion=criterion,
        max_depth=10,
    )
    parts = [sector["nodes"] for sector in result["sectors"]]
    sectors = []
    for index, part in enumerate(parts, start=1):
        interruptions = sum(int(_zone_value(zone, "interrupciones", 0)) for zone in part)
        centers = [_zone_center(zone) for zone in part]
        center = [
            round(sum(point[0] for point in centers) / len(centers), 6),
            round(sum(point[1] for point in centers) / len(centers), 6),
        ]
        sectors.append(
            {
                "id": f"sector-{index}",
                "nombre": f"Sector {index}",
                "zona_ids": [_zone_value(zone, "id") for zone in part],
                "zonas": [_zone_name(zone) for zone in part],
                "cantidad_zonas": len(part),
                "interrupciones": interruptions,
                "criticidad": _sector_criticality(interruptions),
                "center": center,
                "criterio": criterion,
                **_aggregate(part),
            }
        )
    sectors = sorted(sectors, key=lambda sector: sector["prioridad_score"], reverse=True)
    for index, sector in enumerate(sectors, start=1):
        sector["id"] = f"sector-{index}"
        sector["nombre"] = f"Sector {index}"
    return sectors


def sectorize_divide_and_conquer(
    nodes,
    max_sector_size=8,
    split_criterion="geografico",
    max_depth=10,
):
    nodes = [node for node in nodes if node is not None]
    if not nodes:
        raise ValueError("No hay nodos para sectorizar.")
    ids = [_stable_zone_id(node) for node in nodes]
    if len(ids) != len(set(ids)):
        raise ValueError("La lista de nodos contiene ids duplicados.")
    max_sector_size = int(max_sector_size)
    max_depth = int(max_depth)
    if max_sector_size < 1:
        raise ValueError("max_sector_size debe ser mayor que cero.")
    if max_depth < 0:
        raise ValueError("max_depth no puede ser negativo.")
    if split_criterion not in {"geografico", "carga", "mixto", "prioridad"}:
        raise ValueError("Criterio de sectorizacion no permitido.")

    metrics = {
        "recursive_calls": 0,
        "split_count": 0,
        "base_case_count": 0,
        "max_depth_reached": 0,
        "input_nodes": len(nodes),
        "output_sectors": 0,
    }
    warnings = []
    split_trace = []

    def base_sector(part, depth, reason):
        metrics["base_case_count"] += 1
        metrics["max_depth_reached"] = max(metrics["max_depth_reached"], depth)
        if reason == "MAX_DEPTH_REACHED" and len(part) > max_sector_size:
            warnings.append(
                {
                    "code": "MAX_DEPTH_REACHED",
                    "size": len(part),
                    "maxSectorSize": max_sector_size,
                    "depth": depth,
                }
            )
        return [
            {
                "nodes": sorted(part, key=_stable_zone_id),
                "depth": depth,
                "base_case": reason,
            }
        ]

    def solve(part, depth):
        metrics["recursive_calls"] += 1
        metrics["max_depth_reached"] = max(metrics["max_depth_reached"], depth)
        part = sorted(part, key=_stable_zone_id)
        if not part:
            return []
        if len(part) <= max_sector_size:
            return base_sector(part, depth, "MAX_SIZE_REACHED")
        if depth >= max_depth:
            return base_sector(part, depth, "MAX_DEPTH_REACHED")

        left, right, split_by = _balanced_split(part, split_criterion)
        if not left or not right or len(left) >= len(part) or len(right) >= len(part):
            ordered = sorted(part, key=_stable_zone_id)
            middle = max(1, len(ordered) // 2)
            left, right = ordered[:middle], ordered[middle:]
            split_by = "stable_index"
        if not left or not right:
            return base_sector(part, depth, "NON_REDUCING_SPLIT")

        metrics["split_count"] += 1
        split_trace.append(
            {
                "depth": depth,
                "criterion": split_criterion,
                "splitBy": split_by,
                "leftSize": len(left),
                "rightSize": len(right),
            }
        )
        left_sectors = solve(left, depth + 1)
        right_sectors = solve(right, depth + 1)
        return left_sectors + right_sectors

    sectors = solve(nodes, 0)
    metrics["output_sectors"] = len(sectors)
    sizes = [len(sector["nodes"]) for sector in sectors]
    metrics["largest_sector_size"] = max(sizes) if sizes else 0
    metrics["smallest_sector_size"] = min(sizes) if sizes else 0
    metrics["average_sector_size"] = round(sum(sizes) / len(sizes), 4) if sizes else 0
    metrics["estimated_complexity"] = "O(n log n) aproximado para divisiones equilibradas con ordenamiento por nivel"
    return {
        "sectors": sectors,
        "metrics": metrics,
        "warnings": warnings,
        "split_trace": split_trace,
    }
