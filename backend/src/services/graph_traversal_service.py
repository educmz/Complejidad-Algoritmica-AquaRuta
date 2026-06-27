from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from algorithms.bfs import bfs
from algorithms.dfs import dfs
from services.graph_adjacency import build_logical_adjacency


logger = logging.getLogger("aquaruta.traversal")


class GraphTraversalServiceError(ValueError):
    pass


def _center_from_node(node: dict[str, Any]):
    center = node.get("center")
    if isinstance(center, list) and len(center) == 2:
        lat = float(center[0])
        lon = float(center[1])
    else:
        lat = float(node.get("lat", node.get("latitude", 999)))
        lon = float(node.get("lon", node.get("longitude", 999)))
    if not -90 <= lat <= 90 or not -180 <= lon <= 180:
        return None
    return [lat, lon]


def _clean_node(node: dict[str, Any]) -> dict[str, Any]:
    center = _center_from_node(node)
    if not center:
        raise GraphTraversalServiceError(f"El nodo {node.get('id')} no tiene coordenadas validas.")
    return {
        "id": str(node["id"]),
        "nombre": node.get("nombre", node.get("distrito", str(node["id"]))),
        "center": center,
        "interrupciones": int(node.get("interrupciones", 0) or 0),
        "criticidad": node.get("criticidad", "baja"),
        "prioridad_score": float(node.get("prioridad_score", 0) or 0),
        "personas_afectadas_estimadas": int(node.get("personas_afectadas_estimadas", 0) or 0),
    }


class GraphTraversalService:
    def __init__(self, root: Path, districts: list[dict[str, Any]] | None = None):
        self.root = root
        self._static_districts = districts
        self._districts_cache = None
        self._districts_mtime = None

    def _districts(self):
        if self._static_districts is not None:
            return list(self._static_districts)
        path = self.root / "data" / "processed" / "districts_summary.json"
        if not path.exists():
            return []
        mtime = path.stat().st_mtime
        if self._districts_cache is not None and self._districts_mtime == mtime:
            return list(self._districts_cache)
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise GraphTraversalServiceError("districts_summary.json debe contener una lista.")
        self._districts_cache = payload
        self._districts_mtime = mtime
        return list(payload)

    def _resolve_nodes(self, node_ids: list[str], origin_id: str, max_nodes: int):
        clean_ids = [str(node_id) for node_id in node_ids if str(node_id).strip()]
        if not clean_ids:
            raise GraphTraversalServiceError("No hay nodos disponibles en el sector seleccionado.")
        if len(clean_ids) != len(set(clean_ids)):
            raise GraphTraversalServiceError("La lista de nodos contiene ids duplicados.")
        if origin_id not in clean_ids:
            raise GraphTraversalServiceError("El origen debe estar incluido en el conjunto de nodos.")
        if len(clean_ids) > max_nodes:
            raise GraphTraversalServiceError(f"Solo se permiten hasta {max_nodes} nodos.")

        districts = {str(district.get("id")): district for district in self._districts()}
        missing = [node_id for node_id in clean_ids if node_id not in districts]
        if missing:
            raise GraphTraversalServiceError(f"Nodos no encontrados: {', '.join(missing)}.")
        return [_clean_node(districts[node_id]) for node_id in clean_ids]

    def run(
        self,
        origin_id: str,
        node_ids: list[str],
        algorithm: str = "bfs",
        max_nodes: int = 100,
        max_neighbors: int = 4,
    ) -> dict[str, Any]:
        started = time.perf_counter()
        algorithm = str(algorithm or "").strip().lower()
        origin_id = str(origin_id or "").strip()
        if algorithm not in {"bfs", "dfs"}:
            raise GraphTraversalServiceError("Algoritmo de recorrido no permitido.")
        if not origin_id:
            raise GraphTraversalServiceError("Se requiere un origen.")
        if max_nodes < 1 or max_nodes > 120:
            raise GraphTraversalServiceError("maxNodes debe estar entre 1 y 120.")
        if max_neighbors < 1 or max_neighbors > 20:
            raise GraphTraversalServiceError("maxNeighbors debe estar entre 1 y 20.")

        nodes = self._resolve_nodes(node_ids, origin_id, max_nodes)
        node_lookup = {node["id"]: node for node in nodes}
        adjacency = build_logical_adjacency(nodes, max_neighbors=max_neighbors)
        edge_count = sum(len(neighbors) for neighbors in adjacency.values())
        result = (
            bfs(adjacency, origin_id, with_metadata=True)
            if algorithm == "bfs"
            else dfs(adjacency, origin_id, with_metadata=True)
        )
        order = result["order"]
        order_set = set(order)
        unreachable = [node for node in nodes if node["id"] not in order_set]
        dimension_key = "level" if algorithm == "bfs" else "depth"
        dimensions = result["levels"] if algorithm == "bfs" else result["depths"]
        order_items = [
            {
                "position": index + 1,
                "nodeId": node_id,
                "name": node_lookup[node_id]["nombre"],
                "center": node_lookup[node_id]["center"],
                dimension_key: dimensions.get(node_id, 0),
            }
            for index, node_id in enumerate(order)
        ]
        tree_edges = [
            {
                "source": edge["source"],
                "target": edge["target"],
                "order": index + 1,
                "isTraversalEdge": True,
                "edge_type": "logical",
            }
            for index, edge in enumerate(result["tree_edges"])
        ]
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        logger.info(
            "Traversal run: algorithm=%s nodes=%s edges=%s origin=%s visited=%s unreachable=%s elapsed_ms=%s",
            algorithm,
            len(nodes),
            edge_count,
            origin_id,
            len(order),
            len(unreachable),
            elapsed_ms,
        )
        max_dimension = max(dimensions.values()) if dimensions else 0
        return {
            "algorithm": algorithm,
            "origin": {
                "id": origin_id,
                "name": node_lookup[origin_id]["nombre"],
                "center": node_lookup[origin_id]["center"],
            },
            "order": order_items,
            "treeEdges": tree_edges,
            "routePoints": [node_lookup[node_id]["center"] for node_id in order],
            "unreachableNodes": [
                {
                    "id": node["id"],
                    "name": node["nombre"],
                    "center": node["center"],
                }
                for node in unreachable
            ],
            "summary": {
                "visitedNodes": len(order),
                "totalNodes": len(nodes),
                "examinedEdges": int(result["examined_edges"]),
                "treeEdges": len(tree_edges),
                "maxLevel": max_dimension if algorithm == "bfs" else None,
                "maxDepth": max_dimension if algorithm == "dfs" else None,
            },
            "metadata": {
                "algorithm": algorithm,
                "implementation": "python",
                "graphType": "logical",
                "generatedAt": datetime.now().replace(microsecond=0).isoformat(),
                "executionMs": elapsed_ms,
            },
        }
