// app/picks/[playerKey]/page.tsx
"use client";

import * as React from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { usePicks, getPicksByPlayerKey } from "@/lib/picksStore";
import { useSlipStore } from "@/lib/slipStore";
import { PicksBetRow } from "@/components/PicksBetRow";
import JerseyAvatar from "@/components/JerseyAvatar";
import { useState, useEffect } from "react";
import { BetLine } from "@/lib/types";
import BetSlip from "@/components/BetSlip";
import { clsx } from "clsx";
import { CARD_GLASS, PILL, PILL_ACTIVE } from "@/lib/uiTokens";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

export default function PlayerPicksPage() {
  const router = useRouter();
  const params = useParams();
  const playerKey = decodeURIComponent(params.playerKey as string);

  const { picks } = usePicks();
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
  } = useSlipStore();

  const playerPicks = React.useMemo(() => {
    return getPicksByPlayerKey(picks, playerKey);
  }, [picks, playerKey]);

  const playerInfo = React.useMemo(() => {
    if (playerPicks.length === 0) return null;
    const first = playerPicks[0];

    let teamName = "";
    const teamData =
      (first as any)?.player?.team ||
      (first as any)?.team ||
      (first as any)?.teamName;

    if (teamData) {
      if (typeof teamData === "object") {
        teamName = teamData?.name || teamData?.displayName || teamData?.abbrev || "";
      } else {
        teamName = String(teamData);
      }
    }

    return {
      name: (first as any)?.player?.name || (first as any)?.playerName || "Player",
      team: teamName,
      teamKey: (first as any)?.__teamKey || null,
      number:
        (first as any)?.player?.jersey ||
        (first as any)?.player?.number ||
        (first as any)?.number ||
        null,
      pos:
        (first as any)?.player?.pos ||
        (first as any)?.player?.position ||
        "N/A",
    };
  }, [playerPicks]);

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

  // ✅ Διορθωμένη συνάρτηση – χρησιμοποιεί (as any) για player.id και prop.sheet_key
  const getPickId = (row: BetLine): string => {
    return (row as any).id || `${(row as any).player?.id}-${(row.prop as any)?.sheet_key}-${row.line}-${row.side}`;
  };

  const goToPicks = () => {
    window.location.href = "/picks";
  };

  if (playerPicks.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-4">
        <button
          onClick={goToPicks}
          className={clsx(PILL, "gap-2 px-3 py-2 text-[13px] mb-4")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className={clsx(CARD_GLASS, "p-6 text-white/70")}>
          No picks found for this player.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-4">
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={goToPicks}
          className={clsx(PILL, "gap-2 px-3 py-2 text-[13px]")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      {playerInfo && (
        <div className={clsx(CARD_GLASS, "group relative mb-6 overflow-hidden p-5")}>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/15" />

          <div className="relative flex items-center gap-4">
            <JerseyAvatar
              playerName={playerInfo.name}
              number={playerInfo.number || "0"}
              teamName={playerInfo.team}
              teamKey={playerInfo.teamKey}
              size={92}
              className="drop-shadow-lg"
            />

            <div>
              <h1 className="text-xl font-bold text-white">
                {playerInfo.name}
              </h1>

              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-white/70">
                  {playerInfo.team || "—"}
                </span>

                <span className={clsx(PILL, "px-2 py-0.5 text-xs")}>
                  {playerInfo.pos}
                </span>
              </div>

              <div className="mt-2 text-sm text-white/60">
                {playerPicks.length} {playerPicks.length === 1 ? "pick" : "picks"}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {playerPicks.map((row) => (
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