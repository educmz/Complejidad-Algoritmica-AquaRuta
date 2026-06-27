from pathlib import Path
from datetime import datetime
import json
import pandas as pd

from utils.text_utils import normalize_text, slug_text


def classify_criticality(interruptions: int) -> str:
    if interruptions >= 1000:
        return "critica"
    if interruptions >= 700:
        return "alta"
    if interruptions >= 300:
        return "media"
    return "baja"


def most_frequent_value(series: pd.Series) -> str:
    if series.empty:
        return ""
    mode = series.mode()
    if mode.empty:
        return ""
    return str(mode.iloc[0])


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
        "scope_label": "Acumulado histórico del dataset",
    }


def build_districts_summary(df: pd.DataFrame) -> list[dict]:
    grouped = (
        df.groupby(["DEPARTAMENTO", "PROVINCIA", "DISTRITO"], dropna=False)
        .agg(
            interrupciones=("IDINTERRUPCION", "count"),
            conexiones_afectadas=("NUMCONEXDOM", "sum"),
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
        interruptions = int(row["interrupciones"])
        department = str(row["DEPARTAMENTO"]).strip()
        province = str(row["PROVINCIA"]).strip()
        district = str(row["DISTRITO"]).strip()

        record = {
            "id": slug_text(f"{department}-{province}-{district}"),
            "nombre": district.title(),
            "departamento": department.title(),
            "provincia": province.title(),
            "interrupciones": interruptions,
            "conexiones_afectadas": int(row["conexiones_afectadas"]),
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
        records.append(record)

    return records


def enrich_districts_with_centers(
    districts_summary: list[dict],
    centers_df: pd.DataFrame,
) -> list[dict]:
    centers_lookup = {}

    for _, row in centers_df.iterrows():
        key = (
            row["departamento_norm"],
            row["provincia_norm"],
            row["distrito_norm"],
        )
        centers_lookup[key] = [
            round(float(row["latitude"]), 6),
            round(float(row["longitude"]), 6),
        ]

    enriched = []
    matched_count = 0

    for district in districts_summary:
        key = (
            district["departamento_norm"],
            district["provincia_norm"],
            district["distrito_norm"],
        )

        center = centers_lookup.get(key)
        if center is not None:
            district["center"] = center
            matched_count += 1

        enriched.append(district)

    print(f"Distritos con center asignado: {matched_count}/{len(districts_summary)}")
    return enriched


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
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

def build_eps_origins(eps_df: pd.DataFrame, centers_df: pd.DataFrame) -> list[dict]:
    """
    Genera nodos de origen referenciales para EPS cruzando:
    - dataset de EPS
    - centros distritales
    """
    centers_lookup = {}

    for _, row in centers_df.iterrows():
        key = (
            row["departamento_norm"],
            row["provincia_norm"],
            row["distrito_norm"],
        )
        centers_lookup[key] = [
            round(float(row["latitude"]), 6),
            round(float(row["longitude"]), 6),
        ]

    eps_records = (
        eps_df[
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
        ]
        .drop_duplicates()
        .copy()
    )

    origins = []
    seen_ids = set()

    for _, row in eps_records.iterrows():
        key = (
            row["DEPARTAMENTO_NORM"],
            row["PROVINCIA_NORM"],
            row["DISTRITO_NORM"],
        )
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

    origins = sorted(origins, key=lambda item: item["prestador"])
    return origins
