"""3D building footprints for downtown, the Domain and every company site.

Output: public/atlas/buildings.json
  {"sites": [siteId, ...],
   "b": [[height_dm, siteIndex|-1, nOuter, x0, z0, dx1, dz1, ..., nHole, x0, z0, ...], ...]}

Coordinates are integer metres in scene space, delta-encoded per ring. The
client extrudes them (roofs via earcut) and drapes them on the terrain.
"""

import json
import math

import numpy as np
import pyarrow.parquet as pq
import shapely
from shapely.geometry import Point

from config import CACHE, COMPANIES_JSON, OUT, project

ZONES = {
    # name: (west, south, east, north, min footprint m^2)
    "downtown": (-97.7760, 30.2340, -97.7040, 30.3010, 35),
    "domain": (-97.7470, 30.3740, -97.6960, 30.4160, 60),
}
CONTEXT_MIN_KM = 0.55


def to_m(lon, lat):
    x, z = project(np.asarray(lon), np.asarray(lat))
    return np.column_stack([x * 1000, z * 1000])


def est_height(h, floors, area):
    if h and h > 0:
        return h
    if floors and floors > 0:
        return floors * 3.6
    if area < 150:
        return 4.5
    if area < 1000:
        return 7.0
    if area < 10000:
        return 10.0
    return 14.0


def ring_ints(coords):
    c = np.round(np.asarray(coords)[:-1]).astype(np.int64)  # drop closing vertex
    d = np.vstack([c[:1], np.diff(c, axis=0)])
    keep = np.ones(len(d), bool)
    keep[1:] = np.any(d[1:] != 0, axis=1)
    d = d[keep]
    return [len(d)] + d.ravel().tolist() if len(d) >= 3 else None


def build():
    t = pq.read_table(CACHE / "buildings.parquet", columns=["geometry", "height", "num_floors", "is_underground"])
    geoms = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))
    heights = np.array([h if h is not None else 0 for h in t.column("height").to_pylist()], dtype=float)
    floors = np.array([f if f is not None else 0 for f in t.column("num_floors").to_pylist()], dtype=float)
    under = np.array([bool(u) for u in t.column("is_underground").to_pylist()])
    cen = shapely.centroid(geoms)
    lon, lat = shapely.get_x(cen), shapely.get_y(cen)
    area = shapely.area(geoms) * (111320 * np.cos(np.radians(lat))) * 110574

    select = np.zeros(len(geoms), bool)
    for w, s, e, n, min_a in ZONES.values():
        select |= (lon > w) & (lon < e) & (lat > s) & (lat < n) & (area >= min_a)

    companies = json.loads(COMPANIES_JSON.read_text())
    sites = [s for c in companies for s in c["sites"]]
    site_of = np.full(len(geoms), -1, dtype=int)
    tree = shapely.STRtree(geoms)
    # Tight sites claim their buildings before sprawling campuses can.
    for si, s in sorted(enumerate(sites), key=lambda e: e[1]["radius"]):
        klon = 111.320 * math.cos(math.radians(s["lat"]))
        dx = (lon - s["lon"]) * klon
        dz = (lat - s["lat"]) * 110.574
        dist = np.hypot(dx, dz)
        ctx = max(s["radius"] * 1.8, CONTEXT_MIN_KM)
        select |= (dist < ctx) & (area >= 60)
        pt = Point(s["lon"], s["lat"])
        hit = [i for i in tree.query(pt) if geoms[i].contains(pt)]
        if s["radius"] >= 0.15:
            hit += list(np.where((dist < s["radius"]) & (area >= 1500))[0])
        if not hit:
            # Address points often sit on the street frontage, off the roof.
            near = np.where((dist < 0.12) & (area >= 300))[0]
            if len(near):
                hit = [near[np.argmin(dist[near])]]
        for i in hit:
            if site_of[i] == -1:
                site_of[i] = si
                select[i] = True
    select &= ~under

    out, n_pts = [], 0
    for i in np.where(select)[0]:
        g = shapely.transform(geoms[i], lambda c: to_m(c[:, 0], c[:, 1])).simplify(0.6)
        polys = g.geoms if g.geom_type == "MultiPolygon" else [g]
        h = min(350.0, max(3.0, est_height(heights[i], floors[i], area[i])))
        for p in polys:
            if p.is_empty or p.geom_type != "Polygon" or p.area < 12:
                continue
            outer = ring_ints(shapely.geometry.polygon.orient(p, 1.0).exterior.coords)
            if not outer:
                continue
            rec = [int(round(h * 10)), int(site_of[i])] + outer
            for hole in p.interiors:
                if shapely.Polygon(hole).area > 40:
                    r = ring_ints(hole.coords)
                    if r:
                        rec += r
            n_pts += (len(rec) - 2) // 2
            out.append(rec)
    data = {"units": "m", "sites": [s["id"] for s in sites], "b": out}
    path = OUT / "buildings.json"
    path.write_text(json.dumps(data, separators=(",", ":")))
    hi = sum(1 for r in out if r[1] >= 0)
    print(f"  buildings.json: {len(out):,} footprints ({hi} company), ~{n_pts:,} pts, "
          f"{path.stat().st_size / 1e6:.2f} MB")
    matched = {sites[r[1]]["id"] for r in out if r[1] >= 0}
    print("  sites without a footprint:", sorted({s["id"] for s in sites} - matched))


if __name__ == "__main__":
    build()
