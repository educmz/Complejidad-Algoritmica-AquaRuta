from algorithms.tsp_memorization import solve_tsp_memoization


LOCAL_CRITERIA = ("distancia", "tiempo", "costo")
DEFAULT_SECTOR_CRITERION = "mixto"


def _distance(a, b):
    if not a or not b:
        return float("inf")
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def _district_lookup(districts_summary):
    return {district["id"]: district for district in districts_summary if district.get("center")}


def _closest_origin(center, eps_origins):
    if not center or not eps_origins:
        return None
    best = None
    best_distance = float("inf")
    for origin in eps_origins:
        distance = _distance(center, [origin.get("lat"), origin.get("lon")])
        if distance < best_distance:
            best = origin
            best_distance = distance
    if not best:
        return None
    return {**best, "distanceToSector": round(best_distance, 6)}


def _sector_count_options(criteria):
    by_count = criteria.get(DEFAULT_SECTOR_CRITERION)
    criterion_key = DEFAULT_SECTOR_CRITERION if by_count else next(iter(criteria), "")
    by_count = criteria.get(criterion_key, {})
    if not by_count:
        return "", "", []
    sector_count = "3" if "3" in by_count else next(iter(by_count), "")
    return criterion_key, sector_count, by_count.get(sector_count, [])


def _clean_node(node):
    return {
        "id": node["id"],
        "nombre": node["nombre"],
        "center": node.get("center"),
        "interrupciones": node.get("interrupciones", 0),
        "criticidad": node.get("criticidad", "baja"),
        "provincia": node.get("provincia", ""),
        "departamento": node.get("departamento", ""),
        "personas_afectadas_estimadas": node.get("personas_afectadas_estimadas", 0),
        "peso_demanda_familiar": node.get("peso_demanda_familiar", 0),
        "promedio_integrantes_hogar": node.get("promedio_integrantes_hogar", 0),
        "prioridad_score": node.get("prioridad_score", 0),
    }


def _build_sector_edges(nodes, neighbors_per_node=3):
    edges = []
    seen = set()
    for source in nodes:
        candidates = []
        for target in nodes:
            if source["id"] == target["id"]:
                continue
            candidates.append({"target": target, "weight": _distance(source.get("center"), target.get("center"))})
        candidates = [item for item in candidates if item["weight"] != float("inf")]
        candidates.sort(key=lambda item: item["weight"])
        for item in candidates[:neighbors_per_node]:
            target = item["target"]
            key = tuple(sorted((source["id"], target["id"])))
            if key in seen:
                continue
            seen.add(key)
            edges.append(
                {
                    "source": source["id"],
                    "target": target["id"],
                    "weight": round(item["weight"], 6),
                    "edge_type": "logical",
                }
            )
    return edges


def _sequence_edges(origin_node, best_order):
    sequence = [origin_node] + best_order if origin_node else best_order
    return [
        {
            "source": sequence[index]["id"],
            "target": sequence[index + 1]["id"],
            "isSequence": True,
            "edge_type": "logical",
        }
        for index in range(len(sequence) - 1)
    ]


def _solve_sector_tsp(origin, nodes, criterion):
    if not origin:
        return {
            "best_order": [],
            "best_cost": 0.0,
            "total_distance": 0.0,
            "criterion": criterion,
            "explored_states": 0,
            "used_fallback": False,
            "route_points": [],
            "route_edges": [],
            "algorithm": "tsp_memorization.py",
        }
    origin_node = {
        "id": f"{origin['id']}-local-origin",
        "nombre": origin["prestador"],
        "center": [origin["lat"], origin["lon"]],
        "interrupciones": 0,
        "criticidad": "baja",
        "isEpsNode": True,
    }
    result = solve_tsp_memoization(
        origin_node["center"],
        nodes,
        criterion=criterion,
        use_priority_bonus=True,
        return_to_origin=False,
        max_exact_nodes=12,
    )
    result["route_edges"] = _sequence_edges(origin_node, result.get("best_order", []))
    result["algorithm"] = "tsp_memorization.py"
    return result


def build_local_graphs(districts_summary, sectorized_zones, eps_origins):
    district_lookup = _district_lookup(districts_summary)
    results = {}
    for group_id, group in sectorized_zones.items():
        criterion_key, sector_count, sectors = _sector_count_options(group.get("criterios", {}))
        if not sectors:
            continue
        group_result = {"groupId": group_id, "groupName": group.get("groupName", group_id), "sectors": {}}
        for sector in sectors:
            nodes = [
                _clean_node(district_lookup[zone_id])
                for zone_id in sector.get("zona_ids", [])
                if zone_id in district_lookup
            ]
            if not nodes:
                continue
            origin = _closest_origin(sector.get("center"), eps_origins)
            origin_node = (
                {
                    "id": f"{origin['id']}-local-origin",
                    "nombre": origin["prestador"],
                    "center": [origin["lat"], origin["lon"]],
                    "interrupciones": 0,
                    "criticidad": "baja",
                    "isEpsNode": True,
                    "mapOrder": 0,
                }
                if origin
                else None
            )
            sector_key = f"{criterion_key}:{sector_count}:{sector['id']}"
            group_result["sectors"][sector_key] = {
                "sectorId": sector["id"],
                "sectorKey": sector_key,
                "sectorName": sector.get("nombre", sector["id"]),
                "sectorCenter": sector.get("center"),
                "sectorCriterion": criterion_key,
                "sectorCount": sector_count,
                "origin": origin,
                "originNode": origin_node,
                "nodes": nodes,
                "edges": _build_sector_edges(nodes),
                "personas_afectadas_estimadas": sector.get("personas_afectadas_estimadas", 0),
                "peso_demanda_familiar": sector.get("peso_demanda_familiar", 0),
                "prioridad_score": sector.get("prioridad_score", 0),
                "promedio_integrantes_hogar": sector.get("promedio_integrantes_hogar", 0),
                "routes": {criterion: _solve_sector_tsp(origin, nodes, criterion) for criterion in LOCAL_CRITERIA},
            }
        if group_result["sectors"]:
            results[group_id] = group_result
    return results
