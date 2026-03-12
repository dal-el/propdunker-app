
import re
import json
from pathlib import Path
from typing import Dict, Any, Tuple, Optional

from utils import slug, clean_category, iso_from_str

"""NOVIBET adapter

Rules:
- No silent dropping: parse everything available.
- ui_name + sheet_key must come ONLY from categories_map.json.
- book_category must reflect bookmaker naming; for 1Q we store "1Q ...".
- Bet types:
    MAIN_PROPS: over+under
    ALT_PROPS : over only (including X+ style)
- YES/NO markets (DD/TD): over_pick YES, under_pick NO
"""

_ALT_PLUS_RE = re.compile(r"^(?P<n>\d+)\+$", re.I)

# Novibet displayCaption -> canonical key (keys must match categories_map.json)
NOVI_TO_CANON = {
    # basics
    "Points": "Points",
    "Rebounds": "Rebounds",
    "Assists": "Assists",
    "Steals": "Steals",
    "Blocks": "Blocks",
    "Turnovers": "Turnovers",
    "Defensive Rebounds": "Defensive Rebounds",
    "Offensive Rebounds": "Offensive Rebounds",
    "Fouls": "Fouls Committed",
    "Fouls Earned": "Fouls Earned",
    "Shots Rejected": "Shots Rejected",

    # combos
    "Points & Rebounds & Assists": "Points + Rebounds + Ass",
    "Points & Rebounds": "Points + Rebounds",
    "Points & Assists": "Points + Assists",
    "Rebounds & Assists": "Rebounds + Assists",
    "Rebounds &  Assists": "Rebounds + Assists",
    "Steals & Blocks": "Steals + Blocks",

    # dd/td
    "Double-Double": "Double Double",
    "Triple Double": "Triple Double",
    "Triple-Double": "Triple Double",

    # shooting
    "2P Made": "2P Made",
    "2P Attempted": "2P Attempted",
    "3P Made": "3P Made",
    "3P Attempted": "3P Attempted",
    "Free Throws Scored": "Free Throws Made",
    "Free Throws Attempted": "Free Throws Attempted",
    "FG Attempted": "FG Attempted",
    "FG Made": "FG Made",
}

_Q1_SYSNAME_TO_CANON = {
    "BASKETBALL_PLAYER_OVERUNDER_POINTS1ST_QUARTER_": "Q1 Points",
    "BASKETBALL_PLAYER_OVERUNDER_REBOUNDS_1ST_QUARTER_": "Q1 Rebounds",
    "BASKETBALL_PLAYER_OVERUNDER_ASSISTS_1ST_QUARTER_": "Q1 Assists",
}


def _strip_rocket(s: str) -> str:
    return re.sub(r"\s*🚀\s*", "", (s or "")).strip()


def _parse_line(caption: str) -> Tuple[Optional[float], Optional[str], str]:
    c = (caption or "").strip()
    m = _ALT_PLUS_RE.match(c)
    if m:
        n = int(m.group("n"))
        return float(n) - 0.5, c, "ALT_PLUS"
    try:
        return float(c), c, "DECIMAL"
    except Exception:
        return None, None, "UNKNOWN"


def _is_yes_no_market(market_sysname: str, display_caption: str) -> bool:
    if market_sysname in {
        "BASKETBALL_PLAYER_TO_ACHIEVE_A_DOUBLEDOUBLE",
        "BASKETBALL_PLAYER_TO_ACHIEVE_TRIPLEDOUBLE",
    }:
        return True
    dc = (display_caption or "").lower()
    return "double" in dc or "triple" in dc


def _load_categories_map() -> Dict[str, Any]:
    p = Path(__file__).with_name("categories_map.json")
    with p.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, dict) else {}


def _resolve_category(canon: str, cat_map: Dict[str, Any]) -> Tuple[str, str, bool]:
    if canon in cat_map and isinstance(cat_map[canon], dict):
        rec = cat_map[canon]
        return str(rec.get("sheet_key") or canon), str(rec.get("ui_name") or canon), True

    # search aliases
    for key, rec in cat_map.items():
        if not isinstance(rec, dict):
            continue
        for a in (rec.get("aliases") or []):
            if str(a) == canon:
                return str(rec.get("sheet_key") or key), str(rec.get("ui_name") or key), True

    return canon, canon, False


def parse_novibet_json(raw: Dict[str, Any]) -> Dict[str, Any]:
    competitors = raw.get("competitors") or {}
    home = (competitors.get("homeTeam") or {}).get("teamCaption") or "UNKNOWN_HOME"
    away = (competitors.get("awayTeam") or {}).get("teamCaption") or "UNKNOWN_AWAY"
    start_utc = raw.get("startTimeUTC") or raw.get("startTime") or ""
    date_iso = iso_from_str(start_utc) or ""

    # Build keys like STOIXIMAN: YYYY-MM-DD + slug(home) + slug(away)
    # We ONLY normalize for key/ids/label fields; we keep raw team names in `game`.
    date_key = date_iso[:10] if date_iso else "unknown_date"
    home_clean = (home or "").strip()
    away_clean = (away or "").strip()

    # Key-only normalization for common bookmaker variants
    # (do NOT mutate the raw `game` object)
    away_for_key = away_clean
    # Baskonia variants
    if away_for_key.lower() in {"baskonia vitoria", "baskonia vitoria-gasteiz", "baskonia vitoria gasteiz"}:
        away_for_key = "Baskonia"
    # Tel-Aviv variants
    away_for_key = away_for_key.replace("Tel-Aviv", "Tel Aviv")
    home_for_key = home_clean.replace("Tel-Aviv", "Tel Aviv")

    home_id = slug(home_for_key)
    away_id = slug(away_for_key)

    pre_game_key = f"{date_key}_{home_id}_{away_id}"

    # ISO like STOIXIMAN (Z suffix)
    start_time = date_iso.replace("+00:00", "Z") if date_iso else None

    out: Dict[str, Any] = {
        "bookmaker": "NOVIBET",
        "pre_game_key": pre_game_key,
        "match_label": f"{home_clean} vs {away_for_key}",
        "start_time": start_time,
        "home_team": home_clean,
        "away_team": away_for_key,
        "home_team_id": home_id,
        "away_team_id": away_id,
        "game": {"home": home, "away": away, "date": date_iso},
        "props": [],
        "unmapped_categories": [],
    }

    market_categories = raw.get("marketCategories") or []
    if not market_categories:
        raise ValueError("NOVIBET: No marketCategories in input RAW")

    cat_map = _load_categories_map()
    unmapped = set()

    # build code->player index for DD/TD markets
    code_to_player: Dict[str, str] = {}
    for mc in market_categories:
        for item in (mc.get("items") or []):
            for bv in (item.get("betViews") or []):
                cap = (bv.get("caption") or "").strip()
                if not cap:
                    continue
                player_guess = ""
                if cap.lower().startswith("1st quarter - "):
                    tmp = cap.split(" - ", 1)[1].strip()
                    player_guess = tmp.rsplit(" ", 1)[0].strip() if " " in tmp else tmp
                elif " - " in cap:
                    player_guess = cap.split(" - ", 1)[0].strip()
                if not player_guess:
                    continue
                for bi in (bv.get("betItems") or []):
                    code = str(bi.get("code") or "").strip()
                    if code:
                        code_to_player.setdefault(code, player_guess)

    for mc in market_categories:
        mc_sys = mc.get("sysname") or ""
        is_alt_tab = (mc_sys == "ALTERNATIVE_PLAYER_PROPS")

        for item in (mc.get("items") or []):
            for bv in (item.get("betViews") or []):
                disp_raw = _strip_rocket(bv.get("displayCaption") or "")
                if not disp_raw:
                    continue

                market_sysname = (bv.get("marketSysname") or "").strip()

                canon = NOVI_TO_CANON.get(disp_raw, disp_raw)
                canon = clean_category(canon)

                # Q1 override
                for pref, q1canon in _Q1_SYSNAME_TO_CANON.items():
                    if market_sysname.startswith(pref):
                        canon = q1canon
                        break

                sheet_key, ui_name, is_mapped = _resolve_category(canon, cat_map)
                if not is_mapped:
                    unmapped.add(canon)

                # book_category: keep bookmaker naming. For Q1 we store "1Q ..."
                book_category = disp_raw
                if canon.startswith("Q1 "):
                    book_category = canon.replace("Q1 ", "1Q ", 1)

                # player
                cap = (bv.get("caption") or "").strip()
                player_name = ""
                if cap.lower().startswith("1st quarter - "):
                    tmp = cap.split(" - ", 1)[1].strip()
                    player_name = tmp.rsplit(" ", 1)[0].strip() if " " in tmp else tmp
                elif " - " in cap:
                    player_name = cap.split(" - ", 1)[0].strip()
                else:
                    bet_items0 = bv.get("betItems") or []
                    if bet_items0:
                        code = str(bet_items0[0].get("code") or "").strip()
                        player_name = code_to_player.get(code, "UNKNOWN_PLAYER")

                bet_items = bv.get("betItems") or []
                if not bet_items:
                    continue

                # YES/NO
                if _is_yes_no_market(market_sysname, disp_raw):
                    yes_price = None
                    no_price = None
                    for bi in bet_items:
                        if not bi.get("isAvailable", True):
                            continue
                        bd = (bi.get("betDisplayCaption") or "").strip().lower()
                        if bd in {"yes", "y"}:
                            yes_price = float(bi.get("price"))
                        elif bd in {"no", "n", "νο"}:
                            no_price = float(bi.get("price"))
                    if yes_price is not None and no_price is not None:
                        out["props"].append({
                            "bet_type": "MAIN_PROPS",
                            "book_category": book_category,
                            "sheet_key": sheet_key,
                            "ui_name": ui_name,
                            "player_name": player_name,
                            "line": 0.5,
                            "source_display": "YES/NO",
                            "over_odds": yes_price,
                            "under_odds": no_price,
                            "over_pick": "YES",
                            "under_pick": "NO",
                            "is_mapped": is_mapped,
                        })
                    continue

                # ALT tab (over only)
                if is_alt_tab:
                    bi_av = next((x for x in bet_items if x.get("isAvailable", True)), None)
                    if bi_av is None:
                        continue
                    line, source_display, _ = _parse_line(bi_av.get("caption") or "")
                    if line is None:
                        continue
                    out["props"].append({
                        "bet_type": "ALT_PROPS",
                        "book_category": book_category,
                        "sheet_key": sheet_key,
                        "ui_name": ui_name,
                        "player_name": player_name,
                        "line": float(line),
                        "source_display": source_display,
                        "over_odds": float(bi_av.get("price")),
                        "under_odds": None,
                        "is_mapped": is_mapped,
                    })
                    continue

                # MAIN tab: O/U or decimal-over-only
                over = None
                under = None
                line = None
                source_display = None
                kind = "UNKNOWN"

                for bi in bet_items:
                    if not bi.get("isAvailable", True):
                        continue
                    bd = (bi.get("betDisplayCaption") or "").strip().lower()
                    l, sd, k = _parse_line(bi.get("caption") or "")
                    if l is None:
                        continue
                    line = l
                    source_display = sd if k == "ALT_PLUS" else None
                    kind = k
                    if bd.startswith("over") or bd == "o":
                        over = float(bi.get("price"))
                    elif bd.startswith("under") or bd == "u":
                        under = float(bi.get("price"))

                if line is None or over is None:
                    continue

                if under is None:
                    out["props"].append({
                        "bet_type": "ALT_PROPS",
                        "book_category": book_category,
                        "sheet_key": sheet_key,
                        "ui_name": ui_name,
                        "player_name": player_name,
                        "line": float(line),
                        "source_display": source_display if kind == "ALT_PLUS" else str(line),
                        "over_odds": over,
                        "under_odds": None,
                        "is_mapped": is_mapped,
                    })
                else:
                    out["props"].append({
                        "bet_type": "MAIN_PROPS",
                        "book_category": book_category,
                        "sheet_key": sheet_key,
                        "ui_name": ui_name,
                        "player_name": player_name,
                        "line": float(line),
                        "source_display": None,
                        "over_odds": over,
                        "under_odds": under,
                        "is_mapped": is_mapped,
                    })

    # dedup (keep first)
    seen = set()
    deduped = []
    for p in out["props"]:
        key = (
            p.get("bet_type"),
            p.get("book_category"),
            p.get("sheet_key"),
            p.get("player_name"),
            p.get("line"),
            p.get("over_odds"),
            p.get("under_odds"),
            p.get("over_pick"),
            p.get("under_pick"),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(p)
    out["props"] = deduped

    out["unmapped_categories"] = sorted({p.get("ui_name") for p in out["props"] if not p.get("is_mapped")})

    if len(out["props"]) == 0:
        raise ValueError("NOVIBET: 0 props parsed (refuse to write empty output)")

    return out
