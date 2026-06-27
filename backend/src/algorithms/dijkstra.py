from heapq import heappop, heappush
from math import isfinite


def _edge_weight(edge: dict, weight_field: str) -> float:
    if weight_field in edge:
        weight = edge[weight_field]
    elif "weights" in edge and weight_field in edge["weights"]:
        weight = edge["weights"][weight_field]
    else:
        weight = edge.get("weight")
    weight = float(weight)
    if not isfinite(weight) or weight < 0:
        raise ValueError(f"Peso invalido para Dijkstra: {weight_field}={weight}")
    return weight


def dijkstra(adjacency: dict, start: str, goal: str, weight_field: str = "weight"):
    """Shortest path on a directed weighted adjacency list.

    Complexity with heapq and adjacency lists: O((V + E) log V).
    """
    if start not in adjacency or goal not in adjacency:
        return {
            "path": [],
            "cost": 0.0,
            "visited_order": [],
            "distances": {},
            "parents": {},
            "relaxed_edges": 0,
            "reachable": False,
        }

    queue = [(0.0, start)]
    distances = {node: float("inf") for node in adjacency}
    distances[start] = 0.0
    parents = {start: None}
    visited_order = []
    closed = set()
    relaxed_edges = 0

    while queue:
        current_cost, current = heappop(queue)
        if current in closed:
            continue
        closed.add(current)
        visited_order.append(current)
        if current == goal:
            break

        for edge in adjacency.get(current, []):
            neighbor = edge["to"]
            weight = _edge_weight(edge, weight_field)
            next_cost = current_cost + weight
            if next_cost < distances.get(neighbor, float("inf")):
                distances[neighbor] = next_cost
                parents[neighbor] = current
                relaxed_edges += 1
                heappush(queue, (next_cost, neighbor))

    if goal not in parents:
        return {
            "path": [],
            "cost": 0.0,
            "visited_order": visited_order,
            "distances": distances,
            "parents": parents,
            "relaxed_edges": relaxed_edges,
            "reachable": False,
        }

    path = []
    current = goal
    while current is not None:
        path.append(current)
        current = parents[current]
    path.reverse()

    return {
        "path": path,
        "cost": round(distances.get(goal, 0.0), 6),
        "visited_order": visited_order,
        "distances": distances,
        "parents": parents,
        "relaxed_edges": relaxed_edges,
        "reachable": True,
    }
