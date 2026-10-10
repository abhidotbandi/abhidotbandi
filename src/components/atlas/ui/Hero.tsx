"use client";

/**
 * The atlas's title card, over the middle of the opening view as the loader wipes away; gone as
 * the tour sets off, and back at the top. × puts it away until the chapter list's first entry
 * brings it back. It lets the wheel and touches through to the story, except on ×.
 */
export default function Hero({ on, onClose }: { on: boolean; onClose: () => void }) {
  return (
    <section className="atlas-hero" data-on={on ? "1" : "0"} data-obstacle={on ? "" : undefined} aria-labelledby="hero-title">
      <button type="button" className="hero-close" onClick={onClose} aria-label="Put away the title" tabIndex={on ? 0 : -1}>
        ×
      </button>
      <p className="hero-kicker">An atlas of who builds what</p>
      <h1 id="hero-title">
        The <em>Silicon Hills</em>
      </h1>
      <p className="hero-sub">
        <b>Austin, rendered</b> — the companies building warships, rockets, humanoids, reactors and the chips inside all
        of them. Scroll to descend.
      </p>
    </section>
  );
}
