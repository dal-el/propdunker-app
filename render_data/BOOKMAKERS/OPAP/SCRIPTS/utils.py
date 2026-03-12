
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

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
