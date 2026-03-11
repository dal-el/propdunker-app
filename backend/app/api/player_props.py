# app/api/player_props.py
from fastapi import APIRouter, HTTPException
from app.services.json_loader import DataStore
import json

router = APIRouter()

@router.get("/player/{player_id}/props")
async def get_player_props(player_id: str):
    """Επιστρέφει όλα τα MAIN props ενός παίκτη (όχι ALT) από όλους τους bookmakers."""
    ds = DataStore.get()
    props = []
    for bookmaker, game_map in ds.bookmaker_outputs.items():
        for filepath in game_map.values():
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                for prop in data.get("props", []):
                    if prop.get("player_id") != player_id:
                        continue
                    # Έλεγχος αν είναι ALT μέσω bet_type
                    bet_type = prop.get("bet_type", "")
                    if "ALT" in bet_type.upper():
                        continue
                    # Μόνο MAIN props (αν δεν υπάρχει tier, θεωρούμε MAIN)
                    tier = prop.get("tier", "MAIN")
                    if tier != "MAIN":
                        continue
                    props.append({
                        "ui_name": prop.get("ui_name") or prop.get("sheet_key") or "Unknown",
                        "sheet_key": prop.get("sheet_key"),
                        "line": prop.get("line"),
                        "over_odds": prop.get("over_odds"),
                        "under_odds": prop.get("under_odds"),
                        "bookmaker": bookmaker,  # ΠΡΟΣΘΗΚΗ
                    })
            except Exception:
                continue
    if not props:
        raise HTTPException(status_code=404, detail="No props found for this player")
    return props