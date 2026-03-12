import json
from pathlib import Path
import csv

from utils import ensure_dir
from stoiximan_adapter import parse_stoiximan_like_json
from player_matching import load_players_from_master, best_match



# --- Player matching (MASTER-driven) ---
_PLAYERS_CACHE = None  # type: ignore

def _get_master_players() -> list[dict]:
    global _PLAYERS_CACHE
    if _PLAYERS_CACHE is not None:
        return _PLAYERS_CACHE

    # Fixed path (user preference) - ΔΙΟΡΘΩΜΕΝΟ
    master = Path(r"C:\DEV\PROPDUNKER\METADATA") / "MASTER.XLSX"
    if not master.exists():
        raise FileNotFoundError("MASTER.XLSX not found at METADATA path")
    _PLAYERS_CACHE = load_players_from_master(master)
    return _PLAYERS_CACHE

def _apply_player_matching(normalized: dict) -> None:
    players = _get_master_players()
    for p in normalized.get("props", []):
        nm = p.get("player_name") or ""
        m, sc = best_match(str(nm), players)
        p["player_match_confidence"] = int(sc)
        if m is not None and sc >= 90:
            p["player_id"] = m["player_id"]
            p["canonical_player_name"] = m["canonical_name"]
            p["is_player_mapped"] = True
        else:
            p["player_id"] = None
            p["canonical_player_name"] = None
            p["is_player_mapped"] = False

def _project_root_from_input_file(inp: Path) -> Path:
    # Expected: .../PROPDUNKER/BOOKMAKERS/STOIXIMAN/INPUT_JSONS/<file>.json
    p = inp.resolve()
    # Walk up until we find PROPDUNKER folder (fallback: 3 levels up from INPUT_JSONS)
    for _ in range(8):
        if p.name.upper() == "PROPDUNKER":
            return p
        p = p.parent
    # Fallback
    return inp.resolve().parent.parent.parent


def _write_outputs(normalized: dict, out_dir: Path) -> None:
    ensure_dir(out_dir)

    out_json = out_dir / f"{normalized['pre_game_key']}.json"
    out_json.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")

    # CSV view (debug)
    out_csv = out_dir / f"{normalized['pre_game_key']}.csv"
    with out_csv.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "bookmaker","pre_game_key","match_label","start_time",
            "bet_type","book_category","sheet_key","ui_name",
            "player_name","line","source_display","over_odds","under_odds"
        ])
        for p in normalized.get("props", []):
            w.writerow([
                normalized.get("bookmaker"),
                normalized.get("pre_game_key"),
                normalized.get("match_label"),
                normalized.get("start_time"),
                p.get("bet_type"),
                p.get("book_category"),
                p.get("sheet_key"),
                p.get("ui_name"),
                p.get("player_name"),
                p.get("line"),
                p.get("source_display"),
                p.get("over_odds"),
                p.get("under_odds"),
            ])


def process_one_file(inp: Path, out_intermediate: Path, out_processed: Path) -> None:
    raw = json.loads(inp.read_text(encoding="utf-8"))
    normalized = parse_stoiximan_like_json(raw)

    # Add player_id + canonical_player_name (non-destructive)
    _apply_player_matching(normalized)

    # 1) Bookmaker local OUTPUT (debug)
    _write_outputs(normalized, out_intermediate)

    # 2) Common BOOKMAKERS_PROCESSED (frontend)
    _write_outputs(normalized, out_processed)


def process_files(filepaths) -> str:
    files = [Path(p).resolve() for p in filepaths]
    if not files:
        raise FileNotFoundError("No JSON files selected")

    root = _project_root_from_input_file(files[0])

    out_intermediate = root / "BOOKMAKERS" / "STOIXIMAN" / "OUTPUT"
    out_processed = root / "BOOKMAKERS_PROCESSED" / "STOIXIMAN"

    ensure_dir(out_intermediate)
    ensure_dir(out_processed)

    for inp in files:
        if inp.suffix.lower() != ".json":
            continue
        process_one_file(inp, out_intermediate, out_processed)

    return str(out_processed)