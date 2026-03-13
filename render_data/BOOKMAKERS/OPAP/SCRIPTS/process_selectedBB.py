import csv
import hashlib
import json
import re
from pathlib import Path

from utils import ensure_dir
from opap_adapter import parse_opap_json
from player_matching import (
    build_player_index,
    load_players_from_master,
    load_players_from_player_games,
    match_player,
)

_PLAYER_INDEX_CACHE = None


def _get_output_dirs(first_file: Path) -> tuple[Path, Path]:
    """Return (local_out_dir, processed_out_dir) for OPAP/Pame Stoixima."""
    first_parent = first_file.parent
    book_dir = first_parent.parent
    propdunker_root = book_dir.parent.parent

    local_out_dir = book_dir / "OUTPUT"
    processed_out_dir = propdunker_root / "BOOKMAKERS_PROCESSED" / "OPAP"
    ensure_dir(local_out_dir)
    ensure_dir(processed_out_dir)
    return local_out_dir, processed_out_dir


def _safe_key(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9_\-]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s[:120] or "unknown"


def _group_key(raw: dict) -> str:
    """Stable per event across OPAP tabs/files."""
    data = raw.get("data") or {}
    events = data.get("events") or []
    event = events[0] if events else {}
    event_id = str(event.get("id") or "")
    start = str(event.get("startTime") or raw.get("startTime") or "")
    name = str(event.get("name") or "")
    core = f"{event_id}|{start}|{name}"
    h = hashlib.md5(core.encode("utf-8")).hexdigest()[:12]
    return _safe_key(f"{event_id}_{start}_{h}")


def _merge_raw(base_raw: dict, add_raw: dict) -> dict:
    """Merge OPAP events by appending markets from the first event."""
    merged = dict(base_raw)

    base_data = dict(base_raw.get("data") or {})
    add_data = dict(add_raw.get("data") or {})
    base_events = list(base_data.get("events") or [])
    add_events = list(add_data.get("events") or [])
    if not base_events:
        return add_raw
    if not add_events:
        return merged

    base_event = dict(base_events[0])
    add_event = dict(add_events[0])
    base_markets = list(base_event.get("markets") or [])
    add_markets = list(add_event.get("markets") or [])
    base_event["markets"] = base_markets + add_markets
    base_events[0] = base_event
    base_data["events"] = base_events
    merged["data"] = base_data
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
            "bookmaker", "pre_game_key", "match_label", "start_time", "bb_ready",
            "bet_type", "book_category", "sheet_key", "ui_name",
            "player_name", "line", "source_display", "over_odds", "under_odds", "is_mapped"
        ])
        for p in normalized.get("props", []):
            w.writerow([
                normalized.get("bookmaker"),
                normalized.get("pre_game_key"),
                normalized.get("match_label"),
                normalized.get("start_time"),
                p.get("bb_ready"),
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
    fixed = Path(r"C:\DEV\PROPDUNKER\METADATA") / "MASTER.XLSX"
    if fixed.exists():
        return fixed

    cur = path_hint.resolve()
    for _ in range(6):
        cand = cur / "MASTER.XLSX"
        if cand.exists():
            return cand
        cur = cur.parent
    return None


def _find_player_games_near(path_hint: Path) -> Path | None:
    cur = path_hint.resolve()
    for _ in range(6):
        cand = cur / "PLAYER_GAMES"
        if cand.exists() and cand.is_dir():
            return cand
        cur = cur.parent
    return None


def _load_player_index(first_input_file: Path) -> list[dict]:
    global _PLAYER_INDEX_CACHE
    if _PLAYER_INDEX_CACHE is not None:
        return _PLAYER_INDEX_CACHE

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


def _stem_ends_with_1(path: Path) -> bool:
    stem = path.stem.strip()
    return bool(re.search(r"1$", stem))


def _bb_ready_from_path(path: Path) -> str:
    return "YES" if _stem_ends_with_1(path) else "NO"


def _tag_raw_markets_with_bb_ready(raw: dict, bb_ready: str) -> dict:
    """Tag each raw market with source-level bb_ready before merge so merged outputs preserve origin."""
    tagged = dict(raw)
    data = dict(tagged.get("data") or {})
    events = list(data.get("events") or [])
    if not events:
        return tagged

    event = dict(events[0])
    markets = []
    for m in (event.get("markets") or []):
        mm = dict(m)
        mm["__bb_ready"] = bb_ready
        markets.append(mm)
    event["markets"] = markets
    events[0] = event
    data["events"] = events
    tagged["data"] = data
    return tagged


def process_one_file(inp: Path, out_dir: Path | None = None) -> Path:
    raw = json.loads(inp.read_text(encoding="utf-8"))
    raw = _tag_raw_markets_with_bb_ready(raw, _bb_ready_from_path(inp))
    normalized = parse_opap_json(raw)

    try:
        pindex = _load_player_index(inp)
        _enrich_players(normalized, pindex)
    except Exception:
        pass

    out_dir_local, out_dir_processed = _get_output_dirs(inp)
    _write_outputs(normalized, out_dir_local)
    return _write_outputs(normalized, out_dir_processed)


def process_files(filepaths) -> str:
    """Process selected OPAP JSON files with Novibet-like merge flow."""
    files = [Path(p).resolve() for p in filepaths]
    if not files:
        raise FileNotFoundError("No JSON files selected")

    out_dir_local, out_dir_processed = _get_output_dirs(files[0])
    cache_dir = out_dir_processed / ".merge_cache"
    ensure_dir(cache_dir)

    global _PLAYER_INDEX_CACHE
    _PLAYER_INDEX_CACHE = None

    grouped: dict[str, list[Path]] = {}
    for inp in files:
        if inp.suffix.lower() != ".json":
            continue
        raw = json.loads(inp.read_text(encoding="utf-8"))
        gkey = _group_key(raw)
        grouped.setdefault(gkey, []).append(inp)

    for gkey, paths in grouped.items():
        merged_raw = _load_merge_cache(cache_dir, gkey)

        for inp in paths:
            raw = json.loads(inp.read_text(encoding="utf-8"))
            raw = _tag_raw_markets_with_bb_ready(raw, _bb_ready_from_path(inp))
            if merged_raw is None:
                merged_raw = raw
            else:
                merged_raw = _merge_raw(merged_raw, raw)

        if merged_raw is None:
            continue

        _save_merge_cache(cache_dir, gkey, merged_raw)

        normalized = parse_opap_json(merged_raw)

        try:
            pindex = _load_player_index(paths[0])
            _enrich_players(normalized, pindex)
        except Exception:
            pass

        _write_outputs(normalized, out_dir_local)
        _write_outputs(normalized, out_dir_processed)

    return str(out_dir_processed)
