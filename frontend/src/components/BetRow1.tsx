// src/components/BetRow.tsx
"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { clsx } from "clsx";
import { BetLine } from "@/lib/types";
import { fmtLine, fmtOdds, fmtPctInt, fmtSignedPct, valueTone } from "@/lib/format";
import { useFilters } from "@/lib/store";
import { pickIdForRow, usePicks } from "@/lib/picksStore";
import { resolveTeamKey } from "@/lib/resolveTeamKey";
import { TEAM_CANONICAL, TEAM_ALIASES, type TeamKey } from "@/lib/teamData";
import { CARD_GLASS, PILL, PILL_ACTIVE } from "@/lib/uiTokens";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

/** ✅ FIX: accept either probability [0..1] or percentage [0..100] */
function normalizePct(x: any): number {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  const pct = n <= 1.0000001 ? n * 100 : n;
  return Math.max(0, Math.min(100, pct));
}

// -------- Shared history cache (per player_id) for BetRow fallback --------
type HistoryGame = any;
const __historyCache = new Map<string, Promise<HistoryGame[]>>();

function getPlayerIdFromRow(row: any): string | null {
  const cand = [
    row?.player_id,
    row?.playerId,
    row?.player?.id,
    row?.player?.player_id,
    row?.player?.playerId,
    row?.prop?.player_id,
    row?.prop?.playerId,
  ];
  for (const c of cand) {
    const s = String(c ?? "").trim();
    if (s) return s;
  }
  return null;
}

async function fetchHistoryGames(playerId: string, lastN: number): Promise<HistoryGame[]> {
  const url = `${API_BASE}/api/player/${encodeURIComponent(playerId)}/history?last_n=${encodeURIComponent(
    String(lastN)
  )}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const json = await res.json();
  const games = json && Array.isArray(json.recent_games) ? json.recent_games : [];
  return games;
}

function getHistoryGamesCached(playerId: string, lastN: number): Promise<HistoryGame[]> {
  const key = `${playerId}::${lastN}`;
  const existing = __historyCache.get(key);
  if (existing) return existing;
  const p = fetchHistoryGames(playerId, lastN).catch(() => []);
  __historyCache.set(key, p);
  return p;
}

function readFinalStat(finalObj: any, key: string): number | null {
  if (!finalObj || typeof finalObj !== "object") return null;
  const raw = finalObj[key];
  if (raw === "#TRUE#") return 1;
  if (raw === "#FALSE#") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function computeHitPctFromHistory(row: any, games: any[], n: number): number {
  const used = games.slice(0, n);
  if (!used.length) return 0;

  const sheetKey = String(row?.prop?.sheet_key ?? "").trim();
  const hits = used.reduce((acc: number, g: any) => {
    const v = readFinalStat(g?.final, sheetKey) ?? 0;
    const ok = row?.side === "OVER" ? v >= row?.line : v < row?.line;
    return acc + (ok ? 1 : 0);
  }, 0);

  return (hits / used.length) * 100;
}

function safeLogoUrl(u: string | undefined | null) {
  if (!u) return "";
  if (u.startsWith("/")) return API_BASE + u;
  return u;
}

export type HitKey = "L5" | "L10" | "L15" | "L20";

/* ================= STAT RESOLUTION (STRICT) ================= */

function resolveGameStat(row: BetLine | undefined, g: any): number {
  const sheetKeyRaw = (row as any)?.prop?.sheet_key;
  const sheetKey = typeof sheetKeyRaw === "string" ? sheetKeyRaw.trim() : "";
  const k0 = sheetKey.toUpperCase();

  const ALIASES: Record<string, string[]> = {
    "OFFENSIVE REBOUNDS": ["OR", "OREB", "OFFENSIVE REBOUNDS"],
    OREB: ["OR", "OREB", "OFFENSIVE REBOUNDS"],
    "DEFENSIVE REBOUNDS": ["DR", "DREB", "DEFENSIVE REBOUNDS"],
    DREB: ["DR", "DREB", "DEFENSIVE REBOUNDS"],
    FGM: ["SH_M", "FGM", "FG_M"],
    "FG MADE": ["SH_M", "FGM", "FG_M", "FG MADE"],
    DD: ["DD"],
    TD: ["TD"],
  };

  const containers: any[] = [
    g?.final,
    g?.FINAL,
    g?.stats?.final,
    g?.stats,
    g?.boxscore,
    g?.game?.final,
    g?.game?.stats?.final,
    g?.game,
    g,
  ].filter(Boolean);

  const keys = ALIASES[k0] ?? (sheetKey ? [sheetKey] : []);

  for (const key of keys) {
    for (const c of containers) {
      if (!Object.prototype.hasOwnProperty.call(c, key)) continue;
      const v = c[key];
      if (v === "#TRUE#" || v === true) return 1;
      if (v === "#FALSE#" || v === false) return 0;
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) return n;
    }
  }

  const s = g?.stat;
  const sn = typeof s === "number" ? s : Number(s);
  return Number.isFinite(sn) ? sn : 0;
}

/* ================= OPPONENT DEFENCE (single-position pill) ================= */

type OppDefCell = { value: number | null; sign: "" | "+" | "-"; color: "green" | "red" | "neutral" };
type OppDefTable = {
  headers: string[];
  rows: Array<{ team: string; games?: number | null; positions: Record<string, OppDefCell> }>;
};
type OppDefPayload = {
  source?: any;
  stats?: Record<string, { standard?: OppDefTable; percentage?: OppDefTable }>;
};

function _normPhrase(s: any): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveTeamKeyFuzzy(raw: any): TeamKey | null {
  const direct = resolveTeamKey(String(raw ?? ""));
  if (direct) return direct;

  const norm = _normPhrase(raw);
  if (!norm) return null;

  for (const [alias, key] of Object.entries(TEAM_ALIASES as any)) {
    if (!alias) continue;
    if (alias === norm || alias.includes(norm) || norm.includes(alias)) return key as TeamKey;
  }

  const strip = (x: string) =>
    x
      .replace(/\b(fc|bc|bb|basket|basketball|club|team)\b/g, " ")
      .replace(
        /\b(beko|aktor|rapyd|meridianbet|mozzart|bet|segafredo|emporio|armani|ea7|ldlc|ibi)\b/g,
        " "
      )
      .replace(/\s+/g, " ")
      .trim();

  const normStripped = strip(norm);

  let best: { key: TeamKey; score: number } | null = null;

  for (const [k, v] of Object.entries(TEAM_CANONICAL as any)) {
    const disp = _normPhrase((v as any)?.display ?? k);
    const dispStripped = strip(disp);

    let score = 0;
    if (disp === norm) score = 100;
    else if (disp.includes(norm) || norm.includes(disp)) score = 80;
    else if (
      dispStripped &&
      normStripped &&
      (dispStripped.includes(normStripped) || normStripped.includes(dispStripped))
    )
      score = 70;
    else {
      const a = new Set(normStripped.split(" ").filter(Boolean));
      const b = new Set(dispStripped.split(" ").filter(Boolean));
      let inter = 0;
      for (const t of a) if (b.has(t)) inter += 1;
      score = inter * 10;
    }

    if (score > 0 && (!best || score > best.score)) best = { key: k as TeamKey, score };
  }

  return best?.key ?? null;
}

function getTeamKeyFromRow(row: any): TeamKey | null {
  const cand = [
    row?.__teamKey,
    row?.team?.id,
    row?.team_id,
    row?.teamId,
    row?.team?.code,
    row?.team?.abbr,
    row?.teamAbbr,
    row?.player?.team,
    row?.player?.team_code,
  ];
  for (const c of cand) {
    const k = resolveTeamKeyFuzzy(c);
    if (k) return k;
  }
  return null;
}

function getOpponentTeamKey(row: any): TeamKey | null {
  const cand = [
    row?.opp,
    row?.opponent,
    row?.opponent_team,
    row?.opponentTeam,
    row?.oppTeam,
    row?.opp_abbr,
    row?.opponent_abbr,
    row?.matchup?.opp,
    row?.game?.opp,
    row?.awayTeam,
    row?.homeTeam,
    row?.vs,
  ];
  for (const c of cand) {
    const s = String(c ?? "").trim();
    if (!s) continue;
    const cleaned = s.replace(/^vs\s+/i, "").replace(/^at\s+/i, "").replace(/^@\s*/i, "").trim();
    const k = resolveTeamKeyFuzzy(cleaned);
    if (k) return k;
  }

  const m = String(row?.canonical_match ?? row?.match ?? row?.game_key ?? row?.gameKey ?? "").trim();
  const my = getTeamKeyFromRow(row);
  if (m.includes("|")) {
    const parts = m.split("|");
    if (parts.length >= 3) {
      const home = resolveTeamKeyFuzzy(parts[1]);
      const away = resolveTeamKeyFuzzy(parts[2]);
      if (my && home && away) return my === home ? away : my === away ? home : null;
      return home && away ? away : home || away;
    }
  }
  if (m.includes("_")) {
    const parts = m.split("_");
    if (parts.length >= 3) {
      const home = resolveTeamKeyFuzzy(parts[1]);
      const away = resolveTeamKeyFuzzy(parts[2]);
      if (my && home && away) return my === home ? away : my === away ? home : null;
      return home && away ? away : home || away;
    }
  }

  return null;
}

function propToOppDefStatKey(row: any): string | null {
  const raw = String(row?.prop?.sheet_key ?? row?.prop?.sheetKey ?? row?.sheet_key ?? row?.sheetKey ?? "")
    .trim()
    .toUpperCase();
  if (!raw) return null;

  if (raw === "POINTS" || raw === "PTS") return "PTS";
  if (raw === "TR" || raw === "REB" || raw === "REBOUNDS") return "REB";
  if (raw === "OR" || raw === "OREB" || raw === "OFFENSIVE REBOUNDS") return "OREB";
  if (raw === "DR" || raw === "DREB" || raw === "DEFENSIVE REBOUNDS") return "DREB";
  if (raw === "AS" || raw === "AST" || raw === "ASSISTS") return "AST";
  if (raw === "ST" || raw === "STL" || raw === "STEALS") return "STL";
  if (raw === "BL" || raw === "BLK" || raw === "BLOCKS") return "BLK";
  if (raw === "TO" || raw === "TURNOVERS") return "TO";

  if (raw === "2P_M" || raw === "2PM") return "2PM";
  if (raw === "2P_A" || raw === "2PA") return "2PA";
  if (raw === "3P_M" || raw === "3PM") return "3PM";
  if (raw === "3P_A" || raw === "3PA") return "3PA";
  if (raw === "FT_M" || raw === "FTM") return "FTM";
  if (raw === "FT_A" || raw === "FTA") return "FTA";
  if (raw === "SH_M" || raw === "FGM" || raw === "FG MADE") return "FGM";
  if (raw === "SH_AT" || raw === "FGA") return "FGA";

  if (raw === "PR" || raw === "PA" || raw === "RA" || raw === "PRA" || raw === "PB" || raw === "PRB" || raw === "SB")
    return raw;

  if (raw === "FOULS" || raw === "FOULS D") return raw;

  return null;
}

const __oppDefAllCache: { p: Promise<OppDefPayload | null> | null } = { p: null };

function getOppDefAllCached(): Promise<OppDefPayload | null> {
  if (__oppDefAllCache.p) return __oppDefAllCache.p;
  __oppDefAllCache.p = (async () => {
    try {
      const url = `${API_BASE}/api/opponent-defence?kind=standard`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      const json = (await res.json()) as OppDefPayload;
      return json ?? null;
    } catch {
      return null;
    }
  })();
  return __oppDefAllCache.p;
}

function normalizePos(p: any): "PG" | "SG" | "SF" | "PF" | "C" | null {
  const s = String(p ?? "").toUpperCase().trim();
  if (!s) return null;
  const tokens = s.split(/[^A-Z]+/g).filter(Boolean);
  for (const t of tokens) {
    if (t === "PG" || t === "SG" || t === "SF" || t === "PF" || t === "C") return t;
  }
  return null;
}

function getPlayerPos(row: any): "PG" | "SG" | "SF" | "PF" | "C" | null {
  const cand = [row?.player?.pos, row?.player?.position, row?.player?.positions?.[0]];
  for (const c of cand) {
    const p = normalizePos(c);
    if (p) return p;
  }
  return null;
}

function fmtSigned2(cell: OppDefCell | undefined): string | null {
  if (!cell) return null;
  const vRaw = cell.value;
  const v = Number(vRaw);
  if (!Number.isFinite(v)) return null;
  const sign = cell.sign === "+" || cell.sign === "-" ? cell.sign : v >= 0 ? "+" : "-";
  const abs = Math.abs(v);
  return `${sign}${abs.toFixed(2)}`;
}

function oppToneClass(cell: OppDefCell | undefined) {
  const color = cell?.color ?? "neutral";
  if (color === "green") return "text-emerald-200 border-emerald-300/25 bg-emerald-400/10";
  if (color === "red") return "text-rose-200 border-rose-300/25 bg-rose-400/10";
  return "text-white/70 border-white/10 bg-white/6";
}

function OppDefPosPill({ row }: { row: BetLine }) {
  const statKey = React.useMemo(() => propToOppDefStatKey(row as any), [row]);
  const oppKey = React.useMemo(() => getOpponentTeamKey(row as any), [row]);
  const pos = React.useMemo(() => getPlayerPos(row as any), [row]);

  const [cell, setCell] = React.useState<OppDefCell | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      setCell(null);
      if (!statKey || !oppKey || !pos) return;

      const data = await getOppDefAllCached();
      if (!alive) return;

      const keysToTry = [statKey];
      if (statKey === "REB") keysToTry.push("TR");
      if (statKey === "TR") keysToTry.push("REB");
      if (statKey === "FOULS") keysToTry.push("FOULSA");
      if (statKey === "FOULSA") keysToTry.push("FOULS");

      let table: any = null;
      for (const k of keysToTry) {
        const t = data?.stats?.[k]?.standard;
        if (t && Array.isArray((t as any).rows)) {
          table = t;
          break;
        }
      }
      if (!table) return;

      const foundDirect = (table as any).rows.find((r: any) => resolveTeamKeyFuzzy(r?.team) === oppKey) ?? null;

      let found = foundDirect;

      if (!found) {
        const targetDisp = _normPhrase((TEAM_CANONICAL as any)?.[oppKey]?.display ?? String(oppKey));
        const targetTokens = new Set(targetDisp.split(" ").filter(Boolean));

        let bestRow: any = null;
        let bestScore = 0;

        for (const r of (table as any).rows) {
          const rt = _normPhrase(r?.team);
          if (!rt) continue;

          if (rt.includes(targetDisp) || targetDisp.includes(rt)) {
            bestRow = r;
            bestScore = 999;
            break;
          }

          const tokens = new Set(rt.split(" ").filter(Boolean));
          let inter = 0;
          for (const t of tokens) if (targetTokens.has(t)) inter += 1;

          if (inter > bestScore) {
            bestScore = inter;
            bestRow = r;
          }
        }

        if (bestRow && bestScore > 0) found = bestRow;
      }

      if (!found?.positions) return;

      const c = found.positions?.[pos] as OppDefCell | undefined;
      const txt = fmtSigned2(c);
      if (!txt) return;

      setCell(c ?? null);
    })();

    return () => {
      alive = false;
    };
  }, [statKey, oppKey, pos]);

  if (!statKey || !oppKey || !pos) return null;
  if (!cell) return null;

  const val = fmtSigned2(cell);
  if (!val) return null;

  return (
    <span
      className={clsx(
        PILL,
        "px-3 py-[4px] text-[11px]",
        oppToneClass(cell)
      )}
      title={`Opponent defence vs ${pos} (${statKey})`}
    >
      {`OPP vs ${pos} ${val}`}
    </span>
  );
}

/* ================= HIT BADGES ================= */

function HitBadges({
  row,
  onPick,
  open,
  onToggle,
}: {
  row?: BetLine;
  onPick?: (k: HitKey) => void;
  open?: boolean;
  onToggle?: (n?: number) => void;
}) {
  const sortKey = useFilters((s) => s.sortKey);
  const keys: HitKey[] = ["L5", "L10", "L15", "L20"];
  const [historyPcts, setHistoryPcts] = React.useState<Record<string, number> | null>(null);

  React.useEffect(() => {
    const r: any = row as any;
    if (!r) return;

    const sk = String(r?.prop?.sheet_key ?? "").trim().toUpperCase();
    const needs = sk === "OR" || sk === "DR" || sk === "SH_M";
    if (!needs) return;

    const h = r?.hit || {};
    const allZero = [h.L5, h.L10, h.L15, h.L20].every((x: any) => normalizePct(x) === 0);
    if (!allZero) return;

    const pid = getPlayerIdFromRow(r);
    if (!pid) return;

    let alive = true;
    (async () => {
      const games = await getHistoryGamesCached(pid, 20);
      if (!alive) return;
      const pcts: Record<string, number> = {
        L5: computeHitPctFromHistory(r, games, 5),
        L10: computeHitPctFromHistory(r, games, 10),
        L15: computeHitPctFromHistory(r, games, 15),
        L20: computeHitPctFromHistory(r, games, 20),
      };
      setHistoryPcts(pcts);
    })();

    return () => {
      alive = false;
    };
  }, [row]);

  return (
    <div className="grid grid-cols-4 gap-2 w-max min-w-[272px]">
      {keys.map((k) => {
        const active = sortKey === k || sortKey === (("v" + k) as any);
        const n = Number(String(k).replace("L", "")) || 0;
        const upper = String(k).toUpperCase();

        const backendPctRaw = (row as any)?.hit?.[upper];
        let pct = normalizePct(backendPctRaw);

        if (!Number.isFinite(Number(backendPctRaw))) {
          const used = (row as any)?.games?.slice(-n) ?? [];
          const hits = used.reduce((acc: number, g: any) => {
            const v = resolveGameStat(row as any, g);
            const ok = row?.side === "OVER" ? v >= (row as any).line : v < (row as any).line;
            return acc + (ok ? 1 : 0);
          }, 0);
          pct = used.length ? (hits / used.length) * 100 : 0;
        }

        if (historyPcts && normalizePct(backendPctRaw) === 0) {
          const hp = Number(historyPcts[upper]);
          if (Number.isFinite(hp)) pct = Math.max(0, Math.min(100, hp));
        }

        const toneClass =
          pct <= 35
            ? "text-rose-100 border-rose-300/35 bg-gradient-to-b from-rose-400/20 to-rose-500/8"
            : pct <= 65
              ? "text-amber-100 border-amber-300/35 bg-gradient-to-b from-amber-300/20 to-amber-500/8"
              : "text-emerald-100 border-emerald-300/35 bg-gradient-to-b from-emerald-300/20 to-emerald-500/8";

        const activeGlowClass =
          pct <= 35
            ? "border-rose-100/90 text-white bg-gradient-to-b from-rose-300/35 to-rose-500/16 ring-2 ring-rose-300/60 shadow-[0_0_0_1px_rgba(255,255,255,0.14)_inset,0_0_18px_rgba(251,113,133,0.55),0_0_34px_rgba(251,113,133,0.24)] scale-[1.08]"
            : pct <= 65
              ? "border-amber-100/90 text-white bg-gradient-to-b from-amber-200/35 to-amber-500/16 ring-2 ring-amber-300/60 shadow-[0_0_0_1px_rgba(255,255,255,0.14)_inset,0_0_18px_rgba(251,191,36,0.55),0_0_34px_rgba(251,191,36,0.24)] scale-[1.08]"
              : "border-emerald-100/90 text-white bg-gradient-to-b from-emerald-200/35 to-emerald-500/16 ring-2 ring-emerald-300/60 shadow-[0_0_0_1px_rgba(255,255,255,0.14)_inset,0_0_18px_rgba(52,211,153,0.55),0_0_34px_rgba(52,211,153,0.24)] scale-[1.08]";

        return (
          <button
            key={k}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (active) {
                onToggle?.(n);
                return;
              }
              onPick?.(k);
              onToggle?.(n);
            }}
            className={clsx(
              "relative inline-flex items-center justify-center rounded-full border backdrop-blur overflow-hidden",
              "w-[62px] h-[28px] text-[13px] leading-none font-semibold",
              "transition-all duration-200",
              "supports-[hover:hover]:hover:-translate-y-[1px] supports-[hover:hover]:hover:brightness-110",
              "active:scale-[0.98]",
              toneClass,
              active && activeGlowClass
            )}
            aria-label={`Show last ${k.replace("L", "")} chart`}
          >
            <span
              className={clsx(
                "absolute inset-0 opacity-0 transition-opacity duration-200",
                active && "opacity-100"
              )}
            >
              <span className="absolute inset-x-1 top-[2px] h-[36%] rounded-full bg-white/14" />
            </span>

            <span className="relative z-10">{fmtPctInt(pct)}</span>
          </button>
        );
      })}
    </div>
  );
}

function EdgeText({ row }: { row: BetLine }) {
  const sortKey = useFilters((s) => s.sortKey);
  const baseKeyForN = sortKey?.startsWith("v") ? sortKey.slice(1) : sortKey;
  const nFromKey = Number(String(baseKeyForN || "L15").replace("L", ""));
  const n = Number.isFinite(nFromKey) ? nFromKey : 15;

  const used = (row as any)?.games?.slice(-n) ?? [];
  const hits = used.reduce((acc: number, g: any) => {
    const v = resolveGameStat(row as any, g);
    const ok = row.side === "OVER" ? v >= row.line : v < row.line;
    return acc + (ok ? 1 : 0);
  }, 0);

  const p = used.length ? hits / used.length : 0;

  const oddsRaw = (row as any)?.odds ?? 0;
  const odds = Number.isFinite(oddsRaw) ? oddsRaw : Number(oddsRaw);
  const implied = odds > 0 ? 1 / odds : 0;

  const edgePct = (p - implied) * 100;
  const tone = valueTone(edgePct);

  return (
    <span
      className={clsx(
        "text-[11px] font-semibold tracking-wide",
        tone === "pos" && "text-emerald-200",
        tone === "neg" && "text-rose-200",
        tone === "neu" && "text-white/70"
      )}
    >
      EDGE {fmtSignedPct(edgePct)}
    </span>
  );
}

function ExpValueText({ row }: { row: BetLine }) {
  const sortKey = useFilters((s) => s.sortKey);
  const baseKeyForN = sortKey?.startsWith("v") ? sortKey.slice(1) : sortKey;
  const nFromKey = Number(String(baseKeyForN || "L15").replace("L", ""));
  const n = Number.isFinite(nFromKey) ? nFromKey : 15;

  const used = (row as any)?.games?.slice(-n) ?? [];
  const hits = used.reduce((acc: number, g: any) => {
    const v = resolveGameStat(row as any, g);
    const ok = row.side === "OVER" ? v >= row.line : v < row.line;
    return acc + (ok ? 1 : 0);
  }, 0);

  const p = used.length ? hits / used.length : 0;

  const oddsRaw = (row as any)?.odds ?? 0;
  const odds = Number.isFinite(oddsRaw) ? oddsRaw : Number(oddsRaw);
  const ev = p * odds - 1;
  const evPct = ev * 100;

  const tone = valueTone(evPct);

  return (
    <span
      className={clsx(
        "text-[11px] font-semibold tracking-wide",
        tone === "pos" && "text-emerald-200",
        tone === "neg" && "text-rose-200",
        tone === "neu" && "text-white/70"
      )}
    >
      EXP VALUE {fmtSignedPct(evPct)}
    </span>
  );
}

/* ================= SMALL COMPONENTS ================= */

function SidePill({ row }: { row: BetLine }) {
  const isOver = row.side === "OVER";
  return (
    <span
      className={clsx(
        PILL,
        "gap-2 px-3 py-[6px] text-[12px]"
      )}
    >
      <span className={clsx("font-extrabold tracking-wide", isOver ? "text-emerald-200" : "text-rose-200")}>
        {row.side}
      </span>
      <span className="text-white/90">{fmtLine(row.line)}</span>
    </span>
  );
}

function OddsPill({ odds }: { odds: number }) {
  return (
    <span
      className={clsx(
        PILL,
        "px-3 py-[6px] text-[12px] text-white/90"
      )}
      title="Odds"
    >
      {fmtOdds(odds)}
    </span>
  );
}

function TierBadge({ tier }: { tier: BetLine["prop"]["tier"] }) {
  return (
    <span
      className={clsx(
        PILL,
        "px-2.5 py-[3px] text-[11px] font-extrabold",
        tier === "ALT"
          ? "border-sky-300/25 bg-sky-400/10 text-sky-200"
          : "border-violet-300/25 bg-violet-400/10 text-violet-200"
      )}
    >
      {tier}
    </span>
  );
}

function PickTogglePill({
  picked,
  onToggle,
}: {
  picked: boolean;
  onToggle: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        PILL,
        "px-3 py-[5px] text-[12px] transition-all duration-150 active:scale-95",
        picked && PILL_ACTIVE
      )}
      aria-label={picked ? "Remove from My Picks" : "Add to My Picks"}
      title={picked ? "Remove (-)" : "Add (+)"}
    >
      {picked ? "−" : "+"}
    </button>
  );
}

function PlayerPropsTogglePill({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        PILL,
        "px-3 py-[5px] text-[12px] transition-all duration-150 active:scale-95",
        active && "border-blue-300/40 bg-blue-400/12 text-blue-200 ring-2 ring-blue-300/25 shadow-[0_10px_26px_rgba(0,0,0,0.35)]"
      )}
      aria-label="Show all player's props"
      title="SHOW ALL PLAYER's PROPS"
    >
      PP
    </button>
  );
}

/* ================= MAIN ROW ================= */

const BetRowComponent = React.forwardRef<
  HTMLDivElement,
  {
    row?: BetLine;
    open: boolean;
    onToggle: (n?: number) => void;
    onPickHit?: (k: HitKey) => void;
    playerPropsActive?: boolean;
    onTogglePlayerProps?: () => void;
  }
>(function BetRow(
  { row, open, onToggle, onPickHit, playerPropsActive = false, onTogglePlayerProps },
  ref
) {
  if (!row) return null;

  const logoSrcRaw =
    (row as any)?.team?.logo ||
    (row as any)?.teamLogo ||
    (row as any)?.logo ||
    ((row as any)?.player)?.teamLogo ||
    ((row as any)?.player)?.logo;

  const logoSrc = safeLogoUrl(logoSrcRaw);

  const propCategoryFull =
    ((row as any)?.prop)?.label ||
    ((row as any)?.prop)?.fullName ||
    ((row as any)?.prop)?.name ||
    (row as any)?.propLabel ||
    "";

  const bookmakerFull =
    (row as any)?.bookmakerFullName ||
    (row as any)?.bookmakerName ||
    (row as any)?.bookmaker ||
    (row as any)?.book ||
    (row as any)?.sportsbook ||
    "";

  const teamKey =
    (row as any)?.__teamKey ??
    (row as any)?.player?.teamKey ??
    (row as any)?.player?.team_key ??
    (row as any)?.player?.teamSlug ??
    null;

  const pickRow = React.useMemo(() => ({ ...(row as any), __teamKey: teamKey }), [row, teamKey]);
  const id = React.useMemo(() => pickIdForRow(pickRow as any), [pickRow]);

  const picked = usePicks((s) => !!s.picks[id]);
  const togglePick = usePicks((s) => s.togglePick);

  const onPickToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    togglePick(pickRow as any);
  };

  const onPlayerPropsToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onTogglePlayerProps?.();
  };

  return (
    <div
      ref={ref}
      className={clsx(
        CARD_GLASS,
        "overflow-visible lg:overflow-hidden",
        "transition-all duration-200",
        "hover:border-white/20 hover:shadow-[0_10px_32px_rgba(0,0,0,0.55)]",
        open && "ring-1 ring-white/20"
      )}
    >
      <button
        onClick={() => onToggle()} // ✅ fixed type mismatch
        className={clsx(
          "relative w-max min-w-full lg:w-full px-4 py-3 text-left",
          "transition-colors duration-150",
          "hover:bg-white/[0.05] active:bg-white/[0.07]"
        )}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-1 mb-3 sm:mb-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0 -translate-y-[4px]">
              <div className="h-10 w-10 shrink-0 rounded-full bg-white/10 border border-white/10 shadow-inner overflow-hidden flex items-center justify-center">
                {logoSrc ? (
                  <img src={logoSrc} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-6 w-6 rounded-full bg-white/10" />
                )}
              </div>

              <div className="min-w-0">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-[15px] font-semibold tracking-wide truncate text-white/95">
                    {row.player.name}
                  </span>
                  <span className={clsx(PILL, "px-2 py-[2px] text-[11px] text-white/85")}>
                    {row.player.pos}
                  </span>
                </div>
              </div>

              <div className="lg:hidden ml-auto flex flex-col items-end justify-center gap-1 opacity-90">
                <EdgeText row={row} />
                <ExpValueText row={row} />
              </div>
            </div>

            <div className="mt-0 lg:hidden">
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 min-w-0">
                <SidePill row={row} />

                <div className="min-w-0 inline-flex items-center gap-2 justify-start">
                  {propCategoryFull ? (
                    <span className="min-w-0 max-w-[220px] text-[12px] font-medium text-white/85 truncate">
                      {propCategoryFull}
                    </span>
                  ) : (
                    <span className="min-w-0 max-w-[220px]" />
                  )}
                  <OddsPill odds={(row as any)?.odds ?? 0} />
                </div>

                <div className="w-max" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    <PlayerPropsTogglePill active={playerPropsActive} onToggle={onPlayerPropsToggle} />
                    <PickTogglePill picked={picked} onToggle={onPickToggle} />
                  </div>
                </div>
              </div>
            </div>

            <div className="hidden lg:flex mt-2 items-center gap-2 min-w-0 flex-nowrap">
              <SidePill row={row} />

              <div className="min-w-0 inline-flex items-center gap-2 justify-start">
                {propCategoryFull ? (
                  <span className="min-w-0 max-w-[340px] text-[12px] font-medium text-white/85 truncate">
                    {propCategoryFull}
                  </span>
                ) : (
                  <span className="min-w-0 max-w-[340px]" />
                )}

                <OddsPill odds={(row as any)?.odds ?? 0} />

                <div className="w-max" onClick={(e) => e.stopPropagation()}>
                  <PickTogglePill picked={picked} onToggle={onPickToggle} />
                </div>

                <div className="w-max" onClick={(e) => e.stopPropagation()}>
                  <PlayerPropsTogglePill active={playerPropsActive} onToggle={onPlayerPropsToggle} />
                </div>
              </div>

              <div className="ml-auto flex items-center gap-3 opacity-90">
                <OppDefPosPill row={row as any} />
                <EdgeText row={row} />
                <ExpValueText row={row} />
              </div>
            </div>
          </div>

          <div className="hidden lg:grid grid-cols-[62px_62px_62px_62px_20px] gap-2 items-start">
            <div className="col-span-4 flex justify-end">
              <HitBadges row={row} onPick={onPickHit} open={open} onToggle={onToggle} />
            </div>

            <div className="flex justify-center pt-[2px] opacity-70">
              {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </div>

            {bookmakerFull || row.prop?.tier ? (
              <div className="col-span-4 mt-4 flex items-center justify-end gap-2 -translate-x-1 translate-y-1">
                {bookmakerFull ? (
                  <div className="text-[11px] leading-none text-white/60 whitespace-nowrap">{bookmakerFull}</div>
                ) : null}
                <TierBadge tier={row.prop.tier} />
              </div>
            ) : (
              <div className="col-span-4" />
            )}

            <div />
          </div>
        </div>
      </button>

      <div className="lg:hidden px-4 pb-3 min-w-full w-max">
        <div className="mt-2 flex items-end justify-between gap-3" onClick={(e) => e.stopPropagation()}>
          <div className="relative">
            <div className="absolute left-0 -top-[34px] z-10">
              <OppDefPosPill row={row as any} />
            </div>
            <HitBadges row={row} onPick={onPickHit} open={open} onToggle={onToggle} />
          </div>

          {bookmakerFull || row.prop?.tier ? (
            <div className="shrink-0 flex flex-col items-end justify-end">
              {row.prop?.tier ? <TierBadge tier={row.prop.tier} /> : null}
              {bookmakerFull ? (
                <div className="mt-1 text-[11px] leading-none text-white/60 whitespace-nowrap">{bookmakerFull}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

export const BetRow = React.memo(BetRowComponent);