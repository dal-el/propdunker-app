
import re
import json
from pathlib import Path
from typing import Dict, Any, Optional

from utils import slug, iso_from_str, clean_category

_PLUS_RE = re.compile(r"^(?P<n>\d+)\+$")

GROUPCODE_TO_CANON = {
    # main O/U
    "TOTAL_POINTS_OVER_UNDER_PLAYER": "Points",
    "TOTAL_REBOUNDS_OVER_UNDER_PLAYER": "Rebounds",
    "TOTAL_ASSISTS_OVER_UNDER_PLAYER": "Assists",
    "TOTAL_STEALS_OVER_UNDER_PLAYER": "Steals",
    "TOTAL_BLOCKS_OVER_UNDER_PLAYER": "Blocks",

    "PLAYER_TOTAL_POINTS_REBOUNDS_OVER/UNDER": "Points + Rebounds",
    "PLAYER_TOTAL_POINTS_ASSISTS_OVER/UNDER": "Points + Assists",
    "PLAYER_TOTAL_ASSISTS_REBOUNDS_OVER/UNDER": "Rebounds + Assists",
    "PLAYER_UNDEFINED_TOTAL_POINTS_ASSISTS_REBOUNDS": "Points + Rebounds + Ass",
    "PLAYER_TOTAL_STEALS_BLOCKS_OVER/UNDER": "Steals + Blocks",

    "PLAYER_TOTAL_3_POINTERS_OVER/UNDER": "3P Made",
    "PLAYER_TOTAL_THREE_POINT_FIELD_GOALS_OVER/UNDER_INC_OT": "3P Made",
    "PLAYER_UNDEFINED_TOTAL_THREE_POINTERS": "3P Made",
    "PLAYER_UNDEFINED_TOTAL_THREE_POINT_FIELD_GOALS_INC_OT": "3P Made",

    # alt plus
    "PLAYER_UNDEFINED_TOTAL_POINTS": "Points",
    "PLAYER_UNDEFINED_TOTAL_REBOUNDS": "Rebounds",
    "PLAYER_UNDEFINED_TOTAL_ASSISTS": "Assists",
    "PLAYER_UNDEFINED_TOTAL_STEALS": "Steals",
    "PLAYER_UNDEFINED_TOTAL_BLOCKS": "Blocks",
    "PLAYER_UNDEFINED_TOTAL_BLOCKS_STEALS": "Steals + Blocks",
    "PLAYER_UNDEFINED_TOTAL_POINTS_REBOUNDS": "Points + Rebounds",
    "PLAYER_UNDEFINED_TOTAL_POINTS_ASSISTS": "Points + Assists",
    "PLAYER_UNDEFINED_TOTAL_ASSISTS_REBOUNDS": "Rebounds + Assists",
    "PLAYER_UNDEFINED_TOTAL_POINTS_ASSISTS_REBOUNDS": "Points + Rebounds + Ass",

    # yes/no
    "PLAYER_DOUBLE_DOUBLE": "Double Double",
    "PLAYER_TRIPLE_DOUBLE": "Triple Double",
}


def _load_categories_map() -> Dict[str, Any]:
    p = Path(__file__).with_name("categories_map.json")
    with p.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, dict) else {}


def _resolve_category(canon: str, cat_map: Dict[str, Any]):
    canon = clean_category(canon)
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


def _player_from_market_name(name: str) -> str:
    if not name:
        return ""
    s = str(name).strip()
    lines = [x.strip() for x in s.splitlines() if x.strip()]
    if len(lines) > 1:
        return lines[0]
    for sep in (" to Achieve ", " Total "):
        if sep in s:
            return s.split(sep, 1)[0].strip()
    return s


def _line_from_market(market: Dict[str, Any]) -> Optional[float]:
    hv = market.get("handicapValue")
    if isinstance(hv, (int, float)):
        return float(hv)
    for o in market.get("outcomes", []) or []:
        for pr in o.get("prices", []) or []:
            low = pr.get("handicapLow")
            if isinstance(low, str):
                try:
                    return float(low.replace("+", ""))
                except Exception:
                    pass
    return None


def _price_decimal(outcome: Dict[str, Any]) -> Optional[float]:
    prices = outcome.get("prices") or []
    if not prices:
        return None
    dec = prices[0].get("decimal")
    try:
        return float(dec) if dec is not None else None
    except Exception:
        return None


def _is_alt_plus_market(market: Dict[str, Any]) -> bool:
    for o in market.get("outcomes", []) or []:
        if _PLUS_RE.match(str(o.get("name") or "").strip()):
            return True
    return False


def _is_player_market(group_code: str) -> bool:
    return bool(group_code) and (("PLAYER" in group_code) or group_code.endswith("_PLAYER"))


def parse_opap_json(raw: Dict[str, Any]) -> Dict[str, Any]:
    data = raw.get("data") or {}
    events = data.get("events") or []
    if not events:
        raise ValueError("OPAP JSON has no events")
    event = events[0]

    teams = event.get("teams") or []
    home = next((t.get("name") for t in teams if t.get("side") == "HOME"), None) or "HOME"
    away = next((t.get("name") for t in teams if t.get("side") == "AWAY"), None) or "AWAY"

    start_iso = iso_from_str(event.get("startTime") or "")
    date_key = (start_iso or "unknown_date")[:10]
    pre_game_key = f"{date_key}_{slug(home)}_{slug(away)}"

    out: Dict[str, Any] = {
        "bookmaker": "OPAP",
        "pre_game_key": pre_game_key,
        "match_label": f"{home} vs {away}",
        "start_time": start_iso,
        "home_team": home,
        "away_team": away,
        "home_team_id": slug(home),
        "away_team_id": slug(away),
        "props": [],
    }

    cat_map = _load_categories_map()

    for m in (event.get("markets") or []):
        gc = str(m.get("groupCode") or "")
        if not _is_player_market(gc):
            continue

        canon = GROUPCODE_TO_CANON.get(gc)
        if not canon:
            continue

        sheet_key, ui_name, is_mapped = _resolve_category(canon, cat_map)
        player_name = _player_from_market_name(str(m.get("name") or ""))

        # ALT plus
        if _is_alt_plus_market(m):
            for o in (m.get("outcomes") or []):
                oname = str(o.get("name") or "").strip()
                mm = _PLUS_RE.match(oname)
                if not mm:
                    continue
                n = int(mm.group("n"))
                line = float(n) - 0.5
                out["props"].append({
                    "bet_type": "ALT_PROPS",
                    "book_category": ui_name,
                    "sheet_key": sheet_key,
                    "ui_name": ui_name,
                    "player_name": player_name,
                    "line": line,
                    "source_display": oname,
                    "over_odds": _price_decimal(o),
                    "under_odds": None,
                    "is_mapped": is_mapped,
                })
            continue

        # DD/TD (YES only from OPAP)
        if gc in {"PLAYER_DOUBLE_DOUBLE", "PLAYER_TRIPLE_DOUBLE"}:
            outs = m.get("outcomes") or []
            yes_odds = _price_decimal(outs[0]) if outs else None
            out["props"].append({
                "bet_type": "MAIN_PROPS",
                "book_category": ui_name,
                "sheet_key": sheet_key,
                "ui_name": ui_name,
                "player_name": player_name,
                "line": 0.5,
                "source_display": "YES/NO",
                "over_odds": yes_odds,
                "under_odds": None,
                "over_pick": "YES",
                "under_pick": "NO",
                "is_mapped": is_mapped,
            })
            continue

        # MAIN O/U
        outs = m.get("outcomes") or []
        over = next((o for o in outs if str(o.get("name") or "").strip().lower() == "over"), None)
        under = next((o for o in outs if str(o.get("name") or "").strip().lower() == "under"), None)
        if not over or not under:
            continue
        line = _line_from_market(m)
        out["props"].append({
            "bet_type": "MAIN_PROPS",
            "book_category": ui_name,
            "sheet_key": sheet_key,
            "ui_name": ui_name,
            "player_name": player_name,
            "line": line,
            "source_display": None,
            "over_odds": _price_decimal(over),
            "under_odds": _price_decimal(under),
            "is_mapped": is_mapped,
        })

    if not out["props"]:
        raise ValueError("OPAP adapter produced 0 entries (check traversal/mappings)")

    return out
