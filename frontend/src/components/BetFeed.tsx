// src/components/BetFeed.tsx
"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BetRow } from "@/components/BetRow";
import BetDrawerOverlay from "@/components/BetDrawerOverlay";
import { useFilters } from "@/lib/store";
import { resolveTeamKey } from "@/lib/resolveTeamKey";
import { BetLine } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const ROW_GAP = 8;
const FEED_LIMIT = 3000;

const FEED_CACHE = new Map<string, BetLine[]>();
const FEED_INFLIGHT = new Map<string, Promise<BetLine[]>>();

function getRowUiKey(row: BetLine, index: number): string {
  return [
    row.id ?? "",
    row.player?.name ?? "",
    row.prop?.label ?? "",
    row.side ?? "",
    row.line ?? "",
    row.bookmaker ?? "",
    index,
  ].join("::");
}

function getRowPlayerScopeKey(row: BetLine): string {
  const name = String(row?.player?.name ?? "").trim();
  const tk = String((row as any)?.__teamKey ?? "").trim();
  const rawTeam = String((row as any)?.player?.team ?? (row as any)?.team?.name ?? "").trim();
  const derivedTeamKey = resolveTeamKey(rawTeam);
  const teamKey = tk || (derivedTeamKey ? String(derivedTeamKey) : "");
  return `${teamKey}::${name}`;
}

function containsGreek(text: string): boolean {
  if (!text) return false;
  const greekRegex = /[\u0370-\u03FF\u1F00-\u1FFF]/;
  return greekRegex.test(text);
}

function _normBook(s: unknown) {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function _canonBook(s: unknown) {
  const n = _normBook(s);
  if (!n) return String(s ?? "");
  const map: Record<string, string> = {
    STOIXIMAN: "Stoiximan",
    NOVIBET: "Novibet",
    BWIN: "Bwin",
    PAMESTOIXIMA: "Pamestoixima",
    OPAP: "Pamestoixima",
  };
  return map[n] || String(s ?? "");
}

function parseNum(s: string, fallback: number) {
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function computeHitPct(row: BetLine, n: number): number {
  const used = (row.games as any[])?.slice(-n) ?? [];
  if (!used.length) return 0;
  const hits = used.reduce((acc, g) => {
    const stat = Number(g?.stat ?? 0);
    const ok = row.side === "OVER" ? stat > row.line : stat < row.line;
    return acc + (ok ? 1 : 0);
  }, 0);
  return (hits / used.length) * 100;
}

function computeEdgePct(row: BetLine, n: number): number {
  const used = (row.games as any[])?.slice(-n) ?? [];
  if (!used.length) return 0;
  const hits = used.reduce((acc, g) => {
    const stat = Number(g?.stat ?? 0);
    const ok = row.side === "OVER" ? stat > row.line : stat < row.line;
    return acc + (ok ? 1 : 0);
  }, 0);
  const p = hits / used.length;
  const oddsRaw = (row as any)?.odds ?? 0;
  const odds = Number.isFinite(oddsRaw) ? oddsRaw : Number(oddsRaw);
  const implied = odds > 0 ? 1 / odds : 0;
  return (p - implied) * 100;
}

function getMetric(row: BetLine, sortKey: string) {
  const key = String(sortKey || "");
  if (key.startsWith("v")) {
    const upper = key.toUpperCase();
    const raw = (row.value as any)?.[upper];
    const num = Number(raw);
    if (Number.isFinite(num)) return num;
    const base = key.slice(1).toUpperCase();
    const nFromKey = Number(base.replace("L", ""));
    const n = Number.isFinite(nFromKey) && nFromKey > 0 ? nFromKey : 15;
    return computeEdgePct(row, n);
  }

  const upper = key.toUpperCase();
  const backendRaw = (row.hit as any)?.[upper];
  const backendNum = Number(backendRaw);
  if (Number.isFinite(backendNum)) return backendNum;

  const nFromKey = Number(upper.replace("L", ""));
  if (Number.isFinite(nFromKey) && nFromKey > 0) {
    return computeHitPct(row, nFromKey);
  }

  const raw = (row.hit as any)?.[upper];
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function normalizeSheetKey(prop: any): string {
  const raw = String(prop?.sheet_key ?? "").trim();
  const btn = String(prop?.ui_name ?? prop?.label ?? "").trim().toUpperCase();
  if (btn === "OREB" || raw.toUpperCase() === "OREB" || raw === "Offensive Rebounds") return "OR";
  if (btn === "DREB" || raw.toUpperCase() === "DREB" || raw === "Defensive Rebounds") return "DR";
  if (btn === "FGM" || btn === "FG MADE" || raw.toUpperCase() === "FGM" || raw === "FGM") return "SH_M";
  if (btn === "FGA" || raw.toUpperCase() === "FGA" || raw === "SH_AT") return "SH_AT";
  return raw;
}

function normalizeRow(r: any): BetLine {
  const prop = (r && typeof r === "object" ? r.prop : null) ?? {};
  const betType = String(prop.bet_type ?? "").toUpperCase();
  const tier = prop.tier ?? (betType.includes("ALT") ? "ALT" : "MAIN");
  const hit = r?.hit ?? {};
  const value = r?.value ?? {};
  const logoSrcRaw =
    (r as any)?.team?.logo ||
    (r as any)?.teamLogo ||
    (r as any)?.logo ||
    ((r as any)?.player)?.teamLogo ||
    ((r as any)?.player)?.logo;

  const logoStr = typeof logoSrcRaw === "string" ? logoSrcRaw : "";
  const logoSlug = (() => {
    const m = logoStr.match(/\/logos\/euroleague\/([^\/]+)\.(png|svg|webp|jpg|jpeg)/i);
    if (m && m[1]) return m[1];
    const b = logoStr.split("/").pop() || "";
    const mm = b.match(/^([a-z0-9_\-]+)\.(png|svg|webp|jpg|jpeg)$/i);
    if (mm && mm[1]) return mm[1];
    return "";
  })();

  const teamKey =
    resolveTeamKey(logoSlug) ||
    resolveTeamKey((r as any)?.player?.team) ||
    resolveTeamKey((r as any)?.team?.name) ||
    resolveTeamKey((r as any)?.team?.display) ||
    resolveTeamKey((r as any)?.teamName) ||
    resolveTeamKey((r as any)?.team_code) ||
    resolveTeamKey((r as any)?.teamCode) ||
    resolveTeamKey((r as any)?.team?.code) ||
    resolveTeamKey((r as any)?.team?.abbr) ||
    resolveTeamKey((r as any)?.teamAbbr) ||
    null;

  return {
    ...(r || {}),
    __teamKey: teamKey,
    bookmaker: _canonBook(r?.bookmaker),
    prop: {
      label: prop.label ?? prop.ui_name ?? prop.sheet_key ?? "Prop",
      tier,
      sheet_key: normalizeSheetKey(prop),
      bet_type: prop.bet_type ?? betType,
    },
    hit: {
      L5: Number(hit.L5 ?? 0),
      L10: Number(hit.L10 ?? 0),
      L15: Number(hit.L15 ?? 0),
      L20: Number(hit.L20 ?? 0),
    },
    value: {
      vL5: Number(value.vL5 ?? 0),
      vL10: Number(value.vL10 ?? 0),
      vL15: Number(value.vL15 ?? 0),
      vL20: Number(value.vL20 ?? 0),
    },
    games: Array.isArray(r?.games) ? r.games : [],
  } as BetLine;
}

async function fetchFeedRows(bookmaker: string, match: string, scope: string): Promise<BetLine[]> {
  const cacheKey = `${bookmaker}::${match}::${scope}::${FEED_LIMIT}`;

  const cached = FEED_CACHE.get(cacheKey);
  if (cached) return cached;

  const inflight = FEED_INFLIGHT.get(cacheKey);
  if (inflight) return inflight;

  const p = (async () => {
    const qs = new URLSearchParams({
      bookmaker,
      match,
      scope,
      limit: String(FEED_LIMIT),
    });

    const res = await fetch(`${API_BASE}/api/feed?${qs.toString()}`, {
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`Feed request failed (${res.status})`);

    const json = await res.json();
    const rows = (Array.isArray(json) ? json : [])
      .filter(Boolean)
      .map(normalizeRow)
      .filter((row) => {
        const cat = row.prop?.label || "";
        return !containsGreek(cat);
      });

    FEED_CACHE.set(cacheKey, rows);
    FEED_INFLIGHT.delete(cacheKey);
    return rows;
  })().catch((err) => {
    FEED_INFLIGHT.delete(cacheKey);
    throw err;
  });

  FEED_INFLIGHT.set(cacheKey, p);
  return p;
}

export function BetFeed() {
  const bookmaker = useFilters((s) => s.bookmaker);
  const match = useFilters((s) => s.match);
  const scope = useFilters((s) => s.scope);
  const oddsMin = useFilters((s) => s.oddsMin);
  const oddsMax = useFilters((s) => s.oddsMax);
  const sortKey = useFilters((s) => s.sortKey);
  const sortDir = useFilters((s) => s.sortDir);
  const topBarHeight = useFilters((s) => s.topBarHeight);
  const topBarHidden = useFilters((s) => s.topBarHidden);
  const propCategories = useFilters((s) => (s as any).propCategories);
  const selectedPlayers = useFilters((s) => (s as any).selectedPlayers);
  const selectedTeam = useFilters((s) => (s as any).selectedTeam);
  const setFilter = useFilters((s) => s.set);

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const [isLgUp, setIsLgUp] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsLgUp(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const [all, setAll] = React.useState<BetLine[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [openId, setOpenId] = React.useState<string | null>(null);
  const [drawerPos, setDrawerPos] = React.useState<{ top: number; left: number; width: number } | null>(null);
  const [drawerLastN, setDrawerLastN] = React.useState<number | null>(null);

  const [ppFocusPlayerKey, setPpFocusPlayerKey] = React.useState<string | null>(null);
  const ppRestoreScrollTopRef = React.useRef<number | null>(null);
  const ppPendingRestoreScrollTopRef = React.useRef<number | null>(null);

  const rowRefs = React.useRef(new Map<string, HTMLDivElement | null>());
  const parentRef = React.useRef<HTMLDivElement | null>(null);
  const showingDivRef = React.useRef<HTMLDivElement | null>(null);

  const [allBookmakers, setAllBookmakers] = React.useState<string[]>([]);
  const [allMatches, setAllMatches] = React.useState<string[]>([]);
  const [showingDivHeight, setShowingDivHeight] = React.useState(0);

  const [drawerViewportPos, setDrawerViewportPos] = React.useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const latestLoadKeyRef = React.useRef("");

  React.useEffect(() => {
    fetch(`${API_BASE}/api/upcoming-matches?bookmaker=all`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const matches = data.map((m: any) => m.value || m.label).filter(Boolean);
          setAllMatches(matches);
        }
      })
      .catch(console.error);
  }, []);

  React.useEffect(() => {
    if (allMatches.length === 0) return;
    const firstMatch = allMatches[0];

    fetch(`${API_BASE}/api/feed?bookmaker=all&match=${encodeURIComponent(firstMatch)}&scope=ALL&limit=1000`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const bookmakers = new Set<string>();
          data.forEach((row: any) => {
            if (row?.bookmaker) bookmakers.add(_canonBook(row.bookmaker));
          });
          setAllBookmakers(Array.from(bookmakers).sort());
        }
      })
      .catch(console.error);
  }, [allMatches]);

  React.useEffect(() => {
    let alive = true;
    const loadKey = `${bookmaker}::${match}::${scope}::${allBookmakers.join("|")}`;
    latestLoadKeyRef.current = loadKey;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const scopesToFetch = scope === "ALL" ? ["MAIN", "ALT"] : [scope];
        let rows: BetLine[] = [];

        if (bookmaker === "all") {
          if (allBookmakers.length === 0) {
            setAll([]);
            return;
          }

          const promises = allBookmakers.flatMap((bm) =>
            scopesToFetch.map((sc) => fetchFeedRows(bm, match, sc))
          );
          const results = await Promise.all(promises);
          rows = results.flat();
        } else {
          const promises = scopesToFetch.map((sc) => fetchFeedRows(bookmaker, match, sc));
          const results = await Promise.all(promises);
          rows = results.flat();
        }

        if (!alive) return;
        if (latestLoadKeyRef.current !== loadKey) return;

        setAll(rows);

        const categorySet = new Set<string>();
        const playerSeen = new Set<string>();
        const players: any[] = [];

        for (const row of rows as any[]) {
          const cat = row.prop?.label || row.prop?.sheet_key || "";
          if (cat) {
            let cleanCat = cat;
            if (cleanCat === "SH_M") cleanCat = "FGM";
            if (cleanCat === "SH_AT") cleanCat = "FGA";
            if (cleanCat === "OR") cleanCat = "OREB";
            if (cleanCat === "DR") cleanCat = "DREB";
            if (!containsGreek(cleanCat)) categorySet.add(cleanCat);
          }

          const rawName = String(row?.player?.name ?? "").trim();
          const teamRaw = String(row?.player?.team ?? "").trim();
          const teamKey = (row as any)?.__teamKey ?? resolveTeamKey(teamRaw);
          const team = String(teamKey ?? teamRaw).trim();

          if (rawName) {
            const key = `${team}::${rawName}`;
            if (!playerSeen.has(key)) {
              playerSeen.add(key);

              const parsePlayerName = (v: string) => {
                const s = String(v ?? "").trim();
                if (!s) return { first: "", last: "" };
                if (s.includes(",")) {
                  const [a, bRaw] = s.split(",", 2);
                  const aClean = (a ?? "").trim();
                  const bClean = (bRaw ?? "").trim();
                  const bFirst = bClean.split(/\s+/).filter(Boolean)[0] ?? "";
                  const aParts = aClean.split(/\s+/).filter(Boolean);
                  if (aParts.length >= 2 && bFirst && aParts[0].toLowerCase() === bFirst.toLowerCase()) {
                    return { first: bFirst, last: aParts.slice(1).join(" ") };
                  }
                  return { first: bFirst || bClean, last: aClean };
                }
                const parts = s.split(/\s+/).filter(Boolean);
                if (parts.length === 1) return { first: parts[0], last: "" };
                return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
              };

              const { first, last } = parsePlayerName(rawName);
              const surname = (last || rawName).trim();
              const name = (first || "").trim();
              players.push({ key, name, surname, team, teamKey });
            }
          }
        }

        setFilter("propCategoryOptions", Array.from(categorySet).sort());
        setFilter("playerOptions", players);
        setFilter("playerKeys", players.map((p) => p.key));
      } catch (e: any) {
        if (!alive) return;
        if (latestLoadKeyRef.current !== loadKey) return;
        setError(e?.message ?? "Failed to load");
        setAll([]);
      } finally {
        if (!alive) return;
        if (latestLoadKeyRef.current !== loadKey) return;
        setLoading(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [bookmaker, match, scope, allBookmakers, setFilter]);

  React.useEffect(() => {
    setPpFocusPlayerKey(null);
    ppRestoreScrollTopRef.current = null;
    ppPendingRestoreScrollTopRef.current = null;
  }, [match, bookmaker, scope, oddsMin, oddsMax, sortKey, sortDir, propCategories, selectedPlayers, selectedTeam]);

  const data = React.useMemo(() => {
    const min = parseNum(oddsMin, 1.0);
    const max = parseNum(oddsMax, 100.0);
    let rows = all.slice();

    if (Array.isArray(propCategories) && propCategories.length > 0) {
      const set = new Set(propCategories);
      rows = rows.filter((r: any) => {
        let cat = String(r?.prop?.label ?? "").trim();
        if (!cat) {
          const sheetKey = String(r?.prop?.sheet_key ?? "").trim();
          const uiName = String(r?.prop?.ui_name ?? "").trim();
          cat = sheetKey || uiName || "PROP";
          if (cat === "SH_M") cat = "FGM";
          if (cat === "SH_AT") cat = "FGA";
          if (cat === "OR") cat = "OREB";
          if (cat === "DR") cat = "DREB";
        }
        return set.has(cat);
      });
    }

    if (selectedTeam) {
      rows = rows.filter((r: any) => {
        const tk = String((r as any)?.__teamKey ?? "").trim();
        if (tk) return tk === selectedTeam;
        const raw = String(r?.player?.team ?? r?.team?.name ?? "").trim();
        const derived = resolveTeamKey(raw);
        return derived ? String(derived) === selectedTeam : false;
      });
    }

    if (Array.isArray(selectedPlayers) && selectedPlayers.length > 0) {
      const set = new Set(selectedPlayers);
      rows = rows.filter((r: any) => set.has(getRowPlayerScopeKey(r as BetLine)));
    }

    rows = rows.filter((r) => r.odds >= min && r.odds <= max);

    rows.sort((a, b) => {
      const va = getMetric(a, sortKey);
      const vb = getMetric(b, sortKey);
      const dir = sortDir === "asc" ? 1 : -1;
      if (va === vb) return 0;
      return (va - vb) * dir;
    });

    if (ppFocusPlayerKey) {
      rows = rows.filter((r) => getRowPlayerScopeKey(r) === ppFocusPlayerKey);
    }

    return rows;
  }, [all, oddsMin, oddsMax, sortKey, sortDir, propCategories, selectedPlayers, selectedTeam, ppFocusPlayerKey]);

  React.useEffect(() => {
    if (showingDivRef.current) setShowingDivHeight(showingDivRef.current.offsetHeight);
  }, []);

  React.useEffect(() => {
    if (showingDivRef.current) setShowingDivHeight(showingDivRef.current.offsetHeight);
  }, [topBarHidden, ppFocusPlayerKey, loading, data.length]);

  const spacerHeight = topBarHidden ? 0 : topBarHeight;
  const rowCount = data.length;
  const isMobilePlayerPropsMode = !isLgUp && !!ppFocusPlayerKey;

  const virtualizer = useVirtualizer({
    count: isMobilePlayerPropsMode ? 0 : rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (isLgUp ? 132 + ROW_GAP : 187 + ROW_GAP),
    overscan: 12,
    getItemKey: (index) => {
      const row = data[index];
      return row ? getRowUiKey(row, index) : `idx:${index}`;
    },
    enabled: !isMobilePlayerPropsMode,
  });

  React.useEffect(() => {
    setFilter("scrollContainerRef", parentRef);
    return () => {
      setFilter("scrollContainerRef", null);
    };
  }, [setFilter]);

  React.useEffect(() => {
    setOpenId(null);
    setDrawerPos(null);
    setDrawerLastN(null);
    setDrawerViewportPos(null);
  }, [match, bookmaker, scope, oddsMin, oddsMax, sortKey, sortDir, propCategories, selectedPlayers, selectedTeam, ppFocusPlayerKey]);

  React.useLayoutEffect(() => {
    if (ppFocusPlayerKey !== null) return;
    const restoreTop = ppPendingRestoreScrollTopRef.current;
    const scroller = parentRef.current;
    if (restoreTop == null || !scroller) return;
    scroller.scrollTo({ top: restoreTop, behavior: "auto" });
    ppPendingRestoreScrollTopRef.current = null;
  }, [ppFocusPlayerKey, data.length]);

  React.useEffect(() => {
    const scroller = parentRef.current;
    if (!scroller) return;

    const handleScroll = () => {
      if (openId) {
        setOpenId(null);
        setDrawerPos(null);
        setDrawerViewportPos(null);
        setDrawerLastN(null);
      }
    };

    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", handleScroll);
  }, [openId]);

  const handleToggleRow = React.useCallback(
    (row: BetLine, rowUiKey: string, n?: number) => {
      const scroller = parentRef.current;
      const card = rowRefs.current.get(rowUiKey);

      if (!scroller || !card) {
        setOpenId((prev) => (prev === rowUiKey ? null : rowUiKey));
        setDrawerPos(null);
        setDrawerViewportPos(null);
        return;
      }

      if (openId === rowUiKey) {
        setOpenId(null);
        setDrawerPos(null);
        setDrawerViewportPos(null);
        return;
      }

      const cardRect = card.getBoundingClientRect();
      const viewportTop = cardRect.bottom + 8;
      const viewportLeft = 0;
      const width = scroller.clientWidth;

      setOpenId(rowUiKey);

      const picked = Number(n);
      if (Number.isFinite(picked) && picked > 0) {
        setDrawerLastN(picked);
      } else if (drawerLastN == null) {
        const kk = String(sortKey || "L15");
        const base = kk.startsWith("v") ? kk.slice(1) : kk;
        const nn = Number(base.toUpperCase().replace("L", ""));
        setDrawerLastN(Number.isFinite(nn) && nn > 0 ? nn : 15);
      }

      setDrawerViewportPos({ top: viewportTop, left: viewportLeft, width });
      setDrawerPos({
        top: cardRect.bottom - scroller.getBoundingClientRect().top + scroller.scrollTop + 8,
        left: 0,
        width,
      });
    },
    [openId, drawerLastN, sortKey]
  );

  const handleTogglePlayerProps = React.useCallback(
    (row: BetLine) => {
      const playerKey = getRowPlayerScopeKey(row);
      const scroller = parentRef.current;

      setOpenId(null);
      setDrawerPos(null);
      setDrawerViewportPos(null);
      setDrawerLastN(null);

      if (ppFocusPlayerKey === playerKey) {
        ppPendingRestoreScrollTopRef.current = ppRestoreScrollTopRef.current;
        setPpFocusPlayerKey(null);
        ppRestoreScrollTopRef.current = null;
        return;
      }

      ppRestoreScrollTopRef.current = scroller ? scroller.scrollTop : 0;
      setPpFocusPlayerKey(playerKey);

      requestAnimationFrame(() => {
        const el = parentRef.current;
        if (el) el.scrollTo({ top: 0, behavior: "auto" });
      });
    },
    [ppFocusPlayerKey]
  );

  const scrollFeedToTop = React.useCallback(() => {
    const scroller = parentRef.current;
    if (!scroller) return;

    scroller.scrollTo({
      top: 0,
      behavior: isMobilePlayerPropsMode ? "auto" : "smooth",
    });
  }, [isMobilePlayerPropsMode]);

  if (error) {
    return <div className="px-4 py-6 text-[13px] text-red-400">{error}</div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-4">
      <div style={{ height: spacerHeight }} />

      <div ref={showingDivRef} className="mb-3 flex items-center justify-between gap-3 pl-16">
        <div className="text-[12px] opacity-70 whitespace-nowrap">
          Showing{" "}
          <span suppressHydrationWarning className="font-semibold text-white">
            {mounted ? data.length : ""}
          </span>{" "}
          bet lines
          {ppFocusPlayerKey ? (
            <span className="ml-2 inline-flex items-center rounded-full border border-cyan-300/30 bg-cyan-400/10 px-2 py-[2px] text-[10px] font-semibold tracking-wide text-cyan-200">
              PP ACTIVE
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {loading ? <div className="text-[12px] opacity-70">Loading…</div> : null}

          <button
            type="button"
            onClick={scrollFeedToTop}
            className="rounded-full border border-stroke bg-white/6 px-3 py-1 text-[11px] text-white/90 hover:bg-white/10 transition whitespace-nowrap"
          >
            BACK TO TOP
          </button>
        </div>
      </div>

      <div
        ref={parentRef}
        id="bet-rows-container"
        className="overflow-y-auto overflow-x-hidden scrollbar-thin"
        style={{
          height: `calc(100vh - ${spacerHeight + showingDivHeight}px)`,
          WebkitOverflowScrolling: "touch",
          overscrollBehaviorY: "contain",
          touchAction: "pan-y",
        }}
      >
        {!loading && data.length === 0 && (
          <div className="px-4 py-10 text-center text-[13px] opacity-75">NO PROPS</div>
        )}

        {isMobilePlayerPropsMode ? (
          <div className="relative w-full">
            {data.map((row, index) => {
              const rowUiKey = getRowUiKey(row, index);
              const isOpen = openId === rowUiKey;
              const isPlayerPropsActive = ppFocusPlayerKey === getRowPlayerScopeKey(row);

              return (
                <div
                  key={rowUiKey}
                  style={{ width: "100%", paddingBottom: ROW_GAP, boxSizing: "border-box" }}
                >
                  <BetRow
                    ref={(node) => {
                      rowRefs.current.set(rowUiKey, node);
                    }}
                    row={row}
                    open={isOpen}
                    playerPropsActive={isPlayerPropsActive}
                    onTogglePlayerProps={() => handleTogglePlayerProps(row)}
                    onToggle={(n) => handleToggleRow(row, rowUiKey, n)}
                    onPickHit={(k) => {
                      setFilter("sortKey", k as any);
                      const kk = String(k || "L15");
                      const base = kk.startsWith("v") ? kk.slice(1) : kk;
                      const n = Number(base.toUpperCase().replace("L", ""));
                      setDrawerLastN(Number.isFinite(n) && n > 0 ? n : 15);
                    }}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
            {virtualizer.getVirtualItems().map((v) => {
              const row = data[v.index];
              if (!row) return null;

              const rowUiKey = getRowUiKey(row, v.index);
              const isOpen = openId === rowUiKey;
              const isPlayerPropsActive = ppFocusPlayerKey === getRowPlayerScopeKey(row);

              return (
                <div
                  key={rowUiKey}
                  data-index={v.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: Math.round(v.start),
                    left: 0,
                    width: "100%",
                    zIndex: isOpen ? 2 : 1,
                    paddingBottom: ROW_GAP,
                    boxSizing: "border-box",
                  }}
                >
                  <BetRow
                    ref={(node) => {
                      rowRefs.current.set(rowUiKey, node);
                    }}
                    row={row}
                    open={isOpen}
                    playerPropsActive={isPlayerPropsActive}
                    onTogglePlayerProps={() => handleTogglePlayerProps(row)}
                    onToggle={(n) => handleToggleRow(row, rowUiKey, n)}
                    onPickHit={(k) => {
                      setFilter("sortKey", k as any);
                      const kk = String(k || "L15");
                      const base = kk.startsWith("v") ? kk.slice(1) : kk;
                      const n = Number(base.toUpperCase().replace("L", ""));
                      setDrawerLastN(Number.isFinite(n) && n > 0 ? n : 15);
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {openId &&
        drawerViewportPos &&
        (() => {
          const rowIndex = data.findIndex((r, i) => getRowUiKey(r, i) === openId);
          const row = rowIndex >= 0 ? data[rowIndex] : null;
          if (!row) return null;

          return (
            <BetDrawerOverlay
              key={`${openId}-${drawerLastN ?? ""}`}
              row={row}
              top={drawerViewportPos.top}
              left={drawerViewportPos.left}
              width={drawerViewportPos.width}
              initialLastN={drawerLastN ?? undefined}
              onClose={() => {
                setOpenId(null);
                setDrawerPos(null);
                setDrawerViewportPos(null);
              }}
              allLines={all}
            />
          );
        })()}
    </div>
  );
}

export default BetFeed;