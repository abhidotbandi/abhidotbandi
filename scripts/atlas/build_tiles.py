"""Detail tiles: everything the always-loaded map leaves out, in 2 km squares the client loads
around the camera when it comes in close.

Outputs:
  public/atlas/tiles/{ix}_{iz}.bin  one tile (only tiles with something in them are written)
  public/atlas/tiles/index.json     the grid and the tiles in it: [ix, iz, bytes, buildings]

A tile holds three blobs in the building format (building_codec.py), whose "height" field
carries a class code for the two that aren't buildings:
  buildings  every footprint that neither buildings.bin nor central_buildings.bin carries
  streets    open polylines: local streets, paths and tracks, the arterials again (so they can
             be drawn at their real width up close), and runways and taxiways; inside central
             Austin, only the roads cars drive on, as lanes (class code + 100), not drawn
  areas      polygons: parking lots, aprons, helipads, construction sites, swimming pools and
             small ponds (with the ground airport_areas.py adds at Austin-Bergstrom)
Tile layout: magic b"ATIL", version (1), 3 reserved bytes, then the three blobs' byte lengths
(u32 little-endian each) and the blobs in that order. The central detail patch has its own
street-scale surface, so streets (other than lanes) and areas stop at its edge. Tile (ix, iz) spans
x in [X_MIN + ix * 2, X_MIN + (ix + 1) * 2) km, and likewise z; buildings belong to the tile
their centroid falls in, and lines and polygons are clipped to it.
"""

import json
import math
import struct
import time

import numpy as np
import pyarrow.parquet as pq
import shapely
from shapely.geometry import MultiLineString
from shapely.ops import linemerge

from airport_areas import CONSTRUCTION, PARKING, PAVED
from build_buildings import height_m, load, record, selection, towers
from building_codec import encode
from config import CACHE, CX_MAX, CX_MIN, CZ_MAX, CZ_MIN, HEIGHT_KM, OUT, WIDTH_KM, X_MIN, Z_MIN, project

TILE_KM = 2.0
MIN_AREA_M2 = 25
MAGIC = b"ATIL"
VERSION = 1

# Street class codes (the "height" field of the streets blob), shared with the client.
STREET_CODES = {
    ("residential", None): 1, ("unclassified", None): 2, ("living_street", None): 3,
    ("service", None): 4, ("service", "alley"): 5, ("service", "parking_aisle"): 6,
    ("track", None): 7, ("footway", None): 8, ("path", None): 9, ("cycleway", None): 10,
    ("pedestrian", None): 11,
    ("tertiary", None): 20, ("secondary", None): 21, ("primary", None): 22, ("trunk", None): 23,
    ("motorway", None): 24,
    ("runway", None): 30, ("taxiway", None): 31,
}
# Streets cars drive on; inside central Austin they're stored as lanes only (code + LANES_ONLY).
CAR_CODES = {1, 2, 3, 20, 21, 22, 23, 24}
LANES_ONLY = 100
AREA_PARKING, AREA_APRON, AREA_HELIPAD, AREA_SITE, AREA_POOL, AREA_POND = 1, 2, 3, 5, 10, 11
POND_MAX_M2 = 20000  # larger ponds and lakes are already in the regional water


def to_m(g):
    def tf(c):
        x, z = project(c[:, 0], c[:, 1])
        return np.column_stack([x * 1000, z * 1000])
    return shapely.transform(g, tf)


def tile_of(x_km, z_km):
    return np.floor((x_km - X_MIN) / TILE_KM).astype(int), np.floor((z_km - Z_MIN) / TILE_KM).astype(int)


def tile_box(ix, iz):
    x0 = (X_MIN + ix * TILE_KM) * 1000
    z0 = (Z_MIN + iz * TILE_KM) * 1000
    return shapely.box(x0, z0, x0 + TILE_KM * 1000, z0 + TILE_KM * 1000)


PATCH = shapely.box(CX_MIN * 1000, CZ_MIN * 1000, CX_MAX * 1000, CZ_MAX * 1000)


def ints(coords, closed):
    """Coordinates (metres) -> integer points without repeats (or the closing vertex)."""
    c = np.round(np.asarray(coords)).astype(np.int64)
    if closed:
        c = c[:-1]
    keep = np.ones(len(c), bool)
    keep[1:] = np.any(np.diff(c, axis=0) != 0, axis=1)
    c = c[keep]
    return [(int(x), int(z)) for x, z in c] if len(c) >= (3 if closed else 2) else None


def parts(g, kind):
    """The pieces of a geometry of one type (LineString or Polygon)."""
    if g.is_empty:
        return []
    if g.geom_type == kind:
        return [g]
    return [q for sub in getattr(g, "geoms", []) for q in parts(sub, kind)]


def clip_to_tiles(geoms, codes, kind, simplify):
    """Metre geometries -> {(ix, iz): [(code, -1, rings)]}, clipped to tiles. Central Austin draws
    its own streets, so nothing is drawn inside the patch; the roads cars use are kept there as
    lanes only, under their class code + LANES_ONLY."""
    out = {}
    boxes = {}
    for g0, code0 in zip(geoms, codes):
        pieces = [(g0, code0)]
        if g0.intersects(PATCH):
            pieces = [(g0.difference(PATCH), code0)]
            if kind == "LineString" and code0 in CAR_CODES:
                pieces.append((g0.intersection(PATCH), code0 + LANES_ONLY))
        for g, code in pieces:
            if g.is_empty:
                continue
            x0, z0, x1, z1 = (v / 1000 for v in g.bounds)
            ix0, iz0 = (int(v) for v in tile_of(x0, z0))
            ix1, iz1 = (int(v) for v in tile_of(x1, z1))
            for ix in range(ix0, ix1 + 1):
                for iz in range(iz0, iz1 + 1):
                    key = (ix, iz)
                    if key not in boxes:
                        boxes[key] = tile_box(ix, iz)
                    part = g if (ix0 == ix1 and iz0 == iz1) else g.intersection(boxes[key])
                    for p in parts(part, kind):
                        p = p.simplify(simplify)
                        if kind == "LineString":
                            pts = ints(p.coords, False)
                            if pts:
                                out.setdefault(key, []).append((int(code), -1, [pts]))
                        else:
                            outer = ints(shapely.geometry.polygon.orient(p, 1.0).exterior.coords, True)
                            if outer:
                                rings = [outer] + [r for h in p.interiors if (r := ints(h.coords, True))]
                                out.setdefault(key, []).append((int(code), -1, rings))
    return out


def streets():
    geoms, codes = [], []
    t = pq.read_table(CACHE / "segments_local.parquet", columns=["class", "subclass", "geometry"]).to_pylist()
    t += [r for r in pq.read_table(CACHE / "segments.parquet", columns=["class", "subclass", "geometry"]).to_pylist()
          if r["class"] in ("tertiary", "secondary", "primary", "trunk", "motorway")]
    for r in t:
        sub = r["subclass"] if r["subclass"] in ("alley", "parking_aisle") else None
        code = STREET_CODES.get((r["class"], sub))
        if code is None:  # driveways, sidewalks, crosswalks, steps and the like
            continue
        geoms.append(r["geometry"])
        codes.append(code)
    infra = pq.read_table(CACHE / "infrastructure.parquet", columns=["class", "geometry"]).to_pylist()
    for r in infra:
        if r["class"] in ("runway", "taxiway"):
            geoms.append(r["geometry"])
            codes.append(STREET_CODES[(r["class"], None)])
    g = to_m(shapely.from_wkb(np.array(geoms, dtype=object)))
    codes = np.array(codes)
    # Join each class's pieces end to end wherever nothing else meets them, so a street is one
    # line between junctions rather than a run of short segments.
    lines, line_codes = [], []
    for code in np.unique(codes):
        parts_ = [ln for gg in g[codes == code] for ln in parts(gg, "LineString")]
        merged = linemerge(MultiLineString(parts_)) if parts_ else None
        for ln in parts(merged, "LineString") if merged is not None else []:
            lines.append(ln)
            line_codes.append(int(code))
    print(f"  {len(g):,} street, path and runway lines, {len(lines):,} once joined")
    return clip_to_tiles(np.array(lines, dtype=object), np.array(line_codes), "LineString", 1.0)


def areas():
    geoms, codes = [], []
    for r in pq.read_table(CACHE / "infrastructure.parquet", columns=["class", "geometry"]).to_pylist():
        code = {"parking": AREA_PARKING, "apron": AREA_APRON, "helipad": AREA_HELIPAD}.get(r["class"])
        if code:
            geoms.append(r["geometry"])
            codes.append(code)
    for r in pq.read_table(CACHE / "water.parquet", columns=["class", "geometry"]).to_pylist():
        code = {"swimming_pool": AREA_POOL, "pond": AREA_POND, "basin": AREA_POND}.get(r["class"])
        if code:
            geoms.append(r["geometry"])
            codes.append(code)
    for polys, code in ((PAVED, AREA_APRON), (PARKING, AREA_PARKING), (CONSTRUCTION, AREA_SITE)):
        for ring, holes in polys:
            geoms.append(shapely.to_wkb(shapely.Polygon(ring, holes)))
            codes.append(code)
    g = to_m(shapely.from_wkb(np.array(geoms, dtype=object)))
    codes = np.array(codes)
    poly = np.array([gg.geom_type in ("Polygon", "MultiPolygon") for gg in g])
    small = shapely.area(g) <= POND_MAX_M2
    keep = poly & ((codes != AREA_POND) | small)
    print(f"  {keep.sum():,} parking lots, aprons, pools and ponds")
    return clip_to_tiles(g[keep], codes[keep], "Polygon", 0.8)


def buildings():
    geoms, heights, floors, under, lon, lat, area = load()
    select, _, _, _ = selection(geoms, lon, lat, area, under)
    x, z = project(lon, lat)
    in_patch = (x >= CX_MIN) & (x <= CX_MAX) & (z >= CZ_MIN) & (z <= CZ_MAX)
    take = ~select & ~in_patch & ~under & (area >= MIN_AREA_M2)
    ix, iz = tile_of(x, z)
    # skyline.py's buildings drawn at their real heights here too (whole footprints: its towers
    # on podiums are all in buildings.bin).
    tall = towers(geoms)
    out = {}
    for i in np.where(take)[0]:
        h = tall[i][0] if i in tall else height_m(heights, floors, area, i)
        recs = record(geoms[i], h, -1)
        if recs:
            out.setdefault((int(ix[i]), int(iz[i])), []).extend(recs)
    print(f"  {sum(len(v) for v in out.values()):,} footprints for the tiles")
    return out


def build():
    t0 = time.time()
    d = OUT / "tiles"
    d.mkdir(parents=True, exist_ok=True)
    for f in d.glob("*.bin"):
        f.unlink()
    b, s, a = buildings(), streets(), areas()
    nx = math.ceil(WIDTH_KM / TILE_KM)
    nz = math.ceil(HEIGHT_KM / TILE_KM)
    index = []
    total = 0
    for key in sorted(set(b) | set(s) | set(a)):
        ix, iz = key
        if not (0 <= ix < nx and 0 <= iz < nz):
            continue
        blobs = [encode([], b.get(key, [])), encode([], s.get(key, [])), encode([], a.get(key, []))]
        data = struct.pack("<4sB3x3I", MAGIC, VERSION, *(len(x) for x in blobs)) + b"".join(blobs)
        (d / f"{ix}_{iz}.bin").write_bytes(data)
        index.append([ix, iz, len(data), len(b.get(key, []))])
        total += len(data)
    (d / "index.json").write_text(json.dumps({
        "size": TILE_KM, "origin": [X_MIN, Z_MIN], "nx": nx, "nz": nz,
        "streetCodes": {f"{c}{'/' + sc if sc else ''}": v for (c, sc), v in STREET_CODES.items()},
        "tiles": index,
    }, separators=(",", ":")))
    sizes = sorted(i[2] for i in index)
    print(f"  {len(index)} tiles, {total / 1e6:.1f} MB; median {sizes[len(sizes) // 2] / 1e3:.0f} KB, "
          f"largest {sizes[-1] / 1e3:.0f} KB ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    build()
