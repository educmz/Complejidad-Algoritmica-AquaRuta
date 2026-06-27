from heapq import heappop, heappush


def dijkstra(adjacency: dict, start: str, goal: str):
    if start not in adjacency or goal not in adjacency:
        return {"path": [], "cost": 0.0, "visited_order": []}

    queue = [(0.0, start)]
    distances = {start: 0.0}
    parents = {start: None}
    visited_order = []
    closed = set()

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
            weight = float(edge["weight"])
            next_cost = current_cost + weight
            if next_cost < distances.get(neighbor, float("inf")):
                distances[neighbor] = next_cost
                parents[neighbor] = current
                heappush(queue, (next_cost, neighbor))

    if goal not in parents:
        return {"path": [], "cost": 0.0, "visited_order": visited_order}

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
    }
