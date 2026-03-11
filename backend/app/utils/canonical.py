from __future__ import annotations

import json
import os
import re
import unicodedata
from functools import lru_cache


# --- normalization helpers ---

def _strip_accents(s: str) -> str:
    return "".join(
        ch
        for ch in unicodedata.normalize("NFKD", s)
        if not unicodedata.combining(ch)
    )


def _clean(s: str) -> str:
    """Aggressive normalize for matching: lower, strip accents, drop punctuation."""
    s = (s or "").strip().lower()
    s = _strip_accents(s)
    s = s.replace("&", " and ")
    s = re.sub(r"[\(\)\[\]\{\}]", " ", s)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _slug_from_clean(cleaned: str) -> str:
    cleaned = re.sub(r"\b(fc|bc|basketball|club|aok|aktor|u19|u20)\b", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = cleaned.replace(" ", "_")
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    if cleaned.startswith("fc_"):
        cleaned = cleaned[3:]
    return cleaned


# --- Manual aliases (covers cross-book spelling differences) ---
# Keys/values must be in _clean() format (lowercase, no accents/punct)
TEAM_ALIASES: dict[str, str] = {
    # Bayern variants
    "bayern munchen": "bayern munich",
    "bayern muenchen": "bayern munich",
    "fc bayern munchen": "bayern munich",
    "fc bayern muenchen": "bayern munich",
    "fc bayern munich": "bayern munich",
    "bayern munich": "bayern munich",

    # ASVEL variants
    "asvel lyon villeurbanne": "asvel",
    "asvel lyon villeurbanne basketball": "asvel",
    "lyon villeurbanne": "asvel",
    "ldlc asvel": "asvel",
    "ldlc asvel villeurbanne": "asvel",
    "asvel": "asvel",

    # Panathinaikos variants
    "panathinaikos bc": "panathinaikos",
    "panathinaikos aok": "panathinaikos",
    "panathinaikos aktor": "panathinaikos",
    "panathinaikos": "panathinaikos",
}


@lru_cache(maxsize=1)
def _teams_meta() -> list[dict]:
    """Load METADATA/teams.json (optional)."""
    try:
        from app.services.json_loader import DataStore

        ds = DataStore.get()
        fp = os.path.join(ds.data_dir, "METADATA", "teams.json")
        with open(fp, "r", encoding="utf-8") as f:
            doc = json.load(f)
        teams = doc.get("teams") if isinstance(doc, dict) else None
        return teams if isinstance(teams, list) else []
    except Exception:
        return []


def _resolve_from_meta(clean_key: str) -> str:
    """Resolve to team_id using teams.json. Returns '' if not found.

    Some feeds include prefixes like 'FC'/'BC' in team names while others omit them.
    We compare against both the raw cleaned candidate and a version with a leading
    'fc ' or 'bc ' removed.
    """
    for t in _teams_meta():
        if not isinstance(t, dict):
            continue
        tid = t.get("team_id")
        if not isinstance(tid, str) or not tid.strip():
            continue

        # Collect candidate strings
        cand: list[str] = []

        def _add_candidate(raw: str) -> None:
            c = _clean(raw)
            if not c:
                return
            cand.append(c)
            if c.startswith("fc "):
                cand.append(c[3:].strip())
            if c.startswith("bc "):
                cand.append(c[3:].strip())

        for k in ("team_id", "name", "short_name", "abbrev", "slug"):
            v = t.get(k)
            if isinstance(v, str) and v.strip():
                _add_candidate(v)

        aliases = t.get("aliases")
        if isinstance(aliases, list):
            for a in aliases:
                if isinstance(a, str) and a.strip():
                    _add_candidate(a)

        if clean_key in cand:
            out = tid.strip().lower()
            if out.startswith("fc_"):
                out = out[3:]
            return out

    return ""


@lru_cache(maxsize=8192)
def canonical_team(name: str | None) -> str:
    """Resolve any team string (UI/bookmaker) to a stable canonical slug."""
    if not name:
        return ""

    s = _clean(name)
    if not s:
        return ""

    # 1) Manual alias pass (handles Munchen/Munich etc.)
    s = TEAM_ALIASES.get(s, s)

    # 2) Try metadata mapping (keeps all teams you had before)
    out = _resolve_from_meta(s)
    if out:
        return out

    # 3) Strip generic tokens, then alias + meta again
    toks = [t for t in s.split() if t not in {"fc", "bc", "basketball", "club", "aok", "aktor"}]
    s2 = " ".join(toks).strip()
    if s2:
        s2 = TEAM_ALIASES.get(s2, s2)
        out = _resolve_from_meta(s2)
        if out:
            return out
        s = s2

    # 4) Fallback slug
    return _slug_from_clean(s)


@lru_cache(maxsize=4096)
def canonical_team_from_code(code: str | None) -> str:
    """Resolve short legacy codes (e.g. oly, bar) via teams.json when possible."""
    if not code:
        return ""
    c = _clean(code).replace(" ", "_")
    if not c:
        return ""

    # Try metadata direct hits
    for t in _teams_meta():
        if not isinstance(t, dict):
            continue
        tid = t.get("team_id")
        if not isinstance(tid, str) or not tid.strip():
            continue
        tid_out = tid.strip().lower()
        if tid_out.startswith("fc_"):
            tid_out = tid_out[3:]

        for k in ("team_id", "slug"):
            v = t.get(k)
            if isinstance(v, str) and _clean(v).replace(" ", "_") == c:
                return tid_out
        ab = t.get("abbrev")
        if isinstance(ab, str) and _clean(ab).replace(" ", "_") == c:
            return tid_out

    if c.startswith("fc_"):
        c = c[3:]
    return c


def _date_from_start(start_time: str | None) -> str:
    s = (start_time or "").strip()
    m = re.search(r"(\d{4}-\d{2}-\d{2})", s)
    return m.group(1) if m else ""


def canonical_match_key(start_time: str | None, home_team: str | None, away_team: str | None) -> str:
    date = _date_from_start(start_time)
    if not date:
        # allow date_or_iso passed in
        date = (start_time or "").strip()[:10]
    if not date:
        return ""

    home = canonical_team(home_team)
    away = canonical_team(away_team)
    if not home or not away:
        return ""

    return f"{date}|{home}|{away}".lower()


def canonical_from_legacy_match_id(value: str) -> str:
    """Convert legacy match ids to canonical_match.

    Supports:
    - YYYY-MM-DD_home_away
    - YYYY-MM-DD_round25_oly_bar
    - Already canonical: YYYY-MM-DD|home|away
    """
    s = (value or "").strip()
    if not s:
        return ""

    low = s.lower()
    if low.count("|") == 2:
        return low

    # pull date
    date = _date_from_start(s)
    m = re.match(r"^(\d{4}-\d{2}-\d{2})_(.+)$", low)
    rest = m.group(2) if m else ""

    parts = [p for p in re.split(r"[_|]", rest or low) if p]
    parts = [p for p in parts if not re.match(r"^round\d+$", p)]

    if len(parts) < 2:
        return ""

    home_code, away_code = parts[-2], parts[-1]
    home = canonical_team_from_code(home_code) or canonical_team(home_code)
    away = canonical_team_from_code(away_code) or canonical_team(away_code)

    if not date:
        date = (s or "").strip()[:10]

    if date and home and away:
        return f"{date}|{home}|{away}".lower()

    return ""
