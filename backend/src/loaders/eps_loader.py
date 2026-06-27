from pathlib import Path
import pandas as pd

from utils.text_utils import normalize_text


class EpsLoader:
    def __init__(self, csv_path: str):
        self.csv_path = Path(csv_path)

    def load(self) -> pd.DataFrame:
        if not self.csv_path.exists():
            raise FileNotFoundError(f"No se encontro el archivo: {self.csv_path}")

        df = None
        for encoding in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                df = pd.read_csv(self.csv_path, encoding=encoding)
                break
            except UnicodeDecodeError:
                continue
        if df is None:
            raise ValueError("No se pudo leer eps_dataset.csv")

        df.columns = [str(col).strip().upper() for col in df.columns]
        expected = ["DEPARTAMENTO", "PROVINCIA", "DISTRITO", "PRESTADOR"]
        missing = [col for col in expected if col not in df.columns]
        if missing:
            raise ValueError(f"Faltan columnas esperadas en eps_dataset.csv: {missing}")

        for col in expected:
            df[col] = df[col].fillna("").astype(str).str.strip()
            df[f"{col}_NORM"] = df[col].apply(normalize_text)

        return df
