from pathlib import Path
import pandas as pd

from utils.text_utils import normalize_text


class DistrictCentersLoader:
    def __init__(self, csv_path: str):
        self.csv_path = Path(csv_path)

    def load(self) -> pd.DataFrame:
        if not self.csv_path.exists():
            raise FileNotFoundError(f"No se encontró el archivo: {self.csv_path}")

        df = pd.read_csv(self.csv_path, encoding="utf-8")

        # Normalizar nombres de columnas
        df.columns = [str(col).strip().lower() for col in df.columns]

        expected_columns = [
            "departamento",
            "provincia",
            "distrito",
            "latitude",
            "longitude",
        ]
        missing = [col for col in expected_columns if col not in df.columns]
        if missing:
            raise ValueError(f"Faltan columnas esperadas en ubigeo_distrito.csv: {missing}")

        # Limpiar texto
        for col in ["departamento", "provincia", "distrito"]:
            df[col] = df[col].fillna("").astype(str).str.strip()

        # Eliminar filas inválidas
        invalid_mask = (
            (df["departamento"] == "") |
            (df["provincia"] == "") |
            (df["distrito"] == "") |
            (df["departamento"].str.lower() == "nan") |
            (df["provincia"].str.lower() == "nan") |
            (df["distrito"].str.lower() == "nan")
        )
        df = df[~invalid_mask].copy()

        # Limpiar numéricos
        df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
        df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
        df = df.dropna(subset=["latitude", "longitude"]).copy()

        # Columnas normalizadas para merge
        df["departamento_norm"] = df["departamento"].apply(normalize_text)
        df["provincia_norm"] = df["provincia"].apply(normalize_text)
        df["distrito_norm"] = df["distrito"].apply(normalize_text)

        return df[
            [
                "departamento",
                "provincia",
                "distrito",
                "latitude",
                "longitude",
                "departamento_norm",
                "provincia_norm",
                "distrito_norm",
            ]
        ].copy()