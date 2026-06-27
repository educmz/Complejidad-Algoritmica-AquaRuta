from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from algorithms.ufds import agrupar_zonas_operativas
from utils.text_utils import normalize_text


logger = logging.getLogger("aquaruta.grouping")

DEFAULT_INTERACTIVE_GROUPING_CONFIG = {
    "criterio": "combinado",
    "umbral_distancia_geografica_km": 18.0,
    "umbral_distancia_vial_km": 32.0,
    "umbral_tiempo_min": 70.0,
    "umbral_costo": 240.0,
    "velocidad_promedio_kmh": 28.0,
    "factor_vial": 1.35,
    "max_vecinos_candidatos": 12,
}

ALLOWED_CRITERIA = {"geografico", "vial", "combinado"}


class GroupingConfigError(ValueError):
    pass


def _norm(value: Any) -> str:
    return normalize_text(value).upper()


def _positive_number(config: dict[str, Any], key: str, minimum: float, maximum: float) -> float:
    value = float(config[key])
    if value < minimum or value > maximum:
        raise GroupingConfigError(f"{key} debe estar entre {minimum} y {maximum}.")
    return value


def normalize_grouping_config(config: dict[str, Any] | None = None) -> dict[str, Any]:
    merged = dict(DEFAULT_INTERACTIVE_GROUPING_CONFIG)
    for key, value in (config or {}).items():
        if key not in merged:
            raise GroupingConfigError(f"Parametro de configuracion no permitido: {key}.")
        if value is not None:
            merged[key] = value

    criterio = str(merged["criterio"] or "").strip().lower()
    if criterio not in ALLOWED_CRITERIA:
        raise GroupingConfigError("Criterio de agrupacion no permitido.")

    normalized = {
        "criterio": criterio,
        "umbral_distancia_geografica_km": _positive_number(merged, "umbral_distancia_geografica_km", 0.1, 500.0),
        "umbral_distancia_vial_km": _positive_number(merged, "umbral_distancia_vial_km", 0.1, 750.0),
        "umbral_tiempo_min": _positive_number(merged, "umbral_tiempo_min", 1.0, 1440.0),
        "umbral_costo": _positive_number(merged, "umbral_costo", 1.0, 100000.0),
        "velocidad_promedio_kmh": _positive_number(merged, "velocidad_promedio_kmh", 1.0, 120.0),
        "factor_vial": _positive_number(merged, "factor_vial", 1.0, 5.0),
        "max_vecinos_candidatos": int(merged["max_vecinos_candidatos"]),
    }
    if normalized["max_vecinos_candidatos"] < 1 or normalized["max_vecinos_candidatos"] > 100:
        raise GroupingConfigError("max_vecinos_candidatos debe estar entre 1 y 100.")
    return normalized


class GroupingService:
    def __init__(self, root: Path, districts: list[dict[str, Any]] | None = None):
        self.root = root
        self._static_districts = districts
        self._cache_mtime: float | None = None
        self._cache_districts: list[dict[str, Any]] | None = None

    @property
    def districts_path(self) -> Path:
        return self.root / "data" / "processed" / "districts_summary.json"

    def _load_districts(self) -> list[dict[str, Any]]:
        if self._static_districts is not None:
            return list(self._static_districts)

        path = self.districts_path
        if not path.exists():
            return []
        mtime = path.stat().st_mtime
        if self._cache_districts is not None and self._cache_mtime == mtime:
            return list(self._cache_districts)
        districts = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(districts, list):
            raise ValueError("districts_summary.json debe contener una lista.")
        self._cache_districts = districts
        self._cache_mtime = mtime
        return list(districts)

    def _apply_filters(self, districts: list[dict[str, Any]], filters: dict[str, Any] | None) -> list[dict[str, Any]]:
        filters = filters or {}
        departamento = _norm(filters.get("departamento"))
        provincia = _norm(filters.get("provincia"))
        distrito = _norm(filters.get("distrito"))
        eps = _norm(filters.get("eps"))
        criticidad = str(filters.get("criticidad") or "").strip().lower()

        result = []
        for district in districts:
            if departamento and _norm(district.get("departamento")) != departamento:
                continue
            if provincia and _norm(district.get("provincia")) != provincia:
                continue
            if distrito and _norm(district.get("distrito", district.get("nombre"))) != distrito:
                continue
            if eps and eps not in _norm(district.get("eps_principal")):
                continue
            if criticidad and criticidad != "todas" and str(district.get("criticidad", "")).lower() != criticidad:
                continue
            result.append(district)
        return result

    def run(self, filters: dict[str, Any] | None = None, config: dict[str, Any] | None = None) -> dict[str, Any]:
        started = time.perf_counter()
        applied_config = normalize_grouping_config(config)
        all_districts = self._load_districts()
        filtered_districts = self._apply_filters(all_districts, filters)

        groups = agrupar_zonas_operativas(
            filtered_districts,
            criterio=applied_config["criterio"],
            max_geographic_distance_km=applied_config["umbral_distancia_geografica_km"],
            max_road_distance_km=applied_config["umbral_distancia_vial_km"],
            max_time_min=applied_config["umbral_tiempo_min"],
            max_cost=applied_config["umbral_costo"],
            average_speed_kmh=applied_config["velocidad_promedio_kmh"],
            road_factor=applied_config["factor_vial"],
            max_candidate_neighbors=applied_config["max_vecinos_candidatos"],
        )

        ufds_summary = groups[0].get("resumen_ufds", {}) if groups else {}
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        summary = {
            "districtCount": len(filtered_districts),
            "sourceDistrictCount": len(all_districts),
            "groupCount": len(groups),
            "criticalDistrictCount": sum(1 for item in filtered_districts if item.get("criticidad") == "critica"),
            "estimatedAffectedPeople": sum(int(item.get("personas_afectadas_estimadas", 0) or 0) for item in filtered_districts),
            "candidatePairsEvaluated": int(ufds_summary.get("pares_candidatos_evaluados", 0) or 0),
            "validUnions": int(ufds_summary.get("uniones_validas", 0) or 0),
        }

        logger.info(
            "UFDS grouping run: received=%s filtered=%s candidate_pairs=%s unions=%s groups=%s elapsed_ms=%s",
            len(all_districts),
            len(filtered_districts),
            summary["candidatePairsEvaluated"],
            summary["validUnions"],
            len(groups),
            elapsed_ms,
        )

        return {
            "groups": groups,
            "summary": summary,
            "appliedConfig": applied_config,
            "metadata": {
                "algorithm": "ufds",
                "implementation": "python",
                "generatedAt": datetime.now().replace(microsecond=0).isoformat(),
                "executionMs": elapsed_ms,
            },
        }
