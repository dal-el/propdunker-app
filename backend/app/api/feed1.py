# app/api/feed.py
from __future__ import annotations

import json
import os
from functools import lru_cache

from fastapi import APIRouter, Query, Response

from app.services.evaluator import evaluate_player_prop
from app.services.json_loader import DataStore
from app.utils.canonical import canonical_from_legacy_match_id, canonical_match_key
from app.services.player_positions import resolve_player_position, resolve_player_positions
from app.api.player import player_history

# FastAPI router
router = APIRouter()


# Deterministic mapping from UI/legacy sheet keys to backend evaluator keys (history final fields).
# This is REQUIRED so that OREB/DREB/FG Made hit-rates are computed correctly in feed rows.
SHEET_KEY_ALIASES: dict[str, str] = {
    # Rebounds
    "OFFENSIVE REBOUNDS": "OR",
    "OREB": "OR",
    "DEFENSIVE REBOUNDS": "DR",
    "DREB": "DR",
    # Field goals
    "FGM": "SH_M",
    "FG MADE": "SH_M",
    "FIELD GOALS SCORED / FG MADE": "SH_M",
    # Attempts
    "FGA": "SH_AT",
    "SH_AT": "SH_AT",
}

def normalize_sheet_key(k: str | None) -> str | None:
    if k is None:
        return None
    ks = str(k).strip()
    if not ks:
        return None
    return SHEET_KEY_ALIASES.get(ks.upper(), ks)


def _sanitize_rows(rows):
    fixed = []
    for r in rows:
        if "prop" not in r or not isinstance(r.get("prop"), dict):
            r["prop"] = {}
        if "tier" not in r["prop"] or not r["prop"]["tier"]:
            r["prop"]["tier"] = "MAIN"
        if "label" not in r["prop"]:
            r["prop"]["label"] = "Prop"
        fixed.append(r)
    return fixed


@lru_cache(maxsize=1)
def _load_teams_meta() -> list[dict]:
    """Load METADATA/teams.json from PROPDUNKER data root."""
    ds = DataStore.get()
    fp = os.path.join(ds.data_dir, "METADATA", "teams.json")
    try:
        with open(fp, "r", encoding="utf-8") as f:
            doc = json.load(f)
        teams = doc.get("teams") if isinstance(doc, dict) else None
        return teams if isinstance(teams, list) else []
    except Exception:
        return []


def _norm(s: str) -> str:
    s = (s or "").strip().upper()
    s = s.replace("&", "AND")
    s = "".join(ch for ch in s if ch.isalnum() or ch.isspace())
    return " ".join(s.split())


@lru_cache(maxsize=8192)
def resolve_team_id(team_name: str | None) -> str | None:
    """Best-effort resolve team display name -> team_id (substring + token match)."""
    if not team_name:
        return None
    key = _norm(team_name)
    if not key:
        return None

    best_score = 0
    best_id: str | None = None

    for t in _load_teams_meta():
        if not isinstance(t, dict):
            continue
        tid = t.get("team_id")
        if not isinstance(tid, str) or not tid:
            continue

        cand: list[str] = []
        for k in ("team_id", "name", "short_name", "abbrev", "slug"):
            v = t.get(k)
            if isinstance(v, str) and v.strip():
                cand.append(_norm(v))
        aliases = t.get("aliases")
        if isinstance(aliases, list):
            for a in aliases:
                if isinstance(a, str) and a.strip():
                    cand.append(_norm(a))

        # exact
        if key in cand:
            return tid

        # substring
        for c in cand:
            if not c:
                continue
            if c in key or key in c:
                score = min(len(c), len(key))
                if score > best_score:
                    best_score = score
                    best_id = tid

        # token overlap (handles "BASKONIA VITORIA" vs "BASKONIA")
        key_toks = set(key.split())
        for c in cand:
            toks = set(c.split())
            if not toks:
                continue
            inter = len(key_toks & toks)
            if inter >= 2:
                score = 200 + inter
                if score > best_score:
                    best_score = score
                    best_id = tid

    return best_id


def _logo_path(team_id: str | None) -> str | None:
    if not team_id:
        return None
    # relative path; frontend prefixes with API_BASE via safeLogoUrl()
    return f"/api/logo/{team_id}.png"


@lru_cache(maxsize=4096)
def resolve_team(team_name: str | None) -> dict | None:
    if not team_name:
        return None
    key = _norm(team_name)
    if not key:
        return None

    for t in _load_teams_meta():
        if not isinstance(t, dict):
            continue
        cand = set()
        for k in ("team_id", "name", "short_name", "abbrev", "slug"):
            v = t.get(k)
            if isinstance(v, str) and v.strip():
                cand.add(_norm(v))
        aliases = t.get("aliases")
        if isinstance(aliases, list):
            for a in aliases:
                if isinstance(a, str) and a.strip():
                    cand.add(_norm(a))

        if key in cand:
            logo = t.get("logo")
            logo_url = None
            if isinstance(logo, str):
                lp = logo.replace("\\", "/")
                if "METADATA/assets/" in lp:
                    rel = lp.split("METADATA/assets/", 1)[1]
                    logo_url = "/assets/" + rel
            return {
                "id": t.get("team_id"),
                "name": t.get("name") or team_name,
                "abbrev": t.get("abbrev"),
                "logo": logo_url,
            }

    return None


def _pct(x: float | None) -> float:
    if x is None:
        return 0.0
    return float(x) * 100.0


def _valpct(x: float | None) -> float:
    if x is None:
        return 0.0
    return float(x) * 100.0


def _norm_book(s: str) -> str:
    s = (s or "").strip().upper()
    return "".join(ch for ch in s if ch.isalnum())


def parse_minutes(time_value: any) -> float | None:
    """Parse minutes from TIME field (HH:MM:SS) or other formats."""
    if time_value is None:
        return None
    
    # If already number
    if isinstance(time_value, (int, float)):
        if not isinstance(time_value, (int, float)) or not (isinstance(time_value, (int, float)) and time_value == time_value):  # NaN check
            return None
        # If > 300, probably seconds
        if time_value > 300:
            return time_value / 60
        return float(time_value)
    
    # String parsing
    s = str(time_value).strip()
    if not s:
        return None
    
    # Format HH:MM:SS
    if ":" in s:
        parts = s.split(":")
        try:
            if len(parts) == 3:
                hours = int(parts[0])
                minutes = int(parts[1])
                seconds = int(parts[2])
                return hours * 60 + minutes + seconds / 60
            elif len(parts) == 2:
                minutes = int(parts[0])
                seconds = int(parts[1])
                return minutes + seconds / 60
        except (ValueError, IndexError):
            pass
    
    # Try as plain number
    try:
        num = float(s)
        if num > 300:  # Probably seconds
            return num / 60
        return num
    except ValueError:
        return None


# ========== ΣΥΝΑΡΤΗΣΗ ΓΙΑ JERSEY ==========
def get_player_jersey(player_id: str) -> str | None:
    """Παίρνει το νούμερο από το player history API."""
    try:
        result = player_history(player_id, last_n=1)
        if isinstance(result, dict):
            games = result.get("recent_games", [])
            if games and len(games) > 0:
                final = games[0].get("final", {})
                jersey = final.get("#")
                if jersey is not None:
                    return str(jersey)
    except Exception as e:
        print(f"Error getting jersey for {player_id}: {e}")
    return None
# ==========================================


@router.get("/feed")
def feed(
    response: Response,
    bookmaker: str = Query("all", description="Bookmaker code (e.g. STOIXIMAN) or 'all'"),
    match: str = Query("upcoming", description="'upcoming' | 'all' | <canonical_match>"),
    scope: str = Query("ALL", description="'MAIN' | 'ALT' | 'ALL'"),
    limit: int = Query(10000, ge=1, le=10000),
    player_id: str | None = Query(None, description="Filter by player ID"),  # ✅ ΝΕΑ ΠΑΡΑΜΕΤΡΟΣ
):
    """Return a UI-friendly bet-lines feed.

    Key behaviors:
    - Canonical match identity: filtering is done ONLY with canonical_match.
    - If a specific bookmaker is requested but has no data / no json outputs, return [] (UI shows NO PROPS).
    - No silent fallback to "all bookmakers" when bookmaker is unknown or empty.
    - If player_id is provided, return only rows for that player.
    """

    ds = DataStore.get()

    # --- match selection (canonical) ---
    requested_match_raw = (match or "").strip()
    requested_match_lc = requested_match_raw.lower()

    requested_canonical = ""
    if requested_match_lc and requested_match_lc not in ("all", "upcoming"):
        if "|" in requested_match_lc and requested_match_lc.count("|") == 2:
            requested_canonical = requested_match_lc
        else:
            requested_canonical = canonical_from_legacy_match_id(requested_match_raw)

    applied_match_raw = requested_match_raw
    applied_match = requested_match_lc
    applied_canonical = requested_canonical

    # --- bookmaker selection (STRICT) ---
    available = sorted(ds.bookmaker_outputs.keys())

    want_book = None
    if bookmaker and bookmaker.lower() != "all":
        want_book = _norm_book(bookmaker)

    def resolve_bookmaker_key(want: str) -> str | None:
        if not want:
            return None
        amap = {_norm_book(k): k for k in available}
        if want in amap:
            return amap[want]
        # common aliases
        candidates = [
            want,
            {"OPAP": "PAMESTOIXIMA", "PAMESTOIXIMA": "OPAP"}.get(want, ""),
            want.replace("GR", ""),
            want.replace("EU", ""),
        ]
        for cand in candidates:
            if cand and cand in amap:
                return amap[cand]
        for nk, orig in amap.items():
            if not nk:
                continue
            if want in nk or nk in want:
                return orig
        return None

    resolved = resolve_bookmaker_key(want_book) if want_book else None

    # If user asked for a bookmaker but it doesn't exist -> NO PROPS (empty feed)
    if want_book and not resolved:
        response.headers["X-Requested-Bookmaker"] = bookmaker or ""
        response.headers["X-Applied-Bookmaker"] = ""
        response.headers["X-Bookmaker-Found"] = "0"
        response.headers["X-Requested-Match"] = requested_match_raw or ""
        response.headers["X-Applied-Match"] = (applied_canonical or applied_match_raw or "")
        return []

    # ✅ ΑΝ ο χρήστης ζήτησε "all" bookmakers, χρησιμοποιούμε ΟΛΟΥΣ τους διαθέσιμους
    if bookmaker == "all" or bookmaker.lower() == "all":
        books = available
    else:
        books = [resolved] if resolved else available

    # If user asked for a specific bookmaker but it exists and has no outputs -> NO PROPS
    if resolved:
        game_map = ds.bookmaker_outputs.get(resolved) or {}
        if not game_map:
            response.headers["X-Requested-Bookmaker"] = bookmaker or ""
            response.headers["X-Applied-Bookmaker"] = resolved
            response.headers["X-Bookmaker-Found"] = "1"
            response.headers["X-Bookmaker-Has-Data"] = "0"
            response.headers["X-Requested-Match"] = requested_match_raw or ""
            response.headers["X-Applied-Match"] = (applied_canonical or applied_match_raw or "")
            return []

    # headers for debugging / UI sync
    response.headers["X-Requested-Bookmaker"] = bookmaker or ""
    response.headers["X-Applied-Bookmaker"] = resolved or ""
    response.headers["X-Bookmaker-Found"] = "1" if (not want_book or resolved) else "0"
    response.headers["X-Requested-Match"] = requested_match_raw or ""
    response.headers["X-Applied-Match"] = (applied_canonical or applied_match_raw or "")

    rows = []
    windows = [5, 10, 15, 20]
    default_filters = {"min_minutes": 0, "home_away": "all"}

    for book in books:
        game_map = ds.bookmaker_outputs.get(book, {})
        for game_key in sorted(game_map.keys()):
            fp = game_map[game_key]
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    payload = json.load(f)
            except Exception:
                continue

            game = payload.get("game") or {}

            home_raw = payload.get("home_team") or game.get("home")
            away_raw = payload.get("away_team") or game.get("away")
            start_raw = payload.get("start_time") or game.get("date") or payload.get("date")
            canon_match = canonical_match_key(str(start_raw or ""), str(home_raw or ""), str(away_raw or ""))

            # MATCH FILTER (canonical only)
            if applied_match and applied_match not in ("all", "upcoming"):
                if not applied_canonical:
                    # if we couldn't convert, don't silently fall back to ALL; return empty (NO PROPS)
                    continue
                if canon_match.lower() != applied_canonical:
                    continue

            matchup = f"{home_raw or ''} vs {away_raw or ''}"

            for p in payload.get("props", []):
                if len(rows) >= limit:
                    return _sanitize_rows(rows)

                current_player_id = str(p.get("player_id") or "").strip()
                if not current_player_id:
                    continue

                # ✅ Φίλτρο player_id
                if player_id and current_player_id != player_id:
                    continue

                sheet_key = p.get("sheet_key") or p.get("ui_name") or p.get("bet_type")
                ui_name = p.get("ui_name") or p.get("sheet_key") or "Prop"
                line = p.get("line")
                if line is None:
                    continue

                bet_type_raw = str(p.get("bet_type") or "").upper()
                tier = "ALT" if "ALT" in bet_type_raw else "MAIN"

                if scope in ("MAIN", "ALT") and tier != scope:
                    continue

                odds_over = p.get("over_odds")
                odds_under = p.get("under_odds")
                if odds_over is None:
                    continue

                over_eval = evaluate_player_prop(
                    player_id=current_player_id,
                    sheet_key=str(normalize_sheet_key(p.get("sheet_key") or ui_name) or ui_name),
                    line=float(line),
                    bet_type="ALT_PROPS" if tier == "ALT" else "MAIN_PROPS",
                    odds_over=float(odds_over),
                    odds_under=float(odds_under) if odds_under not in (None, "") else None,
                    windows=windows,
                    filters=default_filters,
                )

                games = []
                for g in (over_eval.get("games_used", []) or [])[-20:]:
                    game_id = g.get("game_id")
                    
                    # Πάρε πληροφορίες από το master games.json
                    master_info = ds.games_master.get(game_id) if hasattr(ds, 'games_master') else None
                    
                    # Πάρε όλους τους παίκτες που αγωνίστηκαν (και από τις δύο ομάδες)
                    all_players = []
                    home_players = []
                    away_players = []
                    team_won = None
                    winner = None
                    
                    if master_info:
                        home_players = master_info.get("home_active_codes", [])
                        away_players = master_info.get("away_active_codes", [])
                        all_players = home_players + away_players
                        
                        # Πάρε το αποτέλεσμα του αγώνα
                        winner = master_info.get("winner")
                        if winner and g.get("team"):
                            team_won = (winner == "home" and g.get("home_away") == "home") or \
                                       (winner == "away" and g.get("home_away") == "away")
                    else:
                        # Fallback σε team_games_index αν δεν υπάρχει master_info
                        team_info = ds.team_games_index.get(game_id) if hasattr(ds, 'team_games_index') else None
                        if team_info:
                            all_players = team_info.get("active_codes", [])
                            # Δεν μπορούμε να ξέρουμε winner από team_info μόνο
                    
                    # Parse minutes από το TIME field
                    minutes = parse_minutes(g.get("final", {}).get("TIME"))
                    
                    games.append({
                        "opp": g.get("opponent") or "?",
                        "ha": (g.get("home_away") or "?").upper()[:1],
                        "stat": float(g.get("stat") or 0),
                        "minutes": minutes,
                        "oppLogo": _logo_path(resolve_team_id(g.get("opponent"))),
                        "game_id": game_id,
                        "all_players": all_players,
                        "home_players": home_players,
                        "away_players": away_players,
                        "team_won": team_won,
                        "winner": winner,
                        "home_score": master_info.get("home_score") if master_info else None,
                        "away_score": master_info.get("away_score") if master_info else None,
                        "home_team": master_info.get("home_team") if master_info else None,
                        "away_team": master_info.get("away_team") if master_info else None,
                        "round": g.get("round"),
                    })

                hit_over = {
                    "L5": _pct(over_eval.get("hit_rate", {}).get("5", {}).get("over")),
                    "L10": _pct(over_eval.get("hit_rate", {}).get("10", {}).get("over")),
                    "L15": _pct(over_eval.get("hit_rate", {}).get("15", {}).get("over")),
                    "L20": _pct(over_eval.get("hit_rate", {}).get("20", {}).get("over")),
                }
                val_over = {
                    "vL5": _valpct(over_eval.get("value", {}).get("5", {}).get("over")),
                    "vL10": _valpct(over_eval.get("value", {}).get("10", {}).get("over")),
                    "vL15": _valpct(over_eval.get("value", {}).get("15", {}).get("over")),
                    "vL20": _valpct(over_eval.get("value", {}).get("20", {}).get("over")),
                }

                player_name = over_eval.get("player_name") or p.get("player_name") or current_player_id
                team_hint = ((over_eval.get("games_used") or [{}])[0].get("team")) or (p.get("team") if isinstance(p, dict) else None)
                pos_list = resolve_player_positions(current_player_id, team_hint, player_name)
                pos = pos_list[0] if pos_list else None
                
                # ✅ ΠΑΙΡΝΟΥΜΕ ΤΟ ΝΟΥΜΕΡΟ ΑΠΟ ΤΟ PLAYER HISTORY
                jersey_number = get_player_jersey(current_player_id)

                rows.append(
                    {
                        "id": f"{book}-{game_key}-{current_player_id}-{sheet_key}-{line}-{odds_over}-OVER",
                        "player": {
                            "player_id": current_player_id,
                            "name": player_name,
                            "jersey": jersey_number,
                            "positions": pos_list or None,
                            "position": pos,
                            "pos": pos,
                        },
                        "team": resolve_team((over_eval.get("games_used") or [{}])[0].get("team")) or None,
                        "prop": {"label": ui_name, "tier": tier, "sheet_key": normalize_sheet_key(p.get("sheet_key") or ui_name) or (p.get("sheet_key") or ui_name), "bet_type": bet_type_raw},
                        "side": "OVER",
                        "line": float(line),
                        "odds": float(odds_over),
                        "hit": hit_over,
                        "value": val_over,
                        "bookmaker": book,
                        "match": canon_match or "upcoming",
                        "canonical_match": canon_match,
                        "games": games,
                        "game_key": game_key,
                        "matchup": matchup,
                    }
                )

                if tier == "MAIN" and odds_under not in (None, ""):
                    hit_under = {
                        "L5": _pct(over_eval.get("hit_rate", {}).get("5", {}).get("under")),
                        "L10": _pct(over_eval.get("hit_rate", {}).get("10", {}).get("under")),
                        "L15": _pct(over_eval.get("hit_rate", {}).get("15", {}).get("under")),
                        "L20": _pct(over_eval.get("hit_rate", {}).get("20", {}).get("under")),
                    }
                    val_under = {
                        "vL5": _valpct(over_eval.get("value", {}).get("5", {}).get("under")),
                        "vL10": _valpct(over_eval.get("value", {}).get("10", {}).get("under")),
                        "vL15": _valpct(over_eval.get("value", {}).get("15", {}).get("under")),
                        "vL20": _valpct(over_eval.get("value", {}).get("20", {}).get("under")),
                    }
                    rows.append(
                        {
                            "id": f"{book}-{game_key}-{current_player_id}-{sheet_key}-{line}-{odds_under}-UNDER",
                            "player": {
                                "player_id": current_player_id,
                                "name": player_name,
                                "jersey": jersey_number,
                                "positions": pos_list or None,
                                "position": pos,
                                "pos": pos,
                            },
                            "team": resolve_team((over_eval.get("games_used") or [{}])[0].get("team")) or None,
                            "prop": {"label": ui_name, "tier": tier, "sheet_key": normalize_sheet_key(p.get("sheet_key") or ui_name) or (p.get("sheet_key") or ui_name), "bet_type": bet_type_raw},
                            "side": "UNDER",
                            "line": float(line),
                            "odds": float(odds_under),
                            "hit": hit_under,
                            "value": val_under,
                            "bookmaker": book,
                            "match": canon_match or "upcoming",
                            "canonical_match": canon_match,
                            "games": games,
                            "game_key": game_key,
                            "matchup": matchup,
                        }
                    )

    return _sanitize_rows(rows)