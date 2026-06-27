def dfs(adjacency: dict, start: str) -> list[str]:
    if not start or start not in adjacency:
        return []
    visited = set()
    stack = [start]
    order = []
    while stack:
        current = stack.pop()
        if current in visited:
            continue
        visited.add(current)
        order.append(current)
        neighbors = list(adjacency.get(current, []))
        neighbors.reverse()
        for neighbor in neighbors:
            if neighbor not in visited:
                stack.append(neighbor)
    return order
