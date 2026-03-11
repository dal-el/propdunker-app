# app/api/player.py

from fastapi import APIRouter, HTTPException, Query

from app.services.json_loader import DataStore, load_player_games

router = APIRouter(tags=["player"])


def parse_minutes(time_value: any) -> float | None:
    """Parse minutes from TIME field (HH:MM:SS) or other formats."""
    if time_value is None:
        return None

    if isinstance(time_value, (int, float)):
        if not isinstance(time_value, (int, float)) or not (
            isinstance(time_value, (int, float)) and time_value == time_value
        ):  # NaN check
            return None
        if time_value > 300:
            return time_value / 60
        return float(time_value)

    s = str(time_value).strip()
    if not s:
        return None

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

    try:
        num = float(s)
        if num > 300:
            return num / 60
        return num
    except ValueError:
        return None


@router.get("/player/{player_id}/history")
def player_history(player_id: str, last_n: int = Query(10, ge=1, le=50)):
    """Return recent games for a player from GAME_DATA_EXPORT/PLAYER_GAMES.

    Each game is enriched with:
    - all_players: list of player codes who played in that game (from master games.json)
    - home_players: list of player codes for the home team
    - away_players: list of player codes for the away team
    - team_won: boolean indicating if player's team won
    - minutes: parsed from TIME field (HH:MM:SS)
    """
    ds = DataStore.get()
    pid = str(player_id).strip()
    if not pid:
        raise HTTPException(status_code=400, detail="player_id is required")

    try:
        pg = load_player_games(ds.data_dir, pid)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No player history found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load player history: {e}")

    games = pg.get("games") if isinstance(pg, dict) else None
    if not isinstance(games, list):
        games = []

    recent = games[-last_n:] if last_n and games else []

    enriched = []
    for g in recent:
        game_id = g.get("game_id")
        master_info = ds.games_master.get(game_id) if hasattr(ds, "games_master") else None

        all_players = []
        home_players = []
        away_players = []
        team_won = None

        if master_info:
            home_players = master_info.get("home_active_codes", [])
            away_players = master_info.get("away_active_codes", [])
            all_players = home_players + away_players

            winner = master_info.get("winner")
            if winner and g.get("team"):
                team_won = (
                    (winner == "home" and g.get("home_away") == "home")
                    or (winner == "away" and g.get("home_away") == "away")
                )
        else:
            team_info = ds.team_games_index.get(game_id) if hasattr(ds, "team_games_index") else None
            if team_info:
                all_players = team_info.get("active_codes", [])

        minutes = parse_minutes(g.get("final", {}).get("TIME"))

        opponent = g.get("opponent") or g.get("opp")
        if not opponent and master_info:
            if g.get("home_away") == "home":
                opponent = master_info.get("away_team")
            elif g.get("home_away") == "away":
                opponent = master_info.get("home_team")

        ha_raw = g.get("home_away")
        if ha_raw == "home":
            ha = "H"
        elif ha_raw == "away":
            ha = "A"
        else:
            ha = "?"

        enriched_game = g.copy()
        enriched_game["all_players"] = all_players
        enriched_game["home_players"] = home_players
        enriched_game["away_players"] = away_players
        enriched_game["team_won"] = team_won
        enriched_game["minutes"] = minutes
        enriched_game["opp"] = opponent or "?"
        enriched_game["opponent"] = opponent or "?"
        enriched_game["ha"] = ha
        enriched.append(enriched_game)

    player = pg.get("player") if isinstance(pg, dict) else None
    display_name = None
    if isinstance(player, dict):
        display_name = player.get("name") or player.get("player_name")
    if not display_name:
        display_name = ds.resolve_player_name(pid)

    return {
        "player_id": pid,
        "player_name": display_name,
        "recent_games": enriched,
    }