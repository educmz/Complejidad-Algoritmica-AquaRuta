from __future__ import annotations

from typing import Any


def _distance(a, b):
    if not a or not b:
        return float("inf")
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def build_logical_adjacency(nodes: list[dict[str, Any]], max_neighbors: int = 3) -> dict[str, list[str]]:
    adjacency = {node["id"]: [] for node in nodes}
    for node in nodes:
        if not node.get("center"):
            continue
        neighbors = []
        for other in nodes:
            if other["id"] == node["id"] or not other.get("center"):
                continue
            neighbors.append({"id": other["id"], "distance": _distance(node["center"], other["center"])})
        neighbors.sort(key=lambda item: item["distance"])
        adjacency[node["id"]] = [item["id"] for item in neighbors[:max_neighbors]]
    return adjacency
