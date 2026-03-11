import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.games import router as games_router
from app.api.odds import router as odds_router
from app.api.evaluate import router as evaluate_router
from app.api.player import router as player_router
from app.api.feed import router as feed_router
from app.api.upcoming_matches import router as upcoming_matches_router
from app.api.opponent_defence import router as opponent_defence_router
from app.api.streaks import router as streaks_router
from app.api.player_props import router as player_props_router
from app.api.players import router as players_router
from app.api.bookmakers import router as bookmakers_router  # ΝΕΟ
from app.utils.rate_limit import RateLimitMiddleware

app = FastAPI(title="PROPDUNKER API", version="0.1.0")

def _get_data_root() -> str | None:
    d = os.environ.get("PROPDUNKER_DATA_DIR")
    if d and os.path.isdir(d):
        return d

    try:
        here = os.path.abspath(os.path.dirname(__file__))
        data_txt = os.path.abspath(os.path.join(here, "..", "..", "DATA_DIR.txt"))
        if os.path.isfile(data_txt):
            p = open(data_txt, "r", encoding="utf-8").read().strip()
            if p and os.path.isdir(p):
                return p
    except Exception:
        pass

    try:
        from app.services.json_loader import DataStore as _DS
        return _DS.get().data_dir
    except Exception:
        return None

_root = _get_data_root()
if _root:
    assets_dir = os.path.join(_root, "METADATA", "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
        logos_dir = os.path.join(assets_dir, "logos", "euroleague")
        if os.path.isdir(logos_dir):
            app.mount("/logos/euroleague", StaticFiles(directory=logos_dir), name="logo")

# CORS
_cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://1.0.0.127:3000,http://192.168.1.121:3000")
allow_origins = [o.strip() for o in _cors_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(RateLimitMiddleware, capacity=60, refill_per_sec=1.0)

# ---------- TEST ENDPOINT ----------
@app.get("/api/test")
async def test_endpoint():
    return {"message": "test ok"}

# ---------- INCLUDE ROUTERS ----------
app.include_router(games_router, prefix="/api")
app.include_router(odds_router, prefix="/api")
app.include_router(evaluate_router, prefix="/api")
app.include_router(player_router, prefix="/api")
app.include_router(feed_router, prefix="/api")
app.include_router(upcoming_matches_router, prefix="/api")
app.include_router(opponent_defence_router, prefix="/api")
app.include_router(streaks_router, prefix="/api")
app.include_router(player_props_router, prefix="/api")
app.include_router(players_router, prefix="/api")
app.include_router(bookmakers_router, prefix="/api")  # ΝΕΟ

@app.get("/health")
def health():
    return {"ok": True}