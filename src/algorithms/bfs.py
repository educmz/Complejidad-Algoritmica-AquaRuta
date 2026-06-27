from collections import deque


def bfs(adjacency: dict, start: str) -> list[str]:
    if not start or start not in adjacency:
        return []

    visited = {start}
    queue = deque([start])
    order = []

    while queue:
        current = queue.popleft()
        order.append(current)

        for neighbor in adjacency.get(current, []):
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)

    return order