"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, ChevronDown, SlidersHorizontal } from "lucide-react";
import { clsx } from "clsx";

import type { BetLine } from "@/lib/types";
import { fmtOdds, fmtLine } from "@/lib/format";
import * as echarts from "echarts";
import { 
  resolveEuroleagueLogoUrl, 
  isLikelyUrl, 
  isWindowsPath 
} from "@/lib/teamLogos";
import { pickIdForRow, usePicks } from "@/lib/picksStore";

// ✅ Κεντρικά tokens
import { CARD_GLASS, PILL, PILL_ACTIVE } from "@/lib/uiTokens";

const ReactECharts = dynamic(() => import("echarts-for-react").then((m) => m.default), {
  ssr: false,
}) as any;

// ----- Τύποι και βοηθητικές συναρτήσεις (ίδιες με πριν) -----
type GamePoint = {
  stat?: number;
  date?: string;
  opp?: string;
  ha?: string;
  round?: string | number;
  minutes?: number | null;
  minutesRaw?: number | null;
  oppLogo?: string;
  av?: "at" | "vs";
  team?: string;
  all_players?: string[];
  home_players?: string[];
  away_players?: string[];
  team_won?: boolean | null;
};

function haToAv(haRaw: any): "at" | "vs" {
  const ha = String(haRaw ?? "").trim().toUpperCase();
  const isAway = ha === "A" || ha === "AWAY" || ha === "@";
  return isAway ? "at" : "vs";
}

function _normTeam(s: any): string {
  return String(s ?? "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, "");
}

function getRowTeamCode(row: any): string | null {
  const direct =
    row?.team_code ??
    row?.teamCode ??
    row?.teamAbbr ??
    row?.team_abbr ??
    row?.team ??
    row?.playerTeam ??
    row?.player_team ??
    row?.player?.team_code ??
    row?.player?.teamCode ??
    row?.player?.teamAbbr ??
    row?.player?.team_abbr ??
    row?.player?.team ??
    row?.prop?.team_code ??
    row?.prop?.teamCode ??
    row?.prop?.teamAbbr ??
    row?.prop?.team_abbr ??
    row?.prop?.team ??
    null;

  const d = _normTeam(direct);
  if (d) return d;

  const logoSrcRaw =
    row?.team?.logo ??
    row?.teamLogo ??
    row?.logo ??
    row?.player?.teamLogo ??
    row?.player?.logo ??
    null;

  const logo = String(logoSrcRaw ?? "").trim();
  if (!logo) return null;

  const tail = logo.split("?")[0].split("#")[0].split("/").pop() ?? "";
  const base = tail.replace(/\.[a-z0-9]+$/i, "");
  const b = _normTeam(base);
  return b || null;
}

type UpcomingMatchLite = {
  label?: string;
  value?: string;
  codes?: [string, string] | string[];
};

function inferUpcomingAvFromUpcomingList(row: any, upcomingMatches: UpcomingMatchLite[] | null): "at" | "vs" | null {
  if (!upcomingMatches || upcomingMatches.length === 0) return null;
  const team = getRowTeamCode(row);
  if (!team) return null;

  for (const m of upcomingMatches) {
    const codes = Array.isArray((m as any)?.codes) ? ((m as any).codes as any[]) : null;
    if (!codes || codes.length < 2) continue;

    const home = _normTeam(codes[0]);
    const away = _normTeam(codes[1]);
    if (team === home) return "vs";
    if (team === away) return "at";
  }
  return null;
}

function safeLogoUrl(u?: string | null): string | undefined {
  if (!u) return undefined;
  const s = String(u).trim();
  if (!s) return undefined;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) return s;
  return s;
}

function inferUpcomingAvFromRow(row: any): "at" | "vs" {
  const teamIdRaw = row?.team?.id ?? row?.team_id ?? row?.teamId ?? row?.team ?? null;
  const teamId = _normTeam(teamIdRaw);

  const matchRaw = row?.canonical_match ?? row?.match ?? row?.game_key ?? row?.gameKey ?? null;
  const m = String(matchRaw ?? "").trim();

  if (teamId && m) {
    if (m.includes("|")) {
      const parts = m.split("|");
      if (parts.length >= 3) {
        const home = _normTeam(parts[1]);
        const away = _normTeam(parts[2]);
        if (teamId === home) return "vs";
        if (teamId === away) return "at";
      }
    }

    if (m.includes("_")) {
      const parts = m.split("_");
      if (parts.length >= 3) {
        const home = _normTeam(parts[1]);
        const away = _normTeam(parts[2]);
        if (teamId === home) return "vs";
        if (teamId === away) return "at";
      }
    }
  }

  const haRaw =
    row?.ha ??
    row?.homeAway ??
    row?.home_away ??
    row?.venue ??
    row?.av ??
    row?.isHome ??
    row?.is_home ??
    null;

  if (haRaw != null) return haToAv(haRaw === true ? "HOME" : haRaw === false ? "AWAY" : haRaw);

  return "vs";
}

const API_BASE = ((process.env.NEXT_PUBLIC_API_BASE_URL as string | undefined) ||
  (process.env.NEXT_PUBLIC_API_BASE as string | undefined) ||
  "http://localhost:8000").replace(/\/+$/, "");

function getApiBase(): string {
  return API_BASE;
}

function getPlayerId(row: any): string | null {
  const pid =
    row?.player?.id ??
    row?.player_id ??
    row?.playerId ??
    row?.player?.player_id ??
    row?.player?.playerId;
  const s = String(pid ?? "").trim();
  return s ? s : null;
}

function getPlayerKey(row: any): string {
  const pid = getPlayerId(row);
  if (pid) return `id:${pid}`;
  const name = String(row?.player?.name ?? row?.playerName ?? row?.player_name ?? "").trim();
  return name ? `name:${name.toUpperCase()}` : "";
}

function isMainTier(row: any): boolean {
  const tier = String(row?.prop?.tier ?? row?.tier ?? "").toUpperCase();
  if (tier) return tier === "MAIN";
  const bt = String(row?.prop?.bet_type ?? row?.prop?.betType ?? row?.bet_type ?? "").toUpperCase();
  if (bt.includes("ALT")) return false;
  return true;
}

function normalizeSide(row: any): "OVER" | "UNDER" {
  const raw = row?.side ?? row?.betSide ?? row?.pick ?? row?.selection ?? row?.overUnder ?? row?.ou ?? "OVER";
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "UNDER" || s === "U" || s.startsWith("UNDER ") || s.includes("UNDER")) return "UNDER";
  return "OVER";
}

function oddsNumber(r: any): number {
  const raw = r?.odds ?? r?.price ?? r?.decimal ?? r?.oddsDecimal ?? r?.odds_decimal;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function resolveBestOddsDuplicate(baseRow: any, allLines?: any[]): any {
  if (!baseRow || !Array.isArray(allLines) || allLines.length === 0) return baseRow;
  const playerKey = getPlayerKey(baseRow);
  const propKey = normalizePropKey(baseRow);
  const side = normalizeSide(baseRow);
  const line = Number(baseRow?.line);
  if (!playerKey || !propKey || !Number.isFinite(line)) return baseRow;

  let best = baseRow;
  let bestOdds = oddsNumber(baseRow);

  for (const r of allLines) {
    if (!r) continue;
    if (getPlayerKey(r) !== playerKey) continue;
    if (normalizePropKey(r) !== propKey) continue;
    if (normalizeSide(r) !== side) continue;
    const ln = Number(r?.line);
    if (!Number.isFinite(ln) || ln !== line) continue;
    const o = oddsNumber(r);
    if (Number.isFinite(o) && (!Number.isFinite(bestOdds) || o > bestOdds)) {
      best = r;
      bestOdds = o;
    }
  }

  return best;
}

function hitRateFor(row: any, lastN: number): number {
  const side = normalizeSide(row);
  const line = Number(row?.line);
  const games: any[] = Array.isArray(row?.games) ? row.games : [];
  const used = games.slice(-Math.max(0, lastN));
  if (!Number.isFinite(line) || used.length === 0) return 0;
  let hits = 0;
  for (const g of used) {
    const v = Number(g?.stat ?? 0);
    const ok = side === "OVER" ? v > line : v < line;
    if (ok) hits += 1;
  }
  return hits / used.length;
}

function shortPropLabelFromRow(row: any): string {
  const key = String(normalizePropKey(row) ?? "").trim().toUpperCase();

  if (key === "POINTS") return "PTS";
  if (key === "TR") return "REB";
  if (key === "AS") return "AST";
  if (key === "ST") return "STL";
  if (key === "BL") return "BLK";
  if (key === "TO") return "TO";
  if (key === "SH_M") return "FGM";
  if (key === "SH_AT") return "FGA";
  if (key === "3P_M") return "3PM";
  if (key === "3P_A") return "3PA";
  if (key === "2P_M") return "2PM";
  if (key === "2P_A") return "2PA";
  if (key === "FT_M") return "FTM";
  if (key === "FT_A") return "FTA";
  if (key === "OR") return "OREB";
  if (key === "DR") return "DREB";
  if (key === "PR" || key === "PA" || key === "RA" || key === "PRA" || key === "PB" || key === "PRB" || key === "SB") return key;
  if (key === "FOULS") return "FOULS";
  if (key === "MIN") return "MIN";
  if (key === "DD") return "DD";
  if (key === "TD") return "TD";
  if (key === "Q1_PTS") return "1P PTS";
  if (key === "Q1_TR") return "1P REB";
  if (key === "Q1_AS") return "1P AST";
  if (key === "Q1_3P_M") return "1P 3PM";

  return key || "—";
}

function uiCategoryToPropKey(categoryKey: string): string | null {
  const t = String(categoryKey ?? "").trim().toUpperCase().replace(/\s+/g, "");
  
  if (t === "PTS" || t === "POINTS") return "POINTS";
  if (t === "REB" || t === "REBOUNDS") return "TR";
  if (t === "AST" || t === "ASSISTS") return "AS";
  if (t === "STL" || t === "STEALS") return "ST";
  if (t === "BLK" || t === "BLOCKS") return "BL";
  if (t === "TO" || t === "TURNOVERS") return "TO";
  if (t === "OREB" || t === "OFFENSIVEREBOUNDS") return "OR";
  if (t === "DREB" || t === "DEFENSIVEREBOUNDS") return "DR";
  if (t === "DD" || t === "DOUBLED0UBLE" || t === "DOUBLEDOUBLE") return "DD";
  if (t === "TD" || t === "TRIPLED0UBLE" || t === "TRIPLED0UBLE" || t === "TRIPLEDOUBLE") return "TD";
  if (t === "2PM") return "2P_M";
  if (t === "2PA") return "2P_A";
  if (t === "3PM") return "3P_M";
  if (t === "3PA") return "3P_A";
  if (t === "FTM") return "FT_M";
  if (t === "FTA") return "FT_A";
  if (t === "FGM") return "SH_M";
  if (t === "FGA") return "SH_AT";
  if (t === "PR") return "PR";
  if (t === "PA") return "PA";
  if (t === "RA") return "RA";
  if (t === "PRA") return "PRA";
  if (t === "PB") return "PB";
  if (t === "PRB") return "PRB";
  if (t === "SB") return "SB";
  if (t === "FOULS" || t === "FOULSD") return "FOULS";
  if (t === "MINUTES") return "MIN";
  if (t === "1PPOINTS" || t === "1PPOINT") return "1P_PTS";
  if (t === "1PREBOUNDS" || t === "1PREBOUND") return "1P_REB";
  if (t === "1PASSISTS" || t === "1PASSIST") return "1P_AST";
  if (t === "1P3PM") return "1P_3PM";

  return null;
}

function selectMainForCategory(opts: {
  baseRow: any;
  allLines?: any[];
  categoryKey: string;
  lastN: number;
}): any {
  const { baseRow, allLines, categoryKey, lastN } = opts;
  if (!baseRow || !Array.isArray(allLines) || allLines.length === 0) return baseRow;

  const playerKey = getPlayerKey(baseRow);
  if (!playerKey) return baseRow;

  const wantedPropKey = uiCategoryToPropKey(categoryKey);
  if (!wantedPropKey) return baseRow;

  const candidates = allLines.filter((r) => {
    if (!r) return false;
    if (getPlayerKey(r) !== playerKey) return false;
    if (!isMainTier(r)) return false;
    return normalizePropKey(r) === wantedPropKey;
  });

  if (candidates.length === 0) return baseRow;

  const byLine = new Map<number, any[]>();
  for (const r of candidates) {
    const ln = Number(r?.line);
    if (!Number.isFinite(ln)) continue;
    const arr = byLine.get(ln) ?? [];
    arr.push(r);
    byLine.set(ln, arr);
  }

  let bestLine: number | null = null;
  let bestLineOdds = -Infinity;
  for (const [ln, rows] of byLine.entries()) {
    let maxO = -Infinity;
    for (const r of rows) {
      const o = oddsNumber(r);
      if (Number.isFinite(o)) maxO = Math.max(maxO, o);
    }
    if (maxO > bestLineOdds) {
      bestLineOdds = maxO;
      bestLine = ln;
    }
  }
  if (bestLine == null) return baseRow;

  const lineRows = byLine.get(bestLine) ?? [];
  const bestOver = lineRows
    .filter((r) => normalizeSide(r) === "OVER")
    .reduce((best: any, r: any) => {
      if (!best) return r;
      const o1 = oddsNumber(best);
      const o2 = oddsNumber(r);
      if (!Number.isFinite(o1)) return r;
      if (Number.isFinite(o2) && o2 > o1) return r;
      return best;
    }, null as any);

  const bestUnder = lineRows
    .filter((r) => normalizeSide(r) === "UNDER")
    .reduce((best: any, r: any) => {
      if (!best) return r;
      const o1 = oddsNumber(best);
      const o2 = oddsNumber(r);
      if (!Number.isFinite(o1)) return r;
      if (Number.isFinite(o2) && o2 > o1) return r;
      return best;
    }, null as any);

  const hrOver = bestOver ? hitRateFor(bestOver, lastN) : -Infinity;
  const hrUnder = bestUnder ? hitRateFor(bestUnder, lastN) : -Infinity;
  const pick = hrOver >= hrUnder ? bestOver : bestUnder;

  return pick ? resolveBestOddsDuplicate(pick, allLines) : baseRow;
}

function normalizePropKey(row: any): string {
  const sk = row?.prop?.sheet_key ?? row?.prop?.sheetKey ?? row?.sheet_key ?? row?.sheetKey;
  const s1 = String(sk ?? "").trim();
  if (s1) {
    const k = s1.toUpperCase().trim();

    if (k === "OREB" || k === "OFFENSIVE REBOUNDS") return "OR";
    if (k === "DREB" || k === "DEFENSIVE REBOUNDS") return "DR";
    if (k === "REB" || k === "REBOUNDS" || k === "TR") return "TR";
    if (k === "AST" || k === "ASSISTS" || k === "AS") return "AS";
    if (k === "STL" || k === "STEALS" || k === "ST") return "ST";
    if (k === "BLK" || k === "BLOCKS" || k === "BL") return "BL";
    if (k === "PTS" || k === "POINTS") return "POINTS";
    if (k === "FGM" || k === "FG MADE" || k === "FGMADE" || k === "FIELD GOALS SCORED / FG MADE") return "SH_M";
    if (k === "FGA" || k === "SH_AT" || k === "FIELD GOALS ATTEMPTED") return "SH_AT";
    if (k === "3PM") return "3P_M";
    if (k === "2PM") return "2P_M";
    if (k === "Q1_3PM") return "Q1_3P_M";
    if (k === "Q1_3P_M") return "Q1_3P_M";
    if (k === "Q1_PTS") return "Q1_PTS";
    if (k === "Q1_TR") return "Q1_TR";
    if (k === "Q1_AS") return "Q1_AS";

    return k;
  }

  const raw =
    row?.prop?.key ??
    row?.prop?.label ??
    row?.prop?.ui_name ??
    row?.propLabel ??
    row?.market ??
    row?.stat ??
    "";

  const up = String(raw)
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9+_]/g, "");

  if (up === "POINTS" || up === "PTS") return "POINTS";
  if (up === "REBOUNDS" || up === "REB") return "TR";
  if (up === "ASSISTS" || up === "AST") return "AS";
  if (up === "STEALS" || up === "STL") return "ST";
  if (up === "BLOCKS" || up === "BLK") return "BL";
  if (up === "TURNOVERS" || up === "TO") return "TO";
  if (up === "3PM" || up === "3PTM" || up === "3POINTERSMADE" || up === "3P_M") return "3P_M";
  if (up === "PTS+REB" || up === "POINTS+REBOUNDS") return "PR";
  if (up === "PTS+AST" || up === "POINTS+ASSISTS") return "PA";
  if (up === "REB+AST" || up === "REBOUNDS+ASSISTS") return "RA";
  if (up === "PTS+REB+AST" || up === "POINTS+REBOUNDS+ASSISTS") return "PRA";
  if (up === "OREB" || up === "OFFENSIVEREBOUNDS") return "OR";
  if (up === "DREB" || up === "DEFENSIVEREBOUNDS") return "DR";
  if (up === "FGM") return "SH_M";
  if (up === "FGA") return "SH_AT";
  if (up === "FTM") return "FT_M";
  if (up === "FTA") return "FT_A";
  if (up === "2PM") return "2P_M";
  if (up === "2PA") return "2P_A";
  if (up === "3PA") return "3P_A";
  if (up === "1PPOINTS" || up === "Q1POINTS") return "Q1_PTS";
  if (up === "1PREBOUNDS" || up === "Q1REBOUNDS") return "Q1_TR";
  if (up === "1PASSISTS" || up === "Q1ASSISTS") return "Q1_AS";
  if (up === "1P3PM" || up === "Q13PM" || up === "Q13PMADE") return "Q1_3P_M";
  return up;
}

function statForProp(game: any, propKey: string): number {
  const g = game ?? {};
  const final = (g?.final ?? g?.FINAL ?? g?.stats?.final ?? g?.boxscore ?? {}) as any;
  const key = String(propKey ?? "").trim().toUpperCase();

  const raw = final?.[key];

  if (raw === "#TRUE#") return 1;
  if (raw === "#FALSE#") return 0;

  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function parseMinutes(raw: any): number | null {
  if (raw == null) return null;

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    if (raw > 300) return raw / 60;
    return raw;
  }

  const s = String(raw).replace(",", ".").trim();
  if (!s) return null;

  if (s.includes(":")) {
    const parts = s.split(":").map((p) => p.trim());
    if (parts.length === 2) {
      const mm = Number(parts[0]);
      const ss = Number(parts[1]);
      if (!Number.isFinite(mm)) return null;
      const secPart = Number.isFinite(ss) ? ss / 60 : 0;
      const v = mm + secPart;
      return Number.isFinite(v) ? v : null;
    }
    if (parts.length === 3) {
      const hh = Number(parts[0]);
      const mm = Number(parts[1]);
      const ss = Number(parts[2]);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
      const secPart = Number.isFinite(ss) ? ss / 60 : 0;
      const v = hh * 60 + mm + secPart;
      return Number.isFinite(v) ? v : null;
    }
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n > 300) return n / 60;
  return n;
}

function pickMinutes(g: any): number | null {
  const v =
    g?.minutes ??
    g?.MINUTES ??
    g?.Minutes ??
    g?.mins ??
    g?.min ??
    g?.mp ??
    g?.minutes_played ??
    g?.minutesPlayed ??
    g?.stats?.minutes ??
    g?.stats?.mp ??
    g?.boxscore?.mp ??
    g?.final?.minutes ??
    g?.final?.MIN ??
    g?.final?.MP ??
    g?.final?.TIME ??
    g?.final?.Time ??
    g?.final?.time ??
    g?.stats?.MIN ??
    g?.stats?.MP ??
    g?.boxscore?.MIN ??
    g?.boxscore?.MP;

  return parseMinutes(v);
}

function roundToNum(r: any): number | undefined {
  if (r == null) return undefined;
  const m = String(r).match(/(\d+)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function pickLabel(g: any): string {
  const o = String(g?.opp ?? g?.opponent ?? g?.oppAbbr ?? g?.opp_abbr ?? "");
  const haRaw = String(g?.ha ?? g?.homeAway ?? g?.home_away ?? g?.home_away ?? g?.venue ?? "");
  const ha = haRaw.trim().toUpperCase();

  if (o) {
    const isAway = ha === "A" || ha === "AWAY" || ha === "@";
    const prefix = isAway ? "at " : "vs ";
    return prefix + o;
  }

  const d = String(g?.date ?? g?.gameDate ?? g?.dt ?? "");
  if (d) return d.slice(5, 10);

  return "";
}

function niceMax(v: number) {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  let m = 1;
  if (n <= 1) m = 1;
  else if (n <= 2) m = 2;
  else if (n <= 5) m = 5;
  else m = 10;
  return m * p;
}

function useMounted() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return mounted;
}

function useLockBodyScroll(locked: boolean) {
  React.useEffect(() => {
    if (!locked) return;

    const scrollY = window.scrollY || 0;
    const body = document.body;

    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    };

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";

    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      body.style.paddingRight = prev.paddingRight;

      window.scrollTo(0, scrollY);
    };
  }, [locked]);
}

function ClampButtons({
  value,
  options,
  onChange,
}: {
  value: number;
  options: number[];
  onChange: (v: number) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-xl">
      {options.map((n) => {
        const active = n === value;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={clsx(
              "h-8 rounded-full px-3 text-xs font-semibold transition",
              active
                ? "bg-white/15 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.10)]"
                : "text-white/70 hover:bg-white/10 hover:text-white"
            )}
          >
            L{n}
          </button>
        );
      })}
    </div>
  );
}

// ✅ Memoized chart component without internal filtering
const CinematicEChartsBar = React.memo(function CinematicEChartsBar({
  data,
  lineValue,
  propShortLabel,
  height = 240,
  pickSide,
}: {
  data: GamePoint[];
  lineValue: number;
  propShortLabel: string;
  height?: number;
  pickSide?: "OVER" | "UNDER";
}) {
  const isUnderPick = String(pickSide ?? "OVER").toUpperCase() === "UNDER";

  const orderedChartData = React.useMemo(() => {
    const arr = data.map((d, idx) => {
      const v = Number(d.stat ?? 0);
      const dt = String((d as any)?.date ?? (d as any)?.gameDate ?? (d as any)?.dt ?? "");
      const ts = dt ? Date.parse(dt) : NaN;

      const roundRaw = (d as any)?.round ?? (d as any)?.roundNum ?? (d as any)?.round_name;
      const roundNum = roundToNum(roundRaw);

      return {
        ...d,
        v,
        label: pickLabel(d),
        av: (d as any)?.av ?? haToAv((d as any)?.ha),
        oppLogo:
          (d as any)?.oppLogo ||
          (d as any)?.opp_logo ||
          (d as any)?.oppTeamLogo ||
          (d as any)?.opp_team_logo ||
          (d as any)?.opp?.logo ||
          (d as any)?.opp?.teamLogo ||
          (d as any)?.opp,
        over: v > lineValue,
        hit: isUnderPick ? v < lineValue : v > lineValue,
        roundNum,
        ts: Number.isFinite(ts) ? ts : undefined,
        _idx: idx,
      };
    });

    arr.sort((a, b) => {
      const ar = a.roundNum;
      const br = b.roundNum;
      if (typeof ar === "number" || typeof br === "number") {
        return (br ?? -1) - (ar ?? -1);
      }
      const at = a.ts;
      const bt = b.ts;
      if (typeof at === "number" || typeof bt === "number") {
        return (bt ?? -1) - (at ?? -1);
      }
      return (a._idx ?? 0) - (b._idx ?? 0);
    });

    return arr;
  }, [data, lineValue, isUnderPick]);

  const logoUrlByIdx = React.useMemo(() => {
    const next: Record<number, string | undefined> = {};
    if (!orderedChartData || orderedChartData.length === 0) return next;
    
    for (let i = 0; i < orderedChartData.length; i++) {
      const raw = (orderedChartData[i] as any)?.oppLogo;
      const rawStr = String(raw ?? "").trim();
      if (!rawStr) {
        next[i] = undefined;
        continue;
      }

      if (isWindowsPath(rawStr)) {
        next[i] = undefined;
        continue;
      }

      if (isLikelyUrl(rawStr)) {
        const direct = safeLogoUrl(rawStr);
        next[i] = direct && !isWindowsPath(direct) ? direct : undefined;
        continue;
      }

      next[i] = resolveEuroleagueLogoUrl(rawStr);
    }
    return next;
  }, [orderedChartData]);

  const logoSize = React.useMemo(() => {
    if (!orderedChartData || orderedChartData.length === 0) return 28;
    const barsCount = orderedChartData.length;
    return barsCount >= 20 ? 18 : barsCount >= 15 ? 22 : 28;
  }, [orderedChartData]);

  const maxV = React.useMemo(() => {
    if (!orderedChartData || orderedChartData.length === 0) return niceMax(lineValue);
    const raw = Math.max(lineValue, ...orderedChartData.map((d) => Number(d.v ?? 0)));
    return niceMax(raw);
  }, [orderedChartData, lineValue]);

  const n = React.useMemo(() => {
    return Math.max(1, orderedChartData?.length || 1);
  }, [orderedChartData]);

  const barWidth = React.useMemo(() => {
    return n <= 5 ? 38 : n <= 10 ? 26 : n <= 15 ? 18 : 14;
  }, [n]);

  const circularLogoCacheRef = React.useRef<Map<string, string>>(new Map());
  const [circularLogoUrlByIdx, setCircularLogoUrlByIdx] = React.useState<Record<number, string | undefined>>({});

  React.useEffect(() => {
    if (!orderedChartData || orderedChartData.length === 0) return;
    
    let alive = true;

    const makeCircular = async (url: string, size: number): Promise<string> => {
      const s = Math.max(1, Math.floor(size));
      const scale = Math.max(1, Math.min(4, Math.ceil((window.devicePixelRatio || 1) * 2)));
      const cacheKey = `${url}@@${s}@@${scale}`;
      const cached = circularLogoCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const out = await new Promise<string>((resolve) => {
        try {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            try {
              const canvas = document.createElement("canvas");
              canvas.width = s * scale;
              canvas.height = s * scale;

              const ctx = canvas.getContext("2d");
              if (!ctx) return resolve(url);

              ctx.setTransform(scale, 0, 0, scale, 0, 0);
              ctx.clearRect(0, 0, s, s);

              ctx.imageSmoothingEnabled = true;
              // @ts-ignore
              if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = "high";

              ctx.save();
              ctx.beginPath();
              ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
              ctx.closePath();
              ctx.clip();

              const iw = img.naturalWidth || (img as any).width || s;
              const ih = img.naturalHeight || (img as any).height || s;
              const ratio = Math.min(s / iw, s / ih);
              const dw = iw * ratio;
              const dh = ih * ratio;
              const dx = (s - dw) / 2;
              const dy = (s - dh) / 2;

              ctx.drawImage(img, dx, dy, dw, dh);
              ctx.restore();

              resolve(canvas.toDataURL("image/png"));
            } catch {
              resolve(url);
            }
          };
          img.onerror = () => resolve(url);
          img.src = url;
        } catch {
          resolve(url);
        }
      });

      circularLogoCacheRef.current.set(cacheKey, out);
      return out;
    };

    (async () => {
      const next: Record<number, string | undefined> = {};
      const entries = Object.entries(logoUrlByIdx || {});
      for (const [k, url] of entries) {
        const i = Number(k);
        if (!url) {
          next[i] = undefined;
          continue;
        }
        next[i] = await makeCircular(url, logoSize);
      }
      if (alive) setCircularLogoUrlByIdx(next);
    })();

    return () => {
      alive = false;
    };
  }, [logoUrlByIdx, logoSize, orderedChartData]);

  const option = React.useMemo(() => {
    if (!orderedChartData || orderedChartData.length === 0) return null;
    
    const labels = orderedChartData.map((d, idx) => `${d.label}__${idx}`);
    const values = orderedChartData.map((d) => d.v);

    const rich: Record<string, any> = {
      av: {
        color: "rgba(255,255,255,0.65)",
        fontWeight: 700,
        fontSize: 11,
        lineHeight: 14,
        align: "center",
      },
    };

    for (let i = 0; i < orderedChartData.length; i++) {
      const url = circularLogoUrlByIdx[i] ?? logoUrlByIdx[i];
      rich[`logo${i}`] = {
        width: logoSize,
        height: logoSize,
        align: "center",
        backgroundColor: url ? { image: url } : "rgba(255,255,255,0.10)",
        backgroundRepeat: "no-repeat",
        backgroundSize: "contain",
        backgroundPosition: "center",
        borderRadius: Math.floor(logoSize / 2),
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.18)",
      };
    }

    const greenGrad = (alphaTop = 0.28) =>
      new (echarts as any).graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: `rgba(34,197,94,${alphaTop})` },
        { offset: 0.28, color: "rgba(34,197,94,0.98)" },
        { offset: 1, color: "rgba(16,185,129,0.92)" },
      ]);

    const redGrad = (alphaTop = 0.28) =>
      new (echarts as any).graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: `rgba(239,68,68,${alphaTop})` },
        { offset: 0.28, color: "rgba(239,68,68,0.98)" },
        { offset: 1, color: "rgba(244,63,94,0.92)" },
      ]);

    return {
      backgroundColor: "transparent",
      grid: { left: 44, right: 16, top: 14, bottom: 76 },
      xAxis: {
        type: "category",
        data: labels,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.14)", width: 2 } },
        axisLabel: {
          margin: 18,
          interval: 0,
          hideOverlap: false,
          formatter: (v: any) => {
            const s = String(v);
            const parts = s.split("__");
            const idx = Number(parts[1]);
            const d: any = Number.isFinite(idx) ? orderedChartData[idx] : undefined;
            if (!d) return parts[0];
            const av = d.av === "at" ? "at" : "vs";
            return `{av|${av}}\n{logo${idx}|}`;
          },
          rich,
        },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: maxV,
        splitNumber: 4,
        axisLabel: { color: "rgba(255,255,255,0.70)", fontWeight: 700, fontSize: 11, margin: 10 },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.18)", width: 2 } },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)", width: 1 } },
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(255,255,255,0.04)" } },
        backgroundColor: "rgba(10,10,12,0.86)",
        borderColor: "rgba(255,255,255,0.12)",
        borderWidth: 1,
        textStyle: { color: "#fff", fontWeight: 800, fontSize: 12 },
        extraCssText:
          "border-radius:12px; box-shadow:0 18px 50px rgba(0,0,0,0.65); backdrop-filter:blur(12px); padding:8px 10px;",
        position: (pos: any, _params: any, _dom: any, _rect: any, size: any) => {
          const x = Array.isArray(pos) ? Number(pos[0] ?? 0) : 0;
          const y = Array.isArray(pos) ? Number(pos[1] ?? 0) : 0;

          const contentW = Number(size?.contentSize?.[0] ?? 0);
          const contentH = Number(size?.contentSize?.[1] ?? 0);
          const viewW = Number(size?.viewSize?.[0] ?? 0);
          const viewH = Number(size?.viewSize?.[1] ?? 0);

          const margin = 8;
          let left = x - contentW / 2;
          let top = y - contentH - 14;

          left = Math.max(margin, Math.min(left, viewW - contentW - margin));
          top = Math.max(margin, Math.min(top, viewH - contentH - margin));

          return [left, top];
        },
        formatter: (params: any) => {
          if (!params || !Array.isArray(params) || params.length === 0) return "";
          const p = params[0];
          if (!p) return "";
          const idx = p.dataIndex;
          if (idx === undefined || idx === null) return "";
          const d = orderedChartData[idx];
          if (!d) return "";

          const oppRaw = String(
  d?.opp ?? (d && "opponent" in d ? d.opponent : "") ?? ""
).trim();
          const opp = oppRaw || String(d?.label ?? "").replace(/^\s*(vs|at)\s+/i, "").trim() || "—";
          const av = d?.av === "at" ? "at" : "vs";

          const mm = Number(d?.minutes);
          const minutesText = Number.isFinite(mm) ? String(Math.round(mm)) : "—";

          const vv = Number(d?.v ?? 0);
          const fmtAch = (x: number) => {
            if (!Number.isFinite(x)) return "—";
            const r = Math.round(x);
            return Math.abs(x - r) < 1e-6 ? String(r) : String(Math.round(x * 10) / 10);
          };
          const achText = `${fmtAch(vv)} ${String(propShortLabel ?? "").trim() || "—"}`;

          const dot = d?.hit ? "rgba(34,197,94,0.98)" : "rgba(239,68,68,0.98)";

          return `
            <div style="display:flex;flex-direction:column;gap:4px;min-width:140px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
                <div style="font-weight:900;opacity:0.98">${av} ${opp}</div>
                <span style="width:9px;height:9px;border-radius:999px;background:${dot};box-shadow:0 0 0 3px rgba(255,255,255,0.08)"></span>
              </div>
              <div style="font-size:11px;opacity:0.78;font-weight:800">MIN: <span style="opacity:0.98">${minutesText}</span></div>
              <div style="font-size:12px;opacity:0.92;font-weight:900">${achText}</div>
            </div>
          `;
        },
      },
      series: [
        {
          type: "line",
          data: labels.map(() => lineValue),
          symbol: "none",
          lineStyle: { color: "rgba(250,204,21,0.22)", width: 12 },
          z: 1,
          silent: true,
        },
        {
          type: "line",
          data: labels.map(() => lineValue),
          symbol: "none",
          lineStyle: { color: "rgba(250,204,21,0.92)", width: 2.4, type: "dashed", dashOffset: 4 },
          z: 3,
          silent: true,
        },
        {
          type: "bar",
          data: values,
          barWidth,
          barCategoryGap: n >= 18 ? "12%" : "24%",
          barGap: "20%",
          label: {
            show: true,
            position: "top",
            color: "#ffffff",
            fontSize: 10,
            fontWeight: 600,
            formatter: (params: any) => Math.round(params.value),
          },
          itemStyle: {
            borderRadius: [12, 12, 12, 12],
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.12)",
            shadowBlur: 18,
            shadowOffsetY: 8,
            color: (params: any) => {
              const d = orderedChartData[params.dataIndex];
              return d?.hit ? greenGrad() : redGrad();
            },
            shadowColor: (params: any) => {
              const d = orderedChartData[params.dataIndex];
              return d?.hit ? "rgba(34,197,94,0.20)" : "rgba(239,68,68,0.18)";
            },
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 26,
              shadowOffsetY: 10,
              borderColor: "rgba(255,255,255,0.18)",
            },
          },
          z: 4,
        },
      ],
      animation: true,
      animationDuration: 700,
      animationEasing: "cubicOut",
    };
  }, [orderedChartData, lineValue, propShortLabel, maxV, barWidth, logoUrlByIdx, circularLogoUrlByIdx, logoSize, n]);

  if (!orderedChartData || orderedChartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[240px] text-white/50">
        No data available
      </div>
    );
  }

  // Clean, minimal chart card (cinematic blobs removed)
  return (
    <div className={clsx(CARD_GLASS, "relative overflow-hidden")}>
      <div className="relative" style={{ height }}>
        <ReactECharts 
          option={option} 
          notMerge={false} 
          lazyUpdate={true} 
          style={{ height: "100%", width: "100%" }}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
    </div>
  );
});

function useResponsiveDrawerWidth() {
  const [widthClass, setWidthClass] = React.useState("w-[min(94vw,440px)]");

  React.useEffect(() => {
    const updateWidth = () => {
      const width = window.innerWidth;
      const landscape = window.matchMedia("(orientation: landscape)").matches;
      
      if (width > 1024) {
        setWidthClass("w-[min(60vw,800px)]");
      } else if (landscape) {
        setWidthClass("w-[min(80vw,600px)]");
      } else {
        setWidthClass("w-[min(94vw,440px)]");
      }
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    window.addEventListener("orientationchange", updateWidth);
    return () => {
      window.removeEventListener("resize", updateWidth);
      window.removeEventListener("orientationchange", updateWidth);
    };
  }, []);

  return widthClass;
}

export function BetDrawerOverlay({
  row,
  top,
  left,
  width,
  onClose,
  allLines,
  initialLastN,
}: {
  row?: BetLine;
  top: number;
  left: number;
  width: number;
  onClose: () => void;
  allLines?: BetLine[];
  initialLastN?: number;
}) {
  const mounted = useMounted();
  const drawerWidthClass = useResponsiveDrawerWidth();

  React.useEffect(() => {
    if (allLines) {
      console.log(`📊 BetDrawer: Φορτώθηκαν ${allLines.length} γραμμές`);
    }
  }, [allLines]);

  const [activeRow, setActiveRow] = React.useState<BetLine | undefined>(() =>
    row ? (resolveBestOddsDuplicate(row, allLines) as BetLine) : undefined
  );

  const pickRow = React.useMemo(() => {
    if (!activeRow) return null;
    const teamKey = (activeRow as any)?.__teamKey ??
      (activeRow as any)?.player?.teamKey ??
      (activeRow as any)?.player?.team_key ??
      (activeRow as any)?.player?.teamSlug ??
      null;
    
    return { ...(activeRow as any), __teamKey: teamKey };
  }, [activeRow]);

  const pickId = React.useMemo(() => {
    if (!pickRow) return null;
    return pickIdForRow(pickRow as any);
  }, [pickRow]);

  const picked = usePicks((s) => (pickId ? !!s.picks[pickId] : false));
  const togglePick = usePicks((s) => s.togglePick);

  const onPickToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pickRow) {
      togglePick(pickRow as any);
    }
  };

  useLockBodyScroll(mounted && !!activeRow);

  React.useEffect(() => {
    if (!row) {
      setActiveRow(undefined);
      return;
    }
    setActiveRow(resolveBestOddsDuplicate(row, allLines) as BetLine);
  }, [(row as any)?.id, allLines]);

  const inferredInitialLastN = React.useMemo(() => {
    const cand = [
      initialLastN,
      (row as any)?.lastN,
      (row as any)?.last_n,
      (row as any)?.last,
      (row as any)?.hitRateN,
      (row as any)?.hit_rate_n,
      (row as any)?.selectedLastN,
      (row as any)?.selected_last_n,
      (row as any)?.filters?.lastN,
      (row as any)?.filters?.last_n,
      (row as any)?.hitRate?.n,
      (row as any)?.meta?.lastN,
      (row as any)?.meta?.last_n,
    ]
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0);

    const n = cand[0] ?? 15;
    if (n <= 5) return 5;
    if (n <= 10) return 10;
    if (n <= 15) return 15;
    return 20;
  }, [(row as any)?.id, initialLastN]);

  const [lastN, setLastN] = React.useState<number>(() => inferredInitialLastN);

  React.useEffect(() => {
    setLastN(inferredInitialLastN);
  }, [inferredInitialLastN]);

  // Παλιά φίλτρα
  const [minMinutes, setMinMinutes] = React.useState<number | null>(null);
  const [maxMinutes, setMaxMinutes] = React.useState<number | null>(50.0);
  const [minutesFolded, setMinutesFolded] = React.useState<boolean>(true);
  const [onlyUpcomingVenue, setOnlyUpcomingVenue] = React.useState<boolean>(false);

  const [propTab, setPropTab] = React.useState<"MAIN" | "SHOTS" | "COMBOS" | "OTHER" | "1P">("MAIN");

  // ΝΕΑ STATE
  const [selectedPlayers, setSelectedPlayers] = React.useState<string[]>([]);
  const [playerFilterMode, setPlayerFilterMode] = React.useState<"with" | "without">("with");
  const [filterTeamWins, setFilterTeamWins] = React.useState<boolean | null>(null);
  const [showPlayerSelector, setShowPlayerSelector] = React.useState(false);
  const [teammateNames, setTeammateNames] = React.useState<Record<string, string>>({});

  // 🔧 Cache για ονόματα συμπαικτών
  const teammateNameCache = React.useRef<Record<string, string>>({});

  // REVERSED LINE state
  const [reversedLine, setReversedLine] = React.useState(false);

  // Reset reversedLine όταν αλλάζει παίκτης ή γραμμή
  const activePlayerKey = React.useMemo(() => getPlayerKey(activeRow), [activeRow]);
  const activePropKey = React.useMemo(() => normalizePropKey(activeRow), [activeRow]);
  const activeLine = React.useMemo(() => Number((activeRow as any)?.line), [activeRow]);

  React.useEffect(() => {
    setReversedLine(false);
  }, [activePlayerKey, activePropKey, activeLine]);

  const playerKeyForMenu = React.useMemo(() => getPlayerKey(activeRow), [activeRow]);

  const availablePropKeysForPlayer = React.useMemo(() => {
    const set = new Set<string>();
    if (!playerKeyForMenu || !Array.isArray(allLines) || allLines.length === 0) {
      return set;
    }
    
    for (const r of allLines) {
      if (!r) continue;
      if (getPlayerKey(r) !== playerKeyForMenu) continue;
      if (!isMainTier(r)) continue;
      const pk = normalizePropKey(r);
      if (pk) set.add(pk);
    }
    
    return set;
  }, [allLines, playerKeyForMenu]);

  const tabHasAny = React.useCallback(
    (tab: "MAIN" | "SHOTS" | "COMBOS" | "OTHER" | "1P") => {
      const labels =
        tab === "MAIN"
          ? ["PTS", "REB", "OREB", "DREB", "AST", "TO", "STL", "BLK"]
          : tab === "SHOTS"
          ? ["2PM", "2PA", "3PM", "3PA", "FTM", "FTA", "FGM", "FGA"]
          : tab === "COMBOS"
          ? ["PRA", "PR", "PA", "RA", "PRB", "PB", "SB"]
          : tab === "OTHER"
          ? ["FOULS", "FOULS D", "MINUTES", "DD", "TD"]
          : ["1P POINTS", "1P REBOUNDS", "1P ASSISTS", "1P 3PM"];

      for (const l of labels) {
        const pk = uiCategoryToPropKey(l);
        if (pk && availablePropKeysForPlayer.has(pk)) return true;
      }
      return false;
    },
    [availablePropKeysForPlayer]
  );

  const isCategoryAvailable = React.useCallback(
    (label: string) => {
      const pk = uiCategoryToPropKey(label);
      return !!(pk && availablePropKeysForPlayer.has(pk));
    },
    [availablePropKeysForPlayer]
  );

  const isCategoryActive = React.useCallback(
    (label: string) => {
      const pk = uiCategoryToPropKey(label);
      const cur = normalizePropKey(activeRow);
      return !!(pk && cur && pk === cur);
    },
    [activeRow]
  );

  const minutesAnchorRef = React.useRef<HTMLDivElement | null>(null);
  const [minutesAnchorRect, setMinutesAnchorRect] = React.useState<DOMRect | null>(null);

  React.useEffect(() => {
    if (minutesFolded) return;

    const updateRect = () => {
      if (minutesAnchorRef.current) {
        setMinutesAnchorRect(minutesAnchorRef.current.getBoundingClientRect());
      }
    };

    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [minutesFolded]);

  const [projectionEnabled, setProjectionEnabled] = React.useState<boolean>(false);
  const [projectionDelta, setProjectionDelta] = React.useState<number>(5);
  const [projectionDir, setProjectionDir] = React.useState<"more" | "less">("more");

  const upcomingAv = React.useMemo(() => inferUpcomingAvFromRow(row), [row]);
  const upcomingVenueLabel = React.useMemo(() => {
    return upcomingAv === "vs" ? "SHOW ONLY HOME MATCHES" : "SHOW ONLY AWAY MATCHES";
  }, [upcomingAv]);

  React.useEffect(() => {
    setOnlyUpcomingVenue(false);
    setProjectionEnabled(false);
  }, [row]);

  const [backendGames, setBackendGames] = React.useState<any[] | null>(null);
  const [loadingGames, setLoadingGames] = React.useState(false);
  const [gamesError, setGamesError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setBackendGames(null);
    setGamesError(null);
  }, [row?.id]);

  const MIN_STEP = 0.5;
  const MIN_LIMIT = 0.5;
  const MAX_LIMIT = 50.0;

  const minutesFilterActive = (minMinutes != null || maxMinutes != null);

  const ACTIVE_GLOW_STYLE: React.CSSProperties = {
    boxShadow:
      "0 0 0 1px rgba(190,18,60,0.60), 0 0 22px rgba(190,18,60,0.50), 0 0 42px rgba(190,18,60,0.22)",
  };

  const clampToStep = (v: number) => {
    const rounded = Math.round(v / MIN_STEP) * MIN_STEP;
    const clamped = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, rounded));
    return Number(clamped.toFixed(1));
  };

  const adjustMin = (dir: -1 | 1) => {
    setMinMinutes((cur) => {
      const base = cur == null ? MIN_LIMIT : cur;
      return clampToStep(base + dir * MIN_STEP);
    });
  };

  const adjustMax = (dir: -1 | 1) => {
    setMaxMinutes((cur) => {
      const base = cur == null ? MAX_LIMIT : cur;
      return clampToStep(base + dir * MIN_STEP);
    });
  };

  const holdRef = React.useRef<{ t?: any; i?: any } | null>(null);
  const stopHold = React.useCallback(() => {
    if (!holdRef.current) return;
    if (holdRef.current.t) clearTimeout(holdRef.current.t);
    if (holdRef.current.i) clearInterval(holdRef.current.i);
    holdRef.current.t = undefined;
    holdRef.current.i = undefined;
  }, []);

  React.useEffect(() => {
    return () => stopHold();
  }, [stopHold]);

  const makeHoldHandlers = React.useCallback(
    (fn: () => void) => {
      const onPointerDown = (e: React.PointerEvent) => {
        e.preventDefault();
        fn();
        stopHold();
        holdRef.current = holdRef.current ?? {};
        holdRef.current.t = setTimeout(() => {
          holdRef.current!.i = setInterval(fn, 75);
        }, 220);
      };
      const onPointerUp = () => stopHold();
      const onPointerLeave = () => stopHold();
      const onPointerCancel = () => stopHold();
      return { onPointerDown, onPointerUp, onPointerLeave, onPointerCancel };
    },
    [stopHold]
  );

  React.useEffect(() => {
    if (minMinutes == null || maxMinutes == null) return;
    if (minMinutes > maxMinutes) setMaxMinutes(minMinutes);
  }, [minMinutes, maxMinutes]);

  React.useEffect(() => {
    if (minMinutes == null || maxMinutes == null) return;
    if (maxMinutes < minMinutes) setMinMinutes(maxMinutes);
  }, [maxMinutes, minMinutes]);

  React.useEffect(() => {
    if (!mounted || !activeRow) return;

    const useDummies = String(process.env.NEXT_PUBLIC_USE_DUMMIES ?? "false").toLowerCase() === "true";
    if (useDummies) return;

    const playerId = getPlayerId(activeRow);
    if (!playerId) {
      setGamesError("Missing player_id on row");
      return;
    }

    const ac = new AbortController();
    const run = async () => {
      try {
        setLoadingGames(true);
        setGamesError(null);

        const url = `${getApiBase()}/api/player/${encodeURIComponent(playerId)}/history?last_n=${encodeURIComponent(
          String(lastN)
        )}`;
        const res = await fetch(url, {
          method: "GET",
          signal: ac.signal,
          headers: { Accept: "application/json" },
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} ${res.statusText}${txt ? ` – ${txt}` : ""}`);
        }

        const json = await res.json();
        const games = (json?.recent_games ?? json?.recentGames ?? []) as any[];
        setBackendGames(Array.isArray(games) ? games : []);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setGamesError(e?.message ? String(e.message) : "Failed to load games");
        setBackendGames([]);
      } finally {
        setLoadingGames(false);
      }
    };

    run();
    return () => ac.abort();
  }, [mounted, (activeRow as any)?.id, lastN]);

  const points: GamePoint[] = React.useMemo(() => {
    if (!activeRow) return [];
    const propKey = normalizePropKey(activeRow);
    const games: any[] = (backendGames ?? (activeRow as any)?.games ?? []) as any[];
    return games.slice(-lastN).map((g) => {
      const ha = String(g?.ha ?? g?.homeAway ?? g?.home_away ?? g?.venue ?? g?.home_away ?? "");
      const minutesRaw = pickMinutes(g);
      const baseStat = statForProp(g, propKey);

      const signedDelta = projectionDir === "more" ? projectionDelta : -projectionDelta;
      const projectedMinutes =
        projectionEnabled && typeof minutesRaw === "number" && Number.isFinite(minutesRaw)
          ? Math.max(0.1, minutesRaw + signedDelta)
          : minutesRaw;

      const projectedStat =
  projectionEnabled &&
  typeof minutesRaw === "number" &&
  Number.isFinite(minutesRaw) &&
  minutesRaw > 0 &&
  typeof projectedMinutes === "number" &&
  Number.isFinite(projectedMinutes)
    ? Math.max(0, (baseStat / minutesRaw) * projectedMinutes)
    : baseStat;

      return {
        stat: projectedStat,
        minutes: projectedMinutes,
        minutesRaw,
        date: String(g?.date ?? g?.gameDate ?? g?.dt ?? ""),
        opp: String(g?.opp ?? g?.opponent ?? g?.oppAbbr ?? ""),
        ha,
        av: haToAv(ha),
        oppLogo:
          g?.oppLogo ||
          g?.opp_logo ||
          g?.oppTeamLogo ||
          g?.opp_team_logo ||
          g?.opp?.logo ||
          g?.opp?.teamLogo ||
          g?.oppAbbr ||
          g?.opp ||
          "",
        round: g?.round ?? g?.Round ?? g?.round_name ?? g?.roundName,
        team: g?.team,
        all_players: g?.all_players || [],
        home_players: g?.home_players || [],
        away_players: g?.away_players || [],
        team_won: g?.team_won,
      };
    });
  }, [activeRow, lastN, backendGames, projectionEnabled, projectionDelta, projectionDir]);

  // Υπολογισμός συμπαικτών (με τη σωστή λογική)
  const teammateIds = React.useMemo(() => {
    const teammates = new Set<string>();
    if (!activeRow) return [];

    const playerId = getPlayerId(activeRow);
    if (!playerId) return [];

    points.forEach(p => {
      const homePlayers = p.home_players || [];
      const awayPlayers = p.away_players || [];
      const allPlayers = p.all_players || [];

      if (homePlayers.length > 0 || awayPlayers.length > 0) {
        if (homePlayers.includes(playerId)) {
          homePlayers.forEach(id => {
            if (id !== playerId) teammates.add(id);
          });
        } else if (awayPlayers.includes(playerId)) {
          awayPlayers.forEach(id => {
            if (id !== playerId) teammates.add(id);
          });
        } else {
          allPlayers.forEach(id => {
            if (id !== playerId) teammates.add(id);
          });
        }
      } else {
        allPlayers.forEach(id => {
          if (id !== playerId) teammates.add(id);
        });
      }
    });

    return Array.from(teammates);
  }, [points, activeRow]);

  // Φόρτωση ονομάτων συμπαικτών (παράλληλα)
  React.useEffect(() => {
    const fetchMissingNames = async () => {
      const toFetch: string[] = [];
      for (const playerId of teammateIds) {
        if (!teammateNameCache.current[playerId]) {
          toFetch.push(playerId);
        }
      }

      if (toFetch.length === 0) {
        setTeammateNames({ ...teammateNameCache.current });
        return;
      }

      await Promise.all(
        toFetch.map(async (playerId) => {
          try {
            const res = await fetch(`${API_BASE}/api/player/${playerId}/history?last_n=1`);
            if (res.ok) {
              const data = await res.json();
              const name = data.player_name || data.name || playerId;
              teammateNameCache.current[playerId] = name;
            } else {
              teammateNameCache.current[playerId] = playerId;
            }
          } catch {
            teammateNameCache.current[playerId] = playerId;
          }
        })
      );

      setTeammateNames({ ...teammateNameCache.current });
    };

    fetchMissingNames();
  }, [teammateIds]);

  // Εφαρμογή όλων των φίλτρων (μόνο στο parent)
  const filteredPoints = React.useMemo(() => {
    let filtered = points;
    
    // Φίλτρο λεπτών
    if (minMinutes != null || maxMinutes != null) {
      const lo = minMinutes ?? MIN_LIMIT;
      const hi = maxMinutes ?? MAX_LIMIT;
      const low = Math.min(lo, hi);
      const high = Math.max(lo, hi);
      filtered = filtered.filter(p => {
        const m = p.minutes;
        if (m == null || !Number.isFinite(m)) return false;
        return m >= low && m <= high;
      });
    }
    
    // Φίλτρο home/away
    if (onlyUpcomingVenue) {
      filtered = filtered.filter(p => p.av === upcomingAv);
    }
    
    // ✅ Σωστό φίλτρο συμπαικτών (με home/away/fallback)
    if (selectedPlayers.length > 0) {
      filtered = filtered.filter((p) => {
        const homePlayers = Array.isArray(p.home_players) ? p.home_players : [];
        const awayPlayers = Array.isArray(p.away_players) ? p.away_players : [];
        const allPlayers = Array.isArray(p.all_players) ? p.all_players : [];

        let gamePlayers: string[] = [];

        if (homePlayers.length > 0 || awayPlayers.length > 0) {
          gamePlayers = [...homePlayers, ...awayPlayers];
        } else {
          gamePlayers = allPlayers;
        }

        if (playerFilterMode === "with") {
          return selectedPlayers.every((playerId) => gamePlayers.includes(playerId));
        } else {
          return !selectedPlayers.some((playerId) => gamePlayers.includes(playerId));
        }
      });
    }
    
    // Φίλτρο νικών/ηττών
    if (filterTeamWins !== null) {
      filtered = filtered.filter(p => (p as any).team_won === filterTeamWins);
    }
    
    return filtered;
  }, [points, minMinutes, maxMinutes, onlyUpcomingVenue, upcomingAv, selectedPlayers, playerFilterMode, filterTeamWins]);

  const avgChartMinutes = React.useMemo(() => {
    const mins = filteredPoints
      .map((p) => p.minutes)
      .filter((m): m is number => typeof m === "number" && Number.isFinite(m) && m > 0);
    return mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : null;
  }, [filteredPoints]);

  const avgStat = React.useMemo(() => {
    const validStats = filteredPoints
      .map(p => p.stat)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (validStats.length === 0) return null;
    return validStats.reduce((a, b) => a + b, 0) / validStats.length;
  }, [filteredPoints]);

  const lineValue = Number((activeRow as any)?.line ?? 0);
  const propShortLabel = shortPropLabelFromRow(activeRow);

  // Original side from row
  const originalPickSide: "OVER" | "UNDER" = React.useMemo(() => {
    const raw =
      (activeRow as any)?.side ??
      (activeRow as any)?.betSide ??
      (activeRow as any)?.pick ??
      (activeRow as any)?.selection ??
      (activeRow as any)?.overUnder ??
      (activeRow as any)?.ou ??
      "OVER";
    const s = String(raw ?? "").trim().toUpperCase();
    if (s === "UNDER" || s === "U" || s.startsWith("UNDER ")) return "UNDER";
    if (s.includes("UNDER")) return "UNDER";
    return "OVER";
  }, [activeRow]);

  // Effective side (reversed if needed)
  const effectivePickSide: "OVER" | "UNDER" = React.useMemo(() => {
    if (!reversedLine) return originalPickSide;
    return originalPickSide === "OVER" ? "UNDER" : "OVER";
  }, [reversedLine, originalPickSide]);

  // Find the opposite side row (for header)
  const reversedRow = React.useMemo(() => {
    if (!activeRow || !Array.isArray(allLines) || allLines.length === 0) return null;

    const playerKey = getPlayerKey(activeRow);
    const propKey = normalizePropKey(activeRow);
    const line = Number((activeRow as any)?.line);
    const wantedSide = originalPickSide === "OVER" ? "UNDER" : "OVER";

    if (!playerKey || !propKey || !Number.isFinite(line)) return null;

    const found = allLines.find((r) => {
      if (!r) return false;
      if (getPlayerKey(r) !== playerKey) return false;
      if (normalizePropKey(r) !== propKey) return false;
      if (Number((r as any)?.line) !== line) return false;
      if (normalizeSide(r) !== wantedSide) return false;
      return true;
    });

    return found ? resolveBestOddsDuplicate(found, allLines) : null;
  }, [activeRow, allLines, originalPickSide]);

  // Effective row for header display
  const effectiveHeaderRow = React.useMemo(() => {
    if (!reversedLine) return activeRow;
    return (reversedRow as BetLine) || activeRow;
  }, [reversedLine, reversedRow, activeRow]);

  // Odds for effective side
  const effectiveMainOdds = React.useMemo(() => {
    const source = (effectiveHeaderRow as any) ?? {};
    const n = Number(
      source?.odds ??
      source?.price ??
      source?.overOdds ??
      source?.odds_over ??
      source?.oddsOver ??
      source?.underOdds ??
      source?.odds_under ??
      source?.oddsUnder
    );
    return Number.isFinite(n) ? n : null;
  }, [effectiveHeaderRow]);

  // Chart counts based on effective side
  const effectiveChartCounts = React.useMemo(() => {
    let hits = 0;
    let misses = 0;
    let push = 0;

    for (const p of filteredPoints) {
      const v = p.stat;
      if (v == null || !Number.isFinite(v)) continue;

      if (v === lineValue) {
        push += 1;
        continue;
      }

      const hit = effectivePickSide === "UNDER" ? v < lineValue : v > lineValue;
      if (hit) hits += 1;
      else misses += 1;
    }

    return { hits, misses, push, total: hits + misses + push };
  }, [filteredPoints, lineValue, effectivePickSide]);

  const oddsOver = (activeRow as any)?.overOdds ?? (activeRow as any)?.odds_over ?? (activeRow as any)?.oddsOver;
  const oddsUnder = (activeRow as any)?.underOdds ?? (activeRow as any)?.odds_under ?? (activeRow as any)?.oddsUnder;

  if (!mounted || !activeRow) return null;

  return (
    <>
      <motion.div
        className="fixed inset-0 z-[120] flex items-center justify-center p-3"
        style={{
          height: "100dvh",
          paddingTop: "calc(env(safe-area-inset-top) + 12px)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)",
          overscrollBehavior: "contain",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        aria-modal="true"
        role="dialog"
      >
        <button type="button" onClick={onClose} className="absolute inset-0 bg-black/70" aria-label="Close" />

        <motion.div
          initial={{ y: 28, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 18, opacity: 0 }}
          transition={{ type: "spring", stiffness: 520, damping: 34 }}
          className={clsx(
            "relative overflow-hidden rounded-2xl border",
            "border-white/10",
            "bg-gradient-to-b from-white/[0.06] to-white/[0.02] backdrop-blur-md",
            "shadow-[0_8px_28px_rgba(0,0,0,0.35)]",
            "ring-1 ring-white/20",
            "flex flex-col",
            drawerWidthClass
          )}
          style={{
            height: "calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom))",
            maxHeight: "calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom))",
          }}
        >
          <div className="flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
            <div className="flex items-start gap-3 px-4 pt-4">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white/95 text-center">
                  {(activeRow as any)?.player?.name ?? (activeRow as any)?.playerName ?? "—"}
                </div>

                <div className="mt-1 text-xs font-semibold text-white/70 text-center">
                  {(() => {
                    const source = effectiveHeaderRow as any;
                    const label = source?.prop?.label ?? source?.propLabel ?? "Prop";
                    const book =
                      source?.bookmaker ??
                      source?.book ??
                      source?.sportsbook ??
                      source?.operator ??
                      "";
                    const rawOdds =
                      source?.odds ??
                      source?.price ??
                      source?.overOdds ??
                      source?.odds_over ??
                      source?.oddsOver ??
                      source?.underOdds ??
                      source?.odds_under ??
                      source?.oddsUnder ??
                      null;
                    const n = Number(rawOdds);
                    const oddsStr = Number.isFinite(n) ? n.toFixed(2).replace(".", ",").replace(/,00$/, "") : "";
                    const bookStr = String(book ?? "").trim();
                    const side = effectivePickSide;

                    return (
                      <>
                        {side} {fmtLine(lineValue)} • {label}
                        {oddsStr || bookStr ? (
                          <span className="ml-1">
                            {oddsStr ? `-${oddsStr}` : ""} {bookStr}
                          </span>
                        ) : null}
                      </>
                    );
                  })()}
                </div>

                <div className="mt-3 flex w-full flex-nowrap items-center justify-start gap-1 pl-3 pr-2 text-[11px] font-semibold text-white/70 whitespace-nowrap">
                  {([
                    ["MAIN", "MAIN"],
                    ["SHOTS", "SHOTS"],
                    ["COMBOS", "COMBOS"],
                    ["OTHER", "OTHER"],
                    ["1P", "1st PERIOD"],
                  ] as const).map(([key, label]) => {
                    const active = propTab === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setPropTab(key)}
                        className={clsx(
                          "rounded-full border px-2.5 py-1.5 tracking-wide transition",
                          active
                            ? "border-white/60 bg-white/10 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.25),inset_0_-2px_0_0_rgba(255,255,255,0.95)]"
                            : "border-white/10 bg-white/5 text-white/65 hover:border-white/25 hover:bg-white/10 shadow-[inset_0_-2px_0_0_rgba(255,255,255,0.0)]",
                          tabHasAny(key) ? "text-white/90 ring-1 ring-white/20" : null
                        )}
                        aria-pressed={active}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-3 flex w-full flex-nowrap items-center justify-start gap-1 pl-3 pr-2 text-[11px] font-semibold text-white/65 whitespace-nowrap">
                  {(
                    propTab === "MAIN"
                      ? ["PTS", "REB", "OREB", "DREB", "AST", "TO", "STL", "BLK"]
                      : propTab === "SHOTS"
                      ? ["2PM", "2PA", "3PM", "3PA", "FTM", "FTA", "FGM", "FGA"]
                      : propTab === "COMBOS"
                      ? ["PRA", "PR", "PA", "RA", "PRB", "PB", "SB"]
                      : propTab === "OTHER"
                      ? ["FOULS", "FOULS D", "MINUTES", "DD", "TD"]
                      : ["1P POINTS", "1P REBOUNDS", "1P ASSISTS", "1P 3PM"]
                  ).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        if (!activeRow) return;
                        const next = selectMainForCategory({
                          baseRow: activeRow,
                          allLines,
                          categoryKey: t,
                          lastN,
                        }) as BetLine;
                        if (next) {
                          setActiveRow(next);
                        }
                      }}
                      className={clsx(
                        "rounded-full border px-2 py-1 text-xs transition",
                        isCategoryActive(t)
                          ? "border-white/40 bg-white/10 text-white shadow-[inset_0_-2px_0_0_rgba(255,255,255,0.95)]"
                          : "border-white/10 bg-white/5 text-white/65 hover:border-white/25 hover:bg-white/10 shadow-[inset_0_-2px_0_0_rgba(255,255,255,0.0)]",
                        isCategoryAvailable(t) ? "text-white/90 ring-1 ring-white/20" : null
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {Number.isFinite(Number(oddsOver)) && (
                    <span className={PILL}>
                      Over {fmtOdds(Number(oddsOver))}
                    </span>
                  )}
                  {Number.isFinite(Number(oddsUnder)) && (
                    <span className={PILL}>
                      Under {fmtOdds(Number(oddsUnder))}
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className={clsx(
                  "inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10",
                  "bg-white/8 text-white/85 backdrop-blur transition hover:bg-white/12"
                )}
                aria-label="Close drawer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-4 pt-4 pb-4">
              {(loadingGames || gamesError) && (
                <div className={clsx(CARD_GLASS, "mb-2 flex items-center justify-between px-3 py-2 text-[11px] text-white/70")}>
                  <div className="min-w-0 flex-1 truncate">
                    {loadingGames
                      ? "Φόρτωση ιστορικού από backend…"
                      : gamesError
                      ? `Backend error: ${gamesError}`
                      : ""}
                  </div>
                  <div className="ml-2 shrink-0 rounded-full bg-white/10 px-2 py-0.5 font-semibold text-white/70">
                    API
                  </div>
                </div>
              )}

              {/* ΝΕΑ ΦΙΛΤΡΑ */}
              <div className="mb-3 space-y-3">
                {/* Φίλτρο συμπαικτών */}
                <div className={clsx(CARD_GLASS, "px-3 py-3")}>
                  <button
                    onClick={() => setShowPlayerSelector(!showPlayerSelector)}
                    className="w-full flex items-center justify-center gap-2 text-[11px] font-semibold text-white/70"
                  >
                    <span>FILTER BY TEAMMATES</span>
                    <ChevronDown className={clsx("h-4 w-4 transition", showPlayerSelector && "rotate-180")} />
                  </button>
                  
                  {showPlayerSelector && (
                    <div className="mt-2">
                      <div className="flex gap-2 mb-2">
                        <button
                          onClick={() => setPlayerFilterMode("with")}
                          className={clsx(
                            "flex-1 rounded-full border px-2 py-1 text-[10px] font-semibold transition",
                            playerFilterMode === "with"
                              ? "bg-emerald-500/20 border-emerald-400 text-emerald-400"
                              : "border-white/10 text-white/70 hover:bg-white/10"
                          )}
                        >
                          WITH
                        </button>
                        <button
                          onClick={() => setPlayerFilterMode("without")}
                          className={clsx(
                            "flex-1 rounded-full border px-2 py-1 text-[10px] font-semibold transition",
                            playerFilterMode === "without"
                              ? "bg-rose-500/20 border-rose-400 text-rose-400"
                              : "border-white/10 text-white/70 hover:bg-white/10"
                          )}
                        >
                          WITHOUT
                        </button>
                      </div>
                      
                      <div className="max-h-40 overflow-auto space-y-1">
                        {teammateIds.map(playerId => (
                          <label key={playerId} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-white/5 p-1 rounded">
                            <input
                              type="checkbox"
                              checked={selectedPlayers.includes(playerId)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedPlayers([...selectedPlayers, playerId]);
                                } else {
                                  setSelectedPlayers(selectedPlayers.filter(id => id !== playerId));
                                }
                              }}
                              className="h-3 w-3"
                            />
                            <span className="text-white/80 truncate">
                              {teammateNames[playerId] || playerId}
                            </span>
                          </label>
                        ))}
                        {teammateIds.length === 0 && (
                          <div className="text-white/50 text-xs p-2">No teammate data available</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Δύο pills: AVG και REVERSED LINE */}
                <div className="flex gap-2">
                  <div className={clsx(PILL, "flex-1 text-center")}>
                    AVG {avgStat !== null ? avgStat.toFixed(1) : "—"}
                  </div>
                  <button
                    type="button"
                    onClick={() => setReversedLine((v) => !v)}
                    className={clsx(
                      "flex-1 rounded-full border px-3 py-[6px] text-[12px] leading-none font-semibold text-center backdrop-blur transition",
                      reversedLine
                        ? PILL_ACTIVE
                        : "border-white/10 bg-white/8 text-white/90 hover:bg-white/12"
                    )}
                    style={reversedLine ? ACTIVE_GLOW_STYLE : undefined}
                    aria-pressed={reversedLine}
                  >
                    REVERSED LINE
                  </button>
                </div>

                {(selectedPlayers.length > 0 || filterTeamWins !== null || reversedLine) && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => {
                        setSelectedPlayers([]);
                        setFilterTeamWins(null);
                        setReversedLine(false);
                      }}
                      className="text-[10px] text-white/50 hover:text-white/80 underline"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>

              <CinematicEChartsBar
                data={filteredPoints}
                lineValue={lineValue}
                propShortLabel={propShortLabel}
                pickSide={effectivePickSide}
              />

              <div className="mt-3 flex items-start gap-3">
                <div className="shrink-0 flex items-center gap-2">
                  <ClampButtons value={lastN} options={[5, 10, 15, 20]} onChange={setLastN} />
                  
                  <button
                    type="button"
                    onClick={onPickToggle}
                    className={clsx(
                      "inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm leading-none font-extrabold",
                      "bg-white/5 backdrop-blur-xl transition",
                      picked
                        ? "border-emerald-300/70 ring-2 ring-emerald-300/50 shadow-[0_0_14px_rgba(52,211,153,0.75)] text-emerald-200"
                        : "border-white/10 text-white/80 hover:bg-white/8"
                    )}
                    aria-label={picked ? "Remove from My Picks" : "Add to My Picks"}
                    title={picked ? "Remove (-)" : "Add (+)"}
                  >
                    {picked ? "−" : "+"}
                  </button>
                </div>

                <div className="ml-auto min-w-0 text-right">
                  <div className="text-[11px] font-semibold text-white/60">
                    GAMES IN CHART <span className="text-white/80">{filteredPoints.length}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] font-semibold text-white/60">
                    {effectivePickSide} HITS <span className="text-white/80">{effectiveChartCounts.hits}</span> / MISS{" "}
                    <span className="text-white/80">{effectiveChartCounts.misses}</span>
                  </div>
                </div>
              </div>

              {/* Παλιά φίλτρα (minutes & home/away) */}
              <div ref={minutesAnchorRef} className={clsx(CARD_GLASS, "mt-3 px-3 py-3 relative")}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 text-[11px] font-semibold text-white/60">
                    AVERAGE MINUTES PLAYED{" "}
                    <span className="text-white/80">{avgChartMinutes != null ? avgChartMinutes.toFixed(1) : "—"}</span>
                  </div>
      
                  <button
                    type="button"
                    onClick={() => {
                      setMinutesFolded((v) => {
                        const next = !v;
                        if (!next) {
                          requestAnimationFrame(() => {
                            if (minutesAnchorRef.current) {
                              setMinutesAnchorRect(minutesAnchorRef.current.getBoundingClientRect());
                            }
                          });
                        }
                        return next;
                      });
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white/10"
                    style={minutesFilterActive ? ACTIVE_GLOW_STYLE : undefined}
                    aria-label="Toggle adjust minutes"
                  >
                    <span className="tracking-wide">ADJUST MINUTES</span>
                    <span className="ml-1 inline-flex items-center gap-1 text-white/80">
                      <SlidersHorizontal className="h-4 w-4" />
                      <ChevronDown className={clsx("h-4 w-4 transition-transform", !minutesFolded && "rotate-180")} />
                    </span>
                  </button>
                </div>

                {typeof document !== "undefined" &&
                  createPortal(
                    <motion.div
                      key="minutes-drawer"
                      initial={false}
                      animate={minutesFolded ? { height: 0 } : { height: "auto" }}
                      transition={{ duration: 0.22, ease: "easeOut" }}
                      className={clsx(CARD_GLASS, "fixed z-[10000] overflow-hidden")}
                      style={{
                        top: (minutesAnchorRect?.bottom ?? 0) + 8,
                        left: minutesAnchorRect?.left ?? 0,
                        width: minutesAnchorRect?.width ?? 0,
                        pointerEvents: minutesFolded ? "none" : "auto",
                        transformOrigin: "top",
                      }}
                    >
                      <div className="p-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div className={clsx(CARD_GLASS, "px-3 py-2")}>
                            <button
                              type="button"
                              onClick={() => setMinMinutes(null)}
                              className="mb-2 w-full text-center text-[11px] font-semibold text-white/60 hover:text-white/80"
                            >
                              MIN
                            </button>
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                {...makeHoldHandlers(() => adjustMin(-1))}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                                aria-label="Decrease min minutes"
                              >
                                <ChevronLeft className="h-4 w-4" />
                              </button>
                              <div className="min-w-[64px] text-center text-sm font-bold text-white/90">
                                {minMinutes === null ? "—" : minMinutes.toFixed(1)}
                              </div>
                              <button
                                type="button"
                                {...makeHoldHandlers(() => adjustMin(1))}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                                aria-label="Increase min minutes"
                              >
                                <ChevronRight className="h-4 w-4" />
                              </button>
                            </div>
                          </div>

                          <div className={clsx(CARD_GLASS, "px-3 py-2")}>
                            <button
                              type="button"
                              onClick={() => setMaxMinutes(null)}
                              className="mb-2 w-full text-center text-[11px] font-semibold text-white/60 hover:text-white/80"
                            >
                              MAX
                            </button>
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                {...makeHoldHandlers(() => adjustMax(-1))}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                                aria-label="Decrease max minutes"
                              >
                                <ChevronLeft className="h-4 w-4" />
                              </button>
                              <div className="min-w-[64px] text-center text-sm font-bold text-white/90">
                                {maxMinutes == null ? "—" : maxMinutes.toFixed(1)}
                              </div>
                              <button
                                type="button"
                                {...makeHoldHandlers(() => adjustMax(1))}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                                aria-label="Increase max minutes"
                              >
                                <ChevronRight className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>,
                    document.body
                  )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                {(() => {
                  const vals = filteredPoints.map((p) => Number(p.stat ?? 0));
                  const over = vals.filter((v) => v >= lineValue).length;
                  const under = vals.filter((v) => v < lineValue).length;
                  const push = vals.filter((v) => v === lineValue).length;

                  const mins = filteredPoints
                    .map((p) => p.minutes)
                    .filter((m): m is number => typeof m === 'number' && Number.isFinite(m) && m > 0);
                  const avgMinsPlayed = mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : 0;

                  const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
                    <div className={clsx(CARD_GLASS, "px-3 py-2")}>
                      <div className="text-[11px] font-semibold text-white/55">{label}</div>
                      <div className="mt-0.5 text-sm font-bold text-white/90">{value}</div>
                    </div>
                  );

                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => setOnlyUpcomingVenue((v) => !v)}
                        className={clsx(
                          "rounded-2xl border bg-white/5 px-3 py-2 text-center backdrop-blur-xl transition",
                          onlyUpcomingVenue
                            ? "border-rose-500/80"
                            : "border-white/10 hover:border-white/25"
                        )}
                        aria-pressed={onlyUpcomingVenue}
                        aria-label={upcomingVenueLabel}
                        style={onlyUpcomingVenue ? ACTIVE_GLOW_STYLE : undefined}
                      >
                        <div className="mt-0.5 text-[12px] font-bold leading-4 text-white/90">
                          {upcomingVenueLabel}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setProjectionEnabled((v) => !v)}
                        className={clsx(
                          "rounded-2xl border bg-white/5 px-3 py-2 text-center backdrop-blur-xl transition",
                          projectionEnabled
                            ? "border-rose-500/80"
                            : "border-white/10 hover:border-white/25"
                        )}
                        aria-pressed={projectionEnabled}
                        aria-label="Chart projection filter"
                        style={projectionEnabled ? ACTIVE_GLOW_STYLE : undefined}
                      >
                        <div className="text-[11px] font-semibold text-white/55"></div>
                        <div className="mt-0.5 text-[12px] font-bold leading-4 text-white/90">
                          IF PLAYER HAD{" "}
                          <span
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center"
                          >
                            <select
                              value={projectionDelta}
                              onChange={(e) => setProjectionDelta(Number(e.target.value))}
                              className="mx-1 h-7 rounded-full border border-white/10 bg-white/10 px-2 text-[12px] font-bold text-white/90 outline-none"
                            >
                              {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </span>
                          MINUTES{" "}
                          <span
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center rounded-full border border-white/10 bg-white/10 p-0.5"
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setProjectionDir("more");
                              }}
                              className={clsx(
                                "h-6 rounded-full px-2 text-[11px] font-bold transition",
                                projectionDir === "more" ? "bg-white/15 text-white" : "text-white/70 hover:text-white"
                              )}
                            >
                              MORE
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setProjectionDir("less");
                              }}
                              className={clsx(
                                "h-6 rounded-full px-2 text-[11px] font-bold transition",
                                projectionDir === "less" ? "bg-white/15 text-white" : "text-white/70 hover:text-white"
                              )}
                            >
                              LESS
                            </button>
                          </span>{" "}
                          PER GAME
                        </div>
                      </button>

                      <button
                        onClick={() => setFilterTeamWins(filterTeamWins === true ? null : true)}
                        className={clsx(
                          "rounded-2xl border bg-white/5 px-3 py-2 text-center backdrop-blur-xl transition",
                          filterTeamWins === true
                            ? "border-emerald-500/80 bg-emerald-500/20 text-emerald-400"
                            : "border-white/10 hover:border-white/25"
                        )}
                        style={filterTeamWins === true ? ACTIVE_GLOW_STYLE : undefined}
                      >
                        WINS ONLY
                      </button>
                      <button
                        onClick={() => setFilterTeamWins(filterTeamWins === false ? null : false)}
                        className={clsx(
                          "rounded-2xl border bg-white/5 px-3 py-2 text-center backdrop-blur-xl transition",
                          filterTeamWins === false
                            ? "border-rose-500/80 bg-rose-500/20 text-rose-400"
                            : "border-white/10 hover:border-white/25"
                        )}
                        style={filterTeamWins === false ? ACTIVE_GLOW_STYLE : undefined}
                      >
                        LOSSES ONLY
                      </button>

                      <Stat label="ALT LINES(SOON)" value="—" />
                      <Stat label="CUSTOM LINES(SOON)" value="—" />
                    </>
                  );
                })()}
              </div>
            </div>

            <div className="h-3" />
          </div>
        </motion.div>
      </motion.div>
    </>
  );
}

export default BetDrawerOverlay;