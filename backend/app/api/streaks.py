# app/api/streaks.py
from fastapi import APIRouter, Query
from typing import List, Dict, Any, Optional, Set, Tuple
from app.services.json_loader import DataStore
from app.api.player import player_history
from app.services.player_positions import resolve_player_positions  # <-- ΠΡΟΣΘΗΚΗ
import json
import time
import re
import copy

router = APIRouter()

# Cache για τα streaks
_streaks_cache = {
    "data": None,
    "timestamp": 0
}
CACHE_TTL = 3600  # 1 ώρα

# Σύνολο διαθέσιμων props (κανονικοποιημένα)
_available_props: Set[Tuple[str, str, str, float]] = set()
_available_props_loaded = False

# Κατηγορίες προς εξαίρεση (π.χ. Players Played Time, Double Double, Triple Double)
EXCLUDED_CATEGORIES = {
    "PLAYERS PLAYED TIME", "PLAYERS PLAYED", "PLAYED TIME", "TIME PLAYED",
    "DD", "DOUBLEDOUBLE", "DOUBLE DOUBLE",
    "TD", "TRIPLEDOUBLE", "TRIPLE DOUBLE"
}

def normalize_category(cat: str) -> str:
    """Κανονικοποιεί ονόματα κατηγοριών ώστε να είναι συγκρίσιμα."""
    if not cat:
        return cat
    cat = cat.upper().strip()
    cat = re.sub(r'[^A-Z0-9]', '', cat)
    replacements = {
        "3PM": "3PM", "3P": "3PM", "3P_M": "3PM", "3PMADE": "3PM",
        "2PM": "2PM", "2P": "2PM", "2P_M": "2PM", "2PMADE": "2PM",
        "FTM": "FTM", "FT": "FTM", "FT_M": "FTM", "FTMADE": "FTM",
        "FTA": "FTA", "3PA": "3PA", "2PA": "2PA",
        "OREB": "OREB", "DREB": "DREB", "REB": "REB",
        "AST": "AST", "STL": "STL", "BLK": "BLK", "TOV": "TOV",
        "PTS": "PTS", "POINTS": "PTS",
    }
    return replacements.get(cat, cat)

def normalize_line(line: float) -> float:
    return round(line, 2)

def load_available_props():
    """Φορτώνει όλα τα διαθέσιμα props από όλους τους bookmakers, αποθηκεύοντας ξεχωριστά OVER και UNDER."""
    global _available_props, _available_props_loaded
    if _available_props_loaded:
        return

    print("🔄 Loading available props...")
    ds = DataStore.get()
    props_set = set()
    total_props = 0
    props_with_odds = 0
    sample_printed = False

    for bookmaker, game_map in ds.bookmaker_outputs.items():
        for filepath in game_map.values():
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                for prop in data.get("props", []):
                    total_props += 1
                    if not sample_printed:
                        print("🔍 SAMPLE PROP FIELDS:")
                        for k, v in prop.items():
                            print(f"    {k}: {v}")
                        sample_printed = True

                    player_id = prop.get("player_id")
                    if not player_id:
                        continue
                    raw_cat = prop.get("sheet_key") or prop.get("ui_name") or ""
                    category = normalize_category(raw_cat)
                    if not category:
                        continue
                    # Έλεγχος εξαίρεσης κατηγορίας
                    if raw_cat.upper().strip() in EXCLUDED_CATEGORIES:
                        continue
                    try:
                        line = normalize_line(float(prop.get("line", 0)))
                    except:
                        continue
                    if line <= 0:
                        continue

                    # OVER side
                    over_odds = prop.get("over_odds")
                    if over_odds is not None:
                        try:
                            if float(over_odds) > 0:
                                props_set.add((str(player_id).strip(), category, "OVER", line))
                                props_with_odds += 1
                        except:
                            pass

                    # UNDER side
                    under_odds = prop.get("under_odds")
                    if under_odds is not None:
                        try:
                            if float(under_odds) > 0:
                                props_set.add((str(player_id).strip(), category, "UNDER", line))
                                props_with_odds += 1
                        except:
                            pass

            except Exception as e:
                print(f"Error loading props from {filepath}: {e}")
                continue

    _available_props = props_set
    _available_props_loaded = True
    print(f"📊 Total props scanned: {total_props}")
    print(f"📊 Props with odds >0 (counting both sides): {props_with_odds}")
    print(f"✅ Unique (player,cat,side,line) after normalization: {len(_available_props)}")
    if props_with_odds == 0:
        print("❌ No props with valid odds found. Check the sample prop above.")

def is_prop_available(player_id: str, category: str, side: str, line: float, tolerance: float = 0.05) -> bool:
    norm_cat = normalize_category(category)
    norm_line = normalize_line(line)
    if (player_id, norm_cat, side, norm_line) in _available_props:
        return True
    for (pid, cat, s, l) in _available_props:
        if pid == player_id and cat == norm_cat and s == side and abs(l - norm_line) <= tolerance:
            return True
    return False

def get_all_player_ids() -> List[str]:
    print("🔍 Searching for player_ids...")
    ds = DataStore.get()
    player_ids = set()
    for bookmaker, game_map in ds.bookmaker_outputs.items():
        for filepath in game_map.values():
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                for prop in data.get("props", []):
                    pid = prop.get("player_id")
                    if pid:
                        player_ids.add(str(pid).strip())
            except Exception:
                continue
    print(f"✅ Total unique player_ids found: {len(player_ids)}")
    return list(player_ids)

def get_all_props_for_player(player_id: str) -> List[Dict]:
    """Επιστρέφει όλα τα props για έναν παίκτη από όλους τους bookmakers, προσθέτοντας το πεδίο bookmaker."""
    ds = DataStore.get()
    props = []
    for bookmaker, game_map in ds.bookmaker_outputs.items():
        for filepath in game_map.values():
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                for prop in data.get("props", []):
                    if prop.get("player_id") == player_id:
                        # Δημιουργούμε αντίγραφο για να μην τροποποιήσουμε το αρχικό
                        prop_copy = copy.deepcopy(prop)
                        prop_copy["bookmaker"] = bookmaker
                        props.append(prop_copy)
            except Exception:
                continue
    return props

def get_stat_value(game: Dict, prop_key: str) -> float:
    """Επιστρέφει την τιμή του στατιστικού από το game για το συγκεκριμένο prop_key, με υπολογισμό για σύνθετα."""
    final = game.get("final", {})
    if not final:
        return 0.0

    key_upper = prop_key.upper().strip()

    # Ειδικές περιπτώσεις (π.χ. PRA, PR, κλπ)
    if key_upper == "PRA":
        pts = float(final.get("POINTS", 0)) or float(final.get("PTS", 0))
        reb = float(final.get("TR", 0)) or float(final.get("REB", 0)) or float(final.get("REBOUNDS", 0))
        ast = float(final.get("AS", 0)) or float(final.get("AST", 0)) or float(final.get("ASSISTS", 0))
        return pts + reb + ast

    if key_upper == "PR":
        pts = float(final.get("POINTS", 0)) or float(final.get("PTS", 0))
        reb = float(final.get("TR", 0)) or float(final.get("REB", 0)) or float(final.get("REBOUNDS", 0))
        return pts + reb

    if key_upper == "PA":
        pts = float(final.get("POINTS", 0)) or float(final.get("PTS", 0))
        ast = float(final.get("AS", 0)) or float(final.get("AST", 0)) or float(final.get("ASSISTS", 0))
        return pts + ast

    if key_upper == "RA":
        reb = float(final.get("TR", 0)) or float(final.get("REB", 0)) or float(final.get("REBOUNDS", 0))
        ast = float(final.get("AS", 0)) or float(final.get("AST", 0)) or float(final.get("ASSISTS", 0))
        return reb + ast

    if key_upper == "PB":
        pts = float(final.get("POINTS", 0)) or float(final.get("PTS", 0))
        blk = float(final.get("BL", 0)) or float(final.get("BLK", 0)) or float(final.get("BLOCKS", 0))
        return pts + blk

    if key_upper == "PRB":
        pts = float(final.get("POINTS", 0)) or float(final.get("PTS", 0))
        reb = float(final.get("TR", 0)) or float(final.get("REB", 0)) or float(final.get("REBOUNDS", 0))
        blk = float(final.get("BL", 0)) or float(final.get("BLK", 0)) or float(final.get("BLOCKS", 0))
        return pts + reb + blk

    if key_upper == "SB":
        stl = float(final.get("ST", 0)) or float(final.get("STL", 0)) or float(final.get("STEALS", 0))
        blk = float(final.get("BL", 0)) or float(final.get("BLK", 0)) or float(final.get("BLOCKS", 0))
        return stl + blk

    # Αντιστοίχηση για απλά πεδία
    mapping = {
        "POINTS": "POINTS", "2P_M": "2P_M", "3P_M": "3P_M", "FT_M": "FT_M",
        "AS": "AS", "TR": "TR", "ST": "ST", "TO": "TO", "BL": "BL", "FD": "FD",
        "SH_M": "SH_M", "SH_AT": "SH_AT",
        "OR": "OR", "OREB": "OR", "OFFENSIVE REBOUNDS": "OR",
        "DR": "DR", "DREB": "DR", "DEFENSIVE REBOUNDS": "DR",
        "FGM": "SH_M", "FGA": "SH_AT",
    }
    field = mapping.get(key_upper, prop_key)  # χρήση prop_key αν δεν υπάρχει
    if field in final:
        try:
            return float(final[field])
        except:
            return 0.0
    return 0.0

def calculate_streaks_for_player(player_id: str, player_name: str, last_n: int = 30) -> List[Dict]:
    print(f"\n🧮 Calculating streaks for {player_name} (ID: {player_id}) with last_n={last_n}")
    history = player_history(player_id, last_n=last_n)
    games = history.get("recent_games", [])
    print(f"  Games retrieved: {len(games)}")

    all_props = get_all_props_for_player(player_id)
    if not all_props:
        print("  ⚠️ No props – skipping")
        return []

    # Δημιουργία expanded_props: για κάθε prop, προσθέτουμε το OVER (αν έχει over_odds) και το UNDER (αν έχει under_odds)
    expanded_props = []
    for prop in all_props:
        try:
            line = float(prop.get("line", 0))
        except:
            continue
        if line <= 0:
            continue

        prop_key = prop.get("sheet_key") or prop.get("ui_name") or "UNKNOWN"
        # Έλεγχος εξαίρεσης κατηγορίας
        if prop_key.upper().strip() in EXCLUDED_CATEGORIES:
            continue

        # Προσδιορισμός tier
        tier_from_prop = prop.get("tier")
        bet_type = prop.get("bet_type", "")
        if tier_from_prop:
            tier = tier_from_prop
        else:
            tier = "ALT" if "ALT" in str(bet_type).upper() else "MAIN"

        # OVER side
        over_odds = prop.get("over_odds")
        if over_odds is not None:
            try:
                over_odds = float(over_odds)
                if over_odds > 0:
                    over_prop = copy.deepcopy(prop)
                    over_prop["side"] = "OVER"
                    over_prop["odds"] = over_odds
                    over_prop["tier"] = tier
                    expanded_props.append(over_prop)
            except:
                pass

        # UNDER side
        under_odds = prop.get("under_odds")
        if under_odds is not None:
            try:
                under_odds = float(under_odds)
                if under_odds > 0:
                    under_prop = copy.deepcopy(prop)
                    under_prop["side"] = "UNDER"
                    under_prop["odds"] = under_odds
                    under_prop["tier"] = tier
                    expanded_props.append(under_prop)
            except:
                pass

    print(f"    Expanded props count: {len(expanded_props)} (from {len(all_props)} original)")

    # Ομαδοποίηση ανά μοναδικό (player_id, κατηγορία, side, line)
    unique_props = {}
    for prop in expanded_props:
        side = prop.get("side", "OVER")
        line = float(prop.get("line", 0))
        prop_key = prop.get("sheet_key") or prop.get("ui_name") or "UNKNOWN"
        key = (player_id, prop_key, side, line)
        odds = prop.get("odds", 0.0)
        tier = prop.get("tier", "MAIN")

        if key not in unique_props:
            unique_props[key] = (prop, tier, side, odds)
        else:
            existing_prop, existing_tier, _, existing_odds = unique_props[key]
            # Προτίμηση MAIN έναντι ALT
            if existing_tier == "ALT" and tier == "MAIN":
                unique_props[key] = (prop, tier, side, odds)
            elif existing_tier == tier:
                if odds > existing_odds:
                    unique_props[key] = (prop, tier, side, odds)

    over_count = sum(1 for key in unique_props if key[2] == "OVER")
    under_count = sum(1 for key in unique_props if key[2] == "UNDER")
    print(f"    Unique props after dedup: {len(unique_props)} (OVER: {over_count}, UNDER: {under_count})")

    if not unique_props:
        print("    No props – skipping player")
        return []

    streaks = []

    for (pid, prop_key, side, line), (prop, tier, _, odds) in unique_props.items():
        # Έλεγχος διαθεσιμότητας (τώρα το σύνολο έχει και OVER και UNDER)
        if not is_prop_available(pid, prop_key, side, line):
            print(f"    ❌ Prop {prop_key} {side} {line} NOT in available set – skipping")
            continue
        else:
            print(f"    ✅ Prop {prop_key} {side} {line} IS available (odds={odds})")

        # Ομαδοποίηση κατηγοριών
        categories = {
            "overall": games,
            "home": [g for g in games if str(g.get("home_away", "")).lower() == "home"],
            "away": [g for g in games if str(g.get("home_away", "")).lower() == "away"],
            "win": [g for g in games if g.get("team_won") is True],
            "loss": [g for g in games if g.get("team_won") is False],
        }

        for cat_name, cat_games in categories.items():
            if len(cat_games) < 5:
                continue

            hits = 0
            games_with_stat = []
            for g in cat_games:
                stat = get_stat_value(g, prop_key)
                games_with_stat.append({
                    "stat": stat,
                    "opp": g.get("opponent", "?"),
                    "ha": g.get("home_away", "?")
                })
                if (side == "OVER" and stat > line) or (side == "UNDER" and stat < line):
                    hits += 1

            hit_rate = (hits / len(cat_games)) * 100
            if hit_rate >= 70:
                team = cat_games[0].get("team", "?") if cat_games else "?"
                
                # Υπολογισμός θέσης παίκτη (όπως στο BetRow)
                pos_list = resolve_player_positions(player_id, team, player_name)
                position = pos_list[0] if pos_list else None

                streaks.append({
                    "player_id": pid,
                    "player_name": player_name,
                    "player_team": team,
                    "player_position": position,  # <-- ΠΡΟΣΘΗΚΗ
                    "prop_key": prop_key,
                    "side": side,
                    "line": line,
                    "odds": odds,
                    "bookmaker": prop.get("bookmaker", ""),
                    "category": cat_name,
                    "tier": tier,
                    "hits": hits,
                    "total": len(cat_games),
                    "hit_rate": round(hit_rate, 1),
                    "games": games_with_stat
                })

    print(f"    Streaks found for player: {len(streaks)} (OVER: {sum(1 for s in streaks if s['side']=='OVER')}, UNDER: {sum(1 for s in streaks if s['side']=='UNDER')})")
    return streaks

def compute_all_streaks() -> List[Dict]:
    load_available_props()
    print("🔄 Computing all streaks from scratch (this may take a while)...")
    all_streaks = []
    player_ids = get_all_player_ids()
    total_players = len(player_ids)
    players_with_streaks = 0
    for idx, pid in enumerate(player_ids, 1):
        print(f"  Processing player {idx}/{total_players}...")
        player_name = pid
        props = get_all_props_for_player(pid)
        if props:
            for p in props:
                if p.get("player_name"):
                    player_name = p["player_name"]
                    break
        streaks = calculate_streaks_for_player(pid, player_name, last_n=30)
        if streaks:
            players_with_streaks += 1
        all_streaks.extend(streaks)

    print(f"\n📊 FINAL REPORT:")
    print(f"   Total players processed: {total_players}")
    print(f"   Players with at least one streak: {players_with_streaks}")
    total_over = sum(1 for s in all_streaks if s['side'] == 'OVER')
    total_under = sum(1 for s in all_streaks if s['side'] == 'UNDER')
    print(f"   Total streaks computed: {len(all_streaks)} (OVER: {total_over}, UNDER: {total_under})")
    return all_streaks

@router.get("/streaks")
async def get_streaks(
    force_refresh: bool = False,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=5000),
    tier: Optional[str] = Query(None, regex="^(MAIN|ALT)?$")
) -> Dict[str, Any]:
    global _streaks_cache
    now = time.time()

    if force_refresh or not _streaks_cache["data"] or (now - _streaks_cache["timestamp"] > CACHE_TTL):
        _streaks_cache["data"] = compute_all_streaks()
        _streaks_cache["timestamp"] = now

    all_streaks = _streaks_cache["data"]

    if tier:
        filtered = [s for s in all_streaks if s.get("tier") == tier]
    else:
        filtered = all_streaks

    total = len(filtered)
    paginated = filtered[skip:skip+limit]

    return {
        "total": total,
        "streaks": paginated
    }