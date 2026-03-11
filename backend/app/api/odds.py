from fastapi import APIRouter, Query, HTTPException
from app.services.json_loader import DataStore
import json
import os

router = APIRouter(tags=["odds"])

@router.get("/odds")
def odds_for_game(
    game_key: str = Query(...),
    bookmaker: str = Query(...),
):
    ds = DataStore.get()
    # 1) Prefer datastore index (fast path)
    fp = ds.get_bookmaker_output_path(bookmaker, game_key)

    # 2) Fallback: direct filesystem lookup by convention:
    #    BOOKMAKERS_PROCESSED/<BOOKMAKER>/<game_key>.json
    if not fp:
        book = bookmaker.upper()
        roots = [
            os.path.join(ds.data_dir, "BOOKMAKERS_PROCESSED"),
            os.path.join(ds.data_dir, "GAME_DATA_EXPORT", "BOOKMAKERS_PROCESSED"),
            os.path.join(ds.data_dir, "BOOKMAKERS"),
            os.path.join(ds.data_dir, "GAME_DATA_EXPORT", "BOOKMAKERS"),
        ]
        for root in roots:
            if not os.path.isdir(root):
                continue
            # case-insensitive bookmaker folder match
            book_dir = None
            try:
                for d in os.listdir(root):
                    p = os.path.join(root, d)
                    if os.path.isdir(p) and d.upper() == book:
                        book_dir = p
                        break
            except Exception:
                book_dir = None

            if not book_dir or not os.path.isdir(book_dir):
                continue

            # common layouts
            candidates = [
                os.path.join(book_dir, f"{game_key}.json"),
                os.path.join(book_dir, "OUTPUT", f"{game_key}.json"),
            ]
            for c in candidates:
                if os.path.isfile(c):
                    fp = c
                    break
            if fp:
                break

    if not fp:
        raise HTTPException(status_code=404, detail="No odds found for game_key/bookmaker")

    with open(fp, "r", encoding="utf-8") as f:
        payload = json.load(f)

    props = []
    for p in payload.get("props", []):
        props.append(
            {
                "player_name": p.get("player_name"),
                "player_id": p.get("player_id"),
                "is_player_mapped": p.get("is_player_mapped"),
                "bet_type": p.get("bet_type"),
                "sheet_key": p.get("sheet_key"),
                "ui_name": p.get("ui_name"),
                "book_category": p.get("book_category"),
                "line": p.get("line"),
                "over_odds": p.get("over_odds"),
                "under_odds": p.get("under_odds"),
            }
        )

    return {
        "game_key": game_key,
        "bookmaker": payload.get("bookmaker") or bookmaker.upper(),
        "game": payload.get("game"),
        "props": props,
        "unmapped_categories": payload.get("unmapped_categories", []),
    }
