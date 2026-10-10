// The prep worker: decodes the atlas's data and builds everything the scene needs from it (see
// compute.ts) off the main thread, so the page stays responsive while the map loads and the
// regional scene can compile its shaders while central Austin is still being built.

import { decodeAtlasAssets, decodeCentralAssets, type CentralFiles, type RegionalFiles } from "../assets";
import { computeCentral, computeRegional, computeRegionalModels, transferables, type RegionalPrep } from "./compute";

export type PrepRequest =
  | { type: "regional"; files: RegionalFiles; lowPower: boolean }
  | { type: "central"; files: CentralFiles }
  | { type: "models" };

export type PrepReply =
  | { type: "regional" | "central" | "models"; prep: unknown; marks: [string, number][] }
  | { type: "error"; stage: string; message: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<PrepRequest>) => void) | null;
  postMessage(message: PrepReply, transfer?: Transferable[]): void;
};

let regional: Promise<RegionalPrep> | null = null;

/** This worker's marks since the last reply, as absolute times, for the page's timeline. */
function takeMarks(): [string, number][] {
  const out = performance
    .getEntriesByType("mark")
    .filter((m) => m.name.startsWith("atlas:"))
    .map((m) => [m.name.slice(6), performance.timeOrigin + m.startTime] as [string, number]);
  performance.clearMarks();
  return out;
}

ctx.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "regional") {
      regional = decodeAtlasAssets(m.files).then((assets) => computeRegional(assets, m.lowPower));
      const r = await regional;
      // The central step still needs the elevation raster and the footprints: copy those, hand
      // over the rest.
      const keep = new Set<ArrayBuffer>([r.assets.height.data.buffer as ArrayBuffer]);
      for (const v of Object.values(r.assets.buildings)) if (ArrayBuffer.isView(v)) keep.add(v.buffer as ArrayBuffer);
      ctx.postMessage({ type: "regional", prep: r, marks: takeMarks() }, transferables(r, keep));
    } else if (m.type === "central") {
      if (!regional) throw new Error("central before regional");
      const r = await regional;
      const c = await decodeCentralAssets(r.assets.meta, m.files);
      const prep = computeCentral(r, c);
      ctx.postMessage({ type: "central", prep, marks: takeMarks() }, transferables(prep));
    } else if (m.type === "models") {
      if (!regional) throw new Error("models before regional");
      const models = computeRegionalModels(await regional);
      ctx.postMessage({ type: "models", prep: models, marks: takeMarks() }, transferables(models));
    }
  } catch (err) {
    ctx.postMessage({ type: "error", stage: m.type, message: err instanceof Error ? err.message : String(err) });
  }
};
