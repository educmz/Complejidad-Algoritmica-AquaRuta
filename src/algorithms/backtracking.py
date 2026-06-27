from math import sqrt


def euclidean_distance(a, b):
    if not a or not b:
        return 0.0
    return sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def solve_backtracking_route(origin_center, destinations):
    """
    origin_center: [lat, lon]
    destinations: lista de dicts con al menos:
        - id
        - nombre
        - center

    Retorna:
    {
        "best_order": [...],
        "best_cost": ...,
        "explored_solutions": ...
    }
    """
    if not origin_center or not destinations:
        return {
            "best_order": [],
            "best_cost": 0.0,
            "explored_solutions": 0,
        }

    best_order = []
    best_cost = float("inf")
    explored_solutions = 0

    visited = [False] * len(destinations)
    current_order = []

    def backtrack(current_point, current_cost):
        nonlocal best_order, best_cost, explored_solutions

        if len(current_order) == len(destinations):
            explored_solutions += 1
            if current_cost < best_cost:
                best_cost = current_cost
                best_order = list(current_order)
            return

        if current_cost >= best_cost:
            return

        for i, destination in enumerate(destinations):
            if visited[i]:
                continue

            next_point = destination.get("center")
            if not next_point:
                continue

            next_cost = current_cost + euclidean_distance(current_point, next_point)

            if next_cost >= best_cost:
                continue

            visited[i] = True
            current_order.append(destination)

            backtrack(next_point, next_cost)

            current_order.pop()
            visited[i] = False

    backtrack(origin_center, 0.0)

    return {
        "best_order": [
            {
                "id": item.get("id"),
                "nombre": item.get("nombre"),
                "center": item.get("center"),
                "interrupciones": item.get("interrupciones", 0),
            }
            for item in best_order
        ],
        "best_cost": 0.0 if best_cost == float("inf") else round(best_cost, 6),
        "explored_solutions": explored_solutions,
    }