import { create } from "zustand";
import { persist } from "zustand/middleware";
import { BetLine, ComboItem } from "./types";

export type SlipItem = {
  id: string;
  status: "won" | "lost" | "void";
} & (
  | { type: 'bet'; row: BetLine }
  | { type: 'combo'; combo: ComboItem }
);

export type SlipData = {
  items: SlipItem[];
  stake: string;
  stakeConfirmed: boolean;
};

type SlipStore = {
  slips: Record<number, SlipData>;
  pickToSlipMap: Record<string, number>;
  comboToSlipMap: Record<string, number>;
  addToSlip: (pickId: string, row: BetLine, slipNumber: number) => void;
  addComboToSlip: (combo: ComboItem, slipNumber: number) => void;
  removeFromSlip: (itemId: string) => void;
  updateItemStatus: (slipNumber: number, index: number, status: "won" | "lost" | "void") => void;
  updateStake: (slipNumber: number, stake: string) => void;
  confirmStake: (slipNumber: number) => void;
  addToStake: (slipNumber: number, amount: number) => void;
  backspaceStake: (slipNumber: number) => void;
  closeSlip: (slipNumber: number) => void;
  clearAll: () => void;
};

export const useSlipStore = create<SlipStore>()(
  persist(
    (set, get) => ({
      slips: {},
      pickToSlipMap: {},
      comboToSlipMap: {},
      addToSlip: (pickId, row, slipNumber) => {
        if (get().pickToSlipMap[pickId]) return;
        set((state) => {
          const slip = state.slips[slipNumber] || { items: [], stake: "", stakeConfirmed: false };
          if (slip.items.some(item => item.type === 'bet' && (item.row as any).id === (row as any).id)) return state;
          const newItem: SlipItem = {
            id: pickId,
            type: 'bet',
            row,
            status: "void",
          };
          const newSlips = {
            ...state.slips,
            [slipNumber]: { ...slip, items: [...slip.items, newItem] },
          };
          const newMap = { ...state.pickToSlipMap, [pickId]: slipNumber };
          return { slips: newSlips, pickToSlipMap: newMap };
        });
      },
      addComboToSlip: (combo, slipNumber) => {
        if (get().comboToSlipMap[combo.id]) return;
        set((state) => {
          const slip = state.slips[slipNumber] || { items: [], stake: "", stakeConfirmed: false };
          if (slip.items.some(item => item.type === 'combo' && item.combo.id === combo.id)) return state;
          const newItem: SlipItem = {
            id: combo.id,
            type: 'combo',
            combo,
            status: "void",
          };
          const newSlips = {
            ...state.slips,
            [slipNumber]: { ...slip, items: [...slip.items, newItem] },
          };
          const newMap = { ...state.comboToSlipMap, [combo.id]: slipNumber };
          return { slips: newSlips, comboToSlipMap: newMap };
        });
      },
      removeFromSlip: (itemId) => {
        set((state) => {
          let slipNumber = state.pickToSlipMap[itemId];
          let mapType: 'pick' | 'combo' = 'pick';
          if (slipNumber === undefined) {
            slipNumber = state.comboToSlipMap[itemId];
            mapType = 'combo';
          }
          if (slipNumber === undefined) return state;
          const slip = state.slips[slipNumber];
          if (!slip) return state;
          const newItems = slip.items.filter(item => item.id !== itemId);
          const newPickMap = { ...state.pickToSlipMap };
          const newComboMap = { ...state.comboToSlipMap };
          if (mapType === 'pick') delete newPickMap[itemId];
          else delete newComboMap[itemId];
          if (newItems.length === 0) {
            const { [slipNumber]: _, ...restSlips } = state.slips;
            return { slips: restSlips, pickToSlipMap: newPickMap, comboToSlipMap: newComboMap };
          } else {
            return {
              slips: { ...state.slips, [slipNumber]: { ...slip, items: newItems } },
              pickToSlipMap: newPickMap,
              comboToSlipMap: newComboMap,
            };
          }
        });
      },
      updateItemStatus: (slipNumber, index, status) => {
        set((state) => {
          const slip = state.slips[slipNumber];
          if (!slip) return state;
          const newItems = [...slip.items];
          newItems[index].status = status;
          return {
            slips: { ...state.slips, [slipNumber]: { ...slip, items: newItems } },
          };
        });
      },
      updateStake: (slipNumber, stake) => {
        set((state) => {
          const slip = state.slips[slipNumber];
          if (!slip) return state;
          return {
            slips: { ...state.slips, [slipNumber]: { ...slip, stake, stakeConfirmed: false } },
          };
        });
      },
      confirmStake: (slipNumber) => {
        set((state) => {
          const slip = state.slips[slipNumber];
          if (!slip) return state;
          return {
            slips: { ...state.slips, [slipNumber]: { ...slip, stakeConfirmed: true } },
          };
        });
      },
      addToStake: (slipNumber, amount) => {
        set((state) => {
          const slip = state.slips[slipNumber];
          if (!slip) return state;
          const current = parseFloat(slip.stake) || 0;
          const newStake = (current + amount).toFixed(2);
          return {
            slips: { ...state.slips, [slipNumber]: { ...slip, stake: newStake, stakeConfirmed: false } },
          };
        });
      },
      backspaceStake: (slipNumber) => {
        set((state) => {
          const slip = state.slips[slipNumber];
          if (!slip) return state;
          const newStake = slip.stake.slice(0, -1);
          return {
            slips: { ...state.slips, [slipNumber]: { ...slip, stake: newStake, stakeConfirmed: false } },
          };
        });
      },
      closeSlip: (slipNumber) => {
        set((state) => {
          const { [slipNumber]: slipToRemove, ...restSlips } = state.slips;
          const newPickMap = { ...state.pickToSlipMap };
          const newComboMap = { ...state.comboToSlipMap };
          for (const [pickId, num] of Object.entries(newPickMap)) {
            if (num === slipNumber) delete newPickMap[pickId];
          }
          for (const [comboId, num] of Object.entries(newComboMap)) {
            if (num === slipNumber) delete newComboMap[comboId];
          }
          return { slips: restSlips, pickToSlipMap: newPickMap, comboToSlipMap: newComboMap };
        });
      },
      clearAll: () => {
        set({ slips: {}, pickToSlipMap: {}, comboToSlipMap: {} });
      },
    }),
    { name: "betting-slips-storage" }
  )
);