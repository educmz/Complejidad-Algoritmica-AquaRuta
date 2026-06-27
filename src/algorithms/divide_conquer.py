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

    lat_span = max(latitudes) - min(latitudes) if latitudes else 0
    lon_span = max(longitudes) - min(longitudes) if longitudes else 0

    axis = 1 if lon_span >= lat_span else 0
    ordered = sorted(zones, key=lambda zone: _zone_center(zone)[axis])

    middle = len(ordered) // 2
    return ordered[:middle], ordered[middle:]


def _split_by_load(zones):
    ordered = sorted(
        zones,
        key=lambda zone: float(_zone_value(zone, "interrupciones", 0)),
        reverse=True,
    )

    left = []
    right = []
    left_load = 0
    right_load = 0

    for zone in ordered:
        load = float(_zone_value(zone, "interrupciones", 0))
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
            }
        )

    sectors = sorted(sectors, key=lambda sector: sector["interrupciones"], reverse=True)
    for index, sector in enumerate(sectors, start=1):
        sector["id"] = f"sector-{index}"
        sector["nombre"] = f"Sector {index}"

    return sectors