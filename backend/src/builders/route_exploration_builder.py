from algorithms.dijkstra import dijkstra
from builders.dataset_builder import save_json
from services.edge_metrics import build_edge_metrics, criterion_to_weight_field


ROUTE_CRITERIA = ("distancia", "tiempo", "costo")
DEFAULT_SECTOR_CRITERION = "mixto"


def _distance(a, b):
    if not a or not b:
        return float("inf")
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def _build_zone_lookup(districts_summary):
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


def _build_adjacency(origin_node, nodes, neighbors_per_node=4):
    graph_nodes = [origin_node] + nodes if origin_node else nodes
    adjacency = {node["id"]: [] for node in graph_nodes}
    for node in graph_nodes:
        center = node.get("center")
        if not center:
            continue
        candidates = []
        for other in graph_nodes:
            if other["id"] == node["id"] or not other.get("center"):
                continue
            metrics = build_edge_metrics(node, other)
            candidates.append(
                {
                    "to": other["id"],
                    "metrics": metrics,
                    **metrics,
                    "weight": metrics["distance_weight"],
                }
            )
        candidates.sort(key=lambda item: item["distance_weight"])
        adjacency[node["id"]] = candidates[:neighbors_per_node]
    return adjacency


def _build_edges_from_adjacency(adjacency):
    seen = set()
    edges = []
    for source, neighbors in adjacency.items():
        for edge in neighbors:
            target = edge["to"]
            key = tuple(sorted((source, target)))
            if key in seen:
                continue
            seen.add(key)
            edges.append(
                {
                    "source": source,
                    "target": target,
                    "weight": round(edge["distance_weight"], 6),
                    "distance_km": edge["distance_km"],
                    "road_distance_km": edge["road_distance_km"],
                    "duration_min": edge["duration_min"],
                    "operational_cost": edge["operational_cost"],
                    "traffic_factor": edge["traffic_factor"],
                    "distance_weight": edge["distance_weight"],
                    "time_weight": edge["time_weight"],
                    "cost_weight": edge["cost_weight"],
                    "edge_type": "logical",
                }
            )
    return edges


def _edge_lookup(adjacency):
    return {
        (source, edge["to"]): edge
        for source, neighbors in adjacency.items()
        for edge in neighbors
    }


def _build_path_edges(path, adjacency, weight_field):
    edges_by_pair = _edge_lookup(adjacency)
    edges = []
    for index in range(len(path) - 1):
        source = path[index]
        target = path[index + 1]
        edge = edges_by_pair.get((source, target), {})
        edges.append(
            {
                "source": source,
                "target": target,
                "selectedWeight": round(float(edge.get(weight_field, 0) or 0), 6),
                "distanceKm": edge.get("distance_km", 0),
                "roadDistanceKm": edge.get("road_distance_km", 0),
                "durationMin": edge.get("duration_min", 0),
                "operationalCost": edge.get("operational_cost", 0),
                "trafficFactor": edge.get("traffic_factor", 0),
                "isShortestPath": True,
                "edge_type": "logical",
            }
        )
    return edges


def _route_points_from_path(path, node_lookup):
    return [
        node_lookup[node_id]["center"]
        for node_id in path
        if node_id in node_lookup and node_lookup[node_id].get("center")
    ]


def _summary_from_edges(shortest, path_edges):
    return {
        "totalWeight": shortest.get("cost", 0.0),
        "totalDistanceKm": round(sum(float(edge.get("distanceKm", 0) or 0) for edge in path_edges), 6),
        "totalRoadDistanceKm": round(sum(float(edge.get("roadDistanceKm", 0) or 0) for edge in path_edges), 6),
        "totalDurationMin": round(sum(float(edge.get("durationMin", 0) or 0) for edge in path_edges), 6),
        "totalOperationalCost": round(sum(float(edge.get("operationalCost", 0) or 0) for edge in path_edges), 6),
        "visitedNodes": len(shortest.get("visited_order", [])),
        "relaxedEdges": int(shortest.get("relaxed_edges", 0) or 0),
    }


def _build_route_for_node(origin_node, nodes, destination, criterion):
    weight_field = criterion_to_weight_field(criterion)
    if not origin_node or not destination:
        return {
            "path": [],
            "cost": 0.0,
            "criterion": criterion,
            "visited_order": [],
            "route_points": [],
            "path_edges": [],
            "summary": _summary_from_edges({}, []),
            "reachable": False,
            "weightField": weight_field,
            "algorithm": "dijkstra.py",
        }
    adjacency = _build_adjacency(origin_node, nodes)
    shortest = dijkstra(adjacency, origin_node["id"], destination["id"], weight_field=weight_field)
    node_lookup = {node["id"]: node for node in [origin_node] + nodes}
    path_edges = _build_path_edges(shortest.get("path", []), adjacency, weight_field)
    return {
        **shortest,
        "criterion": criterion,
        "route_points": _route_points_from_path(shortest.get("path", []), node_lookup),
        "path_edges": path_edges,
        "summary": _summary_from_edges(shortest, path_edges),
        "weightField": weight_field,
        "algorithm": "dijkstra.py",
    }


def _origin_node_from_origin(origin):
    if not origin:
        return None
    return {
        "id": f"{origin['id']}-route-origin",
        "nombre": origin["prestador"],
        "center": [origin["lat"], origin["lon"]],
        "interrupciones": 0,
        "criticidad": "baja",
        "isEpsNode": True,
    }


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


def _build_routes_by_destination(nodes, eps_origins):
    routes = {}
    for destination in nodes:
        origin = _closest_origin(destination.get("center"), eps_origins)
        origin_node = _origin_node_from_origin(origin)
        edges = _build_edges_from_adjacency(_build_adjacency(origin_node, nodes))
        routes[destination["id"]] = {
            "destinationId": destination["id"],
            "destinationName": destination.get("nombre", destination["id"]),
            "origin": origin,
            "originNode": origin_node,
            "edges": edges,
            "criteria": {
                criterion: _build_route_for_node(origin_node, nodes, destination, criterion)
                for criterion in ROUTE_CRITERIA
            },
        }
    return routes


def build_route_explorations(districts_summary, sectorized_zones, eps_origins):
    zone_lookup = _build_zone_lookup(districts_summary)
    results = {}
    for group_id, group in sectorized_zones.items():
        criterion_key, sector_count, sectors = _sector_count_options(group.get("criterios", {}))
        if not sectors:
            continue
        group_result = {"groupId": group_id, "groupName": group.get("groupName", group_id), "sectors": {}}
        for sector in sectors:
            nodes = [
                zone_lookup[zone_id]
                for zone_id in sector.get("zona_ids", [])
                if zone_id in zone_lookup
            ]
            if not nodes:
                continue
            origin = _closest_origin(sector.get("center"), eps_origins)
            sector_key = f"{criterion_key}:{sector_count}:{sector['id']}"
            origin_node = _origin_node_from_origin(origin)
            clean_nodes = [_clean_node(node) for node in nodes]
            group_result["sectors"][sector_key] = {
                "sectorId": sector["id"],
                "sectorKey": sector_key,
                "sectorName": sector.get("nombre", sector["id"]),
                "sectorCenter": sector.get("center"),
                "sectorCriterion": criterion_key,
                "sectorCount": sector_count,
                "origin": origin,
                "originNode": origin_node,
                "nodes": clean_nodes,
                "personas_afectadas_estimadas": sector.get("personas_afectadas_estimadas", 0),
                "peso_demanda_familiar": sector.get("peso_demanda_familiar", 0),
                "prioridad_score": sector.get("prioridad_score", 0),
                "promedio_integrantes_hogar": sector.get("promedio_integrantes_hogar", 0),
                "routesByDestination": _build_routes_by_destination(clean_nodes, eps_origins),
            }
        if group_result["sectors"]:
            results[group_id] = group_result
    return results


def save_route_explorations(routes, output_path):
    save_json(routes, output_path)
