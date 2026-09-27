// Scene projection for the Silicon Hills atlas. Must match scripts/atlas/config.py:
// local equirectangular around Congress Ave & 6th St, 1 unit = 1 km, +x east, -z north.

export const LON0 = -97.7431;
export const LAT0 = 30.2672;
export const KM_PER_DEG_LAT = 110.574;
export const KM_PER_DEG_LON = 111.32 * Math.cos((LAT0 * Math.PI) / 180);

export const REGION = { west: -98.1, south: 29.98, east: -97.3, north: 30.96 };

export function project(lon: number, lat: number): [number, number] {
  return [(lon - LON0) * KM_PER_DEG_LON, -(lat - LAT0) * KM_PER_DEG_LAT];
}

export const X_MIN = (REGION.west - LON0) * KM_PER_DEG_LON;
export const X_MAX = (REGION.east - LON0) * KM_PER_DEG_LON;
export const Z_MIN = -(REGION.north - LAT0) * KM_PER_DEG_LAT;
export const Z_MAX = -(REGION.south - LAT0) * KM_PER_DEG_LAT;
export const WIDTH_KM = X_MAX - X_MIN;
export const HEIGHT_KM = Z_MAX - Z_MIN;
export const CENTER_X = (X_MIN + X_MAX) / 2;
export const CENTER_Z = (Z_MIN + Z_MAX) / 2;

// The prairie-to-hills relief is only ~300 m over 100 km, so terrain is exaggerated
// to make the Balcones Escarpment read. Buildings get a gentler boost.
export const TERRAIN_EXAG = 3;
export const BUILDING_EXAG = 1.6;
export const BASE_ELEV_M = 90;

export function elevToY(meters: number): number {
  return ((meters - BASE_ELEV_M) / 1000) * TERRAIN_EXAG;
}

// Central Austin detail patch. Must match C_* in scripts/atlas/config.py.
export const CENTRAL = { west: -97.8, south: 30.236, east: -97.705, north: 30.325 };
export const CX_MIN = (CENTRAL.west - LON0) * KM_PER_DEG_LON;
export const CX_MAX = (CENTRAL.east - LON0) * KM_PER_DEG_LON;
export const CZ_MIN = -(CENTRAL.north - LAT0) * KM_PER_DEG_LAT;
export const CZ_MAX = -(CENTRAL.south - LAT0) * KM_PER_DEG_LAT;
export const C_WIDTH_KM = CX_MAX - CX_MIN;
export const C_HEIGHT_KM = CZ_MAX - CZ_MIN;

/** Anything that answers "how high is the ground here" (metres) at scene coordinates. */
export interface HeightField {
  sample(x: number, z: number): number;
}

/** Row-major raster covering the region; (0,0) is the north-west corner. */
export class RegionRaster implements HeightField {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly data: Float32Array,
  ) {}

  /** Bilinear sample at scene coordinates (km). */
  sample(x: number, z: number): number {
    const u = ((x - X_MIN) / WIDTH_KM) * this.width - 0.5;
    const v = ((z - Z_MIN) / HEIGHT_KM) * this.height - 0.5;
    const x0 = Math.max(0, Math.min(this.width - 1, Math.floor(u)));
    const y0 = Math.max(0, Math.min(this.height - 1, Math.floor(v)));
    const x1 = Math.min(this.width - 1, x0 + 1);
    const y1 = Math.min(this.height - 1, y0 + 1);
    const fx = Math.max(0, Math.min(1, u - x0));
    const fy = Math.max(0, Math.min(1, v - y0));
    const d = this.data;
    const w = this.width;
    const a = d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx;
    const b = d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx;
    return a * (1 - fy) + b * fy;
  }
}

/**
 * Heights on the central patch's mesh grid (metres), already blended into the base terrain
 * near its edges. Sampling it bilinearly matches the rendered patch surface.
 */
export class PatchGrid implements HeightField {
  constructor(
    /** vertices across and down */
    readonly nx: number,
    readonly nz: number,
    readonly data: Float32Array,
  ) {}

  inside(x: number, z: number): boolean {
    return x >= CX_MIN && x <= CX_MAX && z >= CZ_MIN && z <= CZ_MAX;
  }

  sample(x: number, z: number): number {
    const u = ((x - CX_MIN) / C_WIDTH_KM) * (this.nx - 1);
    const v = ((z - CZ_MIN) / C_HEIGHT_KM) * (this.nz - 1);
    const x0 = Math.max(0, Math.min(this.nx - 2, Math.floor(u)));
    const y0 = Math.max(0, Math.min(this.nz - 2, Math.floor(v)));
    const fx = Math.max(0, Math.min(1, u - x0));
    const fy = Math.max(0, Math.min(1, v - y0));
    const d = this.data;
    const w = this.nx;
    const a = d[y0 * w + x0] * (1 - fx) + d[y0 * w + x0 + 1] * fx;
    const b = d[(y0 + 1) * w + x0] * (1 - fx) + d[(y0 + 1) * w + x0 + 1] * fx;
    return a * (1 - fy) + b * fy;
  }
}

/**
 * The surface the base terrain mesh actually draws: heights sampled at its grid vertices and
 * interpolated across its triangles (a THREE.PlaneGeometry split along the anti-diagonal).
 * Matching this rather than the raster keeps objects and the patch edge flush with the mesh.
 */
export class BaseMeshField implements HeightField {
  readonly segZ: number;
  constructor(
    readonly raster: RegionRaster,
    readonly segX: number,
  ) {
    this.segZ = Math.round((segX * HEIGHT_KM) / WIDTH_KM);
  }

  sample(x: number, z: number): number {
    const u = clamp(((x - X_MIN) / WIDTH_KM) * this.segX, 0, this.segX - 1e-6);
    const v = clamp(((z - Z_MIN) / HEIGHT_KM) * this.segZ, 0, this.segZ - 1e-6);
    const ix = Math.floor(u);
    const iz = Math.floor(v);
    const fx = u - ix;
    const fz = v - iz;
    const sx = WIDTH_KM / this.segX;
    const sz = HEIGHT_KM / this.segZ;
    const x0 = X_MIN + ix * sx;
    const z0 = Z_MIN + iz * sz;
    const r = this.raster;
    const ha = r.sample(x0, z0);
    const hb = r.sample(x0, z0 + sz);
    const hd = r.sample(x0 + sx, z0);
    if (fx + fz <= 1) return ha + (hd - ha) * fx + (hb - ha) * fz;
    const hc = r.sample(x0 + sx, z0 + sz);
    return hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
  }
}

/** The ground everything stands on: the central patch where there is one, else the base terrain. */
export class Ground implements HeightField {
  constructor(
    readonly base: HeightField,
    readonly patch: PatchGrid | null,
  ) {}

  sample(x: number, z: number): number {
    return this.patch && this.patch.inside(x, z) ? this.patch.sample(x, z) : this.base.sample(x, z);
  }
}

/** World-space Y of the ground (km) at scene coordinates. */
export function groundY(height: HeightField, x: number, z: number): number {
  return elevToY(height.sample(x, z));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function inRegion(x: number, z: number, margin = 0): boolean {
  return x >= X_MIN - margin && x <= X_MAX + margin && z >= Z_MIN - margin && z <= Z_MAX + margin;
}
