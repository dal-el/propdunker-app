"use client";

import React from "react";
import { resolveEuroleagueLogoUrl } from "@/lib/teamLogos";
import { clsx } from "clsx";

interface OpponentHeaderProps {
  games: Array<{ opponent: string; ha?: "H" | "A" }>;
  lastN: number | "all";
}

export default function OpponentHeader({ games, lastN }: OpponentHeaderProps) {
  const gamesToShow =
    lastN === "all"
      ? games
      : games.slice(-lastN);

  if (gamesToShow.length === 0) return null;

  const count = gamesToShow.length;

  return (
    <tr className="border-b border-white/10 bg-white/5">
      <td colSpan={6} className="p-0" />

      <td className="px-2 py-2">
        <div
          className="grid items-center w-full gap-[2px]"
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
                  <div
                    className={clsx(
                      "h-9 w-9 rounded-full overflow-hidden flex items-center justify-center",
                      "border border-white/15 bg-gradient-to-b from-white to-white/90",
                      "shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_4px_12px_rgba(0,0,0,0.22)]",
                      "ring-1 ring-white/10"
                    )}
                  >
                    <img
                      src={logo}
                      alt={game.opponent}
                      className="h-full w-full object-contain scale-[1.2]"
                      draggable={false}
                    />
                  </div>
                ) : (
                  <div
                    className={clsx(
                      "h-9 w-9 rounded-full flex items-center justify-center",
                      "border border-white/12 bg-gradient-to-b from-white/12 to-white/6",
                      "text-[9px] font-bold text-white/70",
                      "shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_4px_10px_rgba(0,0,0,0.18)]"
                    )}
                  >
                    {initial}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </td>

      <td className="p-0" />
      <td className="p-0" />
    </tr>
  );
}