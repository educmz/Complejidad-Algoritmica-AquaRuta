from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from datetime import datetime
import json
import logging
import sys
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(__file__).resolve().parent / "src"
sys.path.insert(0, str(SRC))

from api.models import (
    BacktrackingRunRequest,
    DijkstraRunRequest,
    GraphTraversalRequest,
    GroupingRunRequest,
    RouteBatchRequest,
    RouteRequest,
    SectorizationRunRequest,
    TspRunRequest,
)
from config.operational_constants import ORS_MAX_ALTERNATIVE_ROUTES
from services.grouping_service import GroupingConfigError, GroupingService
from services.backtracking_service import (
    BacktrackingService,
    BacktrackingServiceError,
)
from services.dijkstra_service import DijkstraService, DijkstraServiceError
from services.graph_traversal_service import GraphTraversalService, GraphTraversalServiceError
from services.ors_service import ORSService, RouteConfig
from services.sectorization_service import SectorizationService, SectorizationServiceError
from services.tsp_service import TspService, TspServiceError

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Retry-After"],
)

PROCESSED_DIR = ROOT / "data" / "processed"
logger = logging.getLogger("aquaruta.routes")
ors_service = ORSService(RouteConfig.from_env(ROOT))
grouping_service = GroupingService(ROOT)
dijkstra_service = DijkstraService(ROOT)
tsp_service = TspService(ROOT)
graph_traversal_service = GraphTraversalService(ROOT)
backtracking_service = BacktrackingService(ROOT)
sectorization_service = SectorizationService(ROOT)


def _load_json(filename: str, fallback):
    path = PROCESSED_DIR / filename
    if not path.exists():
        return fallback

    return json.loads(path.read_text(encoding="utf-8"))


def _parse_datetime(value):
    if not value:
        return None

    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _intersects_period(district, start, end):
    if start is None and end is None:
        return True

    first = _parse_datetime(district.get("primera_interrupcion"))
    last = _parse_datetime(district.get("ultima_actualizacion"))

    if first is None or last is None:
        return False

    if start is not None and last < start:
        return False
    if end is not None and first > end:
        return False
    return True


def _build_metadata(districts):
    execution_timestamp = datetime.now().replace(microsecond=0).isoformat()
    first_values = [
        _parse_datetime(district.get("primera_interrupcion"))
        for district in districts
    ]
    last_values = [
        _parse_datetime(district.get("ultima_actualizacion"))
        for district in districts
    ]
    first_values = [value for value in first_values if value is not None]
    last_values = [value for value in last_values if value is not None]

    period_start = min(first_values).isoformat() if first_values else ""
    period_end = max(last_values).isoformat() if last_values else ""

    return {
        "record_count": len(districts),
        "period_start": period_start,
        "period_end": period_end,
        "last_update": period_end,
        "ultima_actualizacion": execution_timestamp,
        "processed_at": execution_timestamp,
        "scope_label": "Datos filtrados desde backend",
    }


def _sanitize_alternative_routes(value):
    if not value:
        return None

    if not isinstance(value, dict):
        raise HTTPException(
            status_code=400,
            detail="El parametro de rutas alternativas debe ser un objeto.",
        )

    sanitized = dict(value)
    target_count = int(sanitized.get("target_count", ORS_MAX_ALTERNATIVE_ROUTES))
    sanitized["target_count"] = max(1, min(target_count, ORS_MAX_ALTERNATIVE_ROUTES))
    return sanitized


def _build_route_body(payload: RouteRequest):
    if len(payload.coordinates) < 2:
        raise HTTPException(
            status_code=400,
            detail="Se requieren al menos dos coordenadas para calcular una ruta.",
        )

    body = {"coordinates": payload.coordinates}
    alternative_routes = _sanitize_alternative_routes(payload.alternative_routes)
    if alternative_routes:
        body["alternative_routes"] = alternative_routes
    if payload.source:
        body["source"] = payload.source
    if payload.target:
        body["target"] = payload.target
    return body


def _validate_coordinates(coordinates):
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        raise HTTPException(status_code=400, detail="Se requieren al menos dos coordenadas.")

    cleaned = []
    for point in coordinates:
        if not isinstance(point, list) or len(point) != 2:
            raise HTTPException(status_code=400, detail="Cada coordenada debe tener longitud y latitud.")
        lon = float(point[0])
        lat = float(point[1])
        if not -180 <= lon <= 180 or not -90 <= lat <= 90:
            raise HTTPException(status_code=400, detail="Coordenadas fuera de rango.")
        cleaned.append([lon, lat])

    if cleaned[0] == cleaned[-1]:
        raise HTTPException(status_code=400, detail="Origen y destino no pueden ser iguales.")
    return cleaned


def _request_openrouteservice(body):
    return ors_service.route(
        _validate_coordinates(body.get("coordinates", [])),
        alternative_routes=body.get("alternative_routes"),
        source=body.get("source"),
        target=body.get("target"),
    )


@app.post("/routes-batch")
def get_routes_batch(payload: RouteBatchRequest):
    if not payload.routes:
        raise HTTPException(status_code=400, detail="Se requiere al menos una ruta.")
    if len(payload.routes) > 8:
        raise HTTPException(status_code=400, detail="Solo se permiten hasta 8 rutas por lote.")

    routes = []
    for route in payload.routes:
        body = _build_route_body(route)
        body["coordinates"] = _validate_coordinates(body["coordinates"])
        routes.append(body)
    return ors_service.batch(routes)


@app.get("/")
def root():
    return {"message": "Backend AquaRuta activo"}


@app.post("/grouping/run")
def run_grouping(payload: GroupingRunRequest):
    try:
        return grouping_service.run(
            filters=payload.filters.model_dump(),
            config=payload.config.model_dump(),
        )
    except GroupingConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        logger.warning("No se pudo ejecutar agrupacion UFDS: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="No se pudo calcular la agrupacion operativa.",
        ) from exc


@app.post("/local-exploration/tsp")
def run_local_tsp(payload: TspRunRequest):
    try:
        return tsp_service.run(
            origin_id=payload.originId,
            destination_ids=payload.destinationIds,
            criterion=payload.criterion,
            max_exact_nodes=payload.maxExactNodes,
            max_destinations=payload.maxDestinations,
        )
    except TspServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        logger.warning("No se pudo ejecutar TSP local: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="No se pudo calcular la secuencia de visita.",
        ) from exc


@app.post("/local-exploration/dijkstra")
def run_local_dijkstra(payload: DijkstraRunRequest):
    try:
        return dijkstra_service.run(
            origin_id=payload.originId,
            target_id=payload.targetId,
            node_ids=payload.nodeIds,
            criterion=payload.criterion,
            max_nodes=payload.maxNodes,
            max_neighbors=payload.maxNeighbors,
        )
    except DijkstraServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        logger.warning("No se pudo ejecutar Dijkstra local: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="No se pudo calcular el camino minimo.",
        ) from exc


@app.post("/local-exploration/traversal")
def run_local_traversal(payload: GraphTraversalRequest):
    try:
        return graph_traversal_service.run(
            origin_id=payload.originId,
            node_ids=payload.nodeIds,
            algorithm=payload.algorithm,
            max_nodes=payload.maxNodes,
            max_neighbors=payload.maxNeighbors,
        )
    except GraphTraversalServiceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        logger.warning("No se pudo ejecutar recorrido local: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="No se pudo calcular el recorrido.",
        ) from exc


@app.post("/local-exploration/backtracking")
def run_local_backtracking(payload: BacktrackingRunRequest):
    try:
        return backtracking_service.run(
            origin_id=payload.originId,
            destination_ids=payload.destinationIds,
            criterion=payload.criterion,
            constraints=payload.constraints.model_dump(),
            max_exact_nodes=payload.maxExactNodes,
        )
    except BacktrackingServiceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        logger.warning("No se pudo ejecutar Backtracking local: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="No se pudo evaluar la secuencia.",
        ) from exc


@app.post("/sectorization/run")
def run_sectorization(payload: SectorizationRunRequest):
    try:
        return sectorization_service.run(
            group_id=payload.groupId,
            node_ids=payload.nodeIds,
            max_sector_size=payload.maxSectorSize,
            split_criterion=payload.splitCriterion,
            max_depth=payload.maxDepth,
        )
    except SectorizationServiceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        logger.warning("No se pudo ejecutar sectorizacion: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="No se pudo sectorizar el grupo.",
        ) from exc


@app.get("/dashboard")
def get_dashboard(
    eps: str | None = None,
    departamento: str | None = None,
    provincia: str | None = None,
    distrito: str | None = None,
    grupo: str | None = None,
    fecha_inicio: str | None = None,
    fecha_fin: str | None = None,
):
    districts = _load_json("districts_summary.json", [])
    grouped_zones = _load_json("grouped_zones.json", [])
    eps_origins = _load_json("eps_origins.json", [])
    operational_routes = _load_json("operational_routes.json", {})

    selected_group = next(
        (item for item in grouped_zones if item.get("id") == grupo),
        None,
    )
    selected_group_ids = set(selected_group.get("zona_ids", [])) if selected_group else set()
    start = _parse_datetime(fecha_inicio)
    end = _parse_datetime(fecha_fin)

    filtered_districts = []
    for item in districts:
        if selected_group_ids and item.get("id") not in selected_group_ids:
            continue
        if eps and item.get("eps_principal") != eps:
            continue
        if departamento and item.get("departamento") != departamento:
            continue
        if provincia and item.get("provincia") != provincia:
            continue
        if distrito and item.get("id") != distrito:
            continue
        if not _intersects_period(item, start, end):
            continue
        filtered_districts.append(item)

    filtered_ids = {item.get("id") for item in filtered_districts}
    filtered_groups = [
        group
        for group in grouped_zones
        if any(zone_id in filtered_ids for zone_id in group.get("zona_ids", []))
    ]

    return {
        "metadata": _build_metadata(filtered_districts),
        "districts": filtered_districts,
        "groupedZones": filtered_groups,
        "epsOrigins": eps_origins,
        "operationalRoutes": operational_routes,
    }




@app.post("/route")
def get_route_safe(payload: RouteRequest):
    body = _build_route_body(payload)
    body["coordinates"] = _validate_coordinates(body["coordinates"])
    return _request_openrouteservice(body)
