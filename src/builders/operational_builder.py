from algorithms.dfs import dfs
from algorithms.bfs import bfs
from algorithms.backtracking import solve_backtracking_route


def _distance(a, b):
    if not a or not b:
        return float("inf")
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def _district_lookup(districts_summary):
    return {district["id"]: district for district in districts_summary}


def _build_group_districts(group, district_lookup):
    return [
        district_lookup[district_id]
        for district_id in group.get("zona_ids", [])
        if district_id in district_lookup
    ]


def _build_logical_adjacency(districts, max_neighbors=3):
    adjacency = {district["id"]: [] for district in districts}

    for district in districts:
        center = district.get("center")
        if not center:
            continue

        neighbors = []
        for other in districts:
            if other["id"] == district["id"]:
                continue
            if not other.get("center"):
                continue

            neighbors.append(
                {
                    "id": other["id"],
                    "distance": _distance(center, other["center"]),
                }
            )

        neighbors.sort(key=lambda item: item["distance"])
        adjacency[district["id"]] = [item["id"] for item in neighbors[:max_neighbors]]

    return adjacency


def _closest_origin(group_center, eps_origins):
    if not group_center or not eps_origins:
        return None

    best = None
    best_distance = float("inf")

    for origin in eps_origins:
        origin_center = [origin.get("lat"), origin.get("lon")]
        d = _distance(group_center, origin_center)
        if d < best_distance:
            best_distance = d
            best = origin

    return best


def build_operational_routes(districts_summary, grouped_zones, eps_origins, top_groups=7):
    district_lookup = _district_lookup(districts_summary)
    selected_groups = sorted(
        grouped_zones,
        key=lambda group: group.get("interrupciones", 0),
        reverse=True,
    )[:top_groups]

    results = {}

    for group in selected_groups:
        group_districts = _build_group_districts(group, district_lookup)
        if not group_districts:
            continue

        adjacency = _build_logical_adjacency(group_districts, max_neighbors=3)
        start_id = group_districts[0]["id"]
        origin = _closest_origin(group.get("center"), eps_origins)

        dfs_order_ids = dfs(adjacency, start_id)
        bfs_order_ids = bfs(adjacency, start_id)

        dfs_order = [district_lookup[item_id] for item_id in dfs_order_ids if item_id in district_lookup]
        bfs_order = [district_lookup[item_id] for item_id in bfs_order_ids if item_id in district_lookup]

        backtracking_candidates = sorted(
            [district for district in group_districts if district.get("center")],
            key=lambda item: item.get("interrupciones", 0),
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
                "order": [
                    {
                        "id": district["id"],
                        "nombre": district["nombre"],
                        "center": district.get("center"),
                        "interrupciones": district.get("interrupciones", 0),
                    }
                    for district in dfs_order
                ],
            },
            "bfs": {
                "startDistrictId": start_id,
                "order": [
                    {
                        "id": district["id"],
                        "nombre": district["nombre"],
                        "center": district.get("center"),
                        "interrupciones": district.get("interrupciones", 0),
                    }
                    for district in bfs_order
                ],
            },
            "backtracking": backtracking_result,
        }

    return results