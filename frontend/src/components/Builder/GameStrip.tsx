"use client";

import React from "react";
import { clsx } from "clsx";

interface GameInfo {
  stat: number;
  ha: "H" | "A" | "?";
  opponent: string;
  minutes: number | null;
}

interface GameStripProps {
  games: GameInfo[];
  line: number;
  side: "over" | "under";
  lastN: number | "all";
}

export default function GameStrip({ games, line, side, lastN }: GameStripProps) {
  const gamesToShow =
    lastN === "all"
      ? games
      : games.slice(-lastN);

  const count = gamesToShow.length;

  if (count === 0) {
    return <div className="h-5 text-white/30 text-xs">No data</div>;
  }

  return (
    <div
      className="grid items-center h-5 w-full gap-[2px]"
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {gamesToShow.map((g, idx) => {
        const isGreen =
          side === "over"
            ? g.stat > line
            : g.stat < line;

        const prefix =
          g.ha === "H"
            ? "vs"
            : g.ha === "A"
            ? "at"
            : "";

        const tooltipText =
          `${prefix} ${g.opponent}`.trim() +
          `\nStat: ${g.stat}` +
          `\nLine: ${line}` +
          `\nSide: ${side.toUpperCase()}` +
          `\nMinutes: ${g.minutes !== null ? g.minutes.toFixed(1) : "N/A"}`;

        return (
          <div
            key={idx}
            title={tooltipText}
            className={clsx(
              "h-[14px] rounded-full border transition-all duration-150",
              "shadow-[0_1px_0_rgba(255,255,255,0.07)_inset,0_2px_8px_rgba(0,0,0,0.22)]",
              isGreen
                ? "border-teal-300/30 bg-gradient-to-b from-[#6ee7c8] via-[#34d399] to-[#169b83]"
                : "border-rose-300/30 bg-gradient-to-b from-[#ff8aa5] via-[#fb7185] to-[#d9465f]"
            )}
          />
        );
      })}
    </div>
  );
}