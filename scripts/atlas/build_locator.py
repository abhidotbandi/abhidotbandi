"""The locator: a small north-up map of the whole region for the corner of the screen, with the
camera's place and heading on it (ui/Locator.tsx), in the manner of the Levels.fyi atlases.

Travis County is the land, its neighbours paler round it, with the lakes and the Colorado cut
through. A coarse grid names the city (or else the county) under the camera for its caption.

Writes src/data/atlas/locator.json, in scene km (x east, z south):
  frame     [x, z, width, height]: the region
  travis    SVG path: Travis County
  counties  SVG path: the other counties' parts in the region, each its own outline
  water     SVG path: lakes, reservoirs and the wide river over LAKE_MIN_KM2
  river     SVG path: the Colorado's line, where it runs narrow
  names     the grid's names (index 0: none)
  grid      {cell km, cols, rows, runs [count, name index, ...] row by row from the north-west}

    python scripts/atlas/build_locator.py   (needs division_areas.parquet: fetch.py divisions)
"""

import json
import os

import numpy as np
import pyarrow.parquet as pq
import shapely
from shapely.ops import linemerge, unary_union

from config import CACHE, EAST, NORTH, SOUTH, WEST, X_MAX, X_MIN, Z_MAX, Z_MIN, project

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "src", "data", "atlas", "locator.json")

LAKE_MIN_KM2 = 0.6
SIMPLIFY_KM = 0.15  # a quarter of a pixel at the card's size
CELL_KM = 0.5
COUNTY_SHORT = lambda n: n.replace(" County", " Co.")

km = lambda g: shapely.transform(g, lambda c: np.column_stack(project(c[:, 0], c[:, 1])))
fmt = lambda v: f"{v:.1f}".rstrip("0").rstrip(".").replace("-0", "-") if abs(v) >= 0.05 else "0"


def polys(g):
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    return [p for p in getattr(g, "geoms", []) for p in polys(p)]


def lines(g):
    if g.is_empty:
        return []
    if g.geom_type == "LineString":
        return [g]
    return [ln for p in getattr(g, "geoms", []) for ln in lines(p)]


def ring_path(coords, close):
    pts = [(round(x, 1), round(z, 1)) for x, z in coords]
    pts = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
    if len(pts) < (3 if close else 2):
        return ""
    return "M" + "L".join(f"{fmt(x)} {fmt(z)}" for x, z in pts) + ("Z" if close else "")


def area_path(g, tol=SIMPLIFY_KM, hole_km2=0.0):
    g = g.simplify(tol)
    return "".join(ring_path(r.coords[:-1], True) for p in polys(g)
                   for r in [p.exterior, *(h for h in p.interiors if shapely.Polygon(h).area > hole_km2)])


def line_path(g):
    return "".join(ring_path(ln.simplify(SIMPLIFY_KM).coords, False) for ln in lines(g))


def main():
    frame_ll = shapely.box(WEST, SOUTH, EAST, NORTH)
    rows = pq.read_table(CACHE / "division_areas.parquet", columns=["geometry", "names", "subtype"]).to_pylist()
    areas = []
    for r in rows:
        g = shapely.from_wkb(r["geometry"]).intersection(frame_ll)
        if not g.is_empty and g.area > 0:
            areas.append((r["subtype"], r["names"]["primary"], km(g)))
    travis = next(g for kind, name, g in areas if kind == "county" and name == "Travis County")
    others = [g for kind, name, g in areas if kind == "county" and name != "Travis County" and g.area > 1]

    water, river = [], []
    for r in pq.read_table(CACHE / "water.parquet", columns=["geometry", "class", "names"]).to_pylist():
        g = shapely.from_wkb(r["geometry"])
        name = (r["names"] or {}).get("primary")
        if g.geom_type in ("Polygon", "MultiPolygon") and r["class"] in ("lake", "reservoir", "river", "water"):
            g = km(g.intersection(frame_ll))
            if g.area > LAKE_MIN_KM2:
                water.append(g)
        elif g.geom_type in ("LineString", "MultiLineString") and name == "Colorado River":
            river.append(km(g.intersection(frame_ll)))
    water = unary_union(water)
    # The river's line where it runs narrow: across the lakes, their outlines carry it.
    river = linemerge(unary_union(river)).difference(water.buffer(-0.2))

    # Name grid: the city under each cell's centre, or else its county.
    cols = int(np.ceil((X_MAX - X_MIN) / CELL_KM))
    nrows = int(np.ceil((Z_MAX - Z_MIN) / CELL_KM))
    X, Z = np.meshgrid(X_MIN + (np.arange(cols) + 0.5) * CELL_KM, Z_MIN + (np.arange(nrows) + 0.5) * CELL_KM)
    idx = np.zeros(X.shape, np.int32)
    names = [""]
    # Counties first, then cities over them; small cities last, so an enclave keeps its name.
    order = sorted(areas, key=lambda a: (a[0] != "county", -a[2].area))
    for kind, name, g in order:
        inside = shapely.contains_xy(g, X, Z)
        if inside.any():
            names.append(COUNTY_SHORT(name) if kind == "county" else name)
            idx[inside] = len(names) - 1
    flat = idx.ravel()
    edges = np.flatnonzero(np.diff(flat)) + 1
    starts = np.concatenate([[0], edges])
    counts = np.diff(np.concatenate([starts, [len(flat)]]))
    runs = np.column_stack([counts, flat[starts]]).ravel().tolist()

    data = {
        "frame": [round(X_MIN, 2), round(Z_MIN, 2), round(X_MAX - X_MIN, 2), round(Z_MAX - Z_MIN, 2)],
        "travis": area_path(travis),
        "counties": "".join(area_path(g) for g in others),
        "water": area_path(water, 0.25, 0.3),
        "river": line_path(river),
        "names": names,
        "grid": {"cell": CELL_KM, "cols": cols, "rows": nrows, "runs": runs},
    }
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))
        f.write("\n")
    print(f"locator: {len(names) - 1} names, {len(runs) // 2} runs, paths "
          f"{', '.join(f'{k} {len(data[k]) // 1000} kB' for k in ('travis', 'counties', 'water', 'river'))} "
          f"-> {os.path.getsize(OUT) / 1000:.1f} kB")


if __name__ == "__main__":
    main()
