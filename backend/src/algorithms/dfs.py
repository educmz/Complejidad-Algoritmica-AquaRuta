def _empty_result():
    return {
        "order": [],
        "depths": {},
        "parents": {},
        "tree_edges": [],
        "visited_count": 0,
        "examined_edges": 0,
    }


def dfs(adjacency: dict, start: str, with_metadata: bool = False):
    """Depth-first traversal over an adjacency list using a LIFO stack. Complexity: O(V + E)."""
    if not start or start not in adjacency:
        return _empty_result() if with_metadata else []
    visited = set()
    discovered = {start}
    stack = [(start, None, 0)]
    order = []
    depths = {}
    parents = {start: None}
    tree_edges = []
    examined_edges = 0
    while stack:
        current, parent, depth = stack.pop()
        if current in visited:
            continue
        visited.add(current)
        order.append(current)
        parents[current] = parent
        depths[current] = depth
        if parent is not None:
            tree_edges.append({"source": parent, "target": current})
        neighbors = list(adjacency.get(current, []))
        examined_edges += len(neighbors)
        neighbors.reverse()
        for neighbor in neighbors:
            if neighbor not in visited and neighbor not in discovered:
                discovered.add(neighbor)
                stack.append((neighbor, current, depth + 1))
    if not with_metadata:
        return order
    return {
        "order": order,
        "depths": depths,
        "parents": parents,
        "tree_edges": tree_edges,
        "visited_count": len(order),
        "examined_edges": examined_edges,
    }
