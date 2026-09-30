import type { CentralFiles, RegionalFiles } from "../assets";
import type { SiteModelArrays } from "../siteModels";
import type { CentralPrep, RegionalPrep } from "./compute";
import type { PrepReply, PrepRequest } from "./worker";

// The page's side of the prep worker: hand it the fetched files, get back what the scene needs.
// Where module workers or OffscreenCanvas are missing, or the worker fails, the same work runs
// on the main thread instead (slower, and the page stalls while it does).

export interface Prep {
  regional(files: RegionalFiles): Promise<RegionalPrep>;
  central(files: CentralFiles): Promise<CentralPrep>;
  /** the sites' models on the regional map alone, when central Austin can't load */
  models(): Promise<SiteModelArrays>;
  /** stop the worker (the page is going away) */
  dispose(): void;
}

/** Re-create the worker's marks on the page's timeline. */
function replayMarks(marks: [string, number][]) {
  for (const [name, abs] of marks) {
    try {
      performance.mark(`atlas:${name}`, { startTime: abs - performance.timeOrigin });
    } catch {
      // older browsers: no startTime option
    }
  }
}

function mainThread(lowPower: boolean): Prep {
  let regional: Promise<RegionalPrep> | null = null;
  const compute = () => import("./compute");
  return {
    regional(files) {
      regional = Promise.all([import("../assets"), compute()]).then(async ([a, c]) =>
        c.computeRegional(await a.decodeAtlasAssets(files), lowPower),
      );
      return regional;
    },
    async central(files) {
      const [a, c] = await Promise.all([import("../assets"), compute()]);
      const r = await regional!;
      return c.computeCentral(r, await a.decodeCentralAssets(r.assets.meta, files));
    },
    async models() {
      const c = await compute();
      return c.computeRegionalModels(await regional!);
    },
    dispose() {},
  };
}

export function startPrep(lowPower: boolean): Prep {
  let worker: Worker | null = null;
  try {
    if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
      worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    }
  } catch {
    worker = null;
  }
  const fallback = mainThread(lowPower);
  if (!worker) return fallback;

  const waiting = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let broken = false;
  worker.onmessage = (e: MessageEvent<PrepReply>) => {
    const m = e.data;
    if (m.type === "error") {
      waiting.get(m.stage)?.reject(new Error(m.message));
      waiting.delete(m.stage);
      return;
    }
    replayMarks(m.marks);
    waiting.get(m.type)?.resolve(m.prep);
    waiting.delete(m.type);
  };
  worker.onerror = (e) => {
    broken = true;
    for (const w of waiting.values()) w.reject(new Error(e.message || "prep worker failed"));
    waiting.clear();
  };
  const ask = <T,>(req: PrepRequest): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      waiting.set(req.type, { resolve: resolve as (v: unknown) => void, reject });
      // Inputs are copied, not handed over, so the main-thread fallback can still use them.
      worker!.postMessage(req);
    });

  let viaWorker = true;
  return {
    async regional(files) {
      try {
        if (broken) throw new Error("prep worker unavailable");
        return await ask<RegionalPrep>({ type: "regional", files, lowPower });
      } catch (err) {
        console.warn("atlas: prep worker failed, preparing on the main thread", err);
        viaWorker = false;
        return fallback.regional(files);
      }
    },
    async central(files) {
      if (viaWorker && !broken) {
        try {
          return await ask<CentralPrep>({ type: "central", files });
        } catch (err) {
          console.warn("atlas: prep worker failed on central Austin", err);
          throw err;
        }
      }
      return fallback.central(files);
    },
    async models() {
      if (viaWorker && !broken) return ask<SiteModelArrays>({ type: "models" });
      return fallback.models();
    },
    dispose() {
      worker!.terminate();
    },
  };
}
