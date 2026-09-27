"""3D building footprints: central Austin in full, the Domain and every company site.

Outputs (same format, see building_codec.py):
  public/atlas/central_buildings.bin  every building in the central detail patch, thinning out
                                      over a ring beyond its edge so detail dissolves gradually
  public/atlas/buildings.bin          the rest: the Domain and the context around company sites

Each building is a height, an optional company site, and its rings (outer first, then holes) in
integer metres in scene space. The client extrudes them (roofs via earcut) and drapes them on
the terrain.
"""

import json
import math

import numpy as np
import pyarrow.parquet as pq
import shapely
from shapely.geometry import Point

from building_codec import encode
from config import C_EAST, C_NORTH, C_SOUTH, C_WEST, CACHE, COMPANIES_JSON, OUT, project

ZONES = {
    # name: (west, south, east, north, min footprint m^2)
    "domain": (-97.7470, 30.3740, -97.6960, 30.4160, 60),
}
CONTEXT_MIN_KM = 0.55
CENTRAL_MIN_M2 = 25
FADE_KM = 1.6  # buildings thin out over this distance beyond the central patch


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
    """A ring in integer metres without its closing vertex or repeated points; None if degenerate."""
    c = np.round(np.asarray(coords)[:-1]).astype(np.int64)
    keep = np.ones(len(c), bool)
    keep[1:] = np.any(np.diff(c, axis=0) != 0, axis=1)
    c = c[keep]
    return [(int(x), int(z)) for x, z in c] if len(c) >= 3 else None


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

    # Central Austin in full, then a ring where a shrinking random share survives.
    in_central = (lon >= C_WEST) & (lon <= C_EAST) & (lat >= C_SOUTH) & (lat <= C_NORTH)
    klon0 = 111.320 * math.cos(math.radians(30.27))
    dxk = np.maximum.reduce([C_WEST - lon, np.zeros_like(lon), lon - C_EAST]) * klon0
    dzk = np.maximum.reduce([C_SOUTH - lat, np.zeros_like(lat), lat - C_NORTH]) * 110.574
    ring_d = np.hypot(dxk, dzk)
    ring = ~in_central & (ring_d < FADE_KM)
    u = np.random.default_rng(11).random(len(geoms))
    select |= in_central & (area >= CENTRAL_MIN_M2)
    select |= ring & (area >= 50) & (u < np.clip(1 - ring_d / FADE_KM, 0, 1) ** 1.3)
    central_zone = in_central | ring

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

    out, out_c, n_pts = [], [], 0
    for i in np.where(select)[0]:
        dest = out_c if central_zone[i] else out
        g = shapely.transform(geoms[i], lambda c: to_m(c[:, 0], c[:, 1])).simplify(0.6)
        polys = g.geoms if g.geom_type == "MultiPolygon" else [g]
        h = min(350.0, max(3.0, est_height(heights[i], floors[i], area[i])))
        for p in polys:
            if p.is_empty or p.geom_type != "Polygon" or p.area < 12:
                continue
            outer = ring_ints(shapely.geometry.polygon.orient(p, 1.0).exterior.coords)
            if not outer:
                continue
            rings = [outer]
            for hole in p.interiors:
                if shapely.Polygon(hole).area > 40:
                    r = ring_ints(hole.coords)
                    if r:
                        rings.append(r)
            n_pts += sum(len(r) for r in rings)
            dest.append((int(round(h * 10)), int(site_of[i]), rings))
    for name, recs in (("buildings.bin", out), ("central_buildings.bin", out_c)):
        path = OUT / name
        path.write_bytes(encode([s["id"] for s in sites], recs))
        hi = sum(1 for r in recs if r[1] >= 0)
        print(f"  {name}: {len(recs):,} footprints ({hi} company), {path.stat().st_size / 1e6:.2f} MB")
    print(f"  ~{n_pts:,} points in all")
    matched = {sites[r[1]]["id"] for r in out + out_c if r[1] >= 0}
    print("  sites without a footprint:", sorted({s["id"] for s in sites} - matched))


if __name__ == "__main__":
    build()
