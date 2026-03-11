from __future__ import annotations

import os
import json
from functools import lru_cache
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(tags=["logos"])

def _data_root() -> str | None:
    d = os.environ.get("PROPDUNKER_DATA_DIR")
    if d and os.path.isdir(d):
        return d
    try:
        here = os.path.abspath(os.path.dirname(__file__))
        data_txt = os.path.abspath(os.path.join(here, "..", "..", "..", "DATA_DIR.txt"))
        if os.path.isfile(data_txt):
            p = open(data_txt, "r", encoding="utf-8").read().strip()
            if p and os.path.isdir(p):
                return p
    except Exception:
        pass
    return None

@lru_cache(maxsize=1)
def _teams_by_id() -> dict[str, dict]:
    root = _data_root()
    if not root:
        return {}
    fp = os.path.join(root, "METADATA", "teams.json")
    try:
        doc = json.load(open(fp, "r", encoding="utf-8"))
        teams = doc.get("teams") if isinstance(doc, dict) else None
        out: dict[str, dict] = {}
        if isinstance(teams, list):
            for t in teams:
                if isinstance(t, dict) and isinstance(t.get("team_id"), str):
                    out[t["team_id"]] = t
        return out
    except Exception:
        return {}

@router.get("/logo/{team_id}.png")
def get_logo(team_id: str):
    teams = _teams_by_id()
    t = teams.get(team_id)
    if not t:
        raise HTTPException(status_code=404, detail="Unknown team_id")

    root = _data_root()
    if not root:
        raise HTTPException(status_code=500, detail="Data root not configured")

    logo_rel = t.get("logo")
    if not isinstance(logo_rel, str):
        raise HTTPException(status_code=404, detail="Logo not set for team")

    # stored like: METADATA/assets/logos/euroleague/panathinaikos.png
    logo_rel = logo_rel.replace("/", os.sep).replace("\\", os.sep)
    logo_fp = os.path.join(root, logo_rel)
    if not os.path.isfile(logo_fp):
        raise HTTPException(status_code=404, detail="Logo file missing")

    return FileResponse(logo_fp, media_type="image/png")
