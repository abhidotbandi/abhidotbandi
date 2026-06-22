import { ChapterId } from "./store";

export const SCROLL_PAGES = 7.5;

export const CHAPTER_BOUNDS: { id: ChapterId; start: number; end: number }[] = [
  { id: "hero", start: 0, end: 0.12 },
  { id: "macro", start: 0.12, end: 0.32 },
  { id: "meso", start: 0.32, end: 0.52 },
  { id: "micro", start: 0.52, end: 0.74 },
  { id: "vpp", start: 0.74, end: 0.9 },
  { id: "finale", start: 0.9, end: 1.0001 },
];

export function chapterAt(progress: number): ChapterId {
  for (const b of CHAPTER_BOUNDS) {
    if (progress >= b.start && progress < b.end) return b.id;
  }
  return "finale";
}

export function localProgress(progress: number, id: ChapterId): number {
  const b = CHAPTER_BOUNDS.find((c) => c.id === id);
  if (!b) return 0;
  return Math.min(1, Math.max(0, (progress - b.start) / (b.end - b.start)));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function chapterHeightVh(id: ChapterId): number {
  const b = CHAPTER_BOUNDS.find((c) => c.id === id)!;
  const end = Math.min(1, b.end);
  return (end - b.start) * SCROLL_PAGES * 100;
}
