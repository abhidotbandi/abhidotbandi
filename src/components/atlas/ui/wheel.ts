import type { WheelEvent } from "react";

/** The wheel over the tour's fixed panels (the chapter list, the rail) still scrolls the story. */
export function forwardWheel(e: WheelEvent) {
  const el = document.getElementById("atlas-scroller");
  if (!el) return;
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
  el.scrollBy({ top: e.deltaY * k });
}
