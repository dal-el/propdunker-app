import json
from pathlib import Path
import csv
import re
import hashlib

from utils import ensure_dir
from novibet_adapter import parse_novibet_json
from player_matching import (
    load_players_from_master,
    load_players_from_player_games,
    build_player_index,
    match_player,
)

# Cache player index once per run (speed).
_PLAYER_INDEX_CACHE = None


def _get_output_dirs(first_file: Path) -> tuple[Path, Path]:
    """Return (local_out_dir, processed_out_dir) for Novibet.

    Expected layout:
        PROPDUNKER/BOOKMAKERS/NOVIBET/INPUT_JSONS/<files>.json
    """
    first_parent = first_file.parent  # INPUT_JSONS
    novibet_dir = first_parent.parent  # NOVIBET
    propdunker_root = novibet_dir.parent.parent  # PROPDUNKER

    local_out_dir = novibet_dir / 'OUTPUT'
    processed_out_dir = propdunker_root / 'BOOKMAKERS_PROCESSED' / 'NOVIBET'
    ensure_dir(local_out_dir)
    ensure_dir(processed_out_dir)
    return local_out_dir, processed_out_dir



def _safe_key(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9_\-]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    if not s:
        return "unknown"
    # keep filenames short
    return s[:120]


def _group_key(raw: dict) -> str:
    # Stable per event across tabs (PLAYER_PROPS / ALTERNATIVE_PLAYER_PROPS / TEAMS etc.)
    path = str(raw.get("path") or "")
    start = str(raw.get("startTimeUTC") or raw.get("startTime") or "")
    bc = str(raw.get("betContextId") or "")
    core = f"{path}|{start}|{bc}"
    # hash to avoid very long keys + illegal chars
    h = hashlib.md5(core.encode("utf-8")).hexdigest()[:12]
    return _safe_key(f"{path}_{start}_{h}")


def _merge_raw(base_raw: dict, add_raw: dict) -> dict:
    # Merge marketCategories by appending; keep header fields from base_raw.
    merged = dict(base_raw)

    base_cats = list(base_raw.get("marketCategories") or [])
    add_cats = list(add_raw.get("marketCategories") or [])

    merged["marketCategories"] = base_cats + add_cats
    return merged


def _load_merge_cache(cache_dir: Path, gkey: str) -> dict | None:
    p = cache_dir / f"{gkey}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def _save_merge_cache(cache_dir: Path, gkey: str, raw: dict) -> None:
    ensure_dir(cache_dir)
    p = cache_dir / f"{gkey}.json"
    p.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_outputs(normalized: dict, out_dir: Path) -> Path:
    ensure_dir(out_dir)

    out_json = out_dir / f"{normalized['pre_game_key']}.json"
    out_json.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")

    out_csv = out_dir / f"{normalized['pre_game_key']}.csv"
    with out_csv.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "bookmaker","pre_game_key","match_label","start_time",
            "bet_type","book_category","sheet_key","ui_name",
            "player_name","line","source_display","over_odds","under_odds","is_mapped"
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
                p.get("is_mapped"),
            ])

    return out_json


def _find_master_near(path_hint: Path) -> Path | None:
    """Locate MASTER.XLSX.

    Priority:
      1) Fixed METADATA folder (Windows path)
      2) Walk up from the input file location (fallback)
    """
    # 1) Fixed METADATA folder (user preference) - ΔΙΟΡΘΩΜΕΝΟ PATH
    fixed = Path(r"C:\DEV\PROPDUNKER\METADATA") / "MASTER.XLSX"
    if fixed.exists():
        return fixed

    # 2) Fallback: Walk up a few parents and look for MASTER.XLSX
    cur = path_hint.resolve()
    for _ in range(6):
        cand = cur / "MASTER.XLSX"
        if cand.exists():
            return cand
        cur = cur.parent
    return None


def _find_player_games_near(path_hint: Path) -> Path | None:
    """Try to locate a PLAYER_GAMES folder near the project root."""
    cur = path_hint.resolve()
    for _ in range(6):
        cand = cur / "PLAYER_GAMES"
        if cand.exists() and cand.is_dir():
            return cand
        cur = cur.parent
    return None


def _load_player_index(first_input_file: Path) -> list[dict]:
    """Load canonical players once per run.

    Priority:
      1) MASTER.XLSX (best)
      2) PLAYER_GAMES exports (fallback)
    """
    global _PLAYER_INDEX_CACHE
    try:
        cached = _PLAYER_INDEX_CACHE
    except Exception:
        cached = None
    if cached is not None:
        return cached

    master = _find_master_near(first_input_file)
    if master is not None:
        players = load_players_from_master(master)
        _PLAYER_INDEX_CACHE = build_player_index(players)
        return _PLAYER_INDEX_CACHE

    pg = _find_player_games_near(first_input_file)
    if pg is not None:
        players = load_players_from_player_games(pg)
        _PLAYER_INDEX_CACHE = build_player_index(players)
        return _PLAYER_INDEX_CACHE

    raise FileNotFoundError("Could not find MASTER.XLSX or PLAYER_GAMES near inputs")


def _enrich_players(normalized: dict, pindex: list[dict]) -> None:
    """Add player_id + canonical_name fields to each prop without changing existing keys."""
    for p in normalized.get("props", []):
        book_name = str(p.get("player_name") or "").strip()
        match, conf = match_player(book_name, pindex)
        if match and conf >= 90:
            p["player_id"] = match["player_id"]
            p["canonical_player_name"] = match["canonical_name"]
            p["player_match_confidence"] = conf
            p["is_player_mapped"] = True
        else:
            p["player_id"] = None
            p["canonical_player_name"] = None
            p["player_match_confidence"] = conf
            p["is_player_mapped"] = False


def process_one_file(inp: Path, out_dir: Path) -> Path:
    """Backward-compatible single-file processing (no merge cache).

    Writes:
    - NOVIBET/OUTPUT (debug)
    - BOOKMAKERS_PROCESSED/NOVIBET (final)

    The provided out_dir is ignored to keep behavior consistent across runs.
    """
    raw = json.loads(inp.read_text(encoding="utf-8"))
    normalized = parse_novibet_json(raw)

    # --- Player name matching enrichment (optional) ---
    try:
        pindex = _load_player_index(inp)
        _enrich_players(normalized, pindex)
    except Exception:
        pass

    out_dir_local, out_dir_processed = _get_output_dirs(inp)
    _write_outputs(normalized, out_dir_local)
    return _write_outputs(normalized, out_dir_processed)


def process_files(filepaths) -> str:
    """Process selected Novibet JSON files.

    IMPORTANT FIX:
    - Prevent overwrite between PLAYER_PROPS and ALTERNATIVE_PLAYER_PROPS for the same game.
    - We keep a persistent merge cache per event and always write the merged output as ONE JSON.

    Behavior:
    - If user selects 1 file: it is cached and output is written.
    - If later user selects another file from SAME event (e.g. ALT tab): we merge into cache and output is rewritten
      containing BOTH (MAIN + ALT), so you never lose one.
    """
    files = [Path(p).resolve() for p in filepaths]
    if not files:
        raise FileNotFoundError("No JSON files selected")

    out_dir_local, out_dir_processed = _get_output_dirs(files[0])

    cache_dir = out_dir_processed / '.merge_cache'
    ensure_dir(cache_dir)

    # Build player index once per run (for speed) if possible.
    global _PLAYER_INDEX_CACHE
    _PLAYER_INDEX_CACHE = None

    # Group selected files by event, so selecting multiple at once also merges.
    grouped: dict[str, list[Path]] = {}
    for inp in files:
        if inp.suffix.lower() != ".json":
            continue
        raw = json.loads(inp.read_text(encoding="utf-8"))
        gkey = _group_key(raw)
        grouped.setdefault(gkey, []).append(inp)

        # Save the raw alongside the path for later merge stage
        # (we'll re-read; files are small enough)

    for gkey, paths in grouped.items():
        # Start from cached raw if exists (supports "merge across multiple runs")
        merged_raw = _load_merge_cache(cache_dir, gkey)

        for inp in paths:
            raw = json.loads(inp.read_text(encoding="utf-8"))
            if merged_raw is None:
                merged_raw = raw
            else:
                merged_raw = _merge_raw(merged_raw, raw)

        if merged_raw is None:
            continue

        # update cache
        _save_merge_cache(cache_dir, gkey, merged_raw)

        # normalize + write single output per game
        normalized = parse_novibet_json(merged_raw)

        # Enrich players using the same discovery rules as process_one_file.
        try:
            pindex = _load_player_index(paths[0])
            _enrich_players(normalized, pindex)
        except Exception:
            pass
        _write_outputs(normalized, out_dir_local)
        _write_outputs(normalized, out_dir_processed)

    return str(out_dir_processed)