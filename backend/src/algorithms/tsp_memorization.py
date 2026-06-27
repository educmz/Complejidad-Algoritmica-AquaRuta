from __future__ import annotations

from functools import lru_cache
from math import inf, sqrt
from typing import Any


def euclidean_distance(a, b) -> float:
    if not a or not b or len(a) != 2 or len(b) != 2:
        return inf
    return sqrt((float(a[0]) - float(b[0])) ** 2 + (float(a[1]) - float(b[1])) ** 2)


def _get_center(node: dict[str, Any]) -> list[float] | None:
    center = node.get("center")
    if center and len(center) == 2:
        return [float(center[0]), float(center[1])]
    lat = node.get("lat")
    lon = node.get("lon")
    if lat is not None and lon is not None:
        return [float(lat), float(lon)]
    return None


def _score_weight(node: dict[str, Any], priority_bonus: bool = True) -> float:
    interruptions = float(node.get("interrupciones", 0) or 0)
    demand = float(node.get("peso_demanda_familiar", 0) or 0)
    priority_score = float(node.get("prioridad_score", 0) or 0)
    criticality = str(node.get("criticidad", "baja")).lower()
    bonus = 0.0
    if priority_bonus:
        bonus = {"critica": 2.0, "alta": 1.2, "media": 0.5}.get(criticality, 0.0)
    return -(interruptions / 10000.0 + demand * 0.4 + priority_score * 0.5 + bonus)


def _build_cost_matrix(origin_center, nodes, criterion="distancia"):
    points = [{"id": "__origin__", "center": origin_center}] + nodes
    size = len(points)
    matrix = [[0.0 for _ in range(size)] for _ in range(size)]
    for i in range(size):
        for j in range(size):
            if i == j:
                continue
            distance = euclidean_distance(points[i]["center"], points[j]["center"])
            if distance == inf:
                matrix[i][j] = inf
            elif criterion == "tiempo":
                matrix[i][j] = distance * 1.25
            elif criterion == "costo":
                matrix[i][j] = distance * 1.4
            else:
                matrix[i][j] = distance
    return matrix


def _clean_result_node(node):
    return {
        "id": node["id"],
        "nombre": node["nombre"],
        "center": node["center"],
        "interrupciones": node["interrupciones"],
        "criticidad": node["criticidad"],
        "personas_afectadas_estimadas": node.get("personas_afectadas_estimadas", 0),
        "peso_demanda_familiar": node.get("peso_demanda_familiar", 0),
        "prioridad_score": node.get("prioridad_score", 0),
    }


def solve_tsp_memoization(
    origin_center,
    destinations,
    criterion="distancia",
    use_priority_bonus=True,
    return_to_origin=False,
    max_exact_nodes=12,
):
    if not origin_center or len(origin_center) != 2:
        return {
            "best_order": [],
            "best_cost": 0.0,
            "total_distance": 0.0,
            "criterion": criterion,
            "explored_states": 0,
            "used_fallback": False,
            "route_points": [],
            "error": "origin_center invalido",
        }

    clean_nodes = []
    for node in destinations:
        center = _get_center(node)
        if not center:
            continue
        clean_nodes.append(
            {
                "id": node.get("id"),
                "nombre": node.get("nombre", "Nodo"),
                "center": center,
                "interrupciones": int(node.get("interrupciones", 0) or 0),
                "criticidad": node.get("criticidad", "baja"),
                "personas_afectadas_estimadas": int(node.get("personas_afectadas_estimadas", 0) or 0),
                "peso_demanda_familiar": float(node.get("peso_demanda_familiar", 0) or 0),
                "prioridad_score": float(node.get("prioridad_score", 0) or 0),
            }
        )

    if not clean_nodes:
        return {
            "best_order": [],
            "best_cost": 0.0,
            "total_distance": 0.0,
            "criterion": criterion,
            "explored_states": 0,
            "used_fallback": False,
            "route_points": [list(origin_center)],
        }

    n = len(clean_nodes)
    used_fallback = n > max_exact_nodes
    cost_matrix = _build_cost_matrix(list(origin_center), clean_nodes, criterion=criterion)
    priority_penalties = [0.0] + [
        _score_weight(node, priority_bonus=use_priority_bonus) for node in clean_nodes
    ]

    if used_fallback:
        unvisited = set(range(1, n + 1))
        current = 0
        order_indices = []
        total_distance = 0.0
        route_points = [list(origin_center)]
        while unvisited:
            best_next = min(
                unvisited,
                key=lambda nxt: cost_matrix[current][nxt] + priority_penalties[nxt],
            )
            transition = cost_matrix[current][best_next]
            if transition == inf:
                break
            total_distance += transition
            route_points.append(clean_nodes[best_next - 1]["center"])
            order_indices.append(best_next)
            unvisited.remove(best_next)
            current = best_next
        if return_to_origin and current != 0:
            total_distance += cost_matrix[current][0]
            route_points.append(list(origin_center))
        best_order = [clean_nodes[idx - 1] for idx in order_indices]
        return {
            "best_order": [_clean_result_node(node) for node in best_order],
            "best_cost": round(total_distance, 6),
            "total_distance": round(total_distance, 6),
            "criterion": criterion,
            "explored_states": len(order_indices),
            "used_fallback": True,
            "route_points": route_points,
        }

    explored_states = 0

    @lru_cache(maxsize=None)
    def dp(mask: int, last: int) -> float:
        nonlocal explored_states
        explored_states += 1
        if mask == (1 << n) - 1:
            return cost_matrix[last][0] if return_to_origin else 0.0
        best = inf
        for nxt in range(1, n + 1):
            bit = 1 << (nxt - 1)
            if mask & bit:
                continue
            transition = cost_matrix[last][nxt]
            if transition == inf:
                continue
            candidate = transition + priority_penalties[nxt] + dp(mask | bit, nxt)
            if candidate < best:
                best = candidate
        return best

    def reconstruct():
        mask = 0
        last = 0
        order_indices = []
        while mask != (1 << n) - 1:
            best_next = None
            best_value = inf
            for nxt in range(1, n + 1):
                bit = 1 << (nxt - 1)
                if mask & bit:
                    continue
                transition = cost_matrix[last][nxt]
                if transition == inf:
                    continue
                value = transition + priority_penalties[nxt] + dp(mask | bit, nxt)
                if value < best_value:
                    best_value = value
                    best_next = nxt
            if best_next is None:
                break
            order_indices.append(best_next)
            mask |= 1 << (best_next - 1)
            last = best_next
        return order_indices

    raw_best_cost = dp(0, 0)
    best_indices = reconstruct()
    best_order = [clean_nodes[idx - 1] for idx in best_indices]
    total_distance = 0.0
    route_points = [list(origin_center)]
    current = 0
    for idx in best_indices:
        total_distance += cost_matrix[current][idx]
        route_points.append(clean_nodes[idx - 1]["center"])
        current = idx
    if return_to_origin and current != 0:
        total_distance += cost_matrix[current][0]
        route_points.append(list(origin_center))
    return {
        "best_order": [_clean_result_node(node) for node in best_order],
        "best_cost": 0.0 if raw_best_cost == inf else round(raw_best_cost, 6),
        "total_distance": round(total_distance, 6),
        "criterion": criterion,
        "explored_states": explored_states,
        "used_fallback": used_fallback,
        "route_points": route_points,
    }
