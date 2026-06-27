from algorithms.dfs import dfs
from algorithms.bfs import bfs
from algorithms.backtracking import solve_backtracking_route
from services.graph_adjacency import _distance, build_logical_adjacency


def _district_lookup(districts_summary):
    return {district["id"]: district for district in districts_summary}


def _build_group_districts(group, district_lookup):
    return [
        district_lookup[district_id]
        for district_id in group.get("zona_ids", [])
        if district_id in district_lookup
    ]


def _closest_origin(group_center, eps_origins):
    if not group_center or not eps_origins:
        return None
    best = None
    best_distance = float("inf")
    for origin in eps_origins:
        distance = _distance(group_center, [origin.get("lat"), origin.get("lon")])
        if distance < best_distance:
            best_distance = distance
            best = origin
    return best


def _clean_route_district(district):
    return {
        "id": district["id"],
        "nombre": district["nombre"],
        "center": district.get("center"),
        "interrupciones": district.get("interrupciones", 0),
        "personas_afectadas_estimadas": district.get("personas_afectadas_estimadas", 0),
        "peso_demanda_familiar": district.get("peso_demanda_familiar", 0),
        "prioridad_score": district.get("prioridad_score", 0),
    }


def build_operational_routes(districts_summary, grouped_zones, eps_origins, top_groups=7):
    district_lookup = _district_lookup(districts_summary)
    selected_groups = sorted(
        grouped_zones,
        key=lambda group: group.get("prioridad_score", 0),
        reverse=True,
    )[:top_groups]
    results = {}
    for group in selected_groups:
        group_districts = _build_group_districts(group, district_lookup)
        if not group_districts:
            continue
        adjacency = build_logical_adjacency(group_districts, max_neighbors=3)
        start_id = group_districts[0]["id"]
        origin = _closest_origin(group.get("center"), eps_origins)
        dfs_order = [district_lookup[item_id] for item_id in dfs(adjacency, start_id) if item_id in district_lookup]
        bfs_order = [district_lookup[item_id] for item_id in bfs(adjacency, start_id) if item_id in district_lookup]
        backtracking_candidates = sorted(
            [district for district in group_districts if district.get("center")],
            key=lambda item: item.get("prioridad_score", 0),
            reverse=True,
        )[:4]
        backtracking_result = solve_backtracking_route(
            [origin["lat"], origin["lon"]] if origin else None,
            backtracking_candidates,
        )
        results[group["id"]] = {
            "groupId": group["id"],
            "groupName": group["nombre"],
            "origin": origin,
            "dfs": {
                "startDistrictId": start_id,
                "order": [_clean_route_district(district) for district in dfs_order],
            },
            "bfs": {
                "startDistrictId": start_id,
                "order": [_clean_route_district(district) for district in bfs_order],
            },
            "backtracking": backtracking_result,
        }
    return results
