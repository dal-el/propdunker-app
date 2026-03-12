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
    """
    s = (name or "").upper().strip()
    s = s.replace(",", " ")
    s = re.sub(r"[\.\'\-_/]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return _WORD_RE.findall(s)

def _score_tokens(a: List[str], b: List[str]) -> int:
    if not a or not b:
        return 0
    sa, sb = set(a), set(b)
    if sa == sb:
        return 100
    inter = len(sa & sb)
    union = len(sa | sb)
    j = inter / union if union else 0.0
    aa = " ".join(sorted(sa))
    bb = " ".join(sorted(sb))
    sm = SequenceMatcher(None, aa, bb).ratio()
    return int(round(100 * (0.65 * j + 0.35 * sm)))

def load_players_from_master(master_xlsx: Path) -> List[Dict[str, str]]:
    """
    Load canonical players from MASTER.XLSX.
    Expected columns include 'Player' and 'Player_ID' (case-insensitive).
    Returns list of dicts: {player_id, canonical_name}
    """
    try:
        import openpyxl
    except Exception:
        raise RuntimeError("openpyxl is required to read MASTER.XLSX")

    wb = openpyxl.load_workbook(master_xlsx, data_only=True)
    players: List[Dict[str, str]] = []

    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        header = [str(x).strip() if x is not None else "" for x in rows[0]]
        header_low = [h.lower() for h in header]

        pcol = None
        idcol = None

        if "player" in header_low:
            pcol = header_low.index("player")
        else:
            for i, h in enumerate(header_low):
                if h in ("player name", "player_name", "player"):
                    pcol = i
                    break

        if "player_id" in header_low:
            idcol = header_low.index("player_id")
        else:
            for i, h in enumerate(header_low):
                if h in ("player id", "player_id", "id"):
                    idcol = i
                    break

        if pcol is None or idcol is None:
            continue

        for r in rows[1:]:
            if not r:
                continue
            nm = r[pcol] if pcol < len(r) else None
            pid = r[idcol] if idcol < len(r) else None
            if nm is None or pid is None:
                continue
            nm_s = str(nm).strip()
            pid_s = str(pid).strip()
            if not nm_s or not pid_s:
                continue
            if pid_s.isdigit():
                pid_s = pid_s.zfill(6)
            players.append({"player_id": pid_s, "canonical_name": nm_s})
    return players

def best_match(book_name: str, players: List[Dict[str, str]]) -> Tuple[Optional[Dict[str, str]], int]:
    bt = name_tokens(book_name)
    best = None
    best_score = -1
    for p in players:
        ct = name_tokens(p["canonical_name"])
        sc = _score_tokens(bt, ct)
        if sc > best_score:
            best_score = sc
            best = p
            if best_score == 100:
                break
    if best_score < 0:
        return None, 0
    return best, best_score
