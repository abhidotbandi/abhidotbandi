// The detail worker: decodes tiles and builds their meshes off the main thread, so tiles can
// stream in while the camera moves without stalling a frame.

import type { BuildingsData } from "../buildingsCodec";
import { BaseMeshField, RegionRaster } from "../geo";
import { decodeTile } from "../tiles";
import { bucketFixed, buildTile, transferables, type TileOptions, type World } from "./build";

export interface InitMessage {
  type: "init";
  height: { width: number; height: number; data: Float32Array };
  segments: number;
  surface: { width: number; height: number; rgba: Uint8Array };
  density: { width: number; height: number; data: Uint8Array };
  sdfLevels: number;
  surfPxM: number;
  fixed: BuildingsData[];
  size: number;
  origin: [number, number];
}

export interface TileMessage {
  type: "tile";
  key: number;
  buf: ArrayBuffer;
  options: TileOptions;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<InitMessage | TileMessage>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

let world: World | null = null;

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    const raster = new RegionRaster(m.height.width, m.height.height, m.height.data);
    world = {
      ground: new BaseMeshField(raster, m.segments),
      elevation: raster,
      surface: m.surface,
      density: m.density,
      sdfLevels: m.sdfLevels,
      surfPxM: m.surfPxM,
      fixed: m.fixed,
      fixedByTile: bucketFixed(m.fixed, m.size, m.origin),
    };
    return;
  }
  if (!world) return;
  try {
    const meshes = buildTile(decodeTile(m.buf), world, m.options, m.key);
    ctx.postMessage({ type: "tile", key: m.key, meshes }, transferables(meshes));
  } catch (err) {
    ctx.postMessage({ type: "error", key: m.key, message: String(err) });
  }
};
