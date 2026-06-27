from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
from typing import Any, Dict, List
from datetime import datetime
import json
import logging
import os
import requests
import threading
import time
from dotenv import load_dotenv

load_dotenv()

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

ORS_API_KEY = os.getenv("ORS_API_KEY")
ORS_ROUTE_URL = "https://api.openrouteservice.org/v2/directions/driving-car/geojson"
ROUTE_COOLDOWN_SECONDS = float(os.getenv("ROUTE_COOLDOWN_SECONDS", "3"))
ROUTE_TIMEOUT_SECONDS = float(os.getenv("ROUTE_TIMEOUT_SECONDS", "12"))
ORS_MAX_ALTERNATIVE_ROUTES = 3
ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = ROOT / "data" / "processed"
logger = logging.getLogger("aquaruta.routes")
route_lock = threading.Lock()
last_route_request_at = 0.0


class RouteRequest(BaseModel):
    coordinates: List[List[float]]  # [[lon, lat], [lon, lat], ...]
    alternative_routes: Dict[str, Any] | None = None


class RouteBatchRequest(BaseModel):
    routes: List[RouteRequest]


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
    return body


def _request_openrouteservice(body):
    headers = {
        "Authorization": ORS_API_KEY,
        "Content-Type": "application/json",
    }

    try:
        response = requests.post(
            ORS_ROUTE_URL,
            json=body,
            headers=headers,
            timeout=ROUTE_TIMEOUT_SECONDS,
        )
    except requests.exceptions.Timeout as exc:
        logger.warning("Timeout consultando OpenRouteService: %s", exc)
        raise HTTPException(
            status_code=504,
            detail="OpenRouteService tardÃ³ demasiado en responder. Intenta nuevamente en unos segundos.",
        ) from exc
    except requests.exceptions.RequestException as exc:
        logger.warning("Error de red consultando OpenRouteService: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="No se pudo conectar con OpenRouteService. Intenta nuevamente mÃ¡s tarde.",
        ) from exc

    if response.status_code == 429:
        retry_after = response.headers.get("Retry-After")
        retry_message = f" Intenta nuevamente en {retry_after} s." if retry_after else ""
        logger.warning("OpenRouteService devolviÃ³ 429. Retry-After=%s", retry_after)
        raise HTTPException(
            status_code=429,
            detail=(
                "Se alcanzÃ³ el lÃ­mite de solicitudes de OpenRouteService. "
                f"Espera antes de volver a intentar.{retry_message}"
            ),
            headers={"Retry-After": retry_after} if retry_after else None,
        )

    try:
        response.raise_for_status()
    except requests.exceptions.HTTPError as exc:
        logger.warning(
            "OpenRouteService devolviÃ³ error HTTP %s: %s",
            response.status_code,
            response.text[:300],
        )
        raise HTTPException(
            status_code=502,
            detail="OpenRouteService no pudo calcular la ruta solicitada. Revisa los puntos o intenta nuevamente.",
        ) from exc

    try:
        return response.json()
    except ValueError as exc:
        logger.warning("Respuesta invÃ¡lida de OpenRouteService: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="OpenRouteService devolviÃ³ una respuesta invÃ¡lida.",
        ) from exc


@app.post("/routes-batch")
def get_routes_batch(payload: RouteBatchRequest):
    global last_route_request_at

    if not ORS_API_KEY:
        logger.error("ORS_API_KEY no configurada")
        raise HTTPException(
            status_code=503,
            detail="No se ha configurado la clave de OpenRouteService.",
        )

    if not payload.routes:
        raise HTTPException(status_code=400, detail="Se requiere al menos una ruta.")
    if len(payload.routes) > 2:
        raise HTTPException(status_code=400, detail="Solo se permiten hasta 2 consultas de ruta por cálculo.")

    now = time.monotonic()
    with route_lock:
        elapsed = now - last_route_request_at
        if elapsed < ROUTE_COOLDOWN_SECONDS:
            wait_seconds = max(1, int(round(ROUTE_COOLDOWN_SECONDS - elapsed)))
            logger.info("Solicitud /routes-batch bloqueada por cooldown: esperar %s s", wait_seconds)
            raise HTTPException(
                status_code=429,
                detail=f"Espera unos segundos antes de calcular otra ruta. Intenta nuevamente en {wait_seconds} s.",
                headers={"Retry-After": str(wait_seconds)},
            )
        last_route_request_at = now

    return {
        "routes": [
            _request_openrouteservice(_build_route_body(route))
            for route in payload.routes[:2]
        ]
    }


@app.get("/")
def root():
    return {"message": "Backend AquaRuta activo"}


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


# Legacy implementation kept unreachable for reference; /route uses get_route_safe below.
def get_route(payload: RouteRequest):
    return get_route_safe(payload)
    url = "https://api.openrouteservice.org/v2/directions/driving-car/geojson"

    headers = {
        "Authorization": ORS_API_KEY,
        "Content-Type": "application/json",
    }

    body = {
        "coordinates": payload.coordinates
    }

    response = requests.post(url, json=body, headers=headers)

    if response.status_code == 429:
        raise HTTPException(
            status_code=429,
            detail="Se alcanzÃ³ el lÃ­mite de solicitudes de OpenRouteService. Espera unos minutos e intenta nuevamente."
        )

    response.raise_for_status()
    return response.json()


@app.post("/route")
def get_route_safe(payload: RouteRequest):
    global last_route_request_at

    if not ORS_API_KEY:
        logger.error("ORS_API_KEY no configurada")
        raise HTTPException(
            status_code=503,
            detail="No se ha configurado la clave de OpenRouteService.",
        )

    if len(payload.coordinates) < 2:
        raise HTTPException(
            status_code=400,
            detail="Se requieren al menos dos coordenadas para calcular una ruta.",
        )

    now = time.monotonic()
    with route_lock:
        elapsed = now - last_route_request_at
        if elapsed < ROUTE_COOLDOWN_SECONDS:
            wait_seconds = max(1, int(round(ROUTE_COOLDOWN_SECONDS - elapsed)))
            logger.info("Solicitud /route bloqueada por cooldown: esperar %s s", wait_seconds)
            raise HTTPException(
                status_code=429,
                detail=f"Espera unos segundos antes de calcular otra ruta. Intenta nuevamente en {wait_seconds} s.",
                headers={"Retry-After": str(wait_seconds)},
            )
        last_route_request_at = now

    return _request_openrouteservice(_build_route_body(payload))

    headers = {
        "Authorization": ORS_API_KEY,
        "Content-Type": "application/json",
    }
    body = {"coordinates": payload.coordinates}
    alternative_routes = _sanitize_alternative_routes(payload.alternative_routes)
    if alternative_routes:
        body["alternative_routes"] = alternative_routes

    try:
        response = requests.post(
            ORS_ROUTE_URL,
            json=body,
            headers=headers,
            timeout=ROUTE_TIMEOUT_SECONDS,
        )
    except requests.exceptions.Timeout as exc:
        logger.warning("Timeout consultando OpenRouteService: %s", exc)
        raise HTTPException(
            status_code=504,
            detail="OpenRouteService tardÃ³ demasiado en responder. Intenta nuevamente en unos segundos.",
        ) from exc
    except requests.exceptions.RequestException as exc:
        logger.warning("Error de red consultando OpenRouteService: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="No se pudo conectar con OpenRouteService. Intenta nuevamente mÃ¡s tarde.",
        ) from exc

    if response.status_code == 429:
        retry_after = response.headers.get("Retry-After")
        retry_message = f" Intenta nuevamente en {retry_after} s." if retry_after else ""
        logger.warning("OpenRouteService devolviÃ³ 429. Retry-After=%s", retry_after)
        raise HTTPException(
            status_code=429,
            detail=(
                "Se alcanzÃ³ el lÃ­mite de solicitudes de OpenRouteService. "
                f"Espera antes de volver a intentar.{retry_message}"
            ),
            headers={"Retry-After": retry_after} if retry_after else None,
        )

    try:
        response.raise_for_status()
    except requests.exceptions.HTTPError as exc:
        logger.warning(
            "OpenRouteService devolviÃ³ error HTTP %s: %s",
            response.status_code,
            response.text[:300],
        )
        raise HTTPException(
            status_code=502,
            detail="OpenRouteService no pudo calcular la ruta solicitada. Revisa los puntos o intenta nuevamente.",
        ) from exc

    try:
        return response.json()
    except ValueError as exc:
        logger.warning("Respuesta invÃ¡lida de OpenRouteService: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="OpenRouteService devolviÃ³ una respuesta invÃ¡lida.",
        ) from exc
