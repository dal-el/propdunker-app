import json
import re
from pathlib import Path
import pdfplumber

BASE = Path(r"C:\DEV\PROPDUNKER\NEXT_ROUND")
SCHEDULE_DIR = BASE / "SCHEDULE_DOCUMENDS"
OUTPUT_DIR = BASE / "UPCOMMING_MATCHES"

CANONICAL_FILE = BASE / "SCRIPTS" / "TEAMS_NAMES_CANONICAL" / "team_canonical.json"
CODES_FILE = BASE / "SCRIPTS" / "TEAMS_NAMES_CANONICAL" / "team_codes.json"  # REQUIRED

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def load_json(p: Path):
    if not p.exists():
        return {}
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

CANONICAL = load_json(CANONICAL_FILE)   # canonical_key -> {display: ...}
CODE_TO_CANON = load_json(CODES_FILE)   # CODE -> canonical_key (strings)

HDR_RE = re.compile(r"REGULAR SEASON\s*\|\s*ROUND\s*(\d+)\s*\|\s*([A-Z0-9]{2,4})\s*-\s*([A-Z0-9]{2,4})", re.I)
DATE_RE = re.compile(r"([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s+CET:\s+(\d{2}:\d{2})")
MON = {"Jan":"01","Feb":"02","Mar":"03","Apr":"04","May":"05","Jun":"06","Jul":"07","Aug":"08","Sep":"09","Oct":"10","Nov":"11","Dec":"12"}

def to_iso(date_str: str):
    parts = date_str.split()
    if len(parts) < 3:
        return None
    mm = MON.get(parts[0], "01")
    dd = parts[1].replace(",", "").zfill(2)
    yyyy = parts[2]
    return f"{yyyy}-{mm}-{dd}"

def display_from_canon(canon_key: str) -> str:
    v = CANONICAL.get(canon_key)
    if isinstance(v, dict):
        d = v.get("display")
        if isinstance(d, str) and d.strip():
            return d.strip()
    return canon_key.replace("_", " ").title()

def display_from_code(code: str) -> str:
    canon_key = CODE_TO_CANON.get(code.upper())
    if isinstance(canon_key, str) and canon_key:
        return display_from_canon(canon_key)
    return code.upper()

def read_latest_pdf(folder: Path):
    pdfs = sorted(folder.glob("*.pdf"), key=lambda p: p.stat().st_mtime, reverse=True)
    return pdfs[0] if pdfs else None

def extract_full_text(pdf_path: Path) -> str:
    out = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            out.append(page.extract_text() or "")
    return "\n".join(out)

def main():
    pdf = read_latest_pdf(SCHEDULE_DIR)
    if not pdf:
        print("No PDF found in:", SCHEDULE_DIR)
        return

    if not CODE_TO_CANON:
        print("ERROR: team_codes.json is missing or empty:", CODES_FILE)
        return

    print("Using PDF:", pdf.name)
    full = extract_full_text(pdf)

    by_match = {}  # (round, c1, c2) -> entry

    for m in HDR_RE.finditer(full):
        rnd = int(m.group(1))
        c1 = m.group(2).upper()
        c2 = m.group(3).upper()

        window = full[m.end():m.end()+1400]
        d = DATE_RE.search(window)
        if not d:
            continue

        iso_date = to_iso(d.group(1))
        time_str = d.group(2)

        entry = {
            "label": f"{display_from_code(c1)} vs {display_from_code(c2)}",
            "round": rnd,
            "date": iso_date,
            "time_cet": time_str,
            "codes": [c1, c2],
        }

        key = (rnd, c1, c2)
        # keep first (they should be identical date/time); if later differs, prefer one with date/time (already)
        by_match.setdefault(key, entry)

    matches = []
    for (rnd, c1, c2), e in by_match.items():
        e["value"] = f"{e['date']}_round{rnd}_{c1.lower()}_{c2.lower()}"
        matches.append(e)

    matches.sort(key=lambda x: (x["date"] or "9999-12-31", x["time_cet"] or "99:99", x["label"]))

    upcoming_path = OUTPUT_DIR / "upcoming_matches.json"
    with open(upcoming_path, "w", encoding="utf-8") as f:
        json.dump(matches, f, indent=2, ensure_ascii=False)

    standings_path = OUTPUT_DIR / "standings.json"
    with open(standings_path, "w", encoding="utf-8") as f:
        json.dump([], f, indent=2, ensure_ascii=False)

    missing = sorted({c for e in matches for c in e["codes"] if c not in CODE_TO_CANON})
    if missing:
        print("\nWARNING: Missing team code mappings for:", ", ".join(missing))
        print("Add them to:", CODES_FILE)

    print("Unique matches:", len(matches))
    print("Generated:", upcoming_path)
    print("Generated:", standings_path)

if __name__ == "__main__":
    main()
