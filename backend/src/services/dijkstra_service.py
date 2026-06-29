from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from algorithms.dijkstra import dijkstra
from services.edge_metrics import (
    build_edge_metrics,
    center_from_node,
    criterion_to_weight_field,
    haversine_km,
    normalize_criterion,
)


logger = logging.getLogger("aquaruta.dijkstra")


class DijkstraServiceError(ValueError):
    pass


def _clean_district(node: dict[str, Any]) -> dict[str, Any]:
    center = center_from_node(node)
    if not center:
        raise DijkstraServiceError(f"El nodo {node.get('id')} no tiene coordenadas validas.")
    return {
        "id": node["id"],
        "nombre": node.get("nombre", node.get("distrito", node["id"])),
        "center": center,
        "interrupciones": int(node.get("interrupciones", 0) or 0),
        "criticidad": node.get("criticidad", "baja"),
        "duracion_promedio_horas": float(node.get("duracion_promedio_horas", 0) or 0),
        "peso_demanda_familiar": float(node.get("peso_demanda_familiar", 0) or 0),
        "prioridad_score": float(node.get("prioridad_score", 0) or 0),
        "personas_afectadas_estimadas": int(node.get("personas_afectadas_estimadas", 0) or 0),
        "provincia": node.get("provincia", ""),
        "departamento": node.get("departamento", ""),
    }


class DijkstraService:
    def __init__(
        self,
        root: Path,
        districts: list[dict[str, Any]] | None = None,
        eps_origins: list[dict[str, Any]] | None = None,
    ):
        self.root = root
        self._static_districts = districts
        self._static_eps_origins = eps_origins
        self._districts_cache = None
        self._districts_mtime = None
        self._eps_cache = None
        self._eps_mtime = None

    def _load_json_list(self, filename: str, cache_attr: str, mtime_attr: str, static_value):
        if static_value is not None:
            return list(static_value)
        path = self.root / "data" / "processed" / filename
        if not path.exists():
            return []
        mtime = path.stat().st_mtime
        cached = getattr(self, cache_attr)
        cached_mtime = getattr(self, mtime_attr)
        if cached is not None and cached_mtime == mtime:
            return list(cached)
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise DijkstraServiceError(f"{filename} debe contener una lista.")
        setattr(self, cache_attr, payload)
        setattr(self, mtime_attr, mtime)
        return list(payload)

    def _districts(self):
        return self._load_json_list("districts_summary.json", "_districts_cache", "_districts_mtime", self._static_districts)

    def _eps_origins(self):
        return self._load_json_list("eps_origins.json", "_eps_cache", "_eps_mtime", self._static_eps_origins)

    def _resolve_origin(self, origin_id: str) -> dict[str, Any]:
        origins = {origin.get("id"): origin for origin in self._eps_origins()}
        origin = origins.get(origin_id)
        if not origin:
            raise DijkstraServiceError("Origen EPS no encontrado.")
        center = center_from_node(origin)
        if not center:
            raise DijkstraServiceError("El origen EPS no tiene coordenadas validas.")
        return {
            "id": origin["id"],
            "nombre": origin.get("prestador", origin["id"]),
            "center": center,
            "interrupciones": 0,
            "criticidad": "baja",
            "duracion_promedio_horas": 0,
            "peso_demanda_familiar": 0,
            "prioridad_score": 0,
            "isEpsNode": True,
        }

    def _resolve_nodes(self, node_ids: list[str], target_id: str, max_nodes: int) -> list[dict[str, Any]]:
        if len(node_ids) != len(set(node_ids)):
            raise DijkstraServiceError("La lista de nodos contiene ids duplicados.")
        if target_id not in node_ids:
            node_ids = [*node_ids, target_id]
        if len(node_ids) > max_nodes:
            raise DijkstraServiceError(f"Solo se permiten hasta {max_nodes} nodos.")
        districts = {district.get("id"): district for district in self._districts()}
        missing = [node_id for node_id in node_ids if node_id not in districts]
        if missing:
            raise DijkstraServiceError(f"Nodos no encontrados: {', '.join(missing)}.")
        return [_clean_district(districts[node_id]) for node_id in node_ids]

    def _build_adjacency(self, origin: dict[str, Any], nodes: list[dict[str, Any]], max_neighbors: int):
        graph_nodes = [origin] + nodes
        adjacency = {node["id"]: [] for node in graph_nodes}
        for source in graph_nodes:
            candidates = []
            for target in graph_nodes:
                if source["id"] == target["id"]:
                    continue
                metrics = build_edge_metrics(source, target)
                candidates.append(
                    {
                        "to": target["id"],
                        "metrics": metrics,
                        **metrics,
                        "weight": metrics["distance_weight"],
                    }
                )
            candidates.sort(key=lambda edge: edge["distance_weight"])
            adjacency[source["id"]] = candidates[:max_neighbors]
        return adjacency

    @staticmethod
    def _edge(source: dict[str, Any], target: dict[str, Any]) -> dict[str, Any]:
        metrics = build_edge_metrics(source, target)
        return {
            "to": target["id"],
            "metrics": metrics,
            **metrics,
            "weight": metrics["distance_weight"],
        }

    def _build_connected_adjacency(
        self,
        origin: dict[str, Any],
        nodes: list[dict[str, Any]],
        adjacency: dict[str, list[dict[str, Any]]],
    ) -> dict[str, list[dict[str, Any]]]:
        graph_nodes = [origin] + nodes
        node_lookup = {node["id"]: node for node in graph_nodes}
        connected = {
            node_id: [dict(edge) for edge in neighbors]
            for node_id, neighbors in adjacency.items()
        }

        def add_edge(source_id: str, target_id: str) -> None:
            if any(edge["to"] == target_id for edge in connected[source_id]):
                return
            connected[source_id].append(
                self._edge(node_lookup[source_id], node_lookup[target_id])
            )

        for source_id, neighbors in adjacency.items():
            for edge in neighbors:
                add_edge(edge["to"], source_id)

        reached = {origin["id"]}
        while True:
            frontier = list(reached)
            for source_id in frontier:
                reached.update(edge["to"] for edge in connected[source_id])
            if len(reached) == len(graph_nodes):
                break

            outside = set(node_lookup) - reached
            source_id, target_id = min(
                (
                    (inside_id, outside_id)
                    for inside_id in reached
                    for outside_id in outside
                ),
                key=lambda pair: haversine_km(
                    node_lookup[pair[0]]["center"],
                    node_lookup[pair[1]]["center"],
                ),
            )
            add_edge(source_id, target_id)
            add_edge(target_id, source_id)
            reached.add(target_id)

        return connected

    def _path_edges(
        self,
        path: list[str],
        adjacency: dict[str, list[dict[str, Any]]],
        weight_field: str,
        edge_type: str = "logical",
    ):
        edge_map = {
            (source, edge["to"]): edge
            for source, neighbors in adjacency.items()
            for edge in neighbors
        }
        edges = []
        for index in range(len(path) - 1):
            source = path[index]
            target = path[index + 1]
            edge = edge_map[(source, target)]
            edges.append(
                {
                    "source": source,
                    "target": target,
                    "selectedWeight": round(float(edge[weight_field]), 6),
                    "distanceKm": edge["distance_km"],
                    "roadDistanceKm": edge["road_distance_km"],
                    "durationMin": edge["duration_min"],
                    "operationalCost": edge["operational_cost"],
                    "trafficFactor": edge["traffic_factor"],
                    "isShortestPath": True,
                    "edge_type": edge_type,
                }
            )
        return edges

    def run(
        self,
        origin_id: str,
        target_id: str,
        node_ids: list[str],
        criterion: str = "distancia",
        max_nodes: int = 80,
        max_neighbors: int = 4,
    ) -> dict[str, Any]:
        started = time.perf_counter()
        criterion = normalize_criterion(criterion)
        try:
            weight_field = criterion_to_weight_field(criterion)
        except ValueError as exc:
            raise DijkstraServiceError(str(exc)) from exc
        if origin_id == target_id:
            raise DijkstraServiceError("El origen y destino deben ser diferentes.")
        if max_nodes < 1 or max_nodes > 120:
            raise DijkstraServiceError("maxNodes debe estar entre 1 y 120.")
        if max_neighbors < 1 or max_neighbors > 20:
            raise DijkstraServiceError("maxNeighbors debe estar entre 1 y 20.")

        origin = self._resolve_origin(origin_id)
        nodes = self._resolve_nodes([str(item) for item in node_ids], target_id, max_nodes)
        target = next((node for node in nodes if node["id"] == target_id), None)
        if not target:
            raise DijkstraServiceError("Destino no encontrado.")

        adjacency = self._build_adjacency(origin, nodes, max_neighbors)
        shortest = dijkstra(adjacency, origin["id"], target["id"], weight_field=weight_field)
        graph_mode = "local"
        if not shortest.get("reachable"):
            adjacency = self._build_connected_adjacency(origin, nodes, adjacency)
            shortest = dijkstra(
                adjacency,
                origin["id"],
                target["id"],
                weight_field=weight_field,
            )
            graph_mode = "estimated-connected"
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)

        if not shortest.get("reachable"):
            logger.info(
                "Dijkstra unreachable: nodes=%s criterion=%s weight_field=%s elapsed_ms=%s",
                len(nodes),
                criterion,
                weight_field,
                elapsed_ms,
            )
            return {
                "origin": origin,
                "target": target,
                "criterion": criterion,
                "path": [],
                "edges": [],
                "routePoints": [],
                "status": "unreachable",
                "summary": {
                    "totalWeight": 0.0,
                    "totalDistanceKm": 0.0,
                    "totalRoadDistanceKm": 0.0,
                    "totalDurationMin": 0.0,
                    "totalOperationalCost": 0.0,
                    "visitedNodes": len(shortest.get("visited_order", [])),
                    "relaxedEdges": int(shortest.get("relaxed_edges", 0) or 0),
                },
                "metadata": {
                    "algorithm": "dijkstra",
                    "implementation": "python",
                    "weightField": weight_field,
                    "graphMode": graph_mode,
                    "generatedAt": datetime.now().replace(microsecond=0).isoformat(),
                    "executionMs": elapsed_ms,
                },
            }

        node_lookup = {node["id"]: node for node in [origin] + nodes}
        path = [
            {
                "order": index,
                "nodeId": node_id,
                "nombre": node_lookup[node_id].get("nombre", node_id),
                "center": node_lookup[node_id].get("center"),
            }
            for index, node_id in enumerate(shortest["path"])
        ]
        edges = self._path_edges(
            shortest["path"],
            adjacency,
            weight_field,
            edge_type="estimated" if graph_mode == "estimated-connected" else "logical",
        )
        summary = {
            "totalWeight": shortest.get("cost", 0.0),
            "totalDistanceKm": round(sum(edge["distanceKm"] for edge in edges), 6),
            "totalRoadDistanceKm": round(sum(edge["roadDistanceKm"] for edge in edges), 6),
            "totalDurationMin": round(sum(edge["durationMin"] for edge in edges), 6),
            "totalOperationalCost": round(sum(edge["operationalCost"] for edge in edges), 6),
            "visitedNodes": len(shortest.get("visited_order", [])),
            "relaxedEdges": int(shortest.get("relaxed_edges", 0) or 0),
        }
        logger.info(
            "Dijkstra run: nodes=%s criterion=%s weight_field=%s path_edges=%s relaxed_edges=%s elapsed_ms=%s",
            len(nodes),
            criterion,
            weight_field,
            len(edges),
            summary["relaxedEdges"],
            elapsed_ms,
        )
        return {
            "origin": origin,
            "target": target,
            "criterion": criterion,
            "path": path,
            "edges": edges,
            "routePoints": [node_lookup[node_id]["center"] for node_id in shortest["path"]],
            "status": "success",
            "summary": summary,
            "metadata": {
                "algorithm": "dijkstra",
                "implementation": "python",
                "weightField": weight_field,
                "graphMode": graph_mode,
                "generatedAt": datetime.now().replace(microsecond=0).isoformat(),
                "executionMs": elapsed_ms,
            },
        }
