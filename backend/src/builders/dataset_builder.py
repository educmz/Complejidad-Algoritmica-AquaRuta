from __future__ import annotations

from pathlib import Path
from datetime import datetime
import json
from statistics import mean
from typing import Any

import pandas as pd

from loaders.demographics_loader import PROMEDIO_NACIONAL_HOGAR
from utils.text_utils import normalize_text, slug_text


def clamp(value, low=0.0, high=1.0) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return low
    return max(low, min(high, numeric))


def normalizar_maximo(valor, maximo) -> float:
    try:
        numeric = float(valor)
        max_value = float(maximo)
    except (TypeError, ValueError):
        return 0.0
    if numeric <= 0 or max_value <= 0:
        return 0.0
    return clamp(numeric / max_value)


def classify_criticality(interruptions: int) -> str:
    if interruptions >= 1000:
        return "critica"
    if interruptions >= 700:
        return "alta"
    if interruptions >= 300:
        return "media"
    return "baja"


def classify_priority(score: float) -> str:
    if score >= 0.75:
        return "critica"
    if score >= 0.50:
        return "alta"
    if score >= 0.25:
        return "media"
    return "baja"


def most_frequent_value(series: pd.Series) -> str:
    if series.empty:
        return ""
    mode = series.mode()
    return "" if mode.empty else str(mode.iloc[0])


def iso_datetime(value) -> str:
    if value is None or pd.isna(value):
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def rounded_float(value, digits: int = 1) -> float:
    if value is None or pd.isna(value):
        return 0.0
    return round(float(value), digits)


def build_dataset_metadata(df: pd.DataFrame) -> dict:
    starts = df["INICIO_DT"].dropna() if "INICIO_DT" in df else pd.Series(dtype="datetime64[ns]")
    ends = df["FIN_DT"].dropna() if "FIN_DT" in df else pd.Series(dtype="datetime64[ns]")
    timeline = pd.concat([starts, ends], ignore_index=True)
    execution_timestamp = datetime.now().replace(microsecond=0).isoformat()
    return {
        "record_count": int(len(df)),
        "period_start": iso_datetime(starts.min()) if not starts.empty else "",
        "period_end": iso_datetime(timeline.max()) if not timeline.empty else "",
        "last_update": iso_datetime(timeline.max()) if not timeline.empty else "",
        "ultima_actualizacion": execution_timestamp,
        "processed_at": execution_timestamp,
        "scope_label": "Acumulado historico del dataset",
    }


def _demographic_match(district: dict, demographics, report: dict) -> tuple[dict[str, Any] | None, str]:
    ubigeo = district.get("ubigeo")
    if ubigeo and ubigeo in demographics.by_ubigeo:
        report["coincidencias_por_ubigeo"] += 1
        report["coincidencias_exactas"] += 1
        return demographics.by_ubigeo[ubigeo], "ubigeo"

    full_key = (
        district["departamento_norm"].upper(),
        district["provincia_norm"].upper(),
        district["distrito_norm"].upper(),
    )
    if full_key in demographics.by_full_name:
        report["coincidencias_exactas"] += 1
        return demographics.by_full_name[full_key], "nombre_completo"

    dept_district_key = (district["departamento_norm"].upper(), district["distrito_norm"].upper())
    if dept_district_key in demographics.by_department_district_unique:
        report["coincidencias_departamento_distrito"] += 1
        return demographics.by_department_district_unique[dept_district_key], "departamento_distrito"

    national_key = district["distrito_norm"].upper()
    if national_key in demographics.by_national_district_unique:
        report["coincidencias_distrito_unico"] += 1
        return demographics.by_national_district_unique[national_key], "distrito_unico"

    report["sin_coincidencia"] += 1
    return None, "sin_coincidencia"


def _valid_household_average(population: float, households: float) -> tuple[float, bool]:
    if population <= 0 or households <= 0:
        return PROMEDIO_NACIONAL_HOGAR, True
    average = population / households
    if average < 1.0 or average > 10.0:
        return PROMEDIO_NACIONAL_HOGAR, True
    return average, False


def _apply_demographics(records: list[dict], demographics) -> tuple[list[dict], dict, dict]:
    match_report = dict(demographics.load_report)
    values = []
    for record in records:
        demographic, match_method = _demographic_match(record, demographics, match_report)
        if demographic:
            record["ubigeo"] = demographic.get("ubigeo", record.get("ubigeo", ""))
            population = float(demographic.get("poblacion_censada", 0) or 0)
            households = float(demographic.get("total_hogares", 0) or 0)
        else:
            population = 0.0
            households = 0.0

        average, estimated = _valid_household_average(population, households)
        event_connections = float(record.get("conexiones_afectadas_evento_max", 0) or 0)
        estimated_people = min(event_connections * average, population) if population > 0 else event_connections * average
        estimated_people = max(0, round(estimated_people))

        record.update(
            {
                "poblacion_censada": int(round(population)) if population > 0 else 0,
                "total_hogares": int(round(households)) if households > 0 else 0,
                "promedio_integrantes_hogar": round(average, 2),
                "fuente_promedio_hogar": "fallback_nacional_2017" if estimated else "inei_distrital_2017",
                "promedio_hogar_es_estimado": bool(estimated),
                "personas_afectadas_estimadas": int(estimated_people),
                "demographic_match_method": match_method,
            }
        )
        values.append(record)

    max_people = max((item["personas_afectadas_estimadas"] for item in values), default=0)
    max_interruptions = max((item["interrupciones"] for item in values), default=0)
    max_connections = max((item["conexiones_afectadas_evento_max"] for item in values), default=0)
    max_duration = max((item["duracion_maxima_horas"] for item in values), default=0)

    for record in values:
        record["peso_demanda_familiar"] = round(
            normalizar_maximo(record["personas_afectadas_estimadas"], max_people), 4
        )
        record["peso_interrupciones"] = round(
            normalizar_maximo(record["interrupciones"], max_interruptions), 4
        )
        record["peso_conexiones_afectadas"] = round(
            normalizar_maximo(record["conexiones_afectadas_evento_max"], max_connections), 4
        )
        record["peso_duracion"] = round(
            normalizar_maximo(record["duracion_maxima_horas"], max_duration), 4
        )
        priority_score = (
            0.45 * record["peso_interrupciones"]
            + 0.25 * record["peso_conexiones_afectadas"]
            + 0.20 * record["peso_demanda_familiar"]
            + 0.10 * record["peso_duracion"]
        )
        record["prioridad_score"] = round(clamp(priority_score), 4)
        record["prioridad"] = classify_priority(record["prioridad_score"])

    averages = [item["promedio_integrantes_hogar"] for item in values]
    people = [item["personas_afectadas_estimadas"] for item in values]
    weights = [item["peso_demanda_familiar"] for item in values]
    validation_report = {
        "distritos_procesados": len(values),
        "distritos_con_datos_inei": sum(
            1 for item in values if item["fuente_promedio_hogar"] == "inei_distrital_2017"
        ),
        "distritos_con_fallback": sum(1 for item in values if item["promedio_hogar_es_estimado"]),
        "distritos_sin_ubigeo": sum(1 for item in values if not item.get("ubigeo")),
        "promedio_hogar_min": min(averages) if averages else 0,
        "promedio_hogar_max": max(averages) if averages else 0,
        "promedio_hogar_promedio": round(mean(averages), 2) if averages else 0,
        "personas_estimadas_min": min(people) if people else 0,
        "personas_estimadas_max": max(people) if people else 0,
        "peso_demanda_min": min(weights) if weights else 0,
        "peso_demanda_max": max(weights) if weights else 0,
    }
    return values, match_report, validation_report


def build_districts_summary(df: pd.DataFrame, demographics=None) -> tuple[list[dict], dict, dict]:
    grouped = (
        df.groupby(["DEPARTAMENTO", "PROVINCIA", "DISTRITO"], dropna=False)
        .agg(
            interrupciones=("IDINTERRUPCION", "count"),
            conexiones_afectadas=("NUMCONEXDOM", "sum"),
            conexiones_afectadas_evento_max=("NUMCONEXDOM", "max"),
            unidades_afectadas=("UNIDADESUSO", "sum"),
            camiones_puntos=("NUMCAMIONESPUNTOS", "sum"),
            eps_principal=("EPS", most_frequent_value),
            tipo_interrupcion_principal=("TIPOINTERRUPCION", most_frequent_value),
            motivo_principal=("MOTIVOINTERRUPCION", most_frequent_value),
            duracion_promedio_horas=("DURACION_HORAS", "mean"),
            duracion_maxima_horas=("DURACION_HORAS", "max"),
            primera_interrupcion=("INICIO_DT", "min"),
            ultima_actualizacion=("FIN_DT", "max"),
        )
        .reset_index()
    )
    grouped = grouped.sort_values(by="interrupciones", ascending=False).reset_index(drop=True)

    records = []
    for _, row in grouped.iterrows():
        department = str(row["DEPARTAMENTO"]).strip()
        province = str(row["PROVINCIA"]).strip()
        district = str(row["DISTRITO"]).strip()
        interruptions = int(row["interrupciones"])
        records.append(
            {
                "id": slug_text(f"{department}-{province}-{district}"),
                "nombre": district.title(),
                "departamento": department.title(),
                "provincia": province.title(),
                "ubigeo": "",
                "interrupciones": interruptions,
                "conexiones_afectadas": int(row["conexiones_afectadas"]),
                "conexiones_afectadas_evento_max": int(row["conexiones_afectadas_evento_max"]),
                "unidades_afectadas": int(row["unidades_afectadas"]),
                "camiones_puntos": int(row["camiones_puntos"]),
                "eps_principal": str(row["eps_principal"]).strip(),
                "tipo_interrupcion_principal": str(row["tipo_interrupcion_principal"]).strip(),
                "motivo_principal": str(row["motivo_principal"]).strip(),
                "duracion_promedio_horas": rounded_float(row["duracion_promedio_horas"]),
                "duracion_maxima_horas": rounded_float(row["duracion_maxima_horas"]),
                "primera_interrupcion": iso_datetime(row["primera_interrupcion"]),
                "ultima_actualizacion": iso_datetime(row["ultima_actualizacion"]),
                "criticidad": classify_criticality(interruptions),
                "center": None,
                "departamento_norm": normalize_text(department),
                "provincia_norm": normalize_text(province),
                "distrito_norm": normalize_text(district),
            }
        )

    empty_match = {
        "total_hogares_registros": 0,
        "total_poblacion_registros": 0,
        "coincidencias_exactas": 0,
        "coincidencias_por_ubigeo": 0,
        "coincidencias_departamento_distrito": 0,
        "coincidencias_distrito_unico": 0,
        "coincidencias_alias": 0,
        "sin_coincidencia": len(records),
        "ubigeos_duplicados": [],
        "registros_invalidos": [],
    }
    empty_validation = {}
    if demographics:
        records, match_report, validation_report = _apply_demographics(records, demographics)
    else:
        match_report = empty_match
        validation_report = empty_validation
    return records, match_report, validation_report


def enrich_districts_with_centers(districts_summary: list[dict], centers_df: pd.DataFrame) -> list[dict]:
    centers_lookup = {}
    for _, row in centers_df.iterrows():
        key = (row["departamento_norm"], row["provincia_norm"], row["distrito_norm"])
        centers_lookup[key] = {
            "center": [round(float(row["latitude"]), 6), round(float(row["longitude"]), 6)],
            "ubigeo": row.get("ubigeo", ""),
        }

    matched_count = 0
    for district in districts_summary:
        key = (
            district["departamento_norm"],
            district["provincia_norm"],
            district["distrito_norm"],
        )
        center = centers_lookup.get(key)
        if center:
            district["center"] = center["center"]
            district["ubigeo"] = district.get("ubigeo") or center["ubigeo"]
            matched_count += 1
    print(f"Distritos con center asignado: {matched_count}/{len(districts_summary)}")
    return districts_summary


def strip_internal_fields(districts_summary: list[dict]) -> list[dict]:
    clean_records = []
    for district in districts_summary:
        clean = dict(district)
        clean.pop("departamento_norm", None)
        clean.pop("provincia_norm", None)
        clean.pop("distrito_norm", None)
        clean_records.append(clean)
    return clean_records


def save_json(data, output_path: str) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def build_eps_origins(eps_df: pd.DataFrame, centers_df: pd.DataFrame) -> list[dict]:
    centers_lookup = {}
    for _, row in centers_df.iterrows():
        key = (row["departamento_norm"], row["provincia_norm"], row["distrito_norm"])
        centers_lookup[key] = [round(float(row["latitude"]), 6), round(float(row["longitude"]), 6)]

    eps_records = eps_df[
        [
            "PRESTADOR",
            "DEPARTAMENTO",
            "PROVINCIA",
            "DISTRITO",
            "PRESTADOR_NORM",
            "DEPARTAMENTO_NORM",
            "PROVINCIA_NORM",
            "DISTRITO_NORM",
        ]
    ].drop_duplicates()

    origins = []
    seen_ids = set()
    for _, row in eps_records.iterrows():
        key = (row["DEPARTAMENTO_NORM"], row["PROVINCIA_NORM"], row["DISTRITO_NORM"])
        center = centers_lookup.get(key)
        if center is None:
            continue
        origin_id = f"eps-{row['PRESTADOR_NORM'].replace(' ', '-')}"
        if origin_id in seen_ids:
            continue
        seen_ids.add(origin_id)
        origins.append(
            {
                "id": origin_id,
                "prestador": str(row["PRESTADOR"]).strip(),
                "departamento": str(row["DEPARTAMENTO"]).strip().title(),
                "provincia": str(row["PROVINCIA"]).strip().title(),
                "distrito": str(row["DISTRITO"]).strip().title(),
                "lat": center[0],
                "lon": center[1],
                "tipo_origen": "sede_referencial",
                "descripcion": "Origen operativo referencial asociado al prestador",
            }
        )
    return sorted(origins, key=lambda item: item["prestador"])


def aggregate_demographic_metrics(items: list[dict]) -> dict:
    if not items:
        return {
            "personas_afectadas_estimadas": 0,
            "peso_demanda_familiar": 0.0,
            "prioridad_score": 0.0,
            "promedio_integrantes_hogar": PROMEDIO_NACIONAL_HOGAR,
        }
    people = sum(int(item.get("personas_afectadas_estimadas", 0) or 0) for item in items)
    event_connections = sum(int(item.get("conexiones_afectadas_evento_max", 0) or 0) for item in items)
    if event_connections > 0:
        avg_home = sum(
            float(item.get("promedio_integrantes_hogar", PROMEDIO_NACIONAL_HOGAR) or PROMEDIO_NACIONAL_HOGAR)
            * int(item.get("conexiones_afectadas_evento_max", 0) or 0)
            for item in items
        ) / event_connections
    else:
        valid = [
            float(item.get("promedio_integrantes_hogar", PROMEDIO_NACIONAL_HOGAR) or PROMEDIO_NACIONAL_HOGAR)
            for item in items
        ]
        avg_home = mean(valid) if valid else PROMEDIO_NACIONAL_HOGAR
    return {
        "personas_afectadas_estimadas": int(people),
        "peso_demanda_familiar": round(max(float(item.get("peso_demanda_familiar", 0) or 0) for item in items), 4),
        "prioridad_score": round(mean(float(item.get("prioridad_score", 0) or 0) for item in items), 4),
        "promedio_integrantes_hogar": round(avg_home, 2),
    }
