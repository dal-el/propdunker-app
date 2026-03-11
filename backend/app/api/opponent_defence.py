from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.services.opponent_defence import load_opponent_defence


router = APIRouter(tags=["opponent_defence"])


@router.get("/opponent-defence")
def opponent_defence(
    kind: str = Query("both", pattern="^(standard|percentage|both)$"),
    stat: str | None = None,
):
    """Opponent defence impact table.

    Reads the exported Excel that contains one sheet per stat category:
      <stat>_standard
      <stat>_percentage   (optional)

    Returns a JSON payload ready for the frontend table (BetRow), including
    per-cell color hints according to the rules you described.
    """

    try:
        return load_opponent_defence(kind=kind, stat=stat)
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "OPPONENT_DEFENCE_XLSX_NOT_FOUND",
                "path": str(e),
                "hint": "Set env OPPONENT_DEFENCE_XLSX or place the file at the default path.",
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": "OPPONENT_DEFENCE_FAILED", "message": str(e)})
