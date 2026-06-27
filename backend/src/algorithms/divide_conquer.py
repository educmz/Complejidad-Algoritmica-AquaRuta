from statistics import mean


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


def _divide_zones(zones, desired_parts, criterion):
    if desired_parts <= 1 or len(zones) <= 1:
        return [zones]
    left_parts = desired_parts // 2
    right_parts = desired_parts - left_parts
    if criterion == "carga":
        left, right = _split_by_load(zones)
    elif criterion == "mixto":
        geo_left, geo_right = _split_by_geography(zones)
        if abs(len(geo_left) - len(geo_right)) > 1:
            left, right = _split_by_load(zones)
        else:
            left, right = geo_left, geo_right
    else:
        left, right = _split_by_geography(zones)
    if not left or not right:
        middle = max(1, len(zones) // 2)
        left, right = zones[:middle], zones[middle:]
    return _divide_zones(left, left_parts, criterion) + _divide_zones(right, right_parts, criterion)


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
    parts = _divide_zones(zones, sector_count, criterion)
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
