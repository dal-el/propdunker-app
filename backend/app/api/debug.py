from __future__ import annotations

import os
from fastapi import APIRouter

router = APIRouter(tags=["debug"])

@router.get("/debug/assets")
def debug_assets():
    # env
    env_root = os.environ.get("PROPDUNKER_DATA_DIR")

    # DATA_DIR.txt
    data_txt = None
    txt_root = None
    try:
        here = os.path.abspath(os.path.dirname(__file__))
        data_txt = os.path.abspath(os.path.join(here, "..", "..", "..", "DATA_DIR.txt"))
        if os.path.isfile(data_txt):
            txt_root = open(data_txt, "r", encoding="utf-8").read().strip()
    except Exception:
        pass

    root = txt_root if (txt_root and os.path.isdir(txt_root)) else (env_root if (env_root and os.path.isdir(env_root)) else None)
    assets_dir = os.path.join(root, "METADATA", "assets") if root else None
    logo_fp = os.path.join(root, "METADATA", "assets", "logos", "euroleague", "panathinaikos.png") if root else None
    teams_fp = os.path.join(root, "METADATA", "teams.json") if root else None

    return {
        "env_root": env_root,
        "data_dir_txt_path": data_txt,
        "data_dir_txt_value": txt_root,
        "resolved_root": root,
        "assets_dir": assets_dir,
        "assets_dir_exists": bool(assets_dir and os.path.isdir(assets_dir)),
        "teams_json": teams_fp,
        "teams_json_exists": bool(teams_fp and os.path.isfile(teams_fp)),
        "sample_logo": logo_fp,
        "sample_logo_exists": bool(logo_fp and os.path.isfile(logo_fp)),
    }
