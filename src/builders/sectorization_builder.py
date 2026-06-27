from algorithms.divide_conquer import sectorizar_divide_conquer
from builders.dataset_builder import save_json


def _build_zone_lookup(districts_summary: list[dict]) -> dict:
    return {zone["id"]: zone for zone in districts_summary}


def _ordered_groups(grouped_zones: list[dict]) -> list[dict]:
    return sorted(
        grouped_zones,
        key=lambda group: group.get("interrupciones", 0),
        reverse=True,
    )


def build_sectorized_zones(
    districts_summary: list[dict],
    grouped_zones: list[dict],
) -> dict:
    """
    Genera sectorizaciones por divide y venceras dentro de los grupos UFDS.

    Estructura de salida:
    {
      "grupo-1": {
        "groupName": "...",
        "groupCenter": [...],
        "groupInterruptions": ...,
        "groupZonesCount": ...,
        "criterios": {
          "geografico": {
            "2": [...],
            "3": [...],
            "4": [...]
          },
          "carga": { ... },
          "mixto": { ... }
        }
      },
      ...
    }
    """
    zone_lookup = _build_zone_lookup(districts_summary)
    selected_groups = _ordered_groups(grouped_zones)

    result = {}

    for group in selected_groups:
        zone_ids = group.get("zona_ids", [])
        group_zones = [zone_lookup[zone_id] for zone_id in zone_ids if zone_id in zone_lookup]

        if len(group_zones) < 2:
            continue

        max_sectors = min(4, len(group_zones))
        sector_options = [count for count in [2, 3, 4] if count <= max_sectors]

        criterios = {
            "geografico": {},
            "carga": {},
            "mixto": {},
        }

        for count in sector_options:
            criterios["geografico"][str(count)] = sectorizar_divide_conquer(
                group_zones,
                sector_count=count,
                criterion="geografico",
            )
            criterios["carga"][str(count)] = sectorizar_divide_conquer(
                group_zones,
                sector_count=count,
                criterion="carga",
            )
            criterios["mixto"][str(count)] = sectorizar_divide_conquer(
                group_zones,
                sector_count=count,
                criterion="mixto",
            )

        result[group["id"]] = {
            "groupId": group["id"],
            "groupName": group["nombre"],
            "groupCenter": group.get("center"),
            "groupInterruptions": group.get("interrupciones", 0),
            "groupZonesCount": group.get("cantidad_zonas", 0),
            "criterios": criterios,
        }

    return result


def save_sectorized_zones(sectors: dict, output_path: str) -> None:
    save_json(sectors, output_path)
