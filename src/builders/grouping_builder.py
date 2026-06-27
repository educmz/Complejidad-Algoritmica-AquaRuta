from algorithms.ufds import agrupar_zonas_operativas
from builders.dataset_builder import save_json


def build_grouped_zones(districts_summary: list[dict]) -> list[dict]:
    return agrupar_zonas_operativas(
        districts_summary,
        criterio="combinado",
        max_geographic_distance_km=18,
        max_road_distance_km=32,
        max_time_min=70,
        max_cost=240,
        average_speed_kmh=28,
        road_factor=1.35,
        max_candidate_neighbors=12,
    )


def save_grouped_zones(groups: list[dict], output_path: str) -> None:
    save_json(groups, output_path)
