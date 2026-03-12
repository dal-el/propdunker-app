
import re
import json
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional

from utils import slug, ms_to_iso

_PLUS_RE = re.compile(r"^(?P<n>\d+)\+$")


def _load_categories_map() -> Dict[str, Any]:
    p = Path(__file__).with_name("categories_map.json")
    with p.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, dict) else {}


def _resolve_category(canon: str, cat_map: Dict[str, Any]) -> Tuple[str, str, bool]:
    canon = (canon or "").strip()
    if canon in cat_map and isinstance(cat_map[canon], dict):
        rec = cat_map[canon]
        return str(rec.get("sheet_key") or canon), str(rec.get("ui_name") or canon), True
    for key, rec in cat_map.items():
        if not isinstance(rec, dict):
            continue
        for a in (rec.get("aliases") or []):
            if str(a) == canon:
                return str(rec.get("sheet_key") or key), str(rec.get("ui_name") or key), True
    return canon, canon, False


def _norm_title(title: str) -> str:
    t = (title or "").strip()
    t = re.sub(r"\s+", " ", t)
    return t


def _map_market_title(title: str) -> Tuple[Optional[str], Optional[str]]:
    """Return (canonical_key, book_category_override)."""
    t = _norm_title(title)
    low = t.lower()

    # Q1 markets
    if low.startswith("first period -"):
        core = t.split("-", 1)[1].strip()
        core = core.replace("O/U", "").strip()
        cl = core.lower()
        if cl.startswith("points"):
            return "Q1 Points", "1Q Points"
        if cl.startswith("rebounds"):
            return "Q1 Rebounds", "1Q Rebounds"
        if cl.startswith("assists"):
            return "Q1 Assists", "1Q Assists"
        return None, None

    # DD/TD
    if low in ("double-double", "double double"):
        return "Double Double", "Double-Double"
    if low in ("triple-double", "triple double"):
        return "Triple Double", "Triple Double"

    core = t.replace("O/U", "").strip()
    cl = core.lower()

    # Basics
    if cl == "points":
        return "Points", None
    if cl == "rebounds":
        return "Rebounds", None
    if cl == "assists":
        return "Assists", None
    if cl == "steals":
        return "Steals", None
    if cl == "blocks":
        return "Blocks", None
    if cl == "turnovers":
        return "Turnovers", None

    # Fouls
    if cl in ("fouls committed", "fouls", "fouls committed "):
        return "Fouls Committed", None
    if cl in ("fouls earned", "fouls received", "fouls drawn"):
        return "Fouls Earned", None

    # Shooting
    if cl in ("total two point shots scored", "two point shots scored", "two point shots made", "2p made"):
        return "2P Made", None
    if cl in ("two point shots attempted", "two point shots att", "2p attempted"):
        return "2P Attempted", None
    if cl in ("total three point shots scored", "total three point shots made", "three point shots scored", "3p made"):
        return "3P Made", None
    if cl in ("3 point shots attempted", "three point shots attempted", "3p attempted"):
        return "3P Attempted", None
    if cl in ("free throws scored", "free throws made"):
        return "Free Throws Made", None
    if cl in ("free throws attempted", "free throws att"):
        return "Free Throws Attempted", None

    # Field goals
    if cl in ("field goals scored", "field goals made", "fg made", "fgm"):
        return "FG Made", None
    if cl in ("field goals attempted", "fg attempted", "fga"):
        return "FG Attempted", None

    # Combos normalize
    c = re.sub(r"\s+", "", core)
    clc = c.lower()

    if clc in ("points+rebounds", "points+reboundsou"):
        return "Points + Rebounds", None
    if clc in ("points+assists",):
        return "Points + Assists", None
    if clc in ("rebounds+assists", "rebounds&assists", "rebs+asts"):
        return "Rebounds + Assists", None
    if clc in ("points+rebounds+assists", "points+reb+ass", "points+rebounds+assistsou"):
        return "Points + Rebounds + Ass", None

    if "points" in cl and "blocks" in cl and "rebounds" not in cl:
        return "Points + Blocks", None

    if "points" in cl and "rebounds" in cl and "blocks" in cl:
        return "Points + Rebounds + Blocks", None

    if "steals" in cl and "blocks" in cl:
        return "Steals + Blocks", None

    return None, None


def _detect_bet_type(column_titles: List[Dict[str, Any]], sample_row: Dict[str, Any]) -> str:
    if len(column_titles) == 2:
        return "MAIN_PROPS"
    try:
        sels = sample_row["groupSelections"][0]["selections"]
        if sels and isinstance(sels[0].get("name", ""), str) and "+" in sels[0].get("name", ""):
            return "ALT_PROPS"
    except Exception:
        pass
    return "MAIN_PROPS"


def parse_stoiximan_like_json(raw: Dict[str, Any]) -> Dict[str, Any]:
    event = raw["data"]["event"]
    home = event["participants"][0]["name"]
    away = event["participants"][1]["name"]
    start_ms = event.get("startTime")
    start_iso = ms_to_iso(start_ms) if isinstance(start_ms, (int, float)) else None

    home_id = slug(home)
    away_id = slug(away)
    date_key = start_iso[:10] if start_iso else "unknown_date"
    pre_game_key = f"{date_key}_{home_id}_{away_id}"

    out: Dict[str, Any] = {
        "bookmaker": "STOIXIMAN",
        "pre_game_key": pre_game_key,
        "match_label": f"{home} vs {away}",
        "start_time": start_iso,
        "home_team": home,
        "away_team": away,
        "home_team_id": home_id,
        "away_team_id": away_id,
        "props": [],
    }

    cat_map = _load_categories_map()

    for m in event.get("markets", []):
        tl = m.get("tableLayout") or {}
        title = (tl.get("title") or "").strip()
        col_titles = tl.get("columnTitles") or []
        rows = tl.get("rows") or []
        if not rows:
            continue

        bet_type = _detect_bet_type(col_titles, rows[0])
        canon, book_override = _map_market_title(title)

        if not canon:
            canon = _norm_title(title).replace("O/U", "").strip() or title

        sheet_key, ui_name, is_mapped = _resolve_category(canon, cat_map)
        book_category = book_override if book_override else title

        for r in rows:
            player_name = (r.get("title") or "").strip()
            gs = (r.get("groupSelections") or [])
            if not gs:
                continue
            handicap = gs[0].get("handicap")
            sels = gs[0].get("selections") or []

            # YES/NO
            if sheet_key in ("DD", "TD"):
                yes = next((s for s in sels if str(s.get("name", "")).strip().upper() == "YES"), None)
                no = next((s for s in sels if str(s.get("name", "")).strip().upper() == "NO"), None)
                if yes and no:
                    out["props"].append({
                        "bet_type": "MAIN_PROPS",
                        "book_category": book_category,
                        "sheet_key": sheet_key,
                        "ui_name": ui_name,
                        "player_name": player_name,
                        "line": 0.5,
                        "source_display": "YES/NO",
                        "over_odds": float(yes.get("price")) if yes.get("price") is not None else None,
                        "under_odds": float(no.get("price")) if no.get("price") is not None else None,
                        "over_pick": "YES",
                        "under_pick": "NO",
                        "is_mapped": is_mapped,
                    })
                continue

            if bet_type == "MAIN_PROPS":
                over = next((s for s in sels if s.get("columnIndex") == 0), None)
                under = next((s for s in sels if s.get("columnIndex") == 1), None)
                if over and under and isinstance(handicap, (int, float)):
                    out["props"].append({
                        "bet_type": "MAIN_PROPS",
                        "book_category": book_category,
                        "sheet_key": sheet_key,
                        "ui_name": ui_name,
                        "player_name": player_name,
                        "line": float(handicap),
                        "source_display": None,
                        "over_odds": float(over.get("price")) if over.get("price") is not None else None,
                        "under_odds": float(under.get("price")) if under.get("price") is not None else None,
                        "is_mapped": is_mapped,
                    })
            else:
                for s in sels:
                    nm = str(s.get("name", "")).strip()
                    if not nm.endswith("+"):
                        continue
                    try:
                        line_int = int(re.sub(r"\D", "", nm))
                    except Exception:
                        continue
                    out["props"].append({
                        "bet_type": "ALT_PROPS",
                        "book_category": book_category,
                        "sheet_key": sheet_key,
                        "ui_name": ui_name,
                        "player_name": player_name,
                        "line": float(line_int) - 0.5,
                        "source_display": f"{line_int}+",
                        "over_odds": float(s.get("price")) if s.get("price") is not None else None,
                        "under_odds": None,
                        "is_mapped": is_mapped,
                    })

    return out
