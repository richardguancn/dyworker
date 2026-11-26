// 局域网分享发送目标与待确认接收请求队列 store
import { create } from "zustand";
import type { LanIncomingOffer, LanShareKind } from "../types";

export interface LanShareSendTarget {
  kind: LanShareKind;
  sessionId?: string;
  workspacePath?: string;
  pluginTarget?: string;
  includeData?: boolean;
  title: string;
  subtitle?: string;
}

interface LanShareStoreState {
  sendTarget: LanShareSendTarget | null;
  incomingQueue: LanIncomingOffer[];
  openLanShareSend: (target: LanShareSendTarget) => void;
  closeLanShareSend: () => void;
  setIncomingQueue: (offers: LanIncomingOffer[]) => void;
  pushIncomingOffer: (offer: LanIncomingOffer) => void;
  removeIncomingOffer: (transferId: string) => void;
}

export const useLanShareStore = create<LanShareStoreState>((set) => ({
  sendTarget: null,
  incomingQueue: [],
  openLanShareSend: (target) => set({ sendTarget: target }),
  closeLanShareSend: () => set({ sendTarget: null }),
  setIncomingQueue: (offers) => set({ incomingQueue: Array.isArray(offers) ? offers : [] }),
  pushIncomingOffer: (offer) => set((state) => {
    if (!offer?.transferId) return state;
    const filtered = state.incomingQueue.filter((item) => item.transferId !== offer.transferId);
    return { incomingQueue: [...filtered, offer] };
  }),
  removeIncomingOffer: (transferId) => set((state) => ({
    incomingQueue: state.incomingQueue.filter((item) => item.transferId !== transferId),
  })),
}));
