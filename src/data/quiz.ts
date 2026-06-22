export interface QuizQuestion {
  id: string;
  chapter: "macro" | "meso" | "micro" | "vpp";
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: "q-macro-1",
    chapter: "macro",
    question: "Why does the US grid run as three separate interconnections instead of one?",
    options: [
      "Different voltage standards in each region",
      "Historical utility buildouts and AC synchronization limits made one giant grid impractical",
      "Federal law requires three grids",
      "Time zone differences",
    ],
    correctIndex: 1,
    explanation:
      "The grid grew up region by region, and keeping huge areas perfectly synchronized in AC frequency gets harder with distance - so three loosely-linked synchronous zones emerged instead of one.",
  },
  {
    id: "q-meso-1",
    chapter: "meso",
    question: "What makes ERCOT uniquely vulnerable compared to other US grids?",
    options: [
      "It generates the least power of any US grid",
      "It has almost no high-capacity connections to import power from neighboring grids",
      "It only uses renewable energy",
      "It is run by the federal government",
    ],
    correctIndex: 1,
    explanation:
      "ERCOT chose isolation to avoid federal regulation. That means when supply falls short, Texas can't lean on neighboring grids the way other states can.",
  },
  {
    id: "q-micro-1",
    chapter: "micro",
    question: "About how fast does a Base battery take over when the grid goes down?",
    options: ["About 10 seconds", "About 1 minute", "Under half a second", "About 5 minutes"],
    correctIndex: 2,
    explanation:
      "A hub at the house detects the outage and disconnects you from the grid in well under a second, so the switchover is invisible in daily life.",
  },
  {
    id: "q-vpp-1",
    chapter: "vpp",
    question: "What does a virtual power plant actually build?",
    options: [
      "A brand new gas power plant",
      "Nothing physical - it coordinates existing batteries to act like one large dispatchable plant",
      "A new high-voltage transmission line",
      "A new substation",
    ],
    correctIndex: 1,
    explanation:
      "No concrete, no turbines - just thousands of existing home batteries dispatched in unison, which is faster and cheaper to scale than new generation or transmission.",
  },
];
