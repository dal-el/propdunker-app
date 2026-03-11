// app/picks/page.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronUp, X } from "lucide-react";
import JerseyAvatar from "@/components/JerseyAvatar";
import { usePicks, groupPicksByPlayer } from "@/lib/picksStore";
import { useSlipStore } from "@/lib/slipStore";
import { PicksBetRow } from "@/components/PicksBetRow";
import BetSlip from "@/components/BetSlip";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { BetLine } from "@/lib/types";
import { fmtOdds, fmtLine } from "@/lib/format";
import { CARD_GLASS, PILL, PILL_ACTIVE } from "@/lib/uiTokens";
import { clsx } from "clsx";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

export default function PicksPage() {
  const router = useRouter();
  const { picks, clearPicks, togglePick } = usePicks();
  const [expanded, setExpanded] = useState(false);
  const [allLines, setAllLines] = useState<BetLine[]>([]);

  const {
    slips,
    pickToSlipMap,
    addToSlip,
    removeFromSlip,
    updateItemStatus,
    closeSlip,
    updateStake,
    confirmStake,
    addToStake,
    backspaceStake,
    clearAll: clearSlips,
  } = useSlipStore();

  const groups = React.useMemo(() => groupPicksByPlayer(picks), [picks]);
  const allPicks = React.useMemo(() => Object.values(picks), [picks]);

  const [hoveredPlayerKey, setHoveredPlayerKey] = useState<string | null>(null);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const buttonRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  useEffect(() => {
    let mounted = true;
    const fetchAllLines = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/feed?limit=500`);
        if (!res.ok) return;
        const data = await res.json();
        if (mounted && Array.isArray(data)) {
          setAllLines(data);
        }
      } catch (error) {
        console.error("Failed to fetch all lines:", error);
      }
    };
    fetchAllLines();
    return () => {
      mounted = false;
    };
  }, []);

  const handleClearAll = () => {
    if (confirm("Are you sure you want to remove all picks and slips?")) {
      clearPicks();
      clearSlips();
    }
  };

  // ✅ Διορθωμένη συνάρτηση – χρησιμοποιεί (as any) για player.id και prop.sheet_key
  const getPickId = (row: BetLine): string => {
    return (row as any).id || `${(row as any).player?.id}-${(row.prop as any)?.sheet_key}-${row.line}-${row.side}`;
  };

  const handleMouseEnter = (playerKey: string, button: HTMLButtonElement) => {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    setHoveredPlayerKey(playerKey);
    const rect = button.getBoundingClientRect();
    setTooltipPos({
      top: rect.bottom + window.scrollY + 5,
      left: rect.left + window.scrollX + rect.width / 2,
    });
  };

  const handleMouseLeave = () => {
    setHoveredPlayerKey(null);
  };

  const handleTouchStart = (playerKey: string, button: HTMLButtonElement) => {
    handleMouseEnter(playerKey, button);
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    tooltipTimeoutRef.current = setTimeout(() => {
      setHoveredPlayerKey(null);
    }, 2000);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pt-16 pb-4">
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.replace("/")}
          className={clsx(PILL, "gap-2 px-3 py-2 text-[13px]")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="text-[14px] font-semibold text-white/90">
          My Picks <span className="text-white/60">({groups.length} players)</span>
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={clsx(PILL, "gap-2 px-4 py-2 text-[13px]")}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-4 w-4" />
              <span>FOLD</span>
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" />
              <span>EXPAND</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handleClearAll}
          className={clsx(PILL, "gap-2 px-4 py-2 text-[13px]")}
        >
          <X className="h-4 w-4" />
          <span>CLEAR ALL</span>
        </button>
      </div>

      {groups.length === 0 ? (
        <div className={clsx(CARD_GLASS, "p-6 text-white/70")}>
          Δεν έχεις βάσει ακόμα picks (+).
        </div>
      ) : expanded ? (
        <div className="space-y-3">
          {allPicks.map((row) => (
            <PicksBetRow
              key={getPickId(row)}
              row={row}
              allLines={allLines}
              onAddToSlip={(row, num) => addToSlip(getPickId(row), row, num)}
              onRemoveFromSlip={(row) => removeFromSlip(getPickId(row))}
              isInSlip={!!pickToSlipMap[getPickId(row)]}
              selectedSlipNumber={pickToSlipMap[getPickId(row)] || null}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {groups.map((g) => (
            <div key={g.playerKey} className="relative">
              <button
                ref={(el) => {
                  buttonRefs.current.set(g.playerKey, el);
                }}
                onClick={() => router.push(`/picks/${encodeURIComponent(g.playerKey)}`)}
                onMouseEnter={(e) => handleMouseEnter(g.playerKey, e.currentTarget)}
                onMouseLeave={handleMouseLeave}
                onTouchStart={(e) => handleTouchStart(g.playerKey, e.currentTarget)}
                onTouchEnd={() => {}}
                className={clsx(CARD_GLASS, "group relative w-full overflow-hidden p-3 text-left transition hover:shadow-[0_20px_56px_rgba(0,0,0,0.5)] cursor-pointer")}
                title={g.playerName}
              >
                {/* μόνο το top highlight (ουδέτερο) */}
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/15" />

                <div className="relative flex items-center gap-3">
                  <div className="shrink-0">
                    <JerseyAvatar
                      playerName={g.playerName}
                      number={g.number || "0"}
                      teamName={g.teamName}
                      teamKey={g.teamKey}
                      size={74}
                      className="drop-shadow"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-white">
                      {g.playerName}
                    </div>
                    <div className="truncate text-[12px] text-white/65">{g.teamName || "—"}</div>
                    <div className={clsx(PILL, "mt-2 px-2 py-0.5 text-[12px]")}>
                      {g.rows.length} {g.rows.length === 1 ? "pick" : "picks"}
                    </div>
                  </div>
                </div>
              </button>

              {hoveredPlayerKey === g.playerKey &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    className={clsx(CARD_GLASS, "fixed z-50 max-w-xs px-3 py-2 text-xs text-white shadow-lg")}
                    style={{
                      top: tooltipPos.top,
                      left: tooltipPos.left,
                      transform: "translate(-50%, 0)",
                      pointerEvents: "none",
                    }}
                  >
                    <ul className="space-y-1">
                      {g.rows.map((row, idx) => {
                        const side = row.side || "OVER";
                        const line = row.line ?? 0;
                        const propLabel = row.prop?.label || "Prop";
                        const odds = row.odds ?? 0;
                        const fullDescription = `${side} ${fmtLine(line)} ${propLabel} @ ${fmtOdds(odds)}`;
                        return (
                          <li key={idx} className="max-w-[250px] truncate">
                            {fullDescription}
                          </li>
                        );
                      })}
                    </ul>
                    <div className="absolute top-0 left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-l border-t border-stroke bg-black/90" />
                  </div>,
                  document.body
                )}
            </div>
          ))}
        </div>
      )}

      {Object.keys(slips).length > 0 && (
        <div className="mt-8">
          <h2 className="mb-4 text-lg font-semibold text-white/80">BET SLIPS</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(slips).map(([num, data]) => (
              <BetSlip
                key={num}
                slipNumber={parseInt(num)}
                items={data.items}
                onUpdateItem={(index, status) => updateItemStatus(parseInt(num), index, status)}
                onClose={() => closeSlip(parseInt(num))}
                stake={data.stake}
                stakeConfirmed={data.stakeConfirmed}
                onStakeConfirm={() => confirmStake(parseInt(num))}
                onAddToStake={(amount) => addToStake(parseInt(num), amount)}
                onBackspace={() => backspaceStake(parseInt(num))}
                onStakeChange={(stake) => updateStake(parseInt(num), stake)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}