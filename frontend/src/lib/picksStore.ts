import { create } from "zustand";
import { persist } from "zustand/middleware";
import { BetLine } from "./types";

export type PicksState = {
  picks: Record<string, BetLine>;
  togglePick: (row: BetLine) => void;
  clearPicks: () => void;
  removePlayerPicks: (playerKey: string) => void;
};

export function pickIdForRow(row: any): string {
  const playerId =
    row?.player?.id || row?.player_id || row?.playerId || row?.id || "unknown";
  const sheetKey =
    row?.prop?.sheet_key || row?.prop?.sheetKey || row?.sheet_key || row?.sheetKey || "prop";
  const line = row?.line || 0;
  const side = row?.side || "OVER";
  const bookmaker = row?.bookmaker || row?.book || row?.sportsbook || "default";

  return `${playerId}|${sheetKey}|${line}|${side}|${bookmaker}`.replace(/\s+/g, "_");
}

export function getPlayerKeyForGroup(row: any): string {
  const playerName = row?.player?.name || row?.playerName || row?.name || "Unknown Player";
  let cleanName = String(playerName).trim();

  cleanName = cleanName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (!cleanName) {
    const playerId = row?.player?.id || row?.player_id || row?.playerId || row?.id || "unknown";
    return `id:${playerId}`;
  }

  return `name:${cleanName}`;
}

export function groupPicksByPlayer(picks: Record<string, BetLine>) {
  const groups = new Map<
    string,
    {
      playerKey: string;
      playerName: string;
      teamName: string;
      teamKey: string | null;
      number: string | null;
      rows: BetLine[];
    }
  >();

  Object.values(picks).forEach((row) => {
    const playerKey = getPlayerKeyForGroup(row);

    let playerName = (row as any)?.player?.name || (row as any)?.playerName || (row as any)?.name || "Unknown Player";
    playerName = String(playerName).trim();

    let teamName = "";
    const teamData = (row as any)?.player?.team || (row as any)?.team || (row as any)?.teamName;
    if (teamData) {
      if (typeof teamData === "object") {
        teamName = teamData?.name || teamData?.displayName || teamData?.abbrev || "";
      } else {
        teamName = String(teamData);
      }
    }

    const teamKey =
      (row as any)?.__teamKey ||
      (row as any)?.team?.id ||
      (row as any)?.team_id ||
      (row as any)?.teamId ||
      (row as any)?.team?.code ||
      null;

    const number =
      (row as any)?.player?.jersey ||
      (row as any)?.player?.number ||
      (row as any)?.jersey ||
      (row as any)?.number ||
      null;

    if (!groups.has(playerKey)) {
      groups.set(playerKey, {
        playerKey,
        playerName,
        teamName,
        teamKey,
        number: number ? String(number) : null,
        rows: [],
      });
    }

    groups.get(playerKey)!.rows.push(row);
  });

  return Array.from(groups.values()).sort((a, b) => a.playerName.localeCompare(b.playerName, "el"));
}

export function getPicksByPlayerKey(picks: Record<string, BetLine>, playerKey: string) {
  return Object.values(picks).filter((row) => {
    const key = getPlayerKeyForGroup(row);
    return key === playerKey;
  });
}

export const usePicks = create<PicksState>()(
  persist(
    (set, get) => ({
      picks: {},

      togglePick: (row: BetLine) => {
        const id = pickIdForRow(row);
        const current = get().picks;

        if (current[id]) {
          const { [id]: _, ...rest } = current;
          set({ picks: rest });
        } else {
          const rowAny = row as any;

          // ✅ Fix: properly clone the row to avoid mutation issues
          const enhancedRow: BetLine = {
            ...row,
            player: { ...row.player },
            prop: { ...row.prop },
            hit: { ...row.hit },
            value: { ...row.value },
            games: Array.isArray(row.games) ? row.games.map((g) => ({ ...g })) : [],
          };

          if (rowAny.team) {
            (enhancedRow as any).team = { ...rowAny.team };
          }

          if (rowAny.__teamKey) {
            (enhancedRow as any).__teamKey = rowAny.__teamKey;
          }

          set({ picks: { ...current, [id]: enhancedRow } });
        }
      },

      clearPicks: () => set({ picks: {} }),

      removePlayerPicks: (playerKey: string) => {
        set((state) => {
          const newPicks = { ...state.picks };
          Object.keys(newPicks).forEach((id) => {
            const row = newPicks[id];
            const key = getPlayerKeyForGroup(row);
            if (key === playerKey) {
              delete newPicks[id];
            }
          });
          return { picks: newPicks };
        });
      },
    }),
    {
      name: "betting-picks-storage",
    }
  )
);