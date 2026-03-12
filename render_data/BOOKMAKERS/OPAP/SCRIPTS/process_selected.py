import json
from pathlib import Path
import csv
import re
import hashlib

from utils import ensure_dir
from opap_adapter import parse_opap_json


def _safe_key(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9_\-]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    if not s:
        return "unknown"
    return s[:120]


def _group_key(raw: dict) -> str:
    # Stable per event across tabs
    path = str(raw.get("path") or "")
    start = str(raw.get("startTimeUTC") or raw.get("startTime") or "")
    bc = str(raw.get("betContextId") or "")
    core = f"{path}|{start}|{bc}"
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


def process_one_file(inp: Path, out_dir: Path) -> Path:
    raw = json.loads(inp.read_text(encoding="utf-8"))
    normalized = parse_opap_json(raw)
    return _write_outputs(normalized, out_dir)


def process_files(filepaths) -> str:
    """Process selected OPAP JSON files.

    Same behavior as NOVIBET:
    - Always writes intermediate debug output to BOOKMAKERS/OPAP/OUTPUT
    - Also writes final normalized output to BOOKMAKERS_PROCESSED/OPAP
    - Uses merge cache to avoid overwrites when selecting multiple tabs for same event.

    NOTE: No change to merge logic, schema, filenames.
    """
    files = [Path(p).resolve() for p in filepaths]
    if not files:
        raise FileNotFoundError("No JSON files selected")

    first_parent = files[0].parent  # e.g. .../BOOKMAKERS/OPAP/INPUT_JSONS

    # Intermediate (per-bookmaker) output
    out_dir = first_parent.parent / "OUTPUT"
    ensure_dir(out_dir)

    # Final common processed output (GLOBAL): PROPDUNKER/BOOKMAKERS_PROCESSED/OPAP
    # Do NOT write inside BOOKMAKERS/OPAP/...
    scripts_dir = Path(__file__).resolve().parent
    opap_dir = scripts_dir.parent  # .../BOOKMAKERS/OPAP
    project_root = opap_dir.parent.parent  # .../PROPDUNKER
    out_processed = project_root / "BOOKMAKERS_PROCESSED" / "OPAP"
    ensure_dir(out_processed)

    cache_dir = out_dir / ".merge_cache"
    ensure_dir(cache_dir)

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
            if merged_raw is None:
                merged_raw = raw
            else:
                merged_raw = _merge_raw(merged_raw, raw)

        if merged_raw is None:
            continue

        _save_merge_cache(cache_dir, gkey, merged_raw)

        normalized = parse_opap_json(merged_raw)

        # Write to BOTH destinations
        _write_outputs(normalized, out_dir)
        _write_outputs(normalized, out_processed)

    return str(out_processed)
