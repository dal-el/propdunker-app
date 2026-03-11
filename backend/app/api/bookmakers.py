# app/api/bookmakers.py
from fastapi import APIRouter
from app.services.json_loader import DataStore

router = APIRouter()

@router.get("/bookmakers")
async def get_bookmakers():
    ds = DataStore.get()
    # Επιστρέφουμε τη λίστα με όλους τους bookmakers που έχουν δεδομένα
    return sorted(ds.bookmaker_outputs.keys())