import json
import os
import re
from pathlib import Path
from fastapi import APIRouter, HTTPException

from app.utils.canonical import canonical_match_key

router = APIRouter(tags=["upcoming-matches"])


def _next_round_root() -> Path:
    p = os.getenv("PROPDUNKER_NEXT_ROUND_DIR")
    if p:
        return Path(p)
    return Path(r"C:\DEV\PROPDUNKER\NEXT_ROUND")


def _upcoming_file() -> Path:
    return _next_round_root() / "UPCOMMING_MATCHES" / "upcoming_matches.json"


def _slugify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s


def _legacy_value(item: dict) -> str:
    # Legacy format used in the frontend before: YYYY-MM-DD_home_team_slug_away_team_slug
    date = str(item.get("date") or "").strip()
    label = str(item.get("label") or "").strip()

    if " vs " in label:
        home, away = [x.strip() for x in label.split(" vs ", 1)]
        return f"{date}_{_slugify(home)}_{_slugify(away)}"

    # Fallback to original value if label isn't split-able
    return str(item.get("value") or "")


def _canonical_value(item: dict) -> str:
    date = str(item.get("date") or "").strip()
    label = str(item.get("label") or "").strip()
    if not date or not label or " vs " not in label:
        return ""
    home, away = [x.strip() for x in label.split(" vs ", 1)]
    return canonical_match_key(date, home, away)


@router.get("/upcoming-matches")
def get_upcoming_matches():
    p = _upcoming_file()
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"Missing file: {p}")

    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read JSON: {e}")

    out = []
    for x in (data or []):
        if not isinstance(x, dict):
            continue
        label = x.get("label")
        if not label:
            continue
        canon = _canonical_value(x)
        out.append(
            {
                "label": label,
                # canonical is the new source of truth
                "value": canon or _legacy_value(x),
                # keep legacy around for debugging/back-compat
                "legacy_value": _legacy_value(x),
                "canonical_match": canon,
            }
        )

    # Always return deterministic order as in the file
    return out
