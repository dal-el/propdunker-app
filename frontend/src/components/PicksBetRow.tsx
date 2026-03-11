"use client";

import * as React from "react";
import { clsx } from "clsx";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { BetLine } from "@/lib/types";
import { fmtLine, fmtOdds } from "@/lib/format";
import { usePicks } from "@/lib/picksStore";
import { BetDrawerOverlay } from "@/components/BetDrawerOverlay";
import { resolveEuroleagueLogoUrl } from "@/lib/teamLogos";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

function safeLogoUrl(u: string | undefined | null) {
  if (!u) return "";
  if (u.startsWith("/")) return API_BASE + u;
  return u;
}

interface PicksBetRowProps {
  row: BetLine;
  allLines?: BetLine[];
  onAddToSlip?: (row: BetLine, slipNumber: number) => void;
  onRemoveFromSlip?: (row: BetLine) => void;
  isInSlip?: boolean;
  selectedSlipNumber?: number | null;
  onSlipNumberChange?: (num: number | null) => void;
}

export function PicksBetRow({
  row,
  allLines,
  onAddToSlip,
  onRemoveFromSlip,
  isInSlip = false,
  selectedSlipNumber,
  onSlipNumberChange,
}: PicksBetRowProps) {
  const [open, setOpen] = React.useState(false);
  const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  const togglePick = usePicks((s) => s.togglePick);

  const playerName = React.useMemo(
    () =>
      (row as any)?.player?.name ||
      (row as any)?.playerName ||
      (row as any)?.name ||
      "Unknown Player",
    [row]
  );

  const playerPos = React.useMemo(
    () =>
      (row as any)?.player?.pos ||
      (row as any)?.player?.position ||
      (row as any)?.pos ||
      (row as any)?.position ||
      "N/A",
    [row]
  );

  const logoSrc = React.useMemo(() => {
    const logoRaw =
      (row as any)?.team?.logo ||
      (row as any)?.teamLogo ||
      (row as any)?.logo ||
      (row as any)?.player?.teamLogo ||
      (row as any)?.player?.logo ||
      (row as any)?.player?.team?.logo;

    if (logoRaw) return safeLogoUrl(logoRaw);

    const teamKey =
      (row as any)?.__teamKey ||
      (row as any)?.team?.id ||
      (row as any)?.team_id ||
      (row as any)?.teamId ||
      (row as any)?.team?.code ||
      (row as any)?.team?.abbr ||
      (row as any)?.teamAbbr ||
      (row as any)?.player?.team ||
      (row as any)?.player?.team_code;

    if (teamKey) return resolveEuroleagueLogoUrl(String(teamKey));
    return "";
  }, [row]);

  const propCategoryFull = React.useMemo(
    () =>
      (row as any)?.prop?.label ||
      (row as any)?.prop?.fullName ||
      (row as any)?.prop?.name ||
      (row as any)?.propLabel ||
      (row as any)?.market ||
      (row as any)?.prop?.sheet_key ||
      (row as any)?.sheet_key ||
      "",
    [row]
  );

  const bookmakerFull = React.useMemo(
    () =>
      (row as any)?.bookmakerFullName ||
      (row as any)?.bookmakerName ||
      (row as any)?.bookmaker ||
      (row as any)?.book ||
      (row as any)?.sportsbook ||
      (row as any)?.operator ||
      "",
    [row]
  );

  const odds = React.useMemo(() => {
    const raw =
      (row as any)?.odds ||
      (row as any)?.price ||
      (row as any)?.decimal ||
      (row as any)?.overOdds ||
      (row as any)?.odds_over ||
      (row as any)?.oddsOver ||
      0;
    return Number(raw);
  }, [row]);

  const line = React.useMemo(() => Number((row as any)?.line ?? 0), [row]);
  const side = React.useMemo(() => (row as any)?.side || "OVER", [row]);
  const tier = React.useMemo(
    () => (row as any)?.prop?.tier || (row as any)?.tier || "MAIN",
    [row]
  );

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (buttonRef.current) {
      setAnchorRect(buttonRef.current.getBoundingClientRect());
      setOpen(true);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setAnchorRect(null);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    togglePick(row);
  };

  const [localSlipNumber, setLocalSlipNumber] = React.useState<number>(0);
  const effectiveSlipNumber = selectedSlipNumber ?? localSlipNumber;

  const handleSlipNumberChange = (delta: number) => {
    const newNum = Math.min(19, Math.max(0, effectiveSlipNumber + delta));
    if (onSlipNumberChange) {
      onSlipNumberChange(newNum);
    } else {
      setLocalSlipNumber(newNum);
    }
  };

  const handleSlipAction = () => {
    if (isInSlip && onRemoveFromSlip) {
      onRemoveFromSlip(row);
    } else if (!isInSlip && onAddToSlip) {
      onAddToSlip(row, effectiveSlipNumber);
    }
  };

  return (
    <>
      <div
        className={clsx(
          "rounded-2xl border overflow-hidden",
          "border-white/10",
          "bg-gradient-to-b from-white/[0.06] to-white/[0.02] backdrop-blur-md",
          "shadow-[0_8px_28px_rgba(0,0,0,0.35)]",
          "transition-all duration-200",
          "hover:border-white/20 hover:shadow-[0_10px_32px_rgba(0,0,0,0.55)]"
        )}
      >
        <button
          ref={buttonRef}
          type="button"
          onClick={handleOpen}
          className="relative w-full px-4 py-3 text-left hover:bg-white/[0.05] active:bg-white/[0.07] transition cursor-pointer"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-1">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-10 w-10 shrink-0 rounded-full bg-white/10 border border-white/10 shadow-inner overflow-hidden flex items-center justify-center">
                  {logoSrc ? (
                    <img
                      src={logoSrc}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                        const parent = (e.target as HTMLImageElement).parentElement;
                        if (parent) {
                          const div = document.createElement("div");
                          div.className = "h-6 w-6 rounded-full bg-white/10";
                          parent.appendChild(div);
                        }
                      }}
                    />
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-white/10" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-[15px] font-semibold tracking-wide truncate text-white/95">
                      {playerName}
                    </span>
                    <span className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/8 px-2 py-[2px] text-[11px] leading-none text-white/85">
                      {playerPos}
                    </span>
                  </div>

                  {/* Desktop view */}
                  <div className="hidden lg:flex items-center gap-2 mt-2 min-w-0 flex-nowrap">
                    <span
                      className={clsx(
                        "inline-flex items-center gap-2 rounded-full border px-3 py-[6px]",
                        "text-[12px] leading-none font-semibold backdrop-blur",
                        "border-white/10 bg-white/8"
                      )}
                    >
                      <span
                        className={clsx(
                          "font-extrabold tracking-wide",
                          side === "OVER" ? "text-emerald-200" : "text-rose-200"
                        )}
                      >
                        {side}
                      </span>
                      <span className="text-white/90">{fmtLine(line)}</span>
                    </span>

                    {propCategoryFull ? (
                      <span className="min-w-0 max-w-[340px] text-[12px] font-medium text-white/85 truncate">
                        {propCategoryFull}
                      </span>
                    ) : (
                      <span className="min-w-0 max-w-[340px]" />
                    )}

                    <span
                      className={clsx(
                        "inline-flex items-center justify-center rounded-full border px-3 py-[6px]",
                        "text-[12px] leading-none font-semibold backdrop-blur",
                        "border-white/10 bg-white/8 text-white/90"
                      )}
                    >
                      {fmtOdds(odds)}
                    </span>
                  </div>

                  {/* Mobile view */}
                  <div className="lg:hidden mt-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={clsx(
                          "inline-flex items-center gap-2 rounded-full border px-3 py-[6px]",
                          "text-[12px] leading-none font-semibold backdrop-blur",
                          "border-white/10 bg-white/8"
                        )}
                      >
                        <span
                          className={clsx(
                            "font-extrabold tracking-wide",
                            side === "OVER" ? "text-emerald-200" : "text-rose-200"
                          )}
                        >
                          {side}
                        </span>
                        <span className="text-white/90">{fmtLine(line)}</span>
                      </span>

                      <span
                        className={clsx(
                          "inline-flex items-center justify-center rounded-full border px-3 py-[6px]",
                          "text-[12px] leading-none font-semibold backdrop-blur",
                          "border-white/10 bg-white/8 text-white/90"
                        )}
                      >
                        {fmtOdds(odds)}
                      </span>
                    </div>
                    {propCategoryFull && (
                      <div className="mt-1 text-[11px] text-white/70 truncate">
                        {propCategoryFull}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleRemove}
                  className="inline-flex items-center justify-center rounded-full border px-3 py-[5px] text-[12px] leading-none font-extrabold backdrop-blur transition-all duration-150 active:scale-95 border-rose-300/40 bg-rose-400/12 text-rose-200 hover:bg-rose-400/16 shrink-0 cursor-pointer"
                  aria-label="Remove from My Picks"
                  title="Remove"
                >
                  −
                </button>
              </div>

              <div className="mt-2 flex items-center justify-end gap-2 text-[11px]">
                {bookmakerFull && (
                  <span className="leading-none text-white/60 whitespace-nowrap">
                    {bookmakerFull}
                  </span>
                )}
                {tier && (
                  <span
                    className={clsx(
                      "inline-flex items-center justify-center rounded-full border px-2.5 py-[3px]",
                      "text-[11px] font-extrabold tracking-wide backdrop-blur",
                      tier === "ALT"
                        ? "border-sky-300/25 bg-sky-400/10 text-sky-200"
                        : "border-violet-300/25 bg-violet-400/10 text-violet-200"
                    )}
                  >
                    {tier}
                  </span>
                )}
              </div>

              <div className="mt-2 flex items-center justify-end gap-2">
                <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/8 p-1 backdrop-blur">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSlipNumberChange(-1);
                    }}
                    className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-white/10 text-white/80 cursor-pointer transition"
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </button>
                  <span className="min-w-[20px] text-center text-xs font-bold text-white">
                    {effectiveSlipNumber}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSlipNumberChange(1);
                    }}
                    className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-white/10 text-white/80 cursor-pointer transition"
                  >
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSlipAction();
                  }}
                  disabled={!isInSlip && !onAddToSlip}
                  className={clsx(
                    "inline-flex items-center justify-center rounded-full border px-3 py-[5px]",
                    "text-[12px] leading-none font-extrabold backdrop-blur transition-all duration-150 active:scale-95 cursor-pointer",
                    isInSlip
                      ? "border-rose-300/40 bg-rose-400/12 text-rose-200 hover:bg-rose-400/16"
                      : "border-emerald-300/40 bg-emerald-400/12 text-emerald-200 hover:bg-emerald-400/16",
                    !isInSlip && !onAddToSlip && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isInSlip ? "REMOVE" : "ADD TO BETSLIP"}
                </button>
              </div>
            </div>

            <div className="hidden lg:flex items-center gap-2">
              <ChevronDown className="h-5 w-5 opacity-70" />
            </div>
          </div>
        </button>
      </div>

      {open && anchorRect && (
        <BetDrawerOverlay
          row={row}
          top={anchorRect.top}
          left={anchorRect.left}
          width={anchorRect.width}
          onClose={handleClose}
          allLines={allLines}
          initialLastN={15}
        />
      )}
    </>
  );
}