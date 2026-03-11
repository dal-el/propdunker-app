# app/services/json_loader.py

import json
import os
import glob
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Dict, Optional


def _read_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _auto_detect_data_root() -> str:
    """Best-effort auto-detect of the PROPDUNKER data root.

    The data root is the folder that contains the JSON data folders:
      - BOOKMAKERS_PROCESSED/
      - GAME_DATA_EXPORT/
      - METADATA/

    This avoids relying on backend/private_data (which is often empty on Windows).
    """

    def looks_like_root(p: str) -> bool:
        return (
            os.path.isdir(os.path.join(p, "BOOKMAKERS_PROCESSED"))
            and os.path.isdir(os.path.join(p, "GAME_DATA_EXPORT"))
        )

    # 1) Walk upwards from this file.
    here = os.path.abspath(os.path.dirname(__file__))
    cur = here
    for _ in range(15):
        if looks_like_root(cur):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent

    # 2) Common relative candidate from backend folder (repo layout)
    #    .../PROPDUNKER/propdunker_mvp/backend/app/services -> .../PROPDUNKER
    cand = os.path.abspath(os.path.join(here, "..", "..", "..", "..", ".."))
    if looks_like_root(cand):
        return cand

    # 3) Fallback: previous default
    return os.path.abspath(os.path.join(here, "..", "..", "..", "private_data"))


@dataclass
class BookmakerGameIndex:
    bookmaker: str
    game_key: str  # pre_game_key
    start_time: str | None
    home: str
    away: str
    file_path: str


class DataStore:
    """Singleton-ish datastore.

    Loads:
    - games.json (historic)
    - bookmaker OUTPUT jsons (normalized props) and exposes as synthetic games
    - player name map from bookmaker outputs (player_id -> canonical_player_name)
    - team index JSONs (team_id -> games with active_codes)
    - master games.json (game_id -> all active_codes, scores, winner)

    Data dir is controlled by env PROPDUNKER_DATA_DIR.
    Optional bookmakers dir override: env PROPDUNKER_BOOKMAKERS_DIR.
    """

    _instance: Optional["DataStore"] = None

    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self.games: Dict[str, Dict[str, Any]] = {}
        # game_key -> one representative index (kept for backward compatibility)
        self.bookmaker_games: Dict[str, BookmakerGameIndex] = {}
        # game_key -> set of bookmakers that have odds for that key
        self.bookmaker_game_keys: Dict[str, set[str]] = {}
        # bookmaker -> game_key -> filepath
        self.bookmaker_outputs: Dict[str, Dict[str, str]] = {}
        self.player_names: Dict[str, str] = {}
        
        # ΝΕΟ: team index από GAME_DATA_EXPORT/TEAM_INDEX/*.json
        self.team_games_index: Dict[str, dict] = {}  # game_id -> team info
        
        # ΝΕΟ: master games από GAME_DATA_EXPORT/GAMES_INDEX/games.json
        self.games_master: Dict[str, dict] = {}  # game_id -> full game info

        self._load_games()
        self._scan_bookmaker_outputs()
        self._load_team_games_index()
        self._load_games_master()

    @classmethod
    def get(cls) -> "DataStore":
        if cls._instance is None:
            data_dir = os.environ.get("PROPDUNKER_DATA_DIR")
            if not data_dir:
                data_dir = _auto_detect_data_root()
            cls._instance = DataStore(data_dir=data_dir)
        return cls._instance

    def _load_games(self) -> None:
        games_path = os.path.join(self.data_dir, "GAME_DATA_EXPORT", "GAMES_INDEX", "games.json")
        if os.path.exists(games_path):
            self.games = _read_json(games_path)
        else:
            self.games = {}

    def _iter_bookmaker_json_files(self, book_dir: str) -> list[str]:
        """Support multiple layouts without moving files:
        - <BOOK_DIR>/OUTPUT/*.json
        - <BOOK_DIR>/*.json
        - <BOOK_DIR>/**/OUTPUT/*.json (one extra nesting)
        """
        fps: list[str] = []

        out_dir = os.path.join(book_dir, "OUTPUT")
        if os.path.isdir(out_dir):
            fps.extend(glob.glob(os.path.join(out_dir, "*.json")))

        fps.extend(glob.glob(os.path.join(book_dir, "*.json")))

        # allow one level deeper for OUTPUT (e.g. BOOK/PROCESSED/OUTPUT/*.json)
        fps.extend(glob.glob(os.path.join(book_dir, "*", "OUTPUT", "*.json")))

        # unique + stable order
        seen = set()
        uniq = []
        for fp in fps:
            if fp not in seen:
                seen.add(fp)
                uniq.append(fp)
        return uniq

    def _scan_bookmaker_outputs(self) -> None:
        # Optional override: point directly to the folder that contains bookmaker folders (NOVIBET/STOIXIMAN/...)
        override = os.environ.get("PROPDUNKER_BOOKMAKERS_DIR")
        candidates = []
        if override:
            candidates.append(override)

        # Common layouts (no moving required)
        candidates.extend([
            os.path.join(self.data_dir, "BOOKMAKERS_PROCESSED"),
            os.path.join(self.data_dir, "BOOKMAKERS"),
            os.path.join(self.data_dir, "GAME_DATA_EXPORT", "BOOKMAKERS_PROCESSED"),
            os.path.join(self.data_dir, "GAME_DATA_EXPORT", "BOOKMAKERS"),
        ])

        bookmakers_roots = [p for p in candidates if os.path.isdir(p)]
        if not bookmakers_roots:
            return

        for bookmakers_root in bookmakers_roots:
            # Expect: root contains subfolders per bookmaker.
            for book_dir in glob.glob(os.path.join(bookmakers_root, "*")):
                if not os.path.isdir(book_dir):
                    continue

                bookmaker = os.path.basename(book_dir).upper()
                for fp in self._iter_bookmaker_json_files(book_dir):
                    try:
                        data = _read_json(fp)
                    except Exception:
                        continue

                    game_key = str(data.get("pre_game_key") or os.path.splitext(os.path.basename(fp))[0])
                    g = data.get("game") or {}
                    home = (g.get("home") or "").strip()
                    away = (g.get("away") or "").strip()
                    start_time = g.get("date")

                    self.bookmaker_outputs.setdefault(bookmaker, {})[game_key] = fp

                    # representative index (first seen wins)
                    if game_key not in self.bookmaker_games:
                        self.bookmaker_games[game_key] = BookmakerGameIndex(
                            bookmaker=bookmaker,
                            game_key=game_key,
                            start_time=start_time,
                            home=home,
                            away=away,
                            file_path=fp,
                        )

                    self.bookmaker_game_keys.setdefault(game_key, set()).add(bookmaker)

                    # build player name map (best-effort)
                    for p in data.get("props", []):
                        pid = p.get("player_id")
                        cname = p.get("canonical_player_name") or p.get("player_name")
                        if pid and cname and str(pid) not in self.player_names:
                            self.player_names[str(pid)] = str(cname)

    def _load_team_games_index(self) -> None:
        """Φορτώνει όλα τα team JSON από GAME_DATA_EXPORT/TEAM_INDEX και δημιουργεί index με game_id."""
        self.team_games_index = {}
        
        team_index_dir = os.path.join(self.data_dir, "GAME_DATA_EXPORT", "TEAM_INDEX")
        if not os.path.isdir(team_index_dir):
            print(f"⚠️ Δεν βρέθηκε TEAM_INDEX στο {team_index_dir}")
            return
        
        for filename in os.listdir(team_index_dir):
            if not filename.endswith(".json"):
                continue
            
            filepath = os.path.join(team_index_dir, filename)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as e:
                print(f"❌ Σφάλμα φόρτωσης {filename}: {e}")
                continue
            
            team_id = data.get("team_id")
            games = data.get("games", [])
            
            for game in games:
                game_id = game.get("game_id")
                if not game_id:
                    continue
                
                # Αποθηκεύουμε μόνο το πρώτο που βρίσκουμε (αν υπάρχουν πολλά)
                if game_id not in self.team_games_index:
                    self.team_games_index[game_id] = {
                        "team_id": team_id,
                        "opponent": game.get("opponent"),
                        "win": game.get("win", False),
                        "active_codes": game.get("active_codes", []),
                        "team_score": game.get("team_score"),
                        "opponent_score": game.get("opponent_score"),
                        "round": game.get("round"),
                        "home_away": game.get("home_away"),
                    }
        
        print(f"✅ Φορτώθηκαν {len(self.team_games_index)} games από team index")

    def _load_games_master(self) -> None:
        """Φορτώνει το master games.json με όλους τους αγώνες και active codes."""
        self.games_master = {}
        
        games_index_path = os.path.join(self.data_dir, "GAME_DATA_EXPORT", "GAMES_INDEX", "games.json")
        
        if not os.path.exists(games_index_path):
            print(f"⚠️ Δεν βρέθηκε games.json στο {games_index_path}")
            return
        
        try:
            with open(games_index_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            # Το αρχείο μπορεί να είναι λίστα ή dictionary
            if isinstance(data, dict):
                items = data.items()
            elif isinstance(data, list):
                # Αν είναι λίστα, υποθέτουμε ότι κάθε στοιχείο έχει game_id
                items = [(item.get("game_id"), item) for item in data if item.get("game_id")]
            else:
                items = []
            
            for game_id, game_data in items:
                if not game_id:
                    continue
                self.games_master[game_id] = {
                    "game_id": game_id,
                    "league": game_data.get("league"),
                    "season": game_data.get("season"),
                    "phase": game_data.get("phase"),
                    "round": game_data.get("round"),
                    "home_team_id": game_data.get("home_team_id"),
                    "away_team_id": game_data.get("away_team_id"),
                    "home_team": game_data.get("home_team"),
                    "away_team": game_data.get("away_team"),
                    "home_score": game_data.get("home_score"),
                    "away_score": game_data.get("away_score"),
                    "winner": game_data.get("winner"),
                    "home_active_codes": game_data.get("home_active_codes", []),
                    "away_active_codes": game_data.get("away_active_codes", []),
                }
            
            print(f"✅ Φορτώθηκαν {len(self.games_master)} αγώνες από master games.json")
        except Exception as e:
            print(f"❌ Σφάλμα φόρτωσης games.json: {e}")

    def resolve_player_name(self, player_id: str) -> str:
        """Best-effort player display name.

        Priority:
        1) from bookmaker outputs (canonical_player_name)
        2) from PLAYER_GAMES/<id>.json -> player.name
        3) fallback to id
        """
        pid = str(player_id)
        if pid in self.player_names:
            return self.player_names[pid]

        try:
            pg = load_player_games(self.data_dir, pid)
            player = pg.get("player") if isinstance(pg, dict) else None
            name = None
            if isinstance(player, dict):
                name = player.get("name") or player.get("player_name")
            if name:
                self.player_names[pid] = str(name)
                return self.player_names[pid]
        except Exception:
            pass

        return pid

    def list_bookmakers_for_game(self, game_key: str) -> list[str]:
        # If it's a bookmaker-game key, return all that have it.
        if game_key in self.bookmaker_game_keys:
            return sorted(self.bookmaker_game_keys[game_key])

        # For historic games, we can't reliably match without a schedule key.
        return []

    def get_bookmaker_output_path(self, bookmaker: str, game_key: str) -> Optional[str]:
        return self.bookmaker_outputs.get(bookmaker.upper(), {}).get(game_key)


@lru_cache(maxsize=512)
def load_player_games(data_dir: str, player_id: str) -> Dict[str, Any]:
    fp = os.path.join(data_dir, "GAME_DATA_EXPORT", "PLAYER_GAMES", f"{player_id}.json")
    return _read_json(fp)