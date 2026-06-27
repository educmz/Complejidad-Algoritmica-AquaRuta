from math import sqrt


def euclidean_distance(a, b):
    if not a or not b:
        return 0.0
    return sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def solve_backtracking_route(origin_center, destinations):
    if not origin_center or not destinations:
        return {"best_order": [], "best_cost": 0.0, "explored_solutions": 0}

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
        for index, destination in enumerate(destinations):
            if visited[index] or not destination.get("center"):
                continue
            next_cost = current_cost + euclidean_distance(current_point, destination["center"])
            if next_cost >= best_cost:
                continue
            visited[index] = True
            current_order.append(destination)
            backtrack(destination["center"], next_cost)
            current_order.pop()
            visited[index] = False

    backtrack(origin_center, 0.0)
    return {
        "best_order": [
            {
                "id": item.get("id"),
                "nombre": item.get("nombre"),
                "center": item.get("center"),
                "interrupciones": item.get("interrupciones", 0),
                "personas_afectadas_estimadas": item.get("personas_afectadas_estimadas", 0),
                "prioridad_score": item.get("prioridad_score", 0),
            }
            for item in best_order
        ],
        "best_cost": 0.0 if best_cost == float("inf") else round(best_cost, 6),
        "explored_solutions": explored_solutions,
    }
