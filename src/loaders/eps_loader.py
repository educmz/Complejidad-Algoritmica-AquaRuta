from pathlib import Path
import pandas as pd

from utils.text_utils import normalize_text


class EpsLoader:
    def __init__(self, csv_path: str):
        self.csv_path = Path(csv_path)

    def _read_csv_with_fallback(self) -> pd.DataFrame:
        encodings = ["utf-8", "utf-8-sig", "latin-1", "cp1252"]

        last_error = None
        for encoding in encodings:
            try:
                return pd.read_csv(self.csv_path, encoding=encoding)
            except UnicodeDecodeError as exc:
                last_error = exc

        raise UnicodeDecodeError(
            "eps_loader",
            b"",
            0,
            1,
            f"No se pudo leer el archivo con codificaciones conocidas. Último error: {last_error}",
        )

    def load(self) -> pd.DataFrame:
        if not self.csv_path.exists():
            raise FileNotFoundError(f"No se encontró el archivo: {self.csv_path}")

        df = self._read_csv_with_fallback()
        df.columns = [str(col).strip().upper() for col in df.columns]

        expected_columns = [
            "DEPARTAMENTO",
            "PROVINCIA",
            "DISTRITO",
            "PRESTADOR",
        ]
        missing = [col for col in expected_columns if col not in df.columns]
        if missing:
            raise ValueError(f"Faltan columnas esperadas en el dataset EPS: {missing}")

        for col in ["DEPARTAMENTO", "PROVINCIA", "DISTRITO", "PRESTADOR"]:
            df[col] = df[col].fillna("").astype(str).str.strip()

        invalid_mask = (
            (df["DEPARTAMENTO"] == "") |
            (df["PROVINCIA"] == "") |
            (df["DISTRITO"] == "") |
            (df["PRESTADOR"] == "") |
            (df["DEPARTAMENTO"].str.lower() == "nan") |
            (df["PROVINCIA"].str.lower() == "nan") |
            (df["DISTRITO"].str.lower() == "nan") |
            (df["PRESTADOR"].str.lower() == "nan")
        )
        df = df[~invalid_mask].copy()

        df["DEPARTAMENTO_NORM"] = df["DEPARTAMENTO"].apply(normalize_text)
        df["PROVINCIA_NORM"] = df["PROVINCIA"].apply(normalize_text)
        df["DISTRITO_NORM"] = df["DISTRITO"].apply(normalize_text)
        df["PRESTADOR_NORM"] = df["PRESTADOR"].apply(normalize_text)

        return df