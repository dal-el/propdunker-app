
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path


def normalize_person_name(s: str) -> str:
    """Normalize player/person names for matching.

    Rules:
    - Trim
    - Uppercase
    - Remove accents/diacritics
    - Replace punctuation with spaces
    - Collapse spaces
    """
    s = (s or "").strip()
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.upper()
    # Replace separators/punct with spaces
    s = re.sub(r"[\.,'\"`\-_/\\()\[\]{}]+", " ", s)
    # Keep only letters, numbers, and spaces
    s = re.sub(r"[^A-Z0-9\s]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def name_tokens(s: str) -> list[str]:
    """Tokenize a normalized name into meaningful parts."""
    s = normalize_person_name(s)
    if not s:
        return []
    # Common suffixes we want to ignore for matching.
    drop = {"JR", "SR", "II", "III", "IV", "V"}
    toks = [t for t in s.split(" ") if t and t not in drop]
    return toks

def slug(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9\s\-]", " ", s)
    s = re.sub(r"\s+", "_", s).strip("_")
    return s

def iso_from_str(dt_str: str) -> str | None:
    # Novibet provides ISO-ish strings already; pass-through if looks like ISO, else None.
    if not dt_str:
        return None
    return dt_str

def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)

def clean_category(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    # remove emojis/symbols, keep word chars, spaces, & + - / . ( )
    s = re.sub(r"[^\w\s\+\-\&\/\.\(\)]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s
