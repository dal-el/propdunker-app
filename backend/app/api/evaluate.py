from fastapi import APIRouter, HTTPException
from app.models.requests import EvaluateIn
from app.services.evaluator import evaluate_player_prop

router = APIRouter(tags=["evaluate"])

@router.post("/evaluate")
def evaluate(payload: EvaluateIn):
    res = evaluate_player_prop(
        player_id=payload.player_id,
        sheet_key=payload.sheet_key,
        line=payload.line,
        bet_type=payload.bet_type,
        odds_over=payload.odds_over,
        odds_under=payload.odds_under,
        windows=payload.windows,
        filters=payload.filters.model_dump(),
    )
    if "error" in res:
        raise HTTPException(status_code=400, detail=res)
    return res
