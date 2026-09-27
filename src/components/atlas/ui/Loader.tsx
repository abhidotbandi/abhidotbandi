"use client";

import { useAtlas } from "@/lib/atlas/store";
import { Logomark } from "./icons";
import { CompanyTable } from "./ListView";

export default function Loader() {
  const ready = useAtlas((s) => s.ready);
  const progress = useAtlas((s) => s.loadProgress);
  const failed = useAtlas((s) => s.webglFailed);

  if (failed) {
    return (
      <div className="loader is-failed" role="region" aria-label="Companies">
        <div className="loader-inner">
          <Logomark size={34} />
          <h1>Silicon Hills</h1>
          <p>
            This browser couldn&apos;t start the 3D map, so here is the atlas as a table: the deep tech, hard tech and
            defense tech companies and labs of Greater Austin.
          </p>
          <CompanyTable />
        </div>
      </div>
    );
  }

  return (
    <div className="loader" data-done={ready ? "1" : "0"} aria-hidden={ready}>
      <div className="loader-inner">
        <Logomark size={34} />
        <p className="loader-title">Silicon Hills</p>
        <p className="loader-sub">Surveying Central Texas…</p>
        <div className="loader-bar" role="progressbar" aria-label="Loading map" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <span style={{ transform: `scaleX(${Math.max(0.03, progress)})` }} />
        </div>
      </div>
    </div>
  );
}
