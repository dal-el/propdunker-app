from pydantic import BaseModel, Field
from typing import List, Literal, Optional

HomeAway = Literal["home", "away", "all"]
BetType = Literal["MAIN_PROPS", "ALT_PROPS"]

class FiltersIn(BaseModel):
    min_minutes: float = Field(default=0, ge=0)
    home_away: HomeAway = "all"
    opponent_tier: Optional[str] = None

class EvaluateIn(BaseModel):
    player_id: str
    sheet_key: str
    line: float
    bet_type: BetType
    odds_over: float
    odds_under: Optional[float] = None
    windows: List[int] = Field(default_factory=lambda: [5, 10, 15, 20])
    filters: FiltersIn = Field(default_factory=FiltersIn)
