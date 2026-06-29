from __future__ import annotations

import json
import logging
import math
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from algorithms.divide_conquer import sectorize_divide_and_conquer
from config.algorithm_limits import (
    MAX_SECTOR_SIZE_ALLOWED,
    MAX_SECTORIZATION_DEPTH,
    MAX_SECTORIZATION_NODES,
)


logger = logging.getLogger("aquaruta.sectorization")

MIN_SECTOR_SIZE = 1
DEFAULT_MAX_SECTOR_SIZE = 8
ALLOWED_SPLIT_CRITERIA = {"geografico", "carga", "mixto", "prioridad", "geographic_spread"}


class SectorizationServiceError(ValueError):
    pass


def normalize_split_criterion(value: str) -> str:
    normalized = str(value or "geografico").strip().lower()
    aliases = {
        "geographic_spread": "geografico",
        "geographic": "geografico",
        "load": "carga",
        "mixed": "mixto",
        "priority": "prioridad",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized not in {"geografico", "carga", "mixto", "prioridad"}:
        raise SectorizationServiceError("Criterio de sectorizacion no permitido.")
    return normalized


def _center(node: dict[str, Any]):
    center = node.get("center")
    if not isinstance(center, list) or len(center) != 2:
        return None
    lat = float(center[0])
    lon = float(center[1])
    if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        return None
    return [lat, lon]


def _criticality_rank(value: str) -> int:
    return {"critica": 4, "alta": 3, "media": 2, "baja": 1}.get(str(value or "").lower(), 0)


def _rank_criticality(rank: int) -> str:
    return {4: "critica", 3: "alta", 2: "media", 1: "baja"}.get(rank, "baja")


class SectorizationService:
    def __init__(
        self,
        root: Path,
        districts: list[dict[str, Any]] | None = None,
        grouped_zones: list[dict[str, Any]] | None = None,
    ):
        self.root = root
        self._static_districts = districts
        self._static_grouped_zones = grouped_zones
        self._districts_cache = None
        self._districts_mtime = None
        self._groups_cache = None
        self._groups_mtime = None

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
            raise SectorizationServiceError(f"{filename} debe contener una lista.")
        setattr(self, cache_attr, payload)
        setattr(self, mtime_attr, mtime)
        return list(payload)

    def _districts(self):
        return self._load_json_list(
            "districts_summary.json",
            "_districts_cache",
            "_districts_mtime",
            self._static_districts,
        )

    def _groups(self):
        return self._load_json_list(
            "grouped_zones.json",
            "_groups_cache",
            "_groups_mtime",
            self._static_grouped_zones,
        )

    def _resolve_group(self, group_id: str, group: dict[str, Any] | None = None):
        if group is not None:
            if str(group.get("id") or group.get("groupId") or "") != group_id:
                raise SectorizationServiceError("El grupo enviado no coincide con groupId.")
            if not isinstance(group.get("zona_ids"), list):
                raise SectorizationServiceError("El grupo enviado no contiene zona_ids validos.")
            normalized = dict(group)
            normalized["id"] = group_id
            return normalized
        group = next((item for item in self._groups() if item.get("id") == group_id), None)
        if not group:
            raise SectorizationServiceError("Grupo operativo no encontrado.")
        return group

    def _resolve_nodes(self, group: dict[str, Any], node_ids: list[str] | None):
        group_ids = [str(item) for item in group.get("zona_ids", [])]
        if not group_ids:
            raise SectorizationServiceError("El grupo operativo no tiene nodos.")
        selected_ids = [str(item) for item in (node_ids or group_ids)]
        if len(selected_ids) != len(set(selected_ids)):
            raise SectorizationServiceError("La lista de nodos contiene ids duplicados.")
        outside = [node_id for node_id in selected_ids if node_id not in set(group_ids)]
        if outside:
            raise SectorizationServiceError("La solicitud contiene nodos ajenos al grupo seleccionado.")
        district_lookup = {str(district.get("id")): district for district in self._districts()}
        missing = [node_id for node_id in selected_ids if node_id not in district_lookup]
        if missing:
            raise SectorizationServiceError(f"Nodos no encontrados: {', '.join(missing)}.")
        nodes = []
        invalid = []
        for node_id in selected_ids:
            node = dict(district_lookup[node_id])
            center = _center(node)
            if not center:
                invalid.append(node_id)
                continue
            node["center"] = center
            nodes.append(node)
        if invalid:
            raise SectorizationServiceError(f"Nodos sin coordenadas validas: {', '.join(invalid)}.")
        if not nodes:
            raise SectorizationServiceError("No hay nodos disponibles para sectorizar.")
        if len(nodes) > MAX_SECTORIZATION_NODES:
            raise SectorizationServiceError(f"Solo se permiten hasta {MAX_SECTORIZATION_NODES} nodos.")
        return nodes

    def run(
        self,
        group_id: str,
        group: dict[str, Any] | None = None,
        node_ids: list[str] | None = None,
        max_sector_size: int = DEFAULT_MAX_SECTOR_SIZE,
        split_criterion: str = "geografico",
        max_depth: int = MAX_SECTORIZATION_DEPTH,
    ):
        started = time.perf_counter()
        group_id = str(group_id or "").strip()
        if not group_id:
            raise SectorizationServiceError("Se requiere un grupo operativo.")
        split_criterion = normalize_split_criterion(split_criterion)
        max_sector_size = int(max_sector_size)
        max_depth = int(max_depth)
        if max_sector_size < MIN_SECTOR_SIZE or max_sector_size > MAX_SECTOR_SIZE_ALLOWED:
            raise SectorizationServiceError(
                f"maxSectorSize debe estar entre {MIN_SECTOR_SIZE} y {MAX_SECTOR_SIZE_ALLOWED}."
            )
        if max_depth < 0 or max_depth > MAX_SECTORIZATION_DEPTH:
            raise SectorizationServiceError(f"maxDepth debe estar entre 0 y {MAX_SECTORIZATION_DEPTH}.")

        group = self._resolve_group(group_id, group)
        nodes = self._resolve_nodes(group, node_ids)
        result = sectorize_divide_and_conquer(
            nodes,
            max_sector_size=max_sector_size,
            split_criterion=split_criterion,
            max_depth=max_depth,
        )
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        response = self._response(group, nodes, result, max_sector_size, split_criterion, max_depth, elapsed_ms)
        logger.info(
            "Sectorization run: group_id=%s input_nodes=%s max_sector_size=%s criterion=%s recursive_calls=%s split_count=%s base_cases=%s output_sectors=%s max_depth=%s execution_ms=%s warnings=%s",
            group_id,
            len(nodes),
            max_sector_size,
            split_criterion,
            response["metadata"]["recursiveCalls"],
            response["metadata"]["splitCount"],
            response["metadata"]["baseCaseCount"],
            response["summary"]["outputSectors"],
            response["metadata"]["maxDepthReached"],
            elapsed_ms,
            len(response["warnings"]),
        )
        return response

    def _response(self, group, nodes, result, max_sector_size, split_criterion, max_depth, elapsed_ms):
        input_ids = [str(node["id"]) for node in nodes]
        seen = []
        sectors = []
        for index, sector in enumerate(result["sectors"], start=1):
            sector_id = f"{group['id']}-sector-{index}"
            sector_nodes = sector["nodes"]
            node_ids = [str(node["id"]) for node in sector_nodes]
            seen.extend(node_ids)
            sectors.append(
                {
                    "sectorId": sector_id,
                    "id": sector_id,
                    "nombre": f"Sector {index}",
                    "groupId": group["id"],
                    "parentGroupId": group["id"],
                    "nodeIds": node_ids,
                    "zona_ids": node_ids,
                    "zonas": [node.get("nombre", node["id"]) for node in sector_nodes],
                    "nodes": [self._clean_node(node) for node in sector_nodes],
                    "center": self._centroid(sector_nodes),
                    "centroid": self._centroid_object(sector_nodes),
                    "summary": self._sector_summary(sector_nodes),
                    "recursion": {
                        "depth": sector["depth"],
                        "baseCase": sector["base_case"],
                    },
                }
            )
        duplicated_nodes = len(seen) - len(set(seen))
        missing_nodes = [node_id for node_id in input_ids if node_id not in set(seen)]
        unknown_nodes = [node_id for node_id in seen if node_id not in set(input_ids)]
        sizes = [len(sector["nodeIds"]) for sector in sectors]
        warnings = []
        for warning in result["warnings"]:
            warnings.append(dict(warning))
        for sector in sectors:
            if len(sector["nodeIds"]) > max_sector_size:
                warnings.append(
                    {
                        "code": "SECTOR_SIZE_EXCEEDED",
                        "sectorId": sector["sectorId"],
                        "size": len(sector["nodeIds"]),
                        "maxSectorSize": max_sector_size,
                    }
                )
        return {
            "group": {
                "groupId": group["id"],
                "groupName": group.get("nombre", group["id"]),
                "inputNodes": len(nodes),
                "groupCenter": group.get("center"),
            },
            "configuration": {
                "maxSectorSize": max_sector_size,
                "splitCriterion": split_criterion,
                "maxDepth": max_depth,
            },
            "sectors": sectors,
            "summary": {
                "inputNodes": len(nodes),
                "outputSectors": len(sectors),
                "largestSectorSize": max(sizes) if sizes else 0,
                "smallestSectorSize": min(sizes) if sizes else 0,
                "averageSectorSize": round(sum(sizes) / len(sizes), 4) if sizes else 0,
                "allNodesCovered": not missing_nodes and not unknown_nodes,
                "duplicatedNodes": duplicated_nodes,
                "missingNodes": len(missing_nodes),
                "unknownNodes": len(unknown_nodes),
                "maxSectorSizeSatisfied": all(size <= max_sector_size for size in sizes),
                "deterministicIds": True,
            },
            "metadata": {
                "algorithm": "divide_and_conquer",
                "implementation": "python",
                "recursiveCalls": result["metrics"]["recursive_calls"],
                "splitCount": result["metrics"]["split_count"],
                "baseCaseCount": result["metrics"]["base_case_count"],
                "maxDepthReached": result["metrics"]["max_depth_reached"],
                "inputNodes": result["metrics"]["input_nodes"],
                "outputSectors": result["metrics"]["output_sectors"],
                "executionMs": elapsed_ms,
                "generatedAt": datetime.now().replace(microsecond=0).isoformat(),
            },
            "splitTrace": result["split_trace"],
            "warnings": warnings,
        }

    def _clean_node(self, node):
        return {
            "id": node["id"],
            "nombre": node.get("nombre", node["id"]),
            "center": node.get("center"),
            "interrupciones": int(node.get("interrupciones", 0) or 0),
            "criticidad": node.get("criticidad", "baja"),
            "personas_afectadas_estimadas": int(node.get("personas_afectadas_estimadas", 0) or 0),
            "peso_demanda_familiar": float(node.get("peso_demanda_familiar", 0) or 0),
            "prioridad_score": float(node.get("prioridad_score", 0) or 0),
            "promedio_integrantes_hogar": float(node.get("promedio_integrantes_hogar", 0) or 0),
            "conexiones_afectadas_evento_max": int(node.get("conexiones_afectadas_evento_max", 0) or 0),
        }

    def _centroid(self, nodes):
        return [
            round(sum(node["center"][0] for node in nodes) / len(nodes), 6),
            round(sum(node["center"][1] for node in nodes) / len(nodes), 6),
        ]

    def _centroid_object(self, nodes):
        center = self._centroid(nodes)
        return {"latitude": center[0], "longitude": center[1]}

    def _sector_summary(self, nodes):
        centers = [node["center"] for node in nodes]
        centroid = self._centroid(nodes)
        dispersions = [
            math.hypot(center[0] - centroid[0], center[1] - centroid[1])
            for center in centers
        ]
        interruptions = sum(int(node.get("interrupciones", 0) or 0) for node in nodes)
        return {
            "districts": len(nodes),
            "population": sum(int(node.get("poblacion", node.get("poblacion_total", 0)) or 0) for node in nodes),
            "households": sum(int(node.get("total_hogares", 0) or 0) for node in nodes),
            "affectedConnections": sum(int(node.get("conexiones_afectadas_evento_max", 0) or 0) for node in nodes),
            "estimatedAffectedPeople": sum(int(node.get("personas_afectadas_estimadas", 0) or 0) for node in nodes),
            "demandWeight": round(max(float(node.get("peso_demanda_familiar", 0) or 0) for node in nodes), 6),
            "averagePriority": round(
                sum(float(node.get("prioridad_score", 0) or 0) for node in nodes) / len(nodes),
                6,
            ),
            "maxCriticality": _rank_criticality(max(_criticality_rank(node.get("criticidad")) for node in nodes)),
            "interruptions": interruptions,
            "geographicDispersion": round(max(dispersions) if dispersions else 0, 6),
        }
