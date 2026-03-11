"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { clsx } from "clsx";
import GameStrip from "@/components/Builder/GameStrip";
import { resolveEuroleagueLogoUrl } from "@/lib/teamLogos";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

interface Player {
  id: string;
  name: string;
  displayName?: string;
}

interface Prop {
  ui_name: string;
  sheet_key: string;
  line: number;
  over_odds: number;
  under_odds: number;
  bookmaker: string;
}

interface GameInfo {
  stat: number;
  ha: "H" | "A";
  opponent: string;
  minutes: number | null;
}

interface TableProp extends Prop {
  selectedSide: "over" | "under";
  active: boolean;
  games: GameInfo[];
}

type HomeAwayFilter = "ALL" | "HOME" | "AWAY";
type BuildSide = "OVER" | "UNDER";

const EXCLUDED_CATEGORIES = [
  "FG Made",
  "Double Double",
  "Fouls Committed",
  "Fouled Out",
  "Players Played Time",
  "3P Attempted",
  "2P Attempted",
  "FG Attempted",
  "Free Throws Attempted",
  "Fouls Earned",
  "Triple Double",
  "Q1 Points",
  "Q1 Assists",
  "Q1 Rebounds",
].map((s) => s.trim().toLowerCase());

const normalizeCategory = (cat: string): string => cat.trim().toLowerCase();

const extractSurname = (fullName: string): string => {
  if (fullName.includes(",")) return fullName.split(",")[0].trim();
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : fullName;
};

const formatPlayerName = (name: string): string => {
  if (name.includes(",")) return name;
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    const lastName = parts.pop();
    const firstName = parts.join(" ");
    return `${lastName}, ${firstName}`;
  }
  return name;
};

const SHELL_CLASS = clsx(
  "rounded-2xl border overflow-hidden",
  "border-white/10",
  "bg-gradient-to-b from-white/[0.06] to-white/[0.02]",
  "backdrop-blur-md",
  "shadow-[0_8px_28px_rgba(0,0,0,0.35)]"
);

const GRID_CLASS = clsx(
  "grid items-center gap-3",
  "grid-cols-[130px_58px_70px_70px_100px_56px_320px_54px_54px]",
  "lg:grid-cols-[minmax(170px,1.35fr)_70px_82px_82px_120px_70px_minmax(340px,2.6fr)_64px_64px]"
);

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function getGamesToShow(games: GameInfo[], lastN: number | "all") {
  return lastN === "all" ? games : games.slice(0, lastN);
}

function passesFilters(
  game: GameInfo,
  minutesEnabled: boolean,
  minutesMin: number,
  minutesMax: number,
  homeAwayFilter: HomeAwayFilter
) {
  const mins = typeof game.minutes === "number" && Number.isFinite(game.minutes) ? game.minutes : null;

  const minutesOk =
    !minutesEnabled
      ? true
      : mins === null
        ? true
        : mins >= minutesMin && mins <= minutesMax;

  const haOk =
    homeAwayFilter === "ALL"
      ? true
      : homeAwayFilter === "HOME"
        ? game.ha === "H"
        : game.ha === "A";

  return minutesOk && haOk;
}

function propShortLabel(prop: TableProp) {
  const raw = String(prop.sheet_key || prop.ui_name || "").trim().toUpperCase();
  const map: Record<string, string> = {
    POINTS: "PTS",
    PTS: "PTS",
    REBOUNDS: "REB",
    REB: "REB",
    TR: "REB",
    ASSISTS: "AST",
    AST: "AST",
    AS: "AST",
    STEALS: "STL",
    STL: "STL",
    ST: "STL",
    BLOCKS: "BLK",
    BLK: "BLK",
    BL: "BLK",
    TURNOVERS: "TO",
    TO: "TO",
    OREB: "OREB",
    "OFFENSIVE REBOUNDS": "OREB",
    OR: "OREB",
    DREB: "DREB",
    "DEFENSIVE REBOUNDS": "DREB",
    DR: "DREB",
    PRA: "PRA",
    PR: "PR",
    RA: "RA",
    PA: "PA",
    THREES: "3PM",
    "3P MADE": "3PM",
    "3P_M": "3PM",
    "3PM": "3PM",
    FGM: "FGM",
    "FG MADE": "FGM",
  };

  if (map[raw]) return map[raw];

  const ui = String(prop.ui_name || "").trim().toUpperCase();
  if (map[ui]) return map[ui];

  return raw.slice(0, 8) || "PROP";
}

function isHit(game: GameInfo, prop: TableProp, side: BuildSide) {
  return side === "OVER" ? game.stat >= prop.line : game.stat < prop.line;
}

function pct(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

type BuildEntry = {
  propKey: string;
  text: string;
  score: number;
  count: number;
};

function buildMatchesForSide(
  baseProp: TableProp,
  baseSide: BuildSide,
  allProps: TableProp[],
  lastN: number | "all"
) {
  const baseGames = getGamesToShow(baseProp.games, lastN);
  const baseHitIdxs = baseGames
    .map((g, idx) => (isHit(g, baseProp, baseSide) ? idx : -1))
    .filter((idx) => idx >= 0);

  const baseCount = baseHitIdxs.length;

  const entries: BuildEntry[] = [];

  if (!baseCount) {
    return {
      baseCount: 0,
      entries,
    };
  }

  for (const other of allProps) {
    if (other.ui_name === baseProp.ui_name) continue;

    const otherGames = getGamesToShow(other.games, lastN);

    let overCount = 0;
    let underCount = 0;

    for (const idx of baseHitIdxs) {
      const g = otherGames[idx];
      if (!g) continue;
      if (isHit(g, other, "OVER")) overCount += 1;
      else underCount += 1;
    }

    const chosenSide: BuildSide = overCount >= underCount ? "OVER" : "UNDER";
    const chosenCount = chosenSide === "OVER" ? overCount : underCount;
    const score = pct(chosenCount, baseCount);

    entries.push({
      propKey: other.ui_name,
      count: chosenCount,
      score,
      text: `${chosenSide === "OVER" ? "O" : "U"} ${other.line} ${propShortLabel(other)} ${score}%`,
    });
  }

  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.count - a.count;
  });

  return {
    baseCount,
    entries,
  };
}

function DualRangeSlider({
  min,
  max,
  valueMin,
  valueMax,
  onChangeMin,
  onChangeMax,
}: {
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  onChangeMin: (n: number) => void;
  onChangeMax: (n: number) => void;
}) {
  const range = max - min;
  const leftPct = ((valueMin - min) / range) * 100;
  const rightPct = ((valueMax - min) / range) * 100;

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between text-[12px] font-semibold text-white/78">
        <span>MIN {valueMin}</span>
        <span>MAX {valueMax}</span>
      </div>

      <div className="relative h-10">
        <div className="absolute top-1/2 h-[6px] w-full -translate-y-1/2 rounded-full bg-white/10" />
        <div
          className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-gradient-to-r from-white/35 to-white/20"
          style={{
            left: `${leftPct}%`,
            width: `${Math.max(0, rightPct - leftPct)}%`,
          }}
        />

        <input
          type="range"
          min={min}
          max={max}
          value={valueMin}
          onChange={(e) => {
            const next = clamp(Number(e.target.value), min, valueMax);
            onChangeMin(next);
          }}
          className="pointer-events-none absolute left-0 top-1/2 h-10 w-full -translate-y-1/2 appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-white/20 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_2px_10px_rgba(0,0,0,0.35)] [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-white/20 [&::-moz-range-thumb]:bg-white"
        />

        <input
          type="range"
          min={min}
          max={max}
          value={valueMax}
          onChange={(e) => {
            const next = clamp(Number(e.target.value), valueMin, max);
            onChangeMax(next);
          }}
          className="pointer-events-none absolute left-0 top-1/2 h-10 w-full -translate-y-1/2 appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-white/20 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_2px_10px_rgba(0,0,0,0.35)] [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-white/20 [&::-moz-range-thumb]:bg-white"
        />
      </div>
    </div>
  );
}

function OpponentsStrip({
  games,
  lastN,
}: {
  games: GameInfo[];
  lastN: number | "all";
}) {
  const gamesToShow = getGamesToShow(games, lastN);
  const count = gamesToShow.length;

  return (
    <div className={clsx(SHELL_CLASS, "w-max min-w-full px-3 py-3 lg:w-full lg:min-w-0")}>
      <div className={GRID_CLASS}>
        <div className="text-left text-[12px] font-semibold uppercase tracking-[0.08em] text-white/62">
          CATEGORY
        </div>
        <div className="text-center text-[12px] font-semibold uppercase tracking-[0.08em] text-white/62">
          LINE
        </div>
        <div className="text-center text-[12px] font-semibold uppercase tracking-[0.08em] text-white/62">
          OVER
        </div>
        <div className="text-center text-[12px] font-semibold uppercase tracking-[0.08em] text-white/62">
          UNDER
        </div>
        <div className="text-center text-[12px] font-semibold uppercase tracking-[0.08em] text-white/62">
          O/U
        </div>
        <div className="text-center text-[12px] font-semibold uppercase tracking-[0.08em] text-white/62">
          ACTIVE
        </div>
        <div className="text-center text-[12px] font-semibold uppercase tracking-[0.08em] text-white/62">
          OPPONENTS
        </div>
        <div className="text-center text-[12px] font-semibold uppercase tracking-[0.08em] text-white/62">
          HOME
        </div>
        <div className="text-center text-[12px] font-semibold uppercase tracking-[0.08em] text-white/62">
          AWAY
        </div>
      </div>

      <div className={clsx("mt-3", GRID_CLASS)}>
        <div />
        <div />
        <div />
        <div />
        <div />
        <div />

        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-2 py-2 shadow-[0_10px_22px_rgba(0,0,0,0.18),0_1px_0_rgba(255,255,255,0.04)_inset]">
          {count > 0 ? (
            <div
              className="grid w-full items-center gap-[2px]"
              style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
            >
              {gamesToShow.map((game, idx) => {
                const logo = resolveEuroleagueLogoUrl(game.opponent);
                const initial =
                  game.opponent && game.opponent !== "?"
                    ? game.opponent.slice(0, 2).toUpperCase()
                    : "??";

                const prefix =
                  game.ha === "H"
                    ? "vs"
                    : game.ha === "A"
                      ? "at"
                      : "";

                return (
                  <div
                    key={idx}
                    className="flex items-center justify-center"
                    title={`${prefix} ${game.opponent}`.trim()}
                  >
                    {logo ? (
                      <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-gradient-to-b from-white to-white/90 shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_4px_12px_rgba(0,0,0,0.22)] ring-1 ring-white/10">
                        <img
                          src={logo}
                          alt={game.opponent}
                          className="h-full w-full scale-[1.2] object-contain"
                          draggable={false}
                        />
                      </div>
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-gradient-to-b from-white/12 to-white/6 text-[9px] font-bold text-white/70 shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_4px_10px_rgba(0,0,0,0.18)]">
                        {initial}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-9" />
          )}
        </div>

        <div />
        <div />
      </div>
    </div>
  );
}

function BuilderPropRow({
  prop,
  allProps,
  lastN,
  revealBuilds,
  onSideChange,
  onToggleActive,
}: {
  prop: TableProp;
  allProps: TableProp[];
  lastN: number | "all";
  revealBuilds: boolean;
  onSideChange: (ui_name: string, side: "over" | "under") => void;
  onToggleActive: (ui_name: string) => void;
}) {
  const gamesToShow = getGamesToShow(prop.games, lastN);
  const homeCount = gamesToShow.filter((g) => g.ha === "H").length;
  const awayCount = gamesToShow.filter((g) => g.ha === "A").length;

  const overBuilds = useMemo(
    () => buildMatchesForSide(prop, "OVER", allProps, lastN),
    [prop, allProps, lastN]
  );

  const underBuilds = useMemo(
    () => buildMatchesForSide(prop, "UNDER", allProps, lastN),
    [prop, allProps, lastN]
  );

  const baseLabel = `${prop.line} ${propShortLabel(prop)}`;

  return (
    <div
      className={clsx(
        SHELL_CLASS,
        "w-max min-w-full px-3 py-3 transition-all duration-200 lg:w-full lg:min-w-0",
        "hover:border-white/20 hover:shadow-[0_10px_32px_rgba(0,0,0,0.42)]",
        prop.active && "ring-1 ring-white/20",
        revealBuilds && "translate-y-[-1px] shadow-[0_16px_38px_rgba(0,0,0,0.42)]"
      )}
    >
      <div className={GRID_CLASS}>
        <div className="truncate text-[15px] font-semibold text-white/95">
          {prop.ui_name}
        </div>

        <div className="text-center">
          <span className="inline-flex min-w-[42px] items-center justify-center rounded-full border border-white/10 bg-white/8 px-2 py-[4px] text-[12px] font-semibold text-white/90 backdrop-blur">
            {prop.line}
          </span>
        </div>

        <div className="text-center">
          <span className="inline-flex min-w-[50px] items-center justify-center rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2 py-[4px] text-[12px] font-semibold text-emerald-200 backdrop-blur">
            {prop.over_odds}
          </span>
        </div>

        <div className="text-center">
          <span className="inline-flex min-w-[50px] items-center justify-center rounded-full border border-rose-300/25 bg-rose-400/10 px-2 py-[4px] text-[12px] font-semibold text-rose-200 backdrop-blur">
            {prop.under_odds}
          </span>
        </div>

        <div className="text-center">
          <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/8 p-[3px] backdrop-blur">
            <button
              onClick={() => onSideChange(prop.ui_name, "over")}
              className={clsx(
                "rounded-full border px-3 py-[6px] text-[11px] font-extrabold tracking-wide transition-all",
                prop.selectedSide === "over"
                  ? "border border-emerald-300/40 bg-emerald-400/12 text-emerald-200 ring-2 ring-emerald-300/20"
                  : "border border-transparent bg-transparent text-white/75 hover:bg-white/10"
              )}
            >
              O
            </button>

            <button
              onClick={() => onSideChange(prop.ui_name, "under")}
              className={clsx(
                "rounded-full border px-3 py-[6px] text-[11px] font-extrabold tracking-wide transition-all",
                prop.selectedSide === "under"
                  ? "border border-rose-300/40 bg-rose-400/12 text-rose-200 ring-2 ring-rose-300/20"
                  : "border border-transparent bg-transparent text-white/75 hover:bg-white/10"
              )}
            >
              U
            </button>
          </div>
        </div>

        <div className="text-center">
          <button
            onClick={() => onToggleActive(prop.ui_name)}
            className={clsx(
              "mx-auto flex h-7 w-7 items-center justify-center rounded-full border text-[13px] font-extrabold backdrop-blur transition-all",
              prop.active
                ? "border-emerald-300/40 bg-emerald-400/12 text-emerald-200 ring-2 ring-emerald-300/25 shadow-[0_10px_26px_rgba(0,0,0,0.35)]"
                : "border-rose-300/35 bg-rose-400/10 text-rose-200"
            )}
          >
            {prop.active ? "✓" : "✕"}
          </button>
        </div>

        <div className="rounded-xl bg-gradient-to-b from-white/[0.04] to-white/[0.015] px-2 py-[6px] shadow-[0_10px_22px_rgba(0,0,0,0.18),0_1px_0_rgba(255,255,255,0.04)_inset]">
          <GameStrip
            games={prop.games}
            line={prop.line}
            side={prop.selectedSide}
            lastN={lastN}
          />
        </div>

        <div className="text-center">
          <span className="inline-flex min-w-[36px] items-center justify-center rounded-full border border-white/10 bg-white/8 px-2 py-[4px] text-[12px] font-semibold text-white/85 backdrop-blur">
            {homeCount}
          </span>
        </div>

        <div className="text-center">
          <span className="inline-flex min-w-[36px] items-center justify-center rounded-full border border-white/10 bg-white/8 px-2 py-[4px] text-[12px] font-semibold text-white/85 backdrop-blur">
            {awayCount}
          </span>
        </div>
      </div>

      {revealBuilds && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2 text-[12px] leading-5">
            <span className="shrink-0 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2 py-[3px] font-extrabold tracking-wide text-emerald-200">
              O {baseLabel} ({overBuilds.baseCount})
            </span>

            {overBuilds.entries.length > 0 ? (
              overBuilds.entries.map((entry) => (
                <span
                  key={`over-${prop.ui_name}-${entry.propKey}`}
                  className="text-white/82"
                >
                  {entry.text}
                </span>
              ))
            ) : (
              <span className="text-white/45">No matches</span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-start gap-x-3 gap-y-2 text-[12px] leading-5">
            <span className="shrink-0 rounded-full border border-rose-300/25 bg-rose-400/10 px-2 py-[3px] font-extrabold tracking-wide text-rose-200">
              U {baseLabel} ({underBuilds.baseCount})
            </span>

            {underBuilds.entries.length > 0 ? (
              underBuilds.entries.map((entry) => (
                <span
                  key={`under-${prop.ui_name}-${entry.propKey}`}
                  className="text-white/82"
                >
                  {entry.text}
                </span>
              ))
            ) : (
              <span className="text-white/45">No matches</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function BuilderPage() {
  const router = useRouter();
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [bookmakers, setBookmakers] = useState<string[]>([]);
  const [selectedBookmaker, setSelectedBookmaker] = useState<string>("STOIXIMAN");
  const [tableData, setTableData] = useState<TableProp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastN, setLastN] = useState<number | "all">(10);
  const [allGames, setAllGames] = useState<GameInfo[]>([]);
  const [minutesEnabled, setMinutesEnabled] = useState(false);
  const [minutesMin, setMinutesMin] = useState(0);
  const [minutesMax, setMinutesMax] = useState(50);
  const [homeAwayFilter, setHomeAwayFilter] = useState<HomeAwayFilter>("ALL");
  const [revealBuilds, setRevealBuilds] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/players`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const formatted = data.map((p: Player) => ({
            ...p,
            displayName: formatPlayerName(p.name),
          }));

          const sorted = formatted.sort((a, b) => {
            const surnameA = extractSurname(a.name);
            const surnameB = extractSurname(b.name);
            return surnameA.localeCompare(surnameB);
          });

          setPlayers(sorted);
        } else {
          setPlayers([]);
        }
      })
      .catch((err) => console.error("Failed to load players", err));
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/bookmakers`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setBookmakers(data);
          if (data.includes("STOIXIMAN")) setSelectedBookmaker("STOIXIMAN");
          else if (data.length > 0) setSelectedBookmaker(data[0]);
        }
      })
      .catch((err) => console.error("Failed to load bookmakers", err));
  }, []);

  useEffect(() => {
    if (!selectedPlayerId) {
      setTableData([]);
      setAllGames([]);
      return;
    }

    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`${API_BASE}/api/player/${selectedPlayerId}/props`).then((res) => res.json()),
      fetch(`${API_BASE}/api/player/${selectedPlayerId}/history?last_n=30`).then((res) => res.json()),
    ])
      .then(([propsData, historyData]) => {
        let filtered = propsData.filter((p: Prop) => p.over_odds != null && p.under_odds != null);
        filtered = filtered.filter((p: Prop) => p.bookmaker === selectedBookmaker);
        filtered = filtered.filter((p: Prop) => !EXCLUDED_CATEGORIES.includes(normalizeCategory(p.ui_name)));

        const games = (historyData.recent_games || []).slice().reverse();

        const allGamesList: GameInfo[] = games.map((g: any) => ({
          stat: 0,
          ha: g.ha === "A" ? "A" : "H",
          opponent: g.opponent || g.opp || "?",
          minutes: g.minutes || null,
        }));
        setAllGames(allGamesList);

        const gamesMap: Record<string, GameInfo[]> = {};
        filtered.forEach((prop: Prop) => {
          gamesMap[prop.sheet_key] = games.map((g: any) => ({
            stat: g.final?.[prop.sheet_key] || 0,
            ha: g.ha === "A" ? "A" : "H",
            opponent: g.opponent || g.opp || "?",
            minutes: g.minutes || null,
          }));
        });

        const newTableData: TableProp[] = filtered.map((p: Prop) => ({
          ...p,
          selectedSide: "over",
          active: false,
          games: gamesMap[p.sheet_key] || [],
        }));

        setTableData(newTableData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedPlayerId, selectedBookmaker]);

  const filteredAllGames = useMemo(() => {
    return allGames.filter((g) =>
      passesFilters(g, minutesEnabled, minutesMin, minutesMax, homeAwayFilter)
    );
  }, [allGames, minutesEnabled, minutesMin, minutesMax, homeAwayFilter]);

  const filteredTableData = useMemo(() => {
    return tableData.map((prop) => ({
      ...prop,
      games: prop.games.filter((g) =>
        passesFilters(g, minutesEnabled, minutesMin, minutesMax, homeAwayFilter)
      ),
    }));
  }, [tableData, minutesEnabled, minutesMin, minutesMax, homeAwayFilter]);

  const handleSideChange = (ui_name: string, side: "over" | "under") => {
    setTableData((prev) =>
      prev.map((item) => (item.ui_name === ui_name ? { ...item, selectedSide: side } : item))
    );
  };

  const toggleActive = (ui_name: string) => {
    setTableData((prev) =>
      prev.map((item) => (item.ui_name === ui_name ? { ...item, active: !item.active } : item))
    );
  };

  const toggleMinutesFilter = () => {
    if (minutesEnabled) {
      setMinutesEnabled(false);
      setMinutesMin(0);
      setMinutesMax(50);
    } else {
      setMinutesEnabled(true);
    }
  };

  return (
    <div className="min-h-screen bg-[#04070d] text-white">
      <div className="mx-auto max-w-7xl px-4 py-4">
        <div className="mb-4 flex items-center gap-3 pl-16 md:pl-0">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[13px] hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          <h1 className="text-xl font-semibold tracking-wide text-white/95">
            Manual Bet Builder
          </h1>
        </div>

        <div className="mb-6 pl-16 md:pl-0">
          <div className="mx-auto flex max-w-5xl flex-col items-stretch gap-4 md:max-w-none md:flex-row md:flex-wrap md:items-end">
            <div className="w-full md:w-auto">
              <label className="mb-2 block text-sm font-medium text-white/70">
                Select Player
              </label>
              <select
                value={selectedPlayerId}
                onChange={(e) => setSelectedPlayerId(e.target.value)}
                className="w-full rounded-full border border-white/10 bg-[#1b2230] px-4 py-2 text-white outline-none focus:ring-2 focus:ring-white/20 md:w-64"
              >
                <option value="">Choose a player</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-full md:w-auto">
              <label className="mb-2 block text-sm font-medium text-white/70">
                Bookmaker
              </label>
              <select
                value={selectedBookmaker}
                onChange={(e) => setSelectedBookmaker(e.target.value)}
                className="w-full rounded-full border border-white/10 bg-[#1b2230] px-4 py-2 text-white outline-none focus:ring-2 focus:ring-white/20 md:w-48"
              >
                {bookmakers.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-full md:w-auto">
              <label className="mb-2 block text-sm font-medium text-white/70">
                Last N Games
              </label>
              <select
                value={lastN}
                onChange={(e) => setLastN(e.target.value === "all" ? "all" : Number(e.target.value))}
                className="w-full rounded-full border border-white/10 bg-[#1b2230] px-4 py-2 text-white outline-none focus:ring-2 focus:ring-white/20 md:w-32"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={20}>20</option>
                <option value="all">All Season</option>
              </select>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,0.78fr)_220px_220px]">
            <div className={clsx(SHELL_CLASS, "px-4 py-3")}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={toggleMinutesFilter}
                  className={clsx(
                    "rounded-full border px-3 py-[6px] text-[12px] font-extrabold tracking-wide transition-all",
                    minutesEnabled
                      ? "border border-white/20 bg-white/12 text-white ring-1 ring-white/10"
                      : "border border-white/10 bg-white/6 text-white/78 hover:bg-white/10"
                  )}
                >
                  MINUTES
                </button>

                <div className="text-[12px] font-semibold text-white/72">
                  {minutesEnabled ? `${minutesMin} - ${minutesMax}` : "OFF"}
                </div>
              </div>

              <div className="w-full">
                <DualRangeSlider
                  min={0}
                  max={50}
                  valueMin={minutesMin}
                  valueMax={minutesMax}
                  onChangeMin={(n) => {
                    setMinutesEnabled(true);
                    setMinutesMin(n);
                  }}
                  onChangeMax={(n) => {
                    setMinutesEnabled(true);
                    setMinutesMax(n);
                  }}
                />
              </div>
            </div>

            <div className={clsx(SHELL_CLASS, "px-4 py-3")}>
              <label className="mb-2 block text-sm font-medium text-white/70">
                Home / Away
              </label>

              <div className="inline-flex w-full items-center gap-1 rounded-full border border-white/10 bg-white/8 p-[3px] backdrop-blur">
                {(["ALL", "HOME", "AWAY"] as HomeAwayFilter[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setHomeAwayFilter(mode)}
                    className={clsx(
                      "flex-1 rounded-full border px-3 py-[7px] text-[11px] font-extrabold tracking-wide transition-all",
                      homeAwayFilter === mode
                        ? "border border-white/20 bg-white/12 text-white ring-1 ring-white/10"
                        : "border border-transparent bg-transparent text-white/75 hover:bg-white/10"
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className={clsx(SHELL_CLASS, "px-4 py-3")}>
              <label className="mb-2 block text-sm font-medium text-white/70">
                Reveal Builds
              </label>

              <button
                type="button"
                onClick={() => setRevealBuilds((v) => !v)}
                className={clsx(
                  "w-full rounded-full border px-4 py-[10px] text-[12px] font-extrabold tracking-[0.08em] transition-all",
                  revealBuilds
                    ? "border-rose-300/60 bg-rose-400/12 text-rose-100 ring-2 ring-rose-300/45 shadow-[0_0_22px_rgba(244,114,182,0.28)]"
                    : "border-white/10 bg-white/6 text-white/80 hover:bg-white/10"
                )}
              >
                REVEAL BUILDS
              </button>
            </div>
          </div>
        </div>

        {loading && <div className="text-white/70">Loading props...</div>}
        {error && <div className="text-red-400">Error: {error}</div>}

        {!loading && !error && filteredTableData.length > 0 && (
          <div className="w-full overflow-x-auto lg:overflow-visible">
            <div className="inline-block min-w-[1060px] space-y-3 pr-3 lg:block lg:min-w-0 lg:w-full">
              <OpponentsStrip games={filteredAllGames} lastN={lastN} />

              {filteredTableData.map((prop) => (
                <BuilderPropRow
                  key={prop.ui_name}
                  prop={prop}
                  allProps={filteredTableData}
                  lastN={lastN}
                  revealBuilds={revealBuilds}
                  onSideChange={handleSideChange}
                  onToggleActive={toggleActive}
                />
              ))}
            </div>
          </div>
        )}

        {!loading && !error && selectedPlayerId && filteredTableData.length === 0 && (
          <div className="text-white/70">No props found for this player and bookmaker.</div>
        )}
      </div>
    </div>
  );
}