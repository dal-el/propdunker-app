from fastapi import APIRouter, Query, HTTPException
from app.services.json_loader import DataStore
import os
import json

router = APIRouter(tags=["games"])

@router.get("/games")
def list_games(
    league: str | None = Query(default=None),
    season: str | None = Query(default=None),
    phase: str | None = Query(default=None),
    round: str | None = Query(default=None),
):
    """List games available for analysis.

    Preferred source (if present): <DATA_DIR>/METADATA/upcoming_matches.json.
    Fallback source: bookmaker JSON outputs discovered by DataStore.

    The frontend uses this to populate the **Select Match** dropdown.
    """
    ds = DataStore.get()

    # 1) Prefer explicit upcoming schedule file, if the project has it.
    fp = os.path.join(ds.data_dir, "METADATA", "upcoming_matches.json")
    if os.path.exists(fp):
        try:
            with open(fp, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            raise HTTPException(status_code=500, detail="failed to read upcoming_matches.json")

        if not isinstance(data, list):
            raise HTTPException(status_code=500, detail="upcoming_matches.json must be a list")

        # Optional filtering
        out = []
        for g in data:
            if league and g.get("league") != league:
                continue
            if season and g.get("season") != season:
                continue
            if phase and g.get("phase") != phase:
                continue
            if round and g.get("round") != round:
                continue
            out.append(g)
        return out

    # 2) Fallback: build a list from bookmaker JSONs (pre-game odds).
    # DataStore already scanned the BOOKMAKERS_PROCESSED folders.
    out = []
    for gk, bm in sorted(ds.bookmaker_game_keys.items()):
        bg = ds.bookmaker_games.get(gk)
        if not bg:
            continue

        # best-effort label for the dropdown
        match_label = f"{bg.home} vs {bg.away}"

        out.append(
            {
                "game_key": str(gk),
                "match_label": match_label,
                "start_time": bg.start_time,
                "home_team": bg.home,
                "away_team": bg.away,
                "league": None,
                "season": None,
                "phase": None,
                "round": None,
                "bookmaker": bm,
            }
        )

    return out


@router.get("/games/{game_key}")
def game_detail(game_key: str):
    ds = DataStore.get()
    g = ds.games.get(str(game_key))
    if not g:
        # synthetic game from bookmaker output
        bg = ds.bookmaker_games.get(str(game_key))
        if not bg:
            raise HTTPException(status_code=404, detail="game_key not found")

        # build players list from odds file (distinct by player_id)
        import json

        with open(bg.file_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        seen = set()
        players = []
        for p in payload.get("props", []):
            pid = p.get("player_id")
            if not pid or pid in seen:
                continue
            seen.add(pid)
            players.append({"player_id": str(pid), "name": p.get("canonical_player_name") or p.get("player_name"), "team_id": None})

        return {
            "game_key": bg.game_key,
            "start_time": bg.start_time,
            "teams": {
                "home": {"team_id": None, "name": bg.home},
                "away": {"team_id": None, "name": bg.away},
            },
            "meta": {"league": None, "season": None, "phase": None, "round": None},
            "players": players,
            "available_bookmakers": [bg.bookmaker],
        }

    # roster from game record active codes (player ids)
    players = []
    for pid in g.get("home_active_codes", []):
        name = ds.resolve_player_name(pid)
        players.append({"player_id": pid, "name": name, "team_id": g.get("home_team_id")})
    for pid in g.get("away_active_codes", []):
        name = ds.resolve_player_name(pid)
        players.append({"player_id": pid, "name": name, "team_id": g.get("away_team_id")})

    return {
        "game_key": str(g.get("game_id")),
        "start_time": None,
        "teams": {
            "home": {"team_id": g.get("home_team_id"), "name": g.get("home_team")},
            "away": {"team_id": g.get("away_team_id"), "name": g.get("away_team")},
        },
        "meta": {
            "league": g.get("league"),
            "season": g.get("season"),
            "phase": g.get("phase"),
            "round": g.get("round"),
            "home_score": g.get("home_score"),
            "away_score": g.get("away_score"),
            "winner": g.get("winner"),
        },
        "players": players,
        "available_bookmakers": ds.list_bookmakers_for_game(str(game_key)),
    }
