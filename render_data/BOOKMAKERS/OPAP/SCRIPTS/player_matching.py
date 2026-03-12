import json
import re
from pathlib import Path
from difflib import SequenceMatcher
from typing import Dict, Any, List, Tuple, Optional

_WORD_RE = re.compile(r"[A-Z0-9]+")

def name_tokens(name: str) -> List[str]:
    """
    Normalize a player name to a list of uppercase tokens.
    Handles formats like:
      - 'Tarik Biberovic'
      - 'BIBEROVIC, TARIK'
      - 'Micic, V.'
      - double spaces / punctuation
      - initials like T.J. -> TJ
    """
    if not name:
        return []
    s = name.upper().strip()
    # Remove dots and apostrophes completely (they join initials)
    s = re.sub(r"[\.\']", "", s)
    # Replace other punctuation with space
    s = re.sub(r"[,\-_/]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return _WORD_RE.findall(s)


def _score_tokens(a: List[str], b: List[str]) -> int:
    """Return a 0-100 similarity score for two token lists."""
    if not a or not b:
        return 0
    sa, sb = set(a), set(b)
    # Exact token-set match is perfect.
    if sa == sb:
        return 100
    # Jaccard as a base.
    inter = len(sa & sb)
    union = len(sa | sb)
    j = inter / union if union else 0.0
    # SequenceMatcher on sorted tokens gives extra signal for minor typos.
    aa = " ".join(sorted(a))
    bb = " ".join(sorted(b))
    sm = SequenceMatcher(None, aa, bb).ratio()
    # Weighted blend, then scale.
    return int(round(100 * (0.65 * j + 0.35 * sm)))


def load_players_from_master(master_xlsx: Path) -> List[Dict[str, str]]:
    """Load canonical players from MASTER.XLSX.

    Expected columns: includes 'Player' and 'Player_ID' (case-insensitive match).
    Returns list of dicts: {player_id, canonical_name}
    """
    try:
        import openpyxl
    except Exception as e:
        raise RuntimeError("openpyxl is required to read MASTER.XLSX") from e

    wb = openpyxl.load_workbook(master_xlsx, data_only=True)
    out: List[Dict[str, str]] = []
    for ws in wb.worksheets:
        # Find header row (first non-empty row)
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        header = None
        header_i = None
        for i, r in enumerate(rows[:10]):
            if r and any(x is not None and str(x).strip() for x in r):
                header = [str(x).strip() if x is not None else "" for x in r]
                header_i = i
                break
        if not header:
            continue
        # Map columns
        col_map = {h.strip().lower(): idx for idx, h in enumerate(header) if h}
        # Common names seen in your MASTER
        pcol = None
        idcol = None
        for key in ("player", "player_name", "name"):
            if key in col_map:
                pcol = col_map[key]
                break
        for key in ("player_id", "id", "code"):
            if key in col_map:
                idcol = col_map[key]
                break
        if pcol is None or idcol is None:
            continue
        for r in rows[(header_i + 1):]:
            if not r:
                continue
            name = r[pcol] if pcol < len(r) else None
            pid = r[idcol] if idcol < len(r) else None
            if name is None or pid is None:
                continue
            name_s = str(name).strip()
            pid_s = str(pid).strip()
            if not name_s or not pid_s:
                continue
            # Keep zero padding if numeric
            if pid_s.isdigit():
                pid_s = pid_s.zfill(6)
            out.append({"player_id": pid_s, "canonical_name": name_s})
    if not out:
        raise ValueError(f"No players loaded from MASTER: {master_xlsx}")
    return out


def load_players_from_player_games(player_games_dir: Path) -> List[Dict[str, str]]:
    """Fallback loader using exported PLAYER_GAMES/*.json (one per player)."""
    out: List[Dict[str, str]] = []
    for p in sorted(player_games_dir.glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        pid = str(data.get("code") or data.get("player_id") or "").strip()
        name = str(data.get("name") or data.get("player") or "").strip()
        if not pid or not name:
            continue
        if pid.isdigit():
            pid = pid.zfill(6)
        out.append({"player_id": pid, "canonical_name": name})
    if not out:
        raise ValueError(f"No players loaded from PLAYER_GAMES: {player_games_dir}")
    return out


def build_player_index(players: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    """Precompute tokens for faster matching."""
    idx: List[Dict[str, Any]] = []
    for rec in players:
        cname = rec["canonical_name"]
        idx.append({
            "player_id": rec["player_id"],
            "canonical_name": cname,
            "tokens": name_tokens(cname),
        })
    return idx


def match_player(book_name: str, index: List[Dict[str, Any]]) -> Tuple[Optional[Dict[str, str]], int]:
    """Return (best_match, confidence 0-100)."""
    btoks = name_tokens(book_name)
    if not btoks:
        return None, 0
    best = None
    best_score = 0
    for cand in index:
        score = _score_tokens(btoks, cand["tokens"])
        if score > best_score:
            best_score = score
            best = cand
            if best_score == 100:
                break
    if not best:
        return None, 0
    return {"player_id": best["player_id"], "canonical_name": best["canonical_name"]}, best_score