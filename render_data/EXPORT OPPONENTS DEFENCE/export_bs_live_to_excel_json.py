import argparse
import json
import re
import sys
import urllib.request
import urllib.parse
from html import unescape
from pathlib import Path
from openpyxl import Workbook

POS = ("PG","SG","SF","PF","C")

def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0", "Accept":"text/html,*/*"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="ignore")

def strip_tags(s: str) -> str:
    s = re.sub(r"<script[^>]*>.*?</script>", "", s, flags=re.S|re.I)
    s = re.sub(r"<style[^>]*>.*?</style>", "", s, flags=re.S|re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = unescape(s).replace("\xa0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s

def to_float(txt: str):
    if txt is None:
        return None
    t = str(txt).strip().replace(",", ".")
    t = re.sub(r"[^0-9\.\-\+]", "", t)
    if not t:
        return None
    try:
        return float(t)
    except:
        return None

def extract_value_and_color(td_html: str):
    # span with style color
    m = re.search(r'<span[^>]*style=["\'][^"\']*color\s*:\s*([^;"\']+)[^"\']*["\'][^>]*>(.*?)</span>', td_html, flags=re.S|re.I)
    if not m:
        return (to_float(strip_tags(td_html)), None)
    color = (m.group(1) or "").strip().lower()
    val = to_float(strip_tags(m.group(2)))
    if "green" in color or color in ("#00e600","#00ff00"):
        color = "green"
    elif "red" in color or color in ("#ff0000",):
        color = "red"
    else:
        color = None
    return (val, color)

def parse_table(html: str):
    # try stats_table first
    m = re.search(r'<table[^>]*id=["\']stats_table["\'][^>]*>.*?</table>', html, flags=re.S|re.I)
    if not m:
        # sometimes #list container has a table_sp; grab first table that includes PG/SG/SF/PF/C headers
        tables = re.findall(r"<table[^>]*>.*?</table>", html, flags=re.S|re.I)
        for t in tables:
            if re.search(r">PG<", t) and re.search(r">SG<", t) and re.search(r">SF<", t) and re.search(r">PF<", t) and re.search(r">C<", t):
                m = re.search(r"(<table[^>]*>.*?</table>)", t, flags=re.S|re.I)
                break
    if not m:
        return None

    table = m.group(0)

    row_htmls = re.findall(r"<tr[^>]*>.*?</tr>", table, flags=re.S|re.I)
    if not row_htmls:
        return None

    # header row: has TEAM + GAMES + positions
    header_idx = None
    headers = None
    for i, r in enumerate(row_htmls[:8]):
        ths = re.findall(r"<th[^>]*>(.*?)</th>", r, flags=re.S|re.I)
        if not ths:
            continue
        h = [strip_tags(x) for x in ths]
        h_up = [x.upper() for x in h]
        if ("TEAM" in h_up or "ΟΜΑΔΑ" in h_up) and ("GAMES" in h_up or "ΑΓΩΝΕΣ" in h_up) and all(p in h_up for p in POS):
            header_idx = i
            headers = h_up
            break
    if header_idx is None or not headers:
        return None

    pos_cols = {p: headers.index(p) for p in POS if p in headers}
    out = []
    for r in row_htmls[header_idx+1:]:
        tds = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, flags=re.S|re.I)
        if len(tds) < 2:
            continue
        team = strip_tags(tds[0])
        games = strip_tags(tds[1])
        if not team or team.upper() in ("TEAM","ΟΜΑΔΑ"):
            continue
        row = {"Team": team, "Games": games}
        for p, idx in pos_cols.items():
            if idx < len(tds):
                v, c = extract_value_and_color(tds[idx])
                row[p] = v
                row[p+"_color"] = c
        out.append(row)
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--links", default="bs_links.json")
    ap.add_argument("--xlsx", default="basketstories_oppdef.xlsx")
    ap.add_argument("--json", default="opp_def_cache.json")
    args = ap.parse_args()

    links_path = Path(args.links)
    if not links_path.exists():
        print("ERROR: bs_links.json missing", file=sys.stderr)
        sys.exit(2)

    links = json.loads(links_path.read_text(encoding="utf-8"))
    if not isinstance(links, list) or not links:
        print("ERROR: bs_links.json must be a non-empty list", file=sys.stderr)
        sys.exit(2)

    wb = Workbook()
    wb.remove(wb.active)
    cache = {"tables": {"standard": {}, "percentage": {}}}

    for item in links:
        key = (item.get("key") or "").strip().lower()
        url = (item.get("url") or "").strip()
        mode = (item.get("mode") or "standard").strip().lower()
        if mode not in ("standard","percentage"):
            mode = "standard"
        if not key or not url:
            continue

        print(f"Fetching {key} ({mode})")
        html = fetch(url)
        rows = parse_table(html)
        if not rows:
            print(f"WARNING: no table parsed for {key}", file=sys.stderr)
            continue

        sheet = wb.create_sheet(f"{key}_{mode}"[:31])
        sheet.append(["Team","Games","PG","SG","SF","PF","C"])
        for r in rows:
            sheet.append([r.get("Team"), r.get("Games"), r.get("PG"), r.get("SG"), r.get("SF"), r.get("PF"), r.get("C")])

        bucket = cache["tables"][mode]
        bucket.setdefault(key, {})
        for r in rows:
            team = r.get("Team")
            if not team:
                continue
            bucket[key].setdefault(team, {})
            for p in POS:
                bucket[key][team][p] = {"value": r.get(p), "color": r.get(p+"_color")}

    wb.save(args.xlsx)
    Path(args.json).write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    print("DONE")

if __name__ == "__main__":
    main()
