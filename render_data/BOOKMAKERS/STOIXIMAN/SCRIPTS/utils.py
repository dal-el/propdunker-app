
import re
from datetime import datetime, timezone
from pathlib import Path
import json

def slug(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9\s\-]", " ", s)
    s = re.sub(r"\s+", "_", s).strip("_")
    return s

def ms_to_iso(ms: int) -> str:
    # ms epoch -> ISO date-time in UTC (kept as Z)
    dt = datetime.fromtimestamp(ms/1000, tz=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")

def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)
