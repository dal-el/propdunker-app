from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from app.services.json_loader import DataStore, load_player_games
from app.services.value import value_from_prob

# sheet_key -> candidate fields in player_games['games'][i]['final']
SHEET_TO_FIELDS: Dict[str, Tuple[str, ...]] = {
    # basics
    "POINTS": ("POINTS", "PTS"),
    "TR": ("TR", "REB", "REBOUNDS"),
    "AS": ("AS", "AST", "ASSISTS"),
    "ST": ("ST", "STL", "STEALS"),
    "BL": ("BL", "BLK", "BLOCKS"),
    "TO": ("TO", "TOV", "TURNOVERS"),

    # ✅ history.final keys
    "OR": ("OR", "OREB", "OFF_REB", "OFFENSIVE_REBOUNDS"),
    "DR": ("DR", "DREB", "DEF_REB", "DEFENSIVE_REBOUNDS"),

    # shooting
    "2P_M": ("2P_M", "2PM", "FG2M", "2PMade", "FG2_M"),
    "2P_A": ("2P_A", "2PA", "FG2A", "2PAtt", "FG2_A"),
    "3P_M": ("3P_M", "3PM", "FG3M", "3PMade", "FG3_M"),
    "3P_A": ("3P_A", "3PA", "FG3A", "3PAtt", "FG3_A"),
    "FT_M": ("FT_M", "FTM", "FTMade"),
    "FT_A": ("FT_A", "FTA", "FTAtt"),

    # ✅ FIX: FGM uses SH_M in history.final
    "FGM": ("SH_M", "FGM", "FG_M", "FGMade"),
    "SH_M": ("SH_M", "FGM", "FG_M", "FGMade"),

    "SH_AT": ("SH_AT", "FGA", "FG_A", "FGAtt"),

    # fouls
    "F": ("F", "PF", "FOULS"),
    "FD": ("FD", "FOULS_DRAWN", "FOULS_EARNED"),

    # quarter
    "Q1_PTS": ("Q1_PTS", "Q1_POINTS", "Q1PTS"),
    "Q1_TR": ("Q1_TR", "Q1_REB", "Q1REB"),
    "Q1_AS": ("Q1_AS", "Q1_AST", "Q1AST"),
    "Q1_PRA": ("Q1_PRA",),

    # combos / yes-no
    "PR": ("PR",),
    "PA": ("PA",),
    "RA": ("RA",),
    "PRA": ("PRA",),
    "PB": ("PB",),
    "PRB": ("PRB",),
    "SB": ("SB",),
    "DD": ("DD",),
    "TD": ("TD",),
}

ALIASES = {
    "Points": "POINTS",
    "Rebounds": "TR",
    "Assists": "AS",
    "Steals": "ST",
    "Blocks": "BL",
    "Turnovers": "TO",

    # ✅ FIX: human names
    "Offensive Rebounds": "OR",
    "Defensive Rebounds": "DR",
    "Field Goals Made": "FGM",
    "FG Made": "FGM",

    "2P Made": "2P_M",
    "2P Attempted": "2P_A",
    "3P Made": "3P_M",
    "3P Attempted": "3P_A",
    "Free Throws Made": "FT_M",
    "Free Throws Attempted": "FT_A",
    "FG Attempted": "SH_AT",

    "Fouls Committed": "F",
    "Fouls Earned": "FD",

    "Points + Rebounds": "PR",
    "Points + Assists": "PA",
    "Rebounds + Assists": "RA",
    "Points + Rebounds + Ass": "PRA",

    "Q1 Points": "Q1_PTS",
    "Q1 Rebounds": "Q1_TR",
    "Q1 Assists": "Q1_AS",
    "Q1 PRA": "Q1_PRA",

    "Steals + Blocks": "SB",
    "Points + Blocks": "PB",
    "Points + Rebounds + Blocks": "PRB",

    "Double Double": "DD",
    "Triple Double": "TD",
}


def _parse_minutes(game: Dict[str, Any]) -> Optional[float]:
    m = game.get("minutes")
    if isinstance(m, (int, float)):
        return float(m)

    final = game.get("final") or {}
    t = final.get("TIME") or final.get("Q1_TIME")
    if isinstance(t, str) and ":" in t:
        parts = t.split(":")
        try:
            if len(parts) == 3:
                hh, mm, ss = parts
                return int(hh) * 60 + int(mm) + int(ss) / 60
            if len(parts) == 2:
                mm, ss = parts
                return int(mm) + int(ss) / 60
        except Exception:
            return None
    return None


def _get_first_numeric(final: Dict[str, Any], candidates: Tuple[str, ...]) -> Optional[float]:
    for k in candidates:
        v = final.get(k)
        if isinstance(v, (int, float)):
            return float(v)
    return None


def _parse_fraction(v: Any) -> Optional[Tuple[float, float]]:
    if not isinstance(v, str):
        return None
    s = v.strip()
    if "/" in s:
        a, b = s.split("/", 1)
    elif "-" in s:
        a, b = s.split("-", 1)
    else:
        return None
    try:
        return float(a.strip()), float(b.strip())
    except Exception:
        return None


def _get_numeric_or_fraction(final: Dict[str, Any], candidates: Tuple[str, ...], want: str) -> Optional[float]:
    for k in candidates:
        v = final.get(k)
        if isinstance(v, (int, float)):
            return float(v)
        frac = _parse_fraction(v)
        if frac:
            made, att = frac
            return made if want == "made" else att
    return None


def _double_double(final: Dict[str, Any]) -> Optional[float]:
    pts = _get_first_numeric(final, ("POINTS", "PTS"))
    reb = _get_first_numeric(final, ("TR", "REB", "REBOUNDS"))
    ast = _get_first_numeric(final, ("AS", "AST", "ASSISTS"))
    stl = _get_first_numeric(final, ("ST", "STL", "STEALS"))
    blk = _get_first_numeric(final, ("BL", "BLK", "BLOCKS"))
    vals = [v for v in (pts, reb, ast, stl, blk) if v is not None]
    if not vals:
        return None
    return 1.0 if sum(1 for v in vals if v >= 10) >= 2 else 0.0


def _triple_double(final: Dict[str, Any]) -> Optional[float]:
    pts = _get_first_numeric(final, ("POINTS", "PTS"))
    reb = _get_first_numeric(final, ("TR", "REB", "REBOUNDS"))
    ast = _get_first_numeric(final, ("AS", "AST", "ASSISTS"))
    stl = _get_first_numeric(final, ("ST", "STL", "STEALS"))
    blk = _get_first_numeric(final, ("BL", "BLK", "BLOCKS"))
    vals = [v for v in (pts, reb, ast, stl, blk) if v is not None]
    if not vals:
        return None
    return 1.0 if sum(1 for v in vals if v >= 10) >= 3 else 0.0


def _get_stat_value(final: Dict[str, Any], sheet_key: str) -> Optional[float]:
    key = (sheet_key or "").strip()
    key = ALIASES.get(key, key)

    if key == "Q1_PRA":
        q1_pts = _get_first_numeric(final, ("Q1_PTS", "Q1_POINTS", "Q1PTS")) or 0.0
        q1_reb = _get_first_numeric(final, ("Q1_TR", "Q1_REB", "Q1REB")) or 0.0
        q1_ast = _get_first_numeric(final, ("Q1_AS", "Q1_AST", "Q1AST")) or 0.0
        return q1_pts + q1_reb + q1_ast

    if key in ("PR", "PA", "RA", "PRA", "PB", "PRB", "SB"):
        pts = _get_first_numeric(final, ("POINTS", "PTS")) or 0.0
        reb = _get_first_numeric(final, ("TR", "REB", "REBOUNDS")) or 0.0
        ast = _get_first_numeric(final, ("AS", "AST", "ASSISTS")) or 0.0
        stl = _get_first_numeric(final, ("ST", "STL", "STEALS")) or 0.0
        blk = _get_first_numeric(final, ("BL", "BLK", "BLOCKS")) or 0.0
        if key == "PR":
            return pts + reb
        if key == "PA":
            return pts + ast
        if key == "RA":
            return reb + ast
        if key == "PRA":
            return pts + reb + ast
        if key == "PB":
            return pts + blk
        if key == "PRB":
            return pts + reb + blk
        if key == "SB":
            return stl + blk

    if key == "DD":
        return _double_double(final)
    if key == "TD":
        return _triple_double(final)

    candidates = SHEET_TO_FIELDS.get(key)
    if not candidates:
        return None

    if key in ("2P_M", "3P_M", "FT_M", "FGM", "SH_M"):
        return _get_numeric_or_fraction(final, candidates, "made")
    if key in ("2P_A", "3P_A", "FT_A", "SH_AT"):
        return _get_numeric_or_fraction(final, candidates, "att")

    return _get_first_numeric(final, candidates)


@dataclass
class GameRow:
    game_id: str
    league: Optional[str]
    season: Optional[str]
    phase: Optional[str]
    round: Optional[str]
    home_away: Optional[str]
    team: Optional[str]
    opponent: Optional[str]
    minutes: Optional[float]
    stat: float


def evaluate_player_prop(
    player_id: str,
    sheet_key: str,
    line: float,
    bet_type: str,
    odds_over: float,
    odds_under: Optional[float],
    windows: List[int],
    filters: Dict[str, Any],
) -> Dict[str, Any]:
    ds = DataStore.get()
    data = load_player_games(ds.data_dir, player_id)

    field = str(sheet_key or "").strip()
    field = ALIASES.get(field, field)

    min_minutes = float(filters.get("min_minutes", 0) or 0)
    home_away = filters.get("home_away", "all")

    used: List[GameRow] = []
    excluded: List[Dict[str, Any]] = []

    for g in data.get("games", []):
        final = g.get("final") or {}
        stat = _get_stat_value(final, field)
        if stat is None:
            excluded.append({"game_key": g.get("game_id"), "reason": "missing_stat"})
            continue

        mins = _parse_minutes(g)

        # ✅ CRITICAL FIX:
        # If min_minutes == 0, do NOT exclude games with missing minutes.
        # Chart uses history.final only, so feed pills must match that.
        if mins is None:
            if min_minutes <= 0:
                mins = 0.0
            else:
                excluded.append({"game_key": g.get("game_id"), "reason": "missing_minutes"})
                continue

        if mins < min_minutes:
            excluded.append({"game_key": g.get("game_id"), "reason": "minutes < min_minutes"})
            continue

        ha = g.get("home_away")
        if home_away in ("home", "away") and ha != home_away:
            excluded.append({"game_key": g.get("game_id"), "reason": f"home_away != {home_away}"})
            continue

        used.append(
            GameRow(
                game_id=str(g.get("game_id")),
                league=g.get("league"),
                season=g.get("season"),
                phase=g.get("phase"),
                round=g.get("round"),
                home_away=ha,
                team=g.get("team"),
                opponent=g.get("opponent"),
                minutes=mins,
                stat=float(stat),
            )
        )

    # IMPORTANT: keep ordering consistent with /api/player/{player_id}/history.
    # That endpoint returns the last N games based on the JSON order (assumed chronological).
    # To match chart hit-rates 1:1, we treat the *end* of the list as most-recent and reverse here
    # so that used[0] is the most recent.
    used = list(reversed(used))

    hit_rate: Dict[str, Any] = {}
    value: Dict[str, Any] = {}
    games_used_out: List[Dict[str, Any]] = []

    for N in windows:
        slice_rows = used[:N]
        total = len(slice_rows)
        if total == 0:
            hit_rate[str(N)] = {"over": None, "under": None}
            value[str(N)] = {"over": None, "under": None}
            continue

        # ✅ FIX: equality counts as OVER
        over_hits = sum(1 for r in slice_rows if r.stat >= line)
        under_hits = sum(1 for r in slice_rows if r.stat < line)

        over_p = over_hits / total
        under_p = under_hits / total

        if bet_type == "ALT_PROPS":
            hit_rate[str(N)] = {"over": over_p, "under": None}
            value[str(N)] = {"over": value_from_prob(over_p, odds_over), "under": None}
        else:
            hit_rate[str(N)] = {"over": over_p, "under": under_p}
            value[str(N)] = {
                "over": value_from_prob(over_p, odds_over),
                "under": value_from_prob(under_p, odds_under) if odds_under else None,
            }

    maxN = max(windows) if windows else 20
    for r in used[:maxN]:
        games_used_out.append(
            {
                "game_key": r.game_id,
                "league": r.league,
                "season": r.season,
                "phase": r.phase,
                "round": r.round,
                "opponent": r.opponent,
                "team": r.team,
                "home_away": r.home_away,
                "minutes": r.minutes,
                "stat": r.stat,
            }
        )

    return {
        "player_id": player_id,
        "player_name": ds.player_names.get(player_id),
        "sheet_key": sheet_key,
        "line": line,
        "bet_type": bet_type,
        "hit_rate": hit_rate,
        "value": value,
        "games_used": games_used_out,
        "games_excluded": excluded,
    }
