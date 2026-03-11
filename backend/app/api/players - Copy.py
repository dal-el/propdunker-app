from fastapi import APIRouter, Query, HTTPException

from app.services.json_loader import DataStore, load_player_games

router = APIRouter(tags=["players"])


@router.get("/player/{player_id}/history")
def player_history(player_id: str, last_n: int = Query(default=10, ge=1, le=50)):
    """Return recent historical games for a player from GAME_DATA_EXPORT/PLAYER_GAMES."""
    ds = DataStore.get()
    pid = str(player_id)
    try:
        payload = load_player_games(ds.data_dir, pid)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="player_id not found")
    except Exception:
        raise HTTPException(status_code=500, detail="failed to read player history")

    games = payload.get("games") if isinstance(payload, dict) else None
    if not isinstance(games, list):
        games = []

    return {
        "player": payload.get("player") if isinstance(payload, dict) else {"code": pid, "name": ds.resolve_player_name(pid)},
        "games": games[:last_n],
    }
