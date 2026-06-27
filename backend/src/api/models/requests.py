from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from config.algorithm_limits import (
    MAX_BACKTRACKING_NODES,
    MAX_BACKTRACKING_VISITS,
    MAX_DIJKSTRA_NEIGHBORS,
    MAX_DIJKSTRA_NODES,
    MAX_SECTOR_SIZE_ALLOWED,
    MAX_SECTORIZATION_DEPTH,
    MAX_TRAVERSAL_NEIGHBORS,
    MAX_TRAVERSAL_NODES,
    MAX_TSP_EXACT_NODES,
    MAX_TSP_DESTINATIONS,
)
from services.backtracking_service import normalize_backtracking_criterion
from services.sectorization_service import DEFAULT_MAX_SECTOR_SIZE, normalize_split_criterion
from services.tsp_service import normalize_criterion


class RouteRequest(BaseModel):
    coordinates: list[list[float]]
    alternative_routes: dict[str, Any] | None = None
    source: str | None = None
    target: str | None = None


class RouteBatchRequest(BaseModel):
    routes: list[RouteRequest]


class GroupingFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    departamento: str | None = None
    provincia: str | None = None
    distrito: str | None = None
    eps: str | None = None
    criticidad: str | None = None


class GroupingConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    criterio: str = Field("combinado")
    umbral_distancia_geografica_km: float = Field(18.0, ge=0.1, le=500.0)
    umbral_distancia_vial_km: float = Field(32.0, ge=0.1, le=750.0)
    umbral_tiempo_min: float = Field(70.0, ge=1.0, le=1440.0)
    umbral_costo: float = Field(240.0, ge=1.0, le=100000.0)
    velocidad_promedio_kmh: float = Field(28.0, ge=1.0, le=120.0)
    factor_vial: float = Field(1.35, ge=1.0, le=5.0)
    max_vecinos_candidatos: int = Field(12, ge=1, le=100)

    @field_validator("criterio")
    @classmethod
    def validate_criterion(cls, value):
        normalized = str(value or "").strip().lower()
        if normalized not in {"geografico", "vial", "combinado"}:
            raise ValueError("Criterio de agrupacion no permitido.")
        return normalized


class GroupingRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filters: GroupingFilters
    config: GroupingConfig


class TspRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    originId: str = Field(min_length=1)
    destinationIds: list[str] = Field(default_factory=list, max_length=MAX_TSP_DESTINATIONS)
    criterion: str = Field("distancia")
    maxExactNodes: int = Field(MAX_TSP_EXACT_NODES, ge=1, le=MAX_TSP_EXACT_NODES)
    maxDestinations: int = Field(60, ge=1, le=MAX_TSP_DESTINATIONS)

    @field_validator("criterion")
    @classmethod
    def validate_tsp_criterion(cls, value):
        return normalize_criterion(value)

    @field_validator("destinationIds")
    @classmethod
    def validate_destination_ids(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("La lista de destinos contiene ids duplicados.")
        return value


class DijkstraRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    originId: str = Field(min_length=1)
    targetId: str = Field(min_length=1)
    nodeIds: list[str] = Field(default_factory=list, max_length=MAX_DIJKSTRA_NODES)
    criterion: str = Field("distancia")
    maxNodes: int = Field(80, ge=1, le=MAX_DIJKSTRA_NODES)
    maxNeighbors: int = Field(4, ge=1, le=MAX_DIJKSTRA_NEIGHBORS)

    @field_validator("criterion")
    @classmethod
    def validate_dijkstra_criterion(cls, value):
        normalized = str(value or "").strip().lower()
        normalized = {"distance": "distancia", "time": "tiempo", "cost": "costo"}.get(normalized, normalized)
        if normalized not in {"distancia", "tiempo", "costo"}:
            raise ValueError("Criterio Dijkstra no permitido.")
        return normalized

    @field_validator("nodeIds")
    @classmethod
    def validate_node_ids(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("La lista de nodos contiene ids duplicados.")
        return value


class GraphTraversalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    originId: str = Field(min_length=1)
    nodeIds: list[str] = Field(..., min_length=1, max_length=MAX_TRAVERSAL_NODES)
    algorithm: str = Field("bfs")
    maxNodes: int = Field(100, ge=1, le=MAX_TRAVERSAL_NODES)
    maxNeighbors: int = Field(4, ge=1, le=MAX_TRAVERSAL_NEIGHBORS)

    @field_validator("algorithm")
    @classmethod
    def validate_traversal_algorithm(cls, value):
        normalized = str(value or "").strip().lower()
        if normalized not in {"bfs", "dfs"}:
            raise ValueError("Algoritmo de recorrido no permitido.")
        return normalized

    @field_validator("nodeIds")
    @classmethod
    def validate_traversal_node_ids(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("La lista de nodos contiene ids duplicados.")
        return value


class BacktrackingConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid")

    maxDistanceKm: float | None = Field(default=None, ge=0, le=2000)
    maxDurationMin: float | None = Field(default=None, ge=0, le=5000)
    maxOperationalCost: float | None = Field(default=None, ge=0, le=50000)
    maxVisits: int | None = Field(default=None, ge=1, le=MAX_BACKTRACKING_VISITS)


class BacktrackingRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    originId: str = Field(min_length=1)
    destinationIds: list[str] = Field(default_factory=list, max_length=60)
    criterion: str = Field("distancia")
    constraints: BacktrackingConstraints = Field(default_factory=BacktrackingConstraints)
    maxExactNodes: int = Field(MAX_BACKTRACKING_NODES, ge=1, le=MAX_BACKTRACKING_NODES)

    @field_validator("criterion")
    @classmethod
    def validate_backtracking_criterion(cls, value):
        return normalize_backtracking_criterion(value)

    @field_validator("destinationIds")
    @classmethod
    def validate_backtracking_destination_ids(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("La lista de destinos contiene ids duplicados.")
        return value


class SectorizationRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    groupId: str = Field(min_length=1)
    nodeIds: list[str] | None = Field(default=None, max_length=500)
    maxSectorSize: int = Field(DEFAULT_MAX_SECTOR_SIZE, ge=1, le=MAX_SECTOR_SIZE_ALLOWED)
    splitCriterion: str = Field("geografico")
    maxDepth: int = Field(MAX_SECTORIZATION_DEPTH, ge=0, le=MAX_SECTORIZATION_DEPTH)

    @field_validator("splitCriterion")
    @classmethod
    def validate_split_criterion(cls, value):
        return normalize_split_criterion(value)

    @field_validator("nodeIds")
    @classmethod
    def validate_sectorization_node_ids(cls, value):
        if value is not None and len(value) != len(set(value)):
            raise ValueError("La lista de nodos contiene ids duplicados.")
        return value
