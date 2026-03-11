import { create } from "zustand";
import { RefObject } from "react";

export type SortKey =
  | "L5"
  | "L10"
  | "L15"
  | "L20"
  | "vL5"
  | "vL10"
  | "vL15"
  | "vL20"
  | "EDGE";

export type PropsScope = "MAIN" | "ALT" | "ALL";

export type PlayerOption = {
  key: string;
  name: string;
  surname: string;
  team: string;
  teamKey?: string;
  teamDisplay?: string;
  logoUrl?: string;
};

type State = {
  match: string;
  bookmaker: string;
  scope: PropsScope;

  sortKey: SortKey;
  sortDir: "asc" | "desc";
  sortByOdds: boolean;
  sortByLastN: boolean;

  oddsMin: string;
  oddsMax: string;

  propCategories: string[];
  propCategoryOptions: string[];

  playerKeys: string[];
  playerOptions: PlayerOption[];
  selectedPlayers: string[];
  selectedTeam: string | null;
  playerSearch: string;

  // Scroll container ref (από BetFeed)
  scrollContainerRef: React.RefObject<HTMLElement> | null;

  // Ύψος TopBar και κατάσταση ορατότητας
  topBarHeight: number;
  topBarHidden: boolean;
  setTopBarHeight: (height: number) => void;
  setTopBarHidden: (hidden: boolean) => void;

  set: <K extends keyof State>(key: K, value: State[K]) => void;
};

export const useFilters = create<State>((set) => ({
  match: "upcoming",
  bookmaker: "all",
  scope: "ALL",

  sortKey: "L15",
  sortDir: "desc",
  sortByOdds: false,
  sortByLastN: true,

  oddsMin: "1.40",
  oddsMax: "3.00",

  propCategories: [],
  propCategoryOptions: [],

  playerKeys: [],
  playerOptions: [],
  selectedPlayers: [],
  selectedTeam: null,
  playerSearch: "",

  scrollContainerRef: null,

  topBarHeight: 0,
  topBarHidden: false,
  setTopBarHeight: (height) => set({ topBarHeight: height }),
  setTopBarHidden: (hidden) => set({ topBarHidden: hidden }),

  set: (key, value) => set({ [key]: value } as any),
}));