from collections import deque


def _empty_result():
    return {
        "order": [],
        "levels": {},
        "parents": {},
        "tree_edges": [],
        "visited_count": 0,
        "examined_edges": 0,
    }


def bfs(adjacency: dict, start: str, with_metadata: bool = False):
    """Breadth-first traversal over an adjacency list. Complexity: O(V + E)."""
    if not start or start not in adjacency:
        return _empty_result() if with_metadata else []
    visited = {start}
    queue = deque([start])
    order = []
    levels = {start: 0}
    parents = {start: None}
    tree_edges = []
    examined_edges = 0
    while queue:
        current = queue.popleft()
        order.append(current)
        neighbors = adjacency.get(current, [])
        examined_edges += len(neighbors)
        for neighbor in neighbors:
            if neighbor not in visited:
                visited.add(neighbor)
                parents[neighbor] = current
                levels[neighbor] = levels[current] + 1
                tree_edges.append({"source": current, "target": neighbor})
                queue.append(neighbor)
    if not with_metadata:
        return order
    return {
        "order": order,
        "levels": levels,
        "parents": parents,
        "tree_edges": tree_edges,
        "visited_count": len(order),
        "examined_edges": examined_edges,
    }
