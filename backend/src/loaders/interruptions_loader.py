from pathlib import Path
import pandas as pd

from utils.text_utils import normalize_text


class InterruptionsLoader:
    def __init__(self, csv_path: str):
        self.csv_path = Path(csv_path)

    def load(self) -> pd.DataFrame:
        if not self.csv_path.exists():
            raise FileNotFoundError(f"No se encontro el archivo: {self.csv_path}")

        df = pd.read_csv(self.csv_path, encoding="utf-8-sig")
        df.columns = [str(col).strip().upper() for col in df.columns]

        expected_columns = [
            "IDINTERRUPCION",
            "EPS",
            "SEDE",
            "TIPOINTERRUPCION",
            "TIPOSERVICIO",
            "MOTIVOINTERRUPCION",
            "FECHAINICIO",
            "HORAINICIO",
            "FECHAFIN",
            "HORAFIN",
            "DEPARTAMENTO",
            "PROVINCIA",
            "DISTRITO",
            "NUMCONEXDOM",
            "UNIDADESUSO",
            "NUMCAMIONESPUNTOS",
        ]
        missing = [col for col in expected_columns if col not in df.columns]
        if missing:
            raise ValueError(f"Faltan columnas esperadas en el CSV: {missing}")

        text_columns = [
            "EPS",
            "SEDE",
            "TIPOINTERRUPCION",
            "TIPOSERVICIO",
            "MOTIVOINTERRUPCION",
            "DEPARTAMENTO",
            "PROVINCIA",
            "DISTRITO",
        ]
        for col in text_columns:
            df[col] = df[col].fillna("").astype(str).str.strip()

        invalid_mask = (
            (df["DEPARTAMENTO"] == "")
            | (df["PROVINCIA"] == "")
            | (df["DISTRITO"] == "")
            | (df["DEPARTAMENTO"].str.lower() == "nan")
            | (df["PROVINCIA"].str.lower() == "nan")
            | (df["DISTRITO"].str.lower() == "nan")
        )
        df = df[~invalid_mask].copy()

        df["DEPARTAMENTO_NORM"] = df["DEPARTAMENTO"].apply(normalize_text)
        df["PROVINCIA_NORM"] = df["PROVINCIA"].apply(normalize_text)
        df["DISTRITO_NORM"] = df["DISTRITO"].apply(normalize_text)
        df["EPS_NORM"] = df["EPS"].apply(normalize_text)

        for col in ["NUMCONEXDOM", "UNIDADESUSO", "NUMCAMIONESPUNTOS"]:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
            df.loc[df[col] < 0, col] = 0

        inicio_fecha = (
            df["FECHAINICIO"].fillna("").astype(str).str.replace(r"\.0$", "", regex=True).str.zfill(8)
        )
        fin_fecha = (
            df["FECHAFIN"].fillna("").astype(str).str.replace(r"\.0$", "", regex=True).str.zfill(8)
        )
        df["INICIO_DT"] = pd.to_datetime(
            inicio_fecha + " " + df["HORAINICIO"].fillna("").astype(str).str.strip(),
            format="%Y%m%d %H:%M",
            errors="coerce",
        )
        df["FIN_DT"] = pd.to_datetime(
            fin_fecha + " " + df["HORAFIN"].fillna("").astype(str).str.strip(),
            format="%Y%m%d %H:%M",
            errors="coerce",
        )
        duration_hours = (df["FIN_DT"] - df["INICIO_DT"]).dt.total_seconds() / 3600
        df["DURACION_HORAS"] = duration_hours.where(duration_hours > 0)
        return df
