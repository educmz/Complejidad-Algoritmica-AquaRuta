from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
import csv
import re
from typing import Any

import pandas as pd

from utils.text_utils import normalizar_nombre_territorial


PROMEDIO_NACIONAL_HOGAR = 3.45


def _detect_separator(path: Path, encoding: str) -> str:
    sample = path.read_text(encoding=encoding, errors="ignore")[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;")
        return dialect.delimiter
    except csv.Error:
        return ";" if sample.count(";") > sample.count(",") else ","


def _read_csv(path: Path) -> pd.DataFrame:
    last_error: Exception | None = None
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            separator = _detect_separator(path, encoding)
            return pd.read_csv(path, encoding=encoding, sep=separator, dtype=str)
        except UnicodeDecodeError as exc:
            last_error = exc
            continue
    if last_error:
        raise last_error
    raise ValueError(f"No se pudo leer {path}")


def _clean_number(value) -> float:
    if value is None or pd.isna(value):
        return 0.0
    text = str(value).strip()
    if not text:
        return 0.0
    text = text.replace("\u00a0", " ")
    text = re.sub(r"[^0-9,.\-]+", "", text)
    if "," in text and "." in text:
        text = text.replace(",", "")
    elif "," in text:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return 0.0


def _clean_ubigeo(value) -> str:
    text = "" if value is None or pd.isna(value) else str(value).strip()
    text = re.sub(r"\.0$", "", text)
    text = re.sub(r"\D", "", text)
    return text.zfill(6) if text else ""


@dataclass
class DemographicData:
    by_ubigeo: dict[str, dict[str, Any]]
    by_full_name: dict[tuple[str, str, str], dict[str, Any]]
    by_department_district_unique: dict[tuple[str, str], dict[str, Any]]
    by_national_district_unique: dict[str, dict[str, Any]]
    load_report: dict[str, Any]


class DemographicsLoader:
    def __init__(
        self,
        hogares_csv_path: str,
        poblacion_csv_path: str,
        centers_df: pd.DataFrame,
    ):
        self.hogares_csv_path = Path(hogares_csv_path)
        self.poblacion_csv_path = Path(poblacion_csv_path)
        self.centers_df = centers_df

    def load(self) -> DemographicData:
        hogares_df = self._load_hogares()
        poblacion_df = self._load_poblacion()

        centers_by_name = {
            (
                str(row["departamento_norm"]).upper(),
                str(row["provincia_norm"]).upper(),
                str(row["distrito_norm"]).upper(),
            ): row["ubigeo"]
            for _, row in self.centers_df.iterrows()
            if row.get("ubigeo")
        }
        centers_by_ubigeo = {
            row["ubigeo"]: row
            for _, row in self.centers_df.iterrows()
            if row.get("ubigeo")
        }

        hogares_by_ubigeo = {}
        invalid_records = []
        duplicate_ubigeos = [
            ubigeo
            for ubigeo, count in Counter(hogares_df["ubigeo"]).items()
            if ubigeo and count > 1
        ]

        for _, row in hogares_df.iterrows():
            ubigeo = row["ubigeo"]
            hogares = _clean_number(row.get("total_hogares"))
            if not ubigeo or len(ubigeo) != 6 or hogares <= 0:
                invalid_records.append(
                    {
                        "ubigeo": ubigeo,
                        "departamento": row.get("departamento", ""),
                        "provincia": row.get("provincia", ""),
                        "distrito": row.get("distrito", ""),
                        "motivo": "ubigeo_invalido_o_hogares_no_validos",
                    }
                )
                continue
            if ubigeo in hogares_by_ubigeo:
                continue
            hogares_by_ubigeo[ubigeo] = {
                "ubigeo": ubigeo,
                "total_hogares": hogares,
                "departamento": str(row.get("departamento", "")).strip().title(),
                "provincia": str(row.get("provincia", "")).strip().title(),
                "distrito": str(row.get("distrito", "")).strip().title(),
                "departamento_norm": row["departamento_norm"],
                "provincia_norm": row["provincia_norm"],
                "distrito_norm": row["distrito_norm"],
            }

        poblacion_by_ubigeo: dict[str, dict[str, Any]] = {}
        for _, row in poblacion_df.iterrows():
            key = (
                row["departamento_norm"],
                row["provincia_norm"],
                row["distrito_norm"],
            )
            ubigeo = centers_by_name.get(key, "")
            population = _clean_number(row.get("poblacion_censada"))
            if not ubigeo or population <= 0:
                continue
            current = poblacion_by_ubigeo.get(ubigeo)
            if current is None or population > current["poblacion_censada"]:
                poblacion_by_ubigeo[ubigeo] = {
                    "ubigeo": ubigeo,
                    "poblacion_censada": population,
                    "departamento": str(row.get("departamento", "")).strip().title(),
                    "provincia": str(row.get("provincia", "")).strip().title(),
                    "distrito": str(row.get("distrito", "")).strip().title(),
                    "departamento_norm": row["departamento_norm"],
                    "provincia_norm": row["provincia_norm"],
                    "distrito_norm": row["distrito_norm"],
                }

        records = {}
        for ubigeo, center in centers_by_ubigeo.items():
            hogares = hogares_by_ubigeo.get(ubigeo)
            poblacion = poblacion_by_ubigeo.get(ubigeo)
            if not hogares and not poblacion:
                continue
            records[ubigeo] = {
                "ubigeo": ubigeo,
                "departamento": str(center.get("departamento", "")).strip().title(),
                "provincia": str(center.get("provincia", "")).strip().title(),
                "distrito": str(center.get("distrito", "")).strip().title(),
                "departamento_norm": str(center["departamento_norm"]).upper(),
                "provincia_norm": str(center["provincia_norm"]).upper(),
                "distrito_norm": str(center["distrito_norm"]).upper(),
                "total_hogares": hogares["total_hogares"] if hogares else 0.0,
                "poblacion_censada": poblacion["poblacion_censada"] if poblacion else 0.0,
            }

        by_full_name = {
            (
                record["departamento_norm"],
                record["provincia_norm"],
                record["distrito_norm"],
            ): record
            for record in records.values()
        }

        department_district_groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        national_district_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for record in records.values():
            department_district_groups[
                (record["departamento_norm"], record["distrito_norm"])
            ].append(record)
            national_district_groups[record["distrito_norm"]].append(record)

        by_department_district_unique = {
            key: items[0] for key, items in department_district_groups.items() if len(items) == 1
        }
        by_national_district_unique = {
            key: items[0] for key, items in national_district_groups.items() if len(items) == 1
        }

        load_report = {
            "total_hogares_registros": int(len(hogares_df)),
            "total_poblacion_registros": int(len(poblacion_df)),
            "coincidencias_exactas": 0,
            "coincidencias_por_ubigeo": 0,
            "coincidencias_departamento_distrito": 0,
            "coincidencias_distrito_unico": 0,
            "coincidencias_alias": 0,
            "sin_coincidencia": 0,
            "ubigeos_duplicados": duplicate_ubigeos,
            "registros_invalidos": invalid_records[:500],
        }

        return DemographicData(
            by_ubigeo=records,
            by_full_name=by_full_name,
            by_department_district_unique=by_department_district_unique,
            by_national_district_unique=by_national_district_unique,
            load_report=load_report,
        )

    def _load_hogares(self) -> pd.DataFrame:
        if not self.hogares_csv_path.exists():
            raise FileNotFoundError(f"No se encontro el archivo: {self.hogares_csv_path}")
        df = _read_csv(self.hogares_csv_path)
        df.columns = [str(col).strip().lower() for col in df.columns]
        expected = ["ubigeo", "departamento", "provincia", "distrito", "total_hogares"]
        missing = [col for col in expected if col not in df.columns]
        if missing:
            raise ValueError(f"Faltan columnas en hogares: {missing}")
        return self._normalize_names(df, has_ubigeo=True)

    def _load_poblacion(self) -> pd.DataFrame:
        if not self.poblacion_csv_path.exists():
            raise FileNotFoundError(f"No se encontro el archivo: {self.poblacion_csv_path}")
        df = _read_csv(self.poblacion_csv_path)
        df.columns = [str(col).strip().lower() for col in df.columns]
        expected = ["departamento", "provincia", "distrito", "poblacion_censada"]
        missing = [col for col in expected if col not in df.columns]
        if missing:
            raise ValueError(f"Faltan columnas en poblacion: {missing}")
        return self._normalize_names(df, has_ubigeo="ubigeo" in df.columns)

    def _normalize_names(self, df: pd.DataFrame, has_ubigeo: bool) -> pd.DataFrame:
        for col in ["departamento", "provincia", "distrito"]:
            df[col] = df[col].fillna("").astype(str).str.strip()
            df[f"{col}_norm"] = df[col].apply(normalizar_nombre_territorial)
        if has_ubigeo:
            df["ubigeo"] = df["ubigeo"].apply(_clean_ubigeo)
        else:
            df["ubigeo"] = ""
        return df
