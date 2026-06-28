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


def normalize_ubigeo(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.lower() in {"", "nan", "none"}:
        return ""
    if text.endswith(".0"):
        text = text[:-2]
    text = re.sub(r"\D", "", text)
    return text.zfill(6) if text else ""


def slug_text(value) -> str:
    normalized = normalizar_nombre_territorial(value).lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    return normalized.strip("-")
