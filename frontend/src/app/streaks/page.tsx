// app/streaks/page.tsx
"use client";

import React, { useEffect, useState, useMemo, useRef, useLayoutEffect } from "react";
import { Input } from "@/components/ui/Input";
import { resolveEuroleagueLogoUrl } from "@/lib/teamLogos";
import { useFilters } from "@/lib/store";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import { usePicks, pickIdForRow } from "@/lib/picksStore";
import { resolveTeamKey } from "@/lib/resolveTeamKey";
import { BetLine } from "@/lib/types";
import { CARD_GLASS, PILL, PILL_ACTIVE } from "@/lib/uiTokens"; // κεντρικά tokens

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const FETCH_TIMEOUT = 60000;
const INITIAL_VISIBLE = 60;
const LOAD_MORE_STEP = 60;

const CATEGORY_WORD: Record<string, string> = {
  POINTS: "points",
  PTS: "points",
  TR: "rebounds",
  REB: "rebounds",
  REBOUNDS: "rebounds",
  AS: "assists",
  AST: "assists",
  ASSISTS: "assists",
  ST: "steals",
  STL: "steals",
  STEALS: "steals",
  BL: "blocks",
  BLK: "blocks",
  BLOCKS: "blocks",
  TO: "turnovers",
  TOV: "turnovers",
  TURNOVERS: "turnovers",
  OR: "offensive rebounds",
  OREB: "offensive rebounds",
  DR: "defensive rebounds",
  DREB: "defensive rebounds",
  SH_M: "field goals made",
  FGM: "field goals made",
  SH_AT: "field goals attempted",
  FGA: "field goals attempted",
  "3P_M": "three pointers made",
  "3PM": "three pointers made",
  "3P_A": "three pointers attempted",
  "3PA": "three pointers attempted",
  "2P_M": "two pointers made",
  "2PM": "two pointers made",
  "2P_A": "two pointers attempted",
  "2PA": "two pointers attempted",
  FT_M: "free throws made",
  FTM: "free throws made",
  FT_A: "free throws attempted",
  FTA: "free throws attempted",
  FD: "fouls drawn",
  F: "personal fouls",
  PF: "personal fouls",
  MIN: "minutes",
  PRA: "points, rebounds and assists",
  PR: "points and rebounds",
  PA: "points and assists",
  RA: "rebounds and assists",
  PB: "points and blocks",
  PRB: "points, rebounds and blocks",
  SB: "steals and blocks",
};

interface StreakGame {
  stat: number;
  opp: string;
  ha: string;
}

interface Streak {
  player_id: string;
  player_name: string;
  player_team: string;
  player_position?: string;
  prop_key: string;
  side: string;
  line: number;
  odds: number;
  bookmaker: string;
  category: string;
  tier: string;
  hits: number;
  total: number;
  hit_rate: number;
  games: StreakGame[];
}

type TierOption = "MAIN" | "ALT" | "ALL";

const bookmakerOptions = [
  { label: "ALL BOOKMAKERS", value: "all" },
  { label: "Stoiximan", value: "STOIXIMAN" },
  { label: "Novibet", value: "NOVIBET" },
  { label: "Pamestoixima", value: "PAMESTOIXIMA" },
  { label: "Bwin", value: "BWIN" },
];

function useOutsideClick(
  refs: Array<{ current: HTMLElement | null }>,
  onOutside: () => void
) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      const inside = refs.some((r) => (r.current ? r.current.contains(t) : false));
      if (!inside) onOutside();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [refs, onOutside]);
}

function parsePlayerName(fullName: string): { first: string; last: string } {
  const s = fullName.trim();
  if (!s) return { first: "", last: "" };
  if (s.includes(",")) {
    const [lastPart, firstPart] = s.split(",", 2);
    return {
      last: lastPart.trim(),
      first: (firstPart || "").trim(),
    };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return {
    first: parts.slice(0, -1).join(" "),
    last: parts[parts.length - 1],
  };
}

function formatPlayerNameLastFirst(fullName: string): string {
  const { first, last } = parsePlayerName(fullName);
  if (!last) return first;
  return `${last}, ${first}`;
}

function normalizePropKey(propKey: string): string {
  const raw = String(propKey || "").trim().toUpperCase();
  const map: Record<string, string> = {
    SH_M: "FGM",
    SH_AT: "FGA",
    TR: "REB",
    AS: "AST",
    ST: "STL",
    BL: "BLK",
    "3P_M": "3PM",
    "3P_A": "3PA",
    "2P_M": "2PM",
    "2P_A": "2PA",
    FT_M: "FTM",
    FT_A: "FTA",
  };
  return map[raw] || raw;
}

function buildStreakPickRow(streak: Streak): BetLine {
  const teamKey = resolveTeamKey(streak.player_team) || null;
  const label = normalizePropKey(streak.prop_key);

  return {
    id: [
      "streak",
      streak.player_id,
      streak.bookmaker,
      streak.prop_key,
      streak.side,
      streak.line,
      streak.odds,
      streak.category,
      streak.tier,
    ].join("::"),
    __teamKey: teamKey,
    player: {
      id: streak.player_id,
      name: formatPlayerNameLastFirst(streak.player_name),
      pos: streak.player_position || "",
      team: streak.player_team,
    } as any,
    prop: {
      label,
      tier: streak.tier as any,
      sheet_key: streak.prop_key,
      bet_type: streak.tier,
    } as any,
    side: streak.side as any,
    line: Number(streak.line),
    odds: Number(streak.odds),
    bookmaker: streak.bookmaker,
    match: "all",
    hit: {
      L5: 0,
      L10: 0,
      L15: 0,
      L20: 0,
    } as any,
    value: {
      vL5: 0,
      vL10: 0,
      vL15: 0,
      vL20: 0,
    } as any,
    games: Array.isArray(streak.games)
      ? streak.games.map((g) => ({
          date: "",
          opp: g.opp,
          ha: (g.ha === "A" ? "A" : "H") as "H" | "A",
          stat: Number(g.stat ?? 0),
          minutes: 0,
        }))
      : [],
  } as BetLine;
}

function BookmakerDropdown({
  selectedBookmaker,
  onBookmakerChange,
}: {
  selectedBookmaker: string;
  onBookmakerChange: (bookmaker: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);

  useOutsideClick([btnRef as any, popRef as any], () => setOpen(false));

  useLayoutEffect(() => {
    if (!open) return;
    const el = btnRef.current;
    if (!el) return;

    const update = () => {
      const r = el.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, 320), window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const top = Math.min(r.bottom + 8, window.innerHeight - 16);
      setPopPos({ left, top });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  const summary =
    bookmakerOptions.find((b) => b.value === selectedBookmaker)?.label || "ALL BOOKMAKERS";

  return (
    <div className="relative w-full max-w-xs md:w-auto">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          PILL,
          "h-[44px] w-full md:min-w-[260px] justify-center px-4 text-[13px] hover:bg-white/10"
        )}
        title="BOOKMAKER"
      >
        <span className="truncate text-center text-white">{summary}</span>
        <span className="ml-2 text-white/60">▾</span>
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            style={{
              position: "fixed",
              left: popPos?.left ?? 8,
              top: popPos?.top ?? 56,
              width: Math.min(Math.max(btnRef.current?.offsetWidth ?? 320, 320), window.innerWidth - 16),
              zIndex: 9999,
            }}
            className={clsx(CARD_GLASS, "max-h-[360px] overflow-auto p-2")}
            onClick={(e) => e.stopPropagation()}
          >
            {bookmakerOptions.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-white/6 cursor-pointer"
              >
                <div className="text-[13px] text-white/90">{opt.label}</div>
                <input
                  type="checkbox"
                  checked={selectedBookmaker === opt.value}
                  onChange={() => {
                    onBookmakerChange(opt.value);
                    setOpen(false);
                  }}
                  className="h-4 w-4"
                />
              </label>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}

function PlayerDropdown({
  players,
  selectedPlayer,
  onPlayerChange,
  selectedTeam,
  onTeamChange,
}: {
  players: Array<{ key: string; name: string; surname: string; team: string }>;
  selectedPlayer: string;
  onPlayerChange: (playerKey: string) => void;
  selectedTeam: string | null;
  onTeamChange: (teamSlug: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showTeams, setShowTeams] = useState(false);
  const [search, setSearch] = useState("");

  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);

  useOutsideClick([btnRef as any, popRef as any], () => {
    setOpen(false);
    setShowTeams(false);
  });

  useLayoutEffect(() => {
    if (!open) return;
    const el = btnRef.current;
    if (!el) return;

    const update = () => {
      const r = el.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 368));
      const top = Math.min(r.bottom + 8, window.innerHeight - 16);
      setPopPos({ left, top });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  const allActive = !selectedPlayer && !selectedTeam;

  const teamOptions = useMemo(() => {
    const teams = new Set(players.map((p) => p.team));
    return Array.from(teams)
      .sort()
      .map((team) => {
        const slug = team.toLowerCase().replace(/\s+/g, "_");
        return {
          slug,
          display: team,
          logoUrl: resolveEuroleagueLogoUrl(slug),
        };
      });
  }, [players]);

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    let filtered = players;
    if (selectedTeam) {
      filtered = filtered.filter((p) => p.team.toLowerCase().replace(/\s+/g, "_") === selectedTeam);
    }
    if (q) {
      filtered = filtered.filter((p) => p.surname.toLowerCase().startsWith(q));
    }
    return filtered.sort((a, b) => a.surname.localeCompare(b.surname));
  }, [players, selectedTeam, search]);

  const summary = useMemo(() => {
    if (allActive) return "ALL PLAYERS";
    if (selectedPlayer) {
      const p = players.find((p) => p.key === selectedPlayer);
      return p ? `${p.surname} ${p.name}` : "1 selected";
    }
    if (selectedTeam) {
      const display = teamOptions.find((t) => t.slug === selectedTeam)?.display || selectedTeam;
      return `ALL ${display} PLAYERS`;
    }
    return "ALL PLAYERS";
  }, [allActive, selectedPlayer, selectedTeam, players, teamOptions]);

  return (
    <div className="relative w-full max-w-xs md:w-auto">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          PILL,
          "h-[44px] w-full md:min-w-[260px] justify-center px-4 text-[13px] hover:bg-white/10"
        )}
        title="PLAYER"
      >
        <span className="truncate text-center">
          <span className="text-white/70 mr-2">PLAYER</span>
          <span className="text-white">{summary}</span>
        </span>
        <span className="ml-2 text-white/60">▾</span>
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            style={{
              position: "fixed",
              left: popPos?.left ?? 8,
              top: popPos?.top ?? 56,
              width: 360,
              zIndex: 9999,
            }}
            className={clsx(CARD_GLASS, "max-h-[520px] overflow-auto p-2")}
            onClick={(e) => e.stopPropagation()}
          >
            <label className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-white/6 cursor-pointer">
              <div className="text-[13px] text-white/90">ALL PLAYERS</div>
              <input
                type="checkbox"
                checked={allActive}
                onChange={() => {
                  onPlayerChange("");
                  onTeamChange(null);
                }}
                className="h-4 w-4"
              />
            </label>

            <div className="my-2 h-px bg-white/10" />

            <div className="px-2 pb-2">
              <button
                type="button"
                onClick={() => setShowTeams((v) => !v)}
                className={clsx(
                  PILL,
                  "w-full justify-between px-3 py-2 text-[12px] hover:bg-white/8"
                )}
              >
                <span>BY TEAM</span>
                <span className="text-white/60">{showTeams ? "▴" : "▾"}</span>
              </button>

              {showTeams && (
                <div className={clsx(CARD_GLASS, "mt-2 p-2")}>
                  <label className="mb-2 flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-white/6 cursor-pointer">
                    <div className="text-[12px] text-white/90">ALL TEAMS</div>
                    <input
                      type="checkbox"
                      checked={!selectedTeam}
                      onChange={() => onTeamChange(null)}
                      className="h-4 w-4"
                    />
                  </label>

                  <div className="grid grid-cols-4 gap-2">
                    {teamOptions.map((t) => {
                      const active = selectedTeam === t.slug;
                      return (
                        <button
                          key={t.slug}
                          type="button"
                          onClick={() => {
                            onTeamChange(t.slug);
                            setShowTeams(false);
                          }}
                          className={clsx(
                            "rounded-xl border border-white/10 p-2 flex items-center justify-center hover:bg-white/8 transition",
                            active ? "bg-white/10" : "bg-transparent"
                          )}
                          title={t.display}
                        >
                          {t.logoUrl ? (
                            <img src={t.logoUrl} alt={t.display} className="h-8 w-8 object-contain" />
                          ) : (
                            <span className="text-[11px] text-white/70">{t.display}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="my-2 h-px bg-white/10" />

            <div className="px-2">
              <div className="text-[12px] text-white/70 mb-1">SEARCH</div>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full"
                placeholder="Type surname…"
              />

              {search.trim() ? (
                <div className={clsx(CARD_GLASS, "mt-2")}>
                  {filteredPlayers.slice(0, 8).map((p) => {
                    const checked = selectedPlayer === p.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => {
                          onPlayerChange(p.key);
                          setOpen(false);
                        }}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-white/6 transition"
                      >
                        <div className="text-[13px] text-white/90 truncate">
                          {p.surname} <span className="text-white/60">{p.name}</span>
                        </div>
                        <input type="checkbox" readOnly checked={checked} className="h-4 w-4" />
                      </button>
                    );
                  })}
                  {filteredPlayers.length === 0 && (
                    <div className="px-3 py-2 text-[12px] text-white/55">No results.</div>
                  )}
                </div>
              ) : null}
            </div>

            {!search.trim() && (
              <>
                <div className="my-2 h-px bg-white/10" />
                <div className="px-1">
                  <div className="px-2 pb-1 text-[12px] text-white/70">PLAYERS (A–Z)</div>
                  {filteredPlayers.map((p) => {
                    const checked = selectedPlayer === p.key;
                    return (
                      <label
                        key={p.key}
                        className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-white/6 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] text-white/90 truncate">
                            {p.surname} {p.name}
                          </div>
                          <div className="text-[11px] text-white/55 truncate">{p.team}</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            onPlayerChange(p.key);
                            setOpen(false);
                          }}
                          className="h-4 w-4"
                        />
                      </label>
                    );
                  })}
                  {players.length === 0 && (
                    <div className="px-3 py-2 text-[12px] text-white/55">No players yet.</div>
                  )}
                </div>
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

function PropCategoryDropdown({
  categories,
  selectedCategory,
  onCategoryChange,
}: {
  categories: string[];
  selectedCategory: string;
  onCategoryChange: (cat: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);

  useOutsideClick([btnRef as any, popRef as any], () => setOpen(false));

  useLayoutEffect(() => {
    if (!open) return;
    const el = btnRef.current;
    if (!el) return;

    const update = () => {
      const r = el.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 328));
      const top = Math.min(r.bottom + 8, window.innerHeight - 16);
      setPopPos({ left, top });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  const allActive = !selectedCategory;

  return (
    <div className="relative w-full max-w-xs md:w-auto">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          PILL,
          "h-[44px] w-full md:min-w-[260px] justify-center px-4 text-[13px] hover:bg-white/10"
        )}
        title="PROP"
      >
        <span className="truncate text-center">
          <span className="text-white/70 mr-2">PROP CATEGORY</span>
          <span className="text-white">{selectedCategory || "ALL"}</span>
        </span>
        <span className="ml-2 text-white/60">▾</span>
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            style={{
              position: "fixed",
              left: popPos?.left ?? 8,
              top: popPos?.top ?? 56,
              width: 320,
              zIndex: 9999,
            }}
            className={clsx(CARD_GLASS, "max-h-[360px] overflow-auto p-2")}
            onClick={(e) => e.stopPropagation()}
          >
            <label className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-white/6 cursor-pointer">
              <div className="text-[13px] text-white/90">ALL</div>
              <input
                type="checkbox"
                checked={allActive}
                onChange={() => {
                  onCategoryChange("");
                  setOpen(false);
                }}
                className="h-4 w-4"
              />
            </label>

            <div className="my-2 h-px bg-white/10" />

            {categories.map((cat) => (
              <label
                key={cat}
                className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-white/6 cursor-pointer"
              >
                <div className="text-[13px] text-white/90 truncate">{cat}</div>
                <input
                  type="checkbox"
                  checked={selectedCategory === cat}
                  onChange={() => {
                    onCategoryChange(cat);
                    setOpen(false);
                  }}
                  className="h-4 w-4"
                />
              </label>
            ))}

            {categories.length === 0 && (
              <div className="px-3 py-2 text-[12px] text-white/55">No categories yet.</div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

function AddPickPill({
  picked,
  onToggle,
}: {
  picked: boolean;
  onToggle: () => void;
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

// ---------- StreakRow component (με CARD_GLASS) ----------
const StreakRow = React.memo(function StreakRow({
  streak,
  picked,
  onTogglePick,
}: {
  streak: Streak;
  picked: boolean;
  onTogglePick: () => void;
}) {
  const maxStat = Math.max(...streak.games.map((g) => g.stat), 1);
  const barHeight = 82;
  const reversedGames = [...streak.games].reverse();
  const description = buildStreakDescription(streak);
  const platClass = platformClass(streak.bookmaker);
  const teamLogo = resolveEuroleagueLogoUrl(streak.player_team);
  const propLabel = normalizePropKey(streak.prop_key);
  const { first, last } = parsePlayerName(streak.player_name);
  const headerPlayerName = last ? `${last} ${first}` : streak.player_name;

  return (
    <div className={clsx(CARD_GLASS, "group relative overflow-hidden")}>
      {/* μόνο το top highlight (ουδέτερο) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/15" />

      <div className="relative px-4 py-3">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2.5 min-w-0">
            {teamLogo ? (
              <img
                src={teamLogo}
                alt={streak.player_team}
                className="h-7 w-7 rounded-full object-contain ring-1 ring-white/20 shadow-[0_0_14px_rgba(255,255,255,0.10)]"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="h-7 w-7 rounded-full bg-gray-600 ring-1 ring-white/20" />
            )}

            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="font-bold text-white truncate">{headerPlayerName}</span>

              {streak.player_position && (
                <span className={clsx(PILL, "px-2 py-[2px] text-[11px]")}>
                  {streak.player_position}
                </span>
              )}

              <span className={clsx(PILL, "px-2 py-0.5 text-xs")}>
                {streak.category}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <AddPickPill picked={picked} onToggle={onTogglePick} />
            <span className="text-lg font-mono text-emerald-400">{streak.hit_rate}%</span>
          </div>
        </div>

        {/* εσωτερικό card για την περιγραφή – πιο απλό, όχι CARD_GLASS */}
        <div className="mb-3 rounded-2xl border border-white/10 bg-white/6 px-3 py-2 backdrop-blur-md">
          <div className="border-l-4 border-blue-500 pl-3 italic text-sm text-gray-300">
            {description}
          </div>
        </div>

        <div className="flex justify-between items-center mb-2 gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={streak.side === "OVER" ? "text-emerald-200" : "text-rose-200"}>
              {streak.side}
            </span>
            <span className="text-white/80">{streak.line}</span>
            <span className="text-white/60 text-sm">{propLabel}</span>
          </div>

          <span className="text-white font-mono shrink-0">{streak.odds.toFixed(2)}</span>
        </div>

        <div className="flex justify-end items-center gap-2 text-xs mb-3">
          <span
            className={clsx(
              PILL,
              "px-2 py-0.5",
              streak.tier === "ALT"
                ? "border-sky-400/35 bg-sky-400/10 text-sky-200"
                : "border-violet-400/35 bg-violet-400/10 text-violet-200"
            )}
          >
            {streak.tier}
          </span>

          <span className={clsx(PILL, platClass, "px-2 py-0.5")}>{streak.bookmaker}</span>
        </div>

        <div className="overflow-x-auto pb-2">
          <div className="flex gap-1.5" style={{ minWidth: `${streak.games.length * 48}px` }}>
            {reversedGames.map((game, i) => {
              const fillHeight = (game.stat / maxStat) * barHeight;
              const isSuccess =
                (streak.side === "OVER" && game.stat > streak.line) ||
                (streak.side === "UNDER" && game.stat < streak.line);
              const oppLogo = resolveEuroleagueLogoUrl(game.opp);
              const barActualHeight = Math.max(fillHeight, 4);

              return (
                <div key={i} className="flex flex-col items-center group" style={{ width: "40px" }}>
                  <div className="text-xs text-white mb-1 font-bold">{game.stat}</div>

                  <div className="flex items-end justify-center w-8 relative" style={{ height: barHeight }}>
                    <div
                      className={clsx(
                        "relative w-full rounded-t-[10px] border overflow-hidden",
                        isSuccess
                          ? "border-emerald-300/30 bg-gradient-to-b from-emerald-300 to-emerald-500 shadow-[0_0_14px_rgba(16,185,129,0.35)]"
                          : "border-rose-300/30 bg-gradient-to-b from-rose-300 to-rose-500 shadow-[0_0_14px_rgba(244,63,94,0.35)]"
                      )}
                      style={{ height: barActualHeight }}
                    >
                      <span className="absolute inset-x-0 top-0 h-[28%] bg-white/20" />
                    </div>
                  </div>

                  {oppLogo ? (
                    <img
                      src={oppLogo}
                      alt={game.opp}
                      className="w-6 h-6 rounded-full mt-1 object-contain ring-1 ring-white/20 shadow-[0_0_10px_rgba(255,255,255,0.08)]"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gray-600 mt-1 flex items-center justify-center text-[8px] text-white ring-1 ring-white/20">
                      {game.opp.slice(0, 3)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

// ---------- Βοηθητικές συναρτήσεις για StreakRow ----------
function buildStreakDescription(streak: Streak): string {
  const catWord = CATEGORY_WORD[streak.prop_key] || streak.prop_key.toLowerCase();
  const verb = streak.side === "OVER" ? "exceeded" : "failed to exceed";

  let locationText = "";
  if (streak.category === "home") locationText = " at home";
  else if (streak.category === "away") locationText = " on the road";
  else if (streak.category === "win") locationText = " in wins";
  else if (streak.category === "loss") locationText = " in losses";

  return `${streak.player_name} has ${verb} ${streak.line} ${catWord} in ${streak.hits} of his last ${streak.total} games${locationText}.`;
}

function platformClass(platform: string): string {
  const p = String(platform || "").trim().toUpperCase();
  if (p === "STOIXIMAN") return "text-blue-400";
  if (p === "NOVIBET") return "text-green-400";
  if (p === "OPAP" || p === "PAMESTOIXIMA") return "text-yellow-400";
  if (p === "BWIN") return "text-white/80";
  return "text-gray-400";
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

// ---------- Κύριο Page Component ----------
const StreaksPage = () => {
  useFilters();

  const [streaks, setStreaks] = useState<Streak[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<TierOption>("MAIN");

  const [selectedBookmaker, setSelectedBookmaker] = useState<string>("all");
  const [oddsMin, setOddsMin] = useState<string>("1.40");
  const [oddsMax, setOddsMax] = useState<string>("3.00");
  const [selectedPlayer, setSelectedPlayer] = useState<string>("");
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("");

  const [categoryFilters, setCategoryFilters] = useState({
    overall: true,
    win: true,
    loss: true,
    home: true,
    away: true,
  });

  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const picks = usePicks((s) => s.picks);
  const togglePick = usePicks((s) => s.togglePick);

  const toggleCategoryFilter = (key: keyof typeof categoryFilters) => {
    setCategoryFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    let isMounted = true;

    const loadStreaks = async () => {
      try {
        setLoading(true);
        setError(null);
        setVisibleCount(INITIAL_VISIBLE);

        const tierParam = selectedTier === "ALL" ? "" : `&tier=${selectedTier}`;
        const url = `${API_BASE}/api/streaks?skip=0&limit=5000${tierParam}`;

        const res = await fetchWithTimeout(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (!isMounted) return;
        setStreaks(Array.isArray(data?.streaks) ? data.streaks : []);
      } catch (err: any) {
        if (isMounted) {
          console.error("Loading error:", err);
          if (err.name === "AbortError" || err.code === 20) {
            setError("Request timed out. Please try again.");
          } else {
            setError(err.message || "Failed to load streaks");
          }
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadStreaks();

    return () => {
      isMounted = false;
    };
  }, [selectedTier]);

  const playerOptions = useMemo(() => {
    const players = streaks.map((s) => {
      const { first, last } = parsePlayerName(s.player_name);
      return {
        key: s.player_id,
        name: first,
        surname: last || first,
        team: s.player_team,
      };
    });
    const unique = new Map();
    players.forEach((p) => unique.set(p.key, p));
    return Array.from(unique.values());
  }, [streaks]);

  const categoryOptions = useMemo(() => {
    const cats = streaks.map((s) => normalizePropKey(s.prop_key));
    return Array.from(new Set(cats)).sort();
  }, [streaks]);

  const filteredAndSortedStreaks = useMemo(() => {
    let filtered = streaks;

    if (selectedBookmaker !== "all") {
      filtered = filtered.filter((s) => s.bookmaker.toUpperCase() === selectedBookmaker);
    }

    const min = parseFloat(oddsMin) || 0;
    const max = parseFloat(oddsMax) || 100;
    filtered = filtered.filter((s) => s.odds >= min && s.odds <= max);

    if (selectedPlayer) {
      filtered = filtered.filter((s) => s.player_id === selectedPlayer);
    }

    if (selectedTeam) {
      filtered = filtered.filter(
        (s) => s.player_team.toLowerCase().replace(/\s+/g, "_") === selectedTeam
      );
    }

    if (selectedCategory) {
      filtered = filtered.filter((s) => normalizePropKey(s.prop_key) === selectedCategory);
    }

    filtered = filtered.filter((s) => {
      if (s.category === "overall" && !categoryFilters.overall) return false;
      if (s.category === "win" && !categoryFilters.win) return false;
      if (s.category === "loss" && !categoryFilters.loss) return false;
      if (s.category === "home" && !categoryFilters.home) return false;
      if (s.category === "away" && !categoryFilters.away) return false;
      return true;
    });

    filtered.sort((a, b) => {
      if (a.hit_rate !== b.hit_rate) return b.hit_rate - a.hit_rate;
      return b.total - a.total;
    });

    return filtered;
  }, [
    streaks,
    selectedBookmaker,
    oddsMin,
    oddsMax,
    selectedPlayer,
    selectedTeam,
    selectedCategory,
    categoryFilters,
  ]);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [
    selectedBookmaker,
    oddsMin,
    oddsMax,
    selectedPlayer,
    selectedTeam,
    selectedCategory,
    categoryFilters,
    selectedTier,
  ]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        setVisibleCount((prev) =>
          Math.min(prev + LOAD_MORE_STEP, filteredAndSortedStreaks.length)
        );
      },
      {
        root: null,
        rootMargin: "600px 0px",
        threshold: 0,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [filteredAndSortedStreaks.length]);

  const visibleStreaks = useMemo(
    () => filteredAndSortedStreaks.slice(0, visibleCount),
    [filteredAndSortedStreaks, visibleCount]
  );

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-500 border-r-transparent" />
        <p className="mt-2 text-gray-400">Loading streaks...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-400">
        <p>Error: {error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <h1 className="mb-4 text-center text-2xl font-bold text-white md:mb-6 md:text-3xl">
        🔥 Streaks
      </h1>

      <div className="mb-6 flex justify-center">
        <div className="inline-flex rounded-full bg-gray-800 p-1">
          {(["MAIN", "ALT", "ALL"] as TierOption[]).map((tier) => (
            <button
              key={tier}
              onClick={() => setSelectedTier(tier)}
              className={clsx(
                PILL,
                "px-6 py-2 text-sm font-medium",
                selectedTier === tier && PILL_ACTIVE
              )}
            >
              {tier}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6 flex flex-col items-center gap-3 md:flex-row md:flex-wrap md:justify-center">
        <BookmakerDropdown
          selectedBookmaker={selectedBookmaker}
          onBookmakerChange={setSelectedBookmaker}
        />

        <div className={clsx(PILL, "mx-auto w-full max-w-xs justify-between gap-2 px-2 py-1.5 md:w-auto")}>
          <span className="shrink-0 px-1 text-xs text-white/70">ODDS</span>
          <div className="w-[80px]">
            <Input
              className="h-7 text-center text-xs"
              value={oddsMin}
              onChange={(e) => setOddsMin(e.target.value)}
              placeholder="Min"
            />
          </div>
          <span className="shrink-0 text-xs opacity-50">—</span>
          <div className="w-[80px]">
            <Input
              className="h-7 text-center text-xs"
              value={oddsMax}
              onChange={(e) => setOddsMax(e.target.value)}
              placeholder="Max"
            />
          </div>
        </div>

        <PlayerDropdown
          players={playerOptions}
          selectedPlayer={selectedPlayer}
          onPlayerChange={setSelectedPlayer}
          selectedTeam={selectedTeam}
          onTeamChange={setSelectedTeam}
        />

        <PropCategoryDropdown
          categories={categoryOptions}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
        />
      </div>

      {streaks.length > 0 && (
        <div className={clsx(CARD_GLASS, "mb-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-3 p-3 text-center")}>
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={categoryFilters.overall}
              onChange={() => toggleCategoryFilter("overall")}
              className="h-4 w-4"
            />
            Overall
          </label>
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={categoryFilters.win}
              onChange={() => toggleCategoryFilter("win")}
              className="h-4 w-4"
            />
            Wins
          </label>
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={categoryFilters.loss}
              onChange={() => toggleCategoryFilter("loss")}
              className="h-4 w-4"
            />
            Losses
          </label>
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={categoryFilters.home}
              onChange={() => toggleCategoryFilter("home")}
              className="h-4 w-4"
            />
            Home Games
          </label>
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={categoryFilters.away}
              onChange={() => toggleCategoryFilter("away")}
              className="h-4 w-4"
            />
            Away Games
          </label>
        </div>
      )}

      {filteredAndSortedStreaks.length === 0 ? (
        <p className="text-center text-gray-400">No streaks match the filters.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visibleStreaks.map((streak, idx) => {
              const pickRow = buildStreakPickRow(streak);
              const pickId = pickIdForRow(pickRow as any);
              const picked = !!picks[pickId];

              return (
                <StreakRow
                  key={`${streak.player_id}-${streak.prop_key}-${streak.category}-${idx}`}
                  streak={streak}
                  picked={picked}
                  onTogglePick={() => togglePick(pickRow as any)}
                />
              );
            })}
          </div>

          <div ref={loadMoreRef} className="mt-4 flex h-12 items-center justify-center">
            {visibleCount < filteredAndSortedStreaks.length ? (
              <div className="text-sm text-gray-400">Loading more...</div>
            ) : (
              <div className="text-xs text-gray-500">
                Showing all {filteredAndSortedStreaks.length} streaks
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default StreaksPage;