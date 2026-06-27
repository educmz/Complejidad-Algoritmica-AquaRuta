import unicodedata


def normalize_text(value) -> str:
    if value is None:
        return ""

    value = str(value).strip().lower()
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("utf-8")
    return value


def slug_text(value) -> str:
    return normalize_text(value).replace(" ", "-").replace("/", "-")