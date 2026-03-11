"use client";

import * as React from "react";
import { X, Check } from "lucide-react";
import { SlipItem } from "@/lib/slipStore";
import { fmtOdds } from "@/lib/format";

interface BetSlipProps {
  slipNumber: number;
  items: SlipItem[];
  onUpdateItem: (index: number, status: "won" | "lost" | "void") => void;
  onClose: () => void;
  stake: string;
  stakeConfirmed: boolean;
  onStakeConfirm: () => void;
  onAddToStake: (amount: number) => void;
  onBackspace: () => void;
  onStakeChange: (stake: string) => void;
}

const BetSlip: React.FC<BetSlipProps> = ({
  slipNumber,
  items,
  onUpdateItem,
  onClose,
  stake,
  stakeConfirmed,
  onStakeConfirm,
  onAddToStake,
  onBackspace,
  onStakeChange,
}) => {
  const totalOdds = React.useMemo(() => {
    let product = 1.0;

    items.forEach((item) => {
      if (item.type === "bet") {
        if (item.status === "void") product *= 1.0;
        else if (item.status === "won") product *= item.row.odds;
      }
      // Για combo, δεν επηρεάζουν το totalOdds (προς το παρόν)
    });

    return product;
  }, [items]);

  const hasLost = items.some((item) => item.status === "lost");
  const stakeNum = parseFloat(stake) || 0;
  const potentialWinnings = hasLost
    ? 0
    : items.every((i) => i.status === "void")
      ? stakeNum
      : stakeNum * totalOdds;

  const wonLostText = !stakeConfirmed
    ? ""
    : hasLost
      ? "LOST"
      : items.every((i) => i.status === "void")
        ? "VOID - STAKE RETURNED"
        : "WON";

  const grossProfit = stakeConfirmed && !hasLost ? potentialWinnings : 0;
  const netProfit = grossProfit - stakeNum;

  const getButtonClass = (status: string, current: string) => {
    if (status === current) {
      if (current === "won") return "bg-emerald-500/20 border-emerald-400 text-emerald-400";
      if (current === "lost") return "bg-rose-500/20 border-rose-400 text-rose-400";
      if (current === "void") return "bg-yellow-500/20 border-yellow-400 text-yellow-400";
    }
    return "border-white/10 text-white/50 hover:bg-white/10";
  };

  return (
    <div className="rounded-2xl border border-stroke bg-card shadow-glow overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-stroke bg-white/5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white/70">SLIP</span>
          <span className="text-lg font-bold text-white">{slipNumber}</span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-white/10 text-white/80"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 py-3 space-y-2 max-h-80 overflow-auto">
        {items.map((item, idx) => {
          if (item.type === "bet") {
            const row = item.row;
            const playerName = (row as any)?.player?.name || "Unknown Player";
            const propLabel = (row as any)?.prop?.label || "Prop";
            const fullDescription = `${row.side} ${row.line} ${propLabel} @ ${fmtOdds(row.odds)}`;

            return (
              <div
                key={idx}
                className="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/8 transition"
              >
                <div className="min-w-0 flex-1 pr-2">
                  <div className="text-[13px] font-semibold text-white truncate">{playerName}</div>
                  <div className="text-[11px] text-white/60">{fullDescription}</div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onUpdateItem(idx, "won")}
                    className={`h-7 w-7 rounded-full flex items-center justify-center border transition ${getButtonClass(item.status, "won")}`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onUpdateItem(idx, "lost")}
                    className={`h-7 w-7 rounded-full flex items-center justify-center border transition ${getButtonClass(item.status, "lost")}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onUpdateItem(idx, "void")}
                    className={`h-7 px-2 rounded-full flex items-center justify-center border transition text-[10px] font-bold ${getButtonClass(item.status, "void")}`}
                  >
                    VOID
                  </button>
                </div>
              </div>
            );
          }

          const combo = item.combo;

          return (
            <div
              key={idx}
              className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/8 transition"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="text-[13px] font-semibold text-white truncate">{combo.playerName}</div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onUpdateItem(idx, "won")}
                    className={`h-7 w-7 rounded-full flex items-center justify-center border transition ${getButtonClass(item.status, "won")}`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onUpdateItem(idx, "lost")}
                    className={`h-7 w-7 rounded-full flex items-center justify-center border transition ${getButtonClass(item.status, "lost")}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onUpdateItem(idx, "void")}
                    className={`h-7 px-2 rounded-full flex items-center justify-center border transition text-[10px] font-bold ${getButtonClass(item.status, "void")}`}
                  >
                    VOID
                  </button>
                </div>
              </div>

              <div className="text-[11px] text-white/70 mb-1">
                {combo.categories[0]} + {combo.categories[1]} | Lines: {combo.lines[0]} / {combo.lines[1]}
              </div>

              <div className="grid grid-cols-4 gap-1 text-center text-[10px]">
                <div>
                  <div className="font-bold text-white">{fmtOdds(combo.odds?.[0] ?? 0)}</div>
                  <div className="text-white/50">O/O</div>
                </div>
                <div>
                  <div className="font-bold text-white">{fmtOdds(combo.odds?.[1] ?? 0)}</div>
                  <div className="text-white/50">O/U</div>
                </div>
                <div>
                  <div className="font-bold text-white">{fmtOdds(combo.odds?.[2] ?? 0)}</div>
                  <div className="text-white/50">U/U</div>
                </div>
                <div>
                  <div className="font-bold text-white">{fmtOdds(combo.odds?.[3] ?? 0)}</div>
                  <div className="text-white/50">U/O</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-4 pb-4">
        <div className="text-xs font-semibold text-white/60 mb-2">STAKE</div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          {[5, 10, 20, 50].map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => onAddToStake(amt)}
              className="px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs text-white/80 hover:bg-white/10"
            >
              +{amt}
            </button>
          ))}

          <div className="flex items-center gap-1 ml-auto">
            <button
              type="button"
              onClick={() => onAddToStake(1)}
              className="h-8 w-8 rounded-full border border-white/10 bg-white/5 flex items-center justify-center hover:bg-white/10"
            >
              +1
            </button>
            <button
              type="button"
              onClick={() => onAddToStake(-1)}
              className="h-8 w-8 rounded-full border border-white/10 bg-white/5 flex items-center justify-center hover:bg-white/10"
            >
              -1
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            value={stake}
            onChange={(e) => onStakeChange(e.target.value)}
            placeholder="0.00"
            className="flex-1 h-10 rounded-full border border-white/10 bg-white/5 px-4 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
          />

          <button
            type="button"
            onClick={onBackspace}
            className="h-10 w-10 rounded-full border border-white/10 bg-white/5 flex items-center justify-center hover:bg-white/10 font-bold"
          >
            ⌫
          </button>

          <button
            type="button"
            onClick={onStakeConfirm}
            className={`h-10 px-5 rounded-full font-semibold text-sm transition ${
              stakeConfirmed
                ? "bg-emerald-500/20 border border-emerald-400 text-emerald-400"
                : "bg-white/10 border border-white/20 text-white/80 hover:bg-white/20"
            }`}
          >
            OK
          </button>
        </div>

        <div className="rounded-xl bg-white/5 p-3 border border-white/10">
          <div className="flex justify-between text-sm">
            <span className="text-white/60">Potential winnings</span>
            <span className="font-bold text-emerald-400">€{potentialWinnings.toFixed(2)}</span>
          </div>

          <div className="flex justify-between text-sm mt-1">
            <span className="text-white/60">Gross / Net</span>
            <span className="font-bold text-white">
              €{grossProfit.toFixed(2)} / €{netProfit.toFixed(2)}
            </span>
          </div>

          {wonLostText && (
            <div className="mt-2 text-center text-xs font-semibold uppercase tracking-wider text-white/80">
              {wonLostText}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BetSlip;