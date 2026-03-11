from fastapi import APIRouter
import json
from app.services.json_loader import DataStore

router = APIRouter()

@router.get("/players")
async def get_players():
    ds = DataStore.get()
    players = set()
    for bookmaker, game_map in ds.bookmaker_outputs.items():
        for filepath in game_map.values():
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                for prop in data.get("props", []):
                    pid = prop.get("player_id")
                    name = prop.get("player_name") or prop.get("player") or ""
                    if pid and name:
                        players.add((pid, name))
            except Exception:
                continue
    sorted_players = sorted(players, key=lambda x: x[1])
    return [{"id": pid, "name": name} for pid, name in sorted_players]