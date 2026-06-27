import re
import unicodedata


def normalizar_nombre_territorial(valor) -> str:
    text = "" if valor is None else str(valor)
    text = text.strip().upper()
    text = "".join(
        char
        for char in unicodedata.normalize("NFD", text)
        if unicodedata.category(char) != "Mn"
    )
    text = re.sub(r"[^A-Z0-9 ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_text(value) -> str:
    return normalizar_nombre_territorial(value).lower()


def slug_text(value) -> str:
    normalized = normalizar_nombre_territorial(value).lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    return normalized.strip("-")
