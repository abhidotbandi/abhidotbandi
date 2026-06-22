import { create } from "zustand";

export type ChapterId =
  | "hero"
  | "macro"
  | "meso"
  | "micro"
  | "vpp"
  | "finale";

export type BadgeId =
  | "grid-operator"
  | "grid-analyst"
  | "home-expert"
  | "grid-hero";

export const BADGES: Record<BadgeId, { title: string; description: string }> = {
  "grid-operator": {
    title: "Grid Operator",
    description: "Learned how the US grid splits into three interconnections.",
  },
  "grid-analyst": {
    title: "Grid Analyst",
    description: "Understood why ERCOT is the riskiest grid in the country.",
  },
  "home-expert": {
    title: "Home Energy Expert",
    description: "Simulated a blackout and kept the lights on.",
  },
  "grid-hero": {
    title: "Grid Hero",
    description: "Built a virtual power plant out of home batteries.",
  },
};

export const CHAPTER_BADGE: Record<"macro" | "meso" | "micro" | "vpp", BadgeId> = {
  macro: "grid-operator",
  meso: "grid-analyst",
  micro: "home-expert",
  vpp: "grid-hero",
};

interface GridState {
  scrollProgress: number;
  setScrollProgress: (p: number) => void;

  activeChapter: ChapterId;
  setActiveChapter: (c: ChapterId) => void;

  xp: number;
  addXp: (amount: number) => void;

  badges: Set<BadgeId>;
  unlockBadge: (id: BadgeId) => void;

  quizAnswers: Record<string, boolean>;
  answerQuiz: (questionId: string, correct: boolean) => void;

  outageActive: boolean;
  setOutageActive: (v: boolean) => void;

  vppHouseCount: number;
  setVppHouseCount: (n: number) => void;

  lastBadge: BadgeId | null;
  clearLastBadge: () => void;
}

export const useGridStore = create<GridState>((set, get) => ({
  scrollProgress: 0,
  setScrollProgress: (p) => set({ scrollProgress: p }),

  activeChapter: "hero",
  setActiveChapter: (c) => set({ activeChapter: c }),

  xp: 0,
  addXp: (amount) => set({ xp: get().xp + amount }),

  badges: new Set(),
  unlockBadge: (id) => {
    if (get().badges.has(id)) return;
    const next = new Set(get().badges);
    next.add(id);
    set({ badges: next, lastBadge: id });
  },

  quizAnswers: {},
  answerQuiz: (questionId, correct) => {
    if (questionId in get().quizAnswers) return;
    set({ quizAnswers: { ...get().quizAnswers, [questionId]: correct } });
    if (correct) get().addXp(25);
  },

  outageActive: false,
  setOutageActive: (v) => set({ outageActive: v }),

  vppHouseCount: 1,
  setVppHouseCount: (n) => set({ vppHouseCount: n }),

  lastBadge: null,
  clearLastBadge: () => set({ lastBadge: null }),
}));
