from __future__ import annotations

from functools import lru_cache
from math import inf, sqrt
from typing import Any


def euclidean_distance(a: list[float] | tuple[float, float] | None,
                       b: list[float] | tuple[float, float] | None) -> float:
    """
    Distancia euclidiana simple entre dos puntos [lat, lon].
    """
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
    """
    Penalización negativa por importancia del nodo.
    Mientras más importante sea, más atractivo resulta visitarlo temprano.
    """
    interruptions = float(node.get("interrupciones", 0) or 0)
    criticality = str(node.get("criticidad", "baja")).lower()

    bonus = 0.0
    if priority_bonus:
        if criticality == "critica":
            bonus = 2.0
        elif criticality == "alta":
            bonus = 1.2
        elif criticality == "media":
            bonus = 0.5

    return -(interruptions / 10000.0 + bonus)


def _build_cost_matrix(
    origin_center: list[float],
    nodes: list[dict[str, Any]],
    criterion: str = "distancia",
) -> list[list[float]]:
    """
    Construye matriz de costos para origen + nodos.
    Índice 0 = origen
    Índices 1..n = nodos a visitar
    """
    points = [{"id": "__origin__", "center": origin_center}] + nodes
    matrix_size = len(points)
    matrix = [[0.0 for _ in range(matrix_size)] for _ in range(matrix_size)]

    for i in range(matrix_size):
        for j in range(matrix_size):
            if i == j:
                continue

            a = points[i]["center"]
            b = points[j]["center"]
            distance = euclidean_distance(a, b)

            if distance == inf:
                matrix[i][j] = inf
                continue

            if criterion == "tiempo":
                # tiempo aproximado usando factor fijo local
                matrix[i][j] = distance * 1.25
            elif criterion == "costo":
                # costo aproximado local
                matrix[i][j] = distance * 1.4
            else:
                matrix[i][j] = distance

    return matrix


def solve_tsp_memoization(
    origin_center: list[float] | tuple[float, float] | None,
    destinations: list[dict[str, Any]],
    criterion: str = "distancia",
    use_priority_bonus: bool = True,
    return_to_origin: bool = False,
    max_exact_nodes: int = 12,
) -> dict[str, Any]:
    """
    Resuelve una secuencia óptima local tipo TSP usando programación dinámica
    con memorización (Held-Karp simplificado).

    Parámetros:
    - origin_center: punto inicial [lat, lon]
    - destinations: lista de nodos con al menos id, nombre y center
    - criterion: "distancia", "tiempo" o "costo"
    - use_priority_bonus: favorece visitar antes nodos más críticos/importantes
    - return_to_origin: si True, cierra ciclo volviendo al origen
    - max_exact_nodes: límite de nodos para mantener costo computacional razonable

    Retorna:
    {
        "best_order": [...],
        "best_cost": float,
        "total_distance": float,
        "criterion": str,
        "explored_states": int,
        "used_fallback": bool,
        "route_points": [...],
    }
    """
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

    clean_nodes: list[dict[str, Any]] = []
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

    # Para evitar explosión de estados
    used_fallback = False
    if len(clean_nodes) > max_exact_nodes:
        used_fallback = True

    n = len(clean_nodes)
    cost_matrix = _build_cost_matrix(list(origin_center), clean_nodes, criterion=criterion)
    priority_penalties = [0.0] + [
        _score_weight(node, priority_bonus=use_priority_bonus) for node in clean_nodes
    ]

    if used_fallback:
        unvisited = set(range(1, n + 1))
        current = 0
        order_indices: list[int] = []
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
            "best_order": [
                {
                    "id": node["id"],
                    "nombre": node["nombre"],
                    "center": node["center"],
                    "interrupciones": node["interrupciones"],
                    "criticidad": node["criticidad"],
                }
                for node in best_order
            ],
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
        """
        mask representa nodos visitados de 1..n
        last representa el índice actual dentro de la matriz:
        0 = origen
        1..n = nodos
        """
        nonlocal explored_states
        explored_states += 1

        if mask == (1 << n) - 1:
            if return_to_origin:
                return cost_matrix[last][0]
            return 0.0

        best = inf
        for nxt in range(1, n + 1):
            bit = 1 << (nxt - 1)
            if mask & bit:
                continue

            transition = cost_matrix[last][nxt]
            if transition == inf:
                continue

            # Priorizar nodos importantes reduciendo levemente su costo
            candidate = transition + priority_penalties[nxt] + dp(mask | bit, nxt)
            if candidate < best:
                best = candidate

        return best

    def reconstruct() -> list[int]:
        mask = 0
        last = 0
        order_indices: list[int] = []

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

    # Distancia geométrica real de la secuencia, sin bonos de prioridad
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
        "best_order": [
            {
                "id": node["id"],
                "nombre": node["nombre"],
                "center": node["center"],
                "interrupciones": node["interrupciones"],
                "criticidad": node["criticidad"],
            }
            for node in best_order
        ],
        "best_cost": 0.0 if raw_best_cost == inf else round(raw_best_cost, 6),
        "total_distance": round(total_distance, 6),
        "criterion": criterion,
        "explored_states": explored_states,
        "used_fallback": used_fallback,
        "route_points": route_points,
    }
