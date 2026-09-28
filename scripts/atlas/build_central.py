"""Central Austin detail patch: the river, Zilker and Barton Springs, downtown, Rainey
Street, UT and Mount Bonnell at street scale.

Outputs (public/atlas/):
  central_terrain.webp  R/G = elevation in decimetres (16-bit), B = tree canopy.       ~8 m/px
  central_surface.webp  R = water signed distance (sqrt-encoded, >128 on water), G = parkland,
                        B = built-up density (blurred, for night lights and reflections). 4 m/px
  central.json          paths, the Butler trail graph, bridge decks, piers, the Zilker Eagle
                        track, river centrelines with half-widths, streets and landmark geometry.
                        Lines use the vectors.json encoding (delta-encoded integer metres).
  central_trees.bin     tree instances, 6 bytes each: uint16 x, uint16 z (quarter metres from
                        the patch's north-west corner), uint8 crown radius (decimetres),
                        uint8 variant (bit 7 = conical, low bits = tint).
The patch description is merged into meta.json under "central".
"""

import json
import math
import time
import urllib.request

import networkx as nx
import numpy as np
import pyarrow.compute as pc
import pyarrow.parquet as pq
import shapely
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import LineString, MultiLineString, Point
from shapely.ops import linemerge, substring

from config import (C_EAST, C_HEIGHT_KM, C_NORTH, C_SOUTH, C_WEST, C_WIDTH_KM, CACHE, CX_MIN,
                    CZ_MIN, OUT, project, unproject)
from build_vectors import encode, lines_of

TERRAIN_ZOOM = 14
TERRAIN_PX_M = 8.0
SURFACE_PX_M = 4.0
SDF_K = 7.33  # sqrt encoding: 128 +/- K*sqrt(metres), so 127 levels reach ~300 m
TREE_BUDGET = 60000

# Land-use classes that read as parkland (lawns, parks, golf, fields).
PARK_CLASSES = {"park", "dog_park", "nature_reserve", "recreation_ground", "garden", "cemetery",
                "grave_yard", "grass", "meadow", "golf_course", "fairway", "green", "rough", "tee",
                "driving_range", "pitch", "playground", "village_green", "common", "flowerbed"}
# Open lawn: never covered by canopy.
LAWN_CLASSES = {"grass", "pitch", "fairway", "green", "tee", "driving_range", "playground"}
ROAD_WIDTH_M = {"motorway": 24, "trunk": 20, "primary": 16, "secondary": 14, "tertiary": 12,
                "residential": 9, "unclassified": 8, "living_street": 7, "service": 5}
PATH_CLASSES = {"footway", "cycleway", "path", "pedestrian", "steps", "track"}
BUTLER_NAMES = {"Ann & Roy Butler Hike and Bike Trail", "Ann and Roy Butler Hike and Bike Trail",
                "Lady Bird Lake Hike and Bike Trail", "Pfluger Pedestrian Bridge"}
TOM_MILLER_DAM = (-97.7866, 30.2955)
LONGHORN_DAM = (-97.7133, 30.2508)
BARTON_MOUTH = (-97.7628, 30.2662)

# Moonlight tower in Zilker Park (moved there in 1993; strung as the Zilker Holiday Tree).
ZILKER_MOONLIGHT = (-97.77113, 30.26642)
# Where boats launch (Overture places, checked against their street addresses).
DOCKS = [
    ("rowing-dock", "Rowing Dock", -97.77431, 30.27474, "paddle"),
    ("texas-rowing-center", "Texas Rowing Center", -97.76341, 30.26971, "rowing"),
    ("zilker-boat-rentals", "Zilker Park Boat Rentals", -97.76749, 30.26449, "canoe"),
    ("waller-boathouse", "Austin Rowing Club & Congress Avenue Kayaks", -97.74188, 30.26057, "rowing"),
    ("lone-star-riverboat", "Lone Star Riverboat", -97.74792, 30.26181, "riverboat"),
    ("epic-sup", "EpicSUP", -97.72367, 30.24552, "paddle"),
    ("live-love-paddle", "Live Love Paddle", -97.73061, 30.24574, "paddle"),
]
LANDMARK_POINTS = {
    "capitol": (-97.74035, 30.27472),
    "ut-tower": (-97.73943, 30.28619),
    "barton-springs": (-97.77110, 30.26380),
    "mount-bonnell": (-97.77325, 30.32161),
}
# Buildings drawn as models rather than extrusions, found by their Overture names.
NAMED_LANDMARKS = {
    "frost-bank-tower": "Frost Bank Tower",
    "the-independent": "The Independent",
    "block-185": "Block 185",
    "dkr-stadium": "DKR Memorial Stadium",
    "moody-center": "Moody Center",
    "governors-mansion": "Governor's Mansion",
    "land-office": "Capitol Complex Visitor Center",
    "st-mary": "Saint Mary Cathedral",
}
# Overture tags most of Austin's creeks "river", but they are a few metres across; drawn as
# rivers they read as rivers. Where a creek's banks are mapped, its polygons give its width.
RIVER_LINE_M = {"Colorado River": 14, "Barton Creek": 14}
CREEK_LINE_M = 5
# The Capitol's long (east-west) axis, degrees north of east: the street grid's skew.
CAPITOL_AXIS_DEG = -17.7
# Its drives and grand walks, cut out of the lawns around it so they read from above (metres).
CAPITOL_PAVING_M = {"State Capitol Driveway": 6.5, "Great Walk": 7.0, "Oval Walk": 4.0}
STREETS = {
    "rainey": (["Rainey Street"], None),
    "sixth": (["East 6th Street"], (-97.7431, -97.7365)),
    "congress": (["Congress Avenue"], None),
    "soco": (["South Congress Avenue"], (30.2460, 30.2620)),
}

W, S, E, N = C_WEST, C_SOUTH, C_EAST, C_NORTH


# ---------------------------------------------------------------- helpers

def grid(px_m):
    w = int(round(C_WIDTH_KM * 1000 / px_m))
    h = int(round(C_HEIGHT_KM * 1000 / px_m))
    return w, h


def to_px(geoms, w, h, ss=1):
    """lon/lat geometries -> pixel space of a w x h raster over the patch (times ss)."""
    def tf(c):
        x, z = project(c[:, 0], c[:, 1])
        return np.column_stack([(x - CX_MIN) / C_WIDTH_KM * w * ss, (z - CZ_MIN) / C_HEIGHT_KM * h * ss])
    return shapely.transform(geoms, tf)


def to_m(g):
    """lon/lat geometry -> scene metres."""
    def tf(c):
        x, z = project(c[:, 0], c[:, 1])
        return np.column_stack([x * 1000, z * 1000])
    return shapely.transform(g, tf)


def bbox_rows(path, columns, extra=None):
    flt = ((pc.field("bbox", "xmax") >= W) & (pc.field("bbox", "xmin") <= E)
           & (pc.field("bbox", "ymax") >= S) & (pc.field("bbox", "ymin") <= N))
    if extra is not None:
        flt = flt & extra
    import pyarrow.dataset as ds
    return ds.dataset(path, format="parquet").to_table(filter=flt, columns=columns).to_pylist()


def draw_polys(d, g, fill):
    for p in (g.geoms if g.geom_type == "MultiPolygon" else [g]):
        if p.is_empty or p.geom_type != "Polygon":
            continue
        d.polygon([tuple(c) for c in np.asarray(p.exterior.coords)], fill=fill)
        for hole in p.interiors:
            d.polygon([tuple(c) for c in np.asarray(hole.coords)], fill=0)


def draw_lines(d, g, fill, width):
    for ln in lines_of(g):
        d.line([tuple(c) for c in np.asarray(ln.coords)], fill=fill, width=max(1, int(round(width))))


def coverage(img, ss):
    """Supersampled 0/255 mask -> antialiased coverage at output resolution."""
    a = np.asarray(img, dtype=np.float32) / 255
    h, w = a.shape[0] // ss, a.shape[1] // ss
    return a[: h * ss, : w * ss].reshape(h, ss, w, ss).mean(axis=(1, 3))


# ---------------------------------------------------------------- terrain

def tile_xy(lon, lat, z):
    n = 2**z
    r = math.radians(lat)
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n


def fetch_tiles():
    d = CACHE / f"terrain_z{TERRAIN_ZOOM}"
    d.mkdir(parents=True, exist_ok=True)
    x0, y0 = (int(v) for v in tile_xy(W - 0.01, N + 0.01, TERRAIN_ZOOM))
    x1, y1 = (int(v) for v in tile_xy(E + 0.01, S - 0.01, TERRAIN_ZOOM))
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            out = d / f"{x}_{y}.png"
            if out.exists():
                continue
            url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{TERRAIN_ZOOM}/{x}/{y}.png"
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(url, timeout=60) as r:
                        out.write_bytes(r.read())
                    break
                except Exception as e:  # noqa: BLE001 - retry transient network errors
                    if attempt == 3:
                        raise
                    print(f"  retry {x}/{y}: {e}")
                    time.sleep(2**attempt)
    return d, x0, x1, y0, y1


def elevation():
    d, x0, x1, y0, y1 = fetch_tiles()
    img = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256), dtype=np.float32)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            rgb = np.asarray(Image.open(d / f"{x}_{y}.png").convert("RGB"), dtype=np.float32)
            img[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = (
                rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768)
    w, h = grid(TERRAIN_PX_M)
    xs = CX_MIN + (np.arange(w) + 0.5) * C_WIDTH_KM / w
    zs = CZ_MIN + (np.arange(h) + 0.5) * C_HEIGHT_KM / h
    X, Z = np.meshgrid(xs, zs)
    lon, lat = unproject(X, Z)
    n = 256 * 2**TERRAIN_ZOOM
    mx = (lon + 180) / 360 * n - x0 * 256
    lr = np.radians(lat)
    my = (1 - np.log(np.tan(lr) + 1 / np.cos(lr)) / math.pi) / 2 * n - y0 * 256
    smooth = ndimage.gaussian_filter(img, 0.6)
    return np.clip(ndimage.map_coordinates(smooth, [my, mx], order=1, mode="nearest"), 0, 6000)


def building_geoms():
    rows = bbox_rows(str(CACHE / "buildings.parquet"), ["geometry", "height", "num_floors", "names"])
    return shapely.from_wkb([r["geometry"] for r in rows]), rows


# ---------------------------------------------------------------- surface

def water_mask(w, h, ss):
    rows = bbox_rows(str(CACHE / "water.parquet"), ["geometry", "subtype", "class", "names"])
    img = Image.new("L", (w * ss, h * ss), 0)
    d = ImageDraw.Draw(img)
    px_m = SURFACE_PX_M / ss
    lake = Image.new("L", (w * ss, h * ss), 0)
    dl = ImageDraw.Draw(lake)
    for r in rows:
        g = to_px(shapely.from_wkb(r["geometry"]), w, h, ss)
        name = (r["names"] or {}).get("primary") or ""
        if g.geom_type in ("Polygon", "MultiPolygon"):
            if r["class"] in ("wastewater", "basin", "drain", "ditch"):
                continue
            draw_polys(d, g, 255)
            if name in ("Lady Bird Lake", "Lake Austin"):
                draw_polys(dl, g, 255)
        elif g.geom_type in ("LineString", "MultiLineString") and name and r["class"] in ("river", "stream"):
            draw_lines(d, g, 255, RIVER_LINE_M.get(name, CREEK_LINE_M) / px_m)
    return img, lake


def sdf_encode(mask_hi, ss):
    m = np.asarray(mask_hi) > 127
    inside = ndimage.distance_transform_edt(m)
    outside = ndimage.distance_transform_edt(~m)
    sd = (inside - outside) * (SURFACE_PX_M / ss)  # metres, + on water
    h, w = m.shape[0] // ss, m.shape[1] // ss
    sd = sd[: h * ss, : w * ss].reshape(h, ss, w, ss).mean(axis=(1, 3))
    v = 128 + np.sign(sd) * np.minimum(127, SDF_K * np.sqrt(np.abs(sd)))
    return np.clip(np.round(v), 0, 255).astype(np.uint8), sd


def land_use(w, h, ss):
    rows = bbox_rows(str(CACHE / "land_use.parquet"), ["geometry", "class", "names"])
    park = Image.new("L", (w * ss, h * ss), 0)
    lawn = Image.new("L", (w * ss, h * ss), 0)
    dp, dl = ImageDraw.Draw(park), ImageDraw.Draw(lawn)
    for r in rows:
        if r["class"] not in PARK_CLASSES:
            continue
        g = to_px(shapely.from_wkb(r["geometry"]), w, h, ss)
        if g.geom_type in ("Polygon", "MultiPolygon"):
            draw_polys(dp, g, 255)
            if r["class"] in LAWN_CLASSES:
                draw_polys(dl, g, 255)
    return coverage(park, ss), coverage(lawn, ss)


def capitol_paving(segs, w, h, ss):
    """The Capitol's drives and grand walks as coverage, to cut out of the lawns around it."""
    img = Image.new("L", (w * ss, h * ss), 0)
    d = ImageDraw.Draw(img)
    for r in segs:
        wm = CAPITOL_PAVING_M.get(name_of(r))
        if wm:
            draw_lines(d, to_px(r["g"], w, h, ss), 255, wm / SURFACE_PX_M * ss)
    return coverage(img, ss)


def canopy_raw(w, h, ss):
    rows = pq.read_table(CACHE / "land_cover_central.parquet", columns=["subtype", "geometry"]).to_pylist()
    box = shapely.box(W, S, E, N)
    img = Image.new("L", (w * ss, h * ss), 0)
    d = ImageDraw.Draw(img)
    for sub, val in (("shrub", 150), ("forest", 255)):
        for r in rows:
            if r["subtype"] != sub:
                continue
            g = shapely.from_wkb(r["geometry"]).intersection(box)
            if not g.is_empty:
                draw_polys(d, to_px(g, w, h, ss), val)
    return coverage(img, ss)


def footprint_mask(bgeoms, w, h):
    img = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(img)
    for g in to_px(bgeoms, w, h):
        if g.geom_type in ("Polygon", "MultiPolygon"):
            draw_polys(d, g, 255)
    return np.asarray(img, dtype=np.float32) / 255


def road_mask(segs, w, h):
    img = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(img)
    for r in segs:
        wm = ROAD_WIDTH_M.get(r["class"])
        if wm:
            draw_lines(d, to_px(shapely.from_wkb(r["geometry"]), w, h), 255, wm / SURFACE_PX_M)
    return np.asarray(img, dtype=np.float32) / 255


# ---------------------------------------------------------------- trees

def tree_records(X, Z, radius, conical, tint):
    """Trees at patch metres (x east, z south of the north-west corner) in central_trees.bin's layout."""
    rec = np.zeros(len(X), dtype=[("x", "<u2"), ("z", "<u2"), ("r", "u1"), ("v", "u1")])
    rec["x"] = np.clip(np.round(X * 4), 0, 65535)
    rec["z"] = np.clip(np.round(Z * 4), 0, 65535)
    rec["r"] = np.round(radius * 10)
    rec["v"] = tint | np.where(conical, 128, 0)
    return rec


def trees(canopy, sd, park, rng, planted=None):
    """Jittered-grid sampling of the canopy, favouring the river, parks and downtown. `planted`
    is a mask of places with their own planting (the Capitol grounds), left out here."""
    h, w = canopy.shape
    step_m = 11.0
    gx = np.arange(0, w * SURFACE_PX_M, step_m)
    gz = np.arange(0, h * SURFACE_PX_M, step_m)
    X, Z = np.meshgrid(gx, gz)
    X = X + rng.uniform(0, step_m, X.shape)
    Z = Z + rng.uniform(0, step_m, Z.shape)
    # Every draw is made for the whole grid, so a change in one place (a creek's width, a park)
    # only moves the trees there.
    u_keep, u_rank, u_river, u_hills = (rng.uniform(0, 1, X.shape) for _ in range(4))
    size = rng.normal(5.2, 1.2, X.shape)
    tint = rng.integers(0, 128, X.shape)
    ix = np.clip((X / SURFACE_PX_M).astype(int), 0, w - 1)
    iz = np.clip((Z / SURFACE_PX_M).astype(int), 0, h - 1)
    c = canopy[iz, ix]
    dist = sd[iz, ix]  # metres, + on water
    near_river = (dist < 0) & (dist > -160)
    weight = np.where(near_river | (park[iz, ix] > 0.5), 1.0, 0.6)
    p = np.clip(c, 0, 1) ** 1.4 * weight
    keep = u_keep < p
    if planted is not None:
        keep &= planted[iz, ix] < 0.5
    if keep.sum() > TREE_BUDGET:
        keep &= u_rank <= np.sort(u_rank[keep])[TREE_BUDGET - 1]
    X, Z, dist, c, size, tint = X[keep], Z[keep], dist[keep], c[keep], size[keep], tint[keep]
    # Bald cypress line the river; Ashe juniper ("cedar") fills the western hills.
    xs_km = CX_MIN + X / 1000
    conical = ((dist > -18) & (u_river[keep] < 0.7)) | ((xs_km < -3.2) & (u_hills[keep] < 0.35))
    radius = np.clip(size * np.where(conical, 0.75, 1.0) * (0.85 + 0.3 * c), 2.5, 9)
    return tree_records(X, Z, radius, conical, tint)


def capitol_to_scene(u, v):
    """Scene metres (x east, z south) of (u, v): metres east and north along the Capitol's axes
    from its landmark point (as src/lib/atlas/capitol.ts). Works on numpy arrays."""
    ax, az = (c * 1000 for c in project(*LANDMARK_POINTS["capitol"]))
    t = math.radians(CAPITOL_AXIS_DEG)
    return ax + u * math.cos(t) - v * math.sin(t), az - (u * math.sin(t) + v * math.cos(t))


def capitol_grounds():
    """Capitol Square (the grounds, 11th to 15th Street), in lon/lat."""
    rows = bbox_rows(str(CACHE / "land_use.parquet"), ["geometry", "names"])
    return next(shapely.from_wkb(r["geometry"]) for r in rows if (r["names"] or {}).get("primary") == "Capitol Square")


def capitol_trees(grounds, bgeoms, segs, rng):
    """The Capitol grounds' live oaks, pecans and elms. The grounds are mapped as lawns, which the
    canopy sampler leaves open, so they get their own planting: through the south lawn but clear
    of the Great Walk's view of the south front, thickest on the east and west grounds, sparse on
    the terrace around the building, and none on the lawns over the underground Capitol Extension
    (the scene's clearings keep them off the monuments and fountains)."""
    near = grounds.buffer(0.0002)
    blocked = [to_m(bgeoms[i]).buffer(5) for i in shapely.STRtree(bgeoms).query(near)]
    for r in segs:
        if r["g"].intersects(near):
            blocked.append(to_m(r["g"]).buffer(2.4 if r["class"] in PATH_CLASSES else 6))
    blocked = shapely.union_all(blocked)
    area = to_m(grounds)
    us = np.arange(-175, 180, 12.5)
    vs = np.arange(-230, 250, 12.5)
    U, V = np.meshgrid(us, vs)
    U = U + rng.uniform(-4.5, 4.5, U.shape)
    V = V + rng.uniform(-4.5, 4.5, V.shape)
    x, z = capitol_to_scene(U, V)
    a = np.abs(U - 2)  # from the axis (the Great Walk)
    p = np.full(U.shape, 0.8)
    p[(a < 108) & (V > -64) & (V < 52)] = 0.12  # the terrace and drive around the building
    p[(V < -40) & (a < 17)] = 0  # the Great Walk's view of the south front
    p[(a < 80) & (V > 44) & (V < 205)] = 0  # the lawns over the Capitol Extension
    ok = (rng.uniform(0, 1, U.shape) < p) & shapely.contains_xy(area, x, z) & ~shapely.contains_xy(blocked, x, z)
    x, z = x[ok], z[ok]
    radius = np.clip(rng.normal(6.4, 1.2, len(x)), 4.2, 9)
    conical = rng.uniform(0, 1, len(x)) < 0.03
    tint = rng.integers(0, 128, len(x))
    print(f"  Capitol grounds: {len(x)} trees")
    return tree_records(x - CX_MIN * 1000, z - CZ_MIN * 1000, radius, conical, tint)


# ---------------------------------------------------------------- vectors

def seg_rows():
    t = pq.read_table(CACHE / "segments_central.parquet",
                      columns=["class", "subclass", "names", "road_flags", "geometry", "subtype"]).to_pylist()
    out = []
    for r in t:
        g = shapely.from_wkb(r["geometry"])
        b = g.bounds
        if b[2] >= W and b[0] <= E and b[3] >= S and b[1] <= N:
            r["g"] = g
            out.append(r)
    return out


def name_of(r):
    return (r["names"] or {}).get("primary") or ""


def flagged(r, flag):
    """Sub-lines of a segment covered by a road flag (Overture linear referencing)."""
    out = []
    for f in r["road_flags"] or []:
        if flag in (f.get("values") or []):
            a, b = (f.get("between") or [0, 1])
            out.append(substring(r["g"], a, b, normalized=True))
    return out


class SdfSampler:
    def __init__(self, sd):
        self.sd = sd
        self.h, self.w = sd.shape

    def __call__(self, xm, zm):
        """Signed water distance (m) at scene metres."""
        ix = (np.asarray(xm) / 1000 - CX_MIN) / C_WIDTH_KM * self.w - 0.5
        iz = (np.asarray(zm) / 1000 - CZ_MIN) / C_HEIGHT_KM * self.h - 0.5
        return ndimage.map_coordinates(self.sd, [np.atleast_1d(iz), np.atleast_1d(ix)], order=1, mode="nearest")


def paths(segs):
    out = {k: [] for k in PATH_CLASSES}
    for r in segs:
        if r["class"] in PATH_CLASSES and r["subclass"] not in ("sidewalk", "crosswalk"):
            for ln in lines_of(to_m(r["g"]).simplify(1.2)):
                e = encode(ln)
                if e:
                    out[r["class"]].append(e)
    return {k: v for k, v in out.items() if v}


def trail_graph(segs, water_at):
    """The Butler Hike-and-Bike Trail as a graph agents can wander: nodes + polyline edges.
    Edge kind: 0 trail, 1 boardwalk or bridge on the trail itself, 2 road-bridge sidewalk or the
    Pfluger Pedestrian Bridge."""
    pieces = []  # (line in metres, kind)
    for r in segs:
        nm = name_of(r)
        butler = nm in BUTLER_NAMES and nm != "Pfluger Pedestrian Bridge"
        sidewalk_bridge = r["class"] in ("footway", "cycleway") and r["subclass"] == "sidewalk" and bool(flagged(r, "is_bridge"))
        if not (butler or nm == "Pfluger Pedestrian Bridge" or sidewalk_bridge):
            continue
        cuts = sorted({0.0, 1.0, *[v for f in r["road_flags"] or [] if "is_bridge" in (f.get("values") or [])
                                   for v in (f.get("between") or [0, 1])]})
        spans = [(f.get("between") or [0, 1]) for f in r["road_flags"] or [] if "is_bridge" in (f.get("values") or [])]
        for a, b in zip(cuts[:-1], cuts[1:]):
            if b - a < 1e-6:
                continue
            part = to_m(substring(r["g"], a, b, normalized=True))
            on_bridge = any(lo <= (a + b) / 2 <= hi for lo, hi in spans)
            if butler:
                kind = 1 if on_bridge else 0
            else:
                kind = 2
            for ln in lines_of(part):
                if ln.length > 0.5:
                    pieces.append((ln, kind))
    g = nx.Graph()
    key = lambda p: (round(p[0] / 2), round(p[1] / 2))  # snap endpoints within ~2 m
    for ln, kind in pieces:
        c = list(ln.coords)
        a, b = key(c[0]), key(c[-1])
        if a == b:
            continue
        if g.has_edge(a, b) and g[a][b]["line"].length <= ln.length:
            continue
        g.add_edge(a, b, line=ln, kind=kind)
    # Close small gaps between pieces (unnamed connectors, bridge approaches): join a dead end to
    # the nearest node of another component within 30 m.
    comp = {n: i for i, c in enumerate(nx.connected_components(g)) for n in c}
    nodes = np.array(list(g.nodes), dtype=float) * 2
    names = list(g.nodes)
    for n in [n for n in g.nodes if g.degree(n) == 1]:
        p = np.array(n, dtype=float) * 2
        d = np.hypot(*(nodes - p).T)
        order = np.argsort(d)
        for j in order[1:6]:
            if d[j] > 30:
                break
            if comp[names[j]] != comp[n]:
                g.add_edge(n, names[j], line=LineString([p, nodes[j]]), kind=0)
                old, new = comp[names[j]], comp[n]
                for m, c in comp.items():
                    if c == old:
                        comp[m] = new
                break
    comps = [c for c in nx.connected_components(g) if sum(g[u][v]["line"].length for u, v in g.subgraph(c).edges) > 400]
    keep = set().union(*comps) if comps else set()
    sub = g.subgraph(keep)
    nodes = list(sub.nodes)
    index = {n: i for i, n in enumerate(nodes)}
    edges = []
    for u, v, dat in sub.edges(data=True):
        ln = dat["line"]
        if key(ln.coords[0]) != u:  # orient the polyline from u to v
            ln = LineString(list(ln.coords)[::-1])
        e = encode(ln.simplify(0.8))
        if e:
            edges.append([index[u], index[v], dat["kind"], e])
    lengths = sorted((sum(sub[u][v]["line"].length for u, v in sub.subgraph(c).edges) / 1000 for c in comps), reverse=True)
    board = sum(sub[u][v]["line"].length for u, v in sub.edges if sub[u][v]["kind"] == 1) / 1000
    print(f"  trail graph: {len(nodes)} nodes, {len(edges)} edges, parts (km): {[round(x, 1) for x in lengths[:8]]}, "
          f"boardwalk/bridges {board:.1f} km")
    return {"nodes": [[n[0] * 2, n[1] * 2] for n in nodes], "edges": edges}


def bridges(segs, water_at):
    """Bridge decks over open water, with road class and name, for 3D decks and piers."""
    out = []
    for r in segs:
        if r["subtype"] != "road":
            continue
        for part in flagged(r, "is_bridge"):
            ln = to_m(part)
            if ln.length < 25:
                continue
            pts = [ln.interpolate(t, normalized=True) for t in (0.25, 0.5, 0.75)]
            wet = water_at([p.x for p in pts], [p.y for p in pts])
            if np.max(wet) < 10:  # creeks are at most a few metres from their banks
                continue
            e = encode(ln.simplify(0.8))
            if e:
                out.append({"name": name_of(r), "cls": r["class"], "line": e})
    print(f"  bridges over water: {len(out)}")
    return out


def piers():
    rows = bbox_rows(str(CACHE / "infrastructure_central.parquet"), ["class", "geometry", "names"])
    polys, lines = [], []
    for r in rows:
        if r["class"] != "pier":
            continue
        g = to_m(shapely.from_wkb(r["geometry"]))
        if g.geom_type == "Polygon":
            e = encode(LineString(g.exterior.coords))
            if e:
                polys.append(e)
        else:
            for ln in lines_of(g):
                e = encode(ln)
                if e:
                    lines.append(e)
    return {"polys": polys, "lines": lines}


def moonlight_towers():
    rows = bbox_rows(str(CACHE / "infrastructure_central.parquet"), ["class", "geometry", "names", "source_tags"])
    pts = []
    for r in rows:
        tags = dict(r["source_tags"] or [])
        if r["class"] == "lighting" and "Moonlight" in (tags.get("note") or "") + ((r["names"] or {}).get("primary") or ""):
            p = shapely.from_wkb(r["geometry"])
            pts.append((p.x, p.y))
    pts.append(ZILKER_MOONLIGHT)
    out = []
    for lon, lat in pts:
        x, z = project(lon, lat)
        out.append([round(x * 1000), round(z * 1000)])
    print(f"  moonlight towers: {len(out)}")
    return out


def train_track(segs):
    ls = [to_m(r["g"]) for r in segs if r["subtype"] == "rail" and name_of(r) in ("Zilker Eagle", "Zilker Zephyr")]
    merged = linemerge(MultiLineString([ln for g in ls for ln in lines_of(g)])) if ls else None
    return [e for ln in lines_of(merged) if (e := encode(ln.simplify(0.6)))] if merged else []


def rivers(water_at):
    rows = bbox_rows(str(CACHE / "water.parquet"), ["geometry", "names", "class"])
    colorado = [to_m(shapely.from_wkb(r["geometry"])) for r in rows
                if (r["names"] or {}).get("primary") == "Colorado River" and r["class"] == "river"]
    barton = [to_m(shapely.from_wkb(r["geometry"])) for r in rows
              if (r["names"] or {}).get("primary") == "Barton Creek" and r["class"] == "river"]
    patch = to_m(shapely.box(W, S, E, N))

    def one(geoms):
        m = linemerge(MultiLineString([ln for g in geoms for ln in lines_of(g.intersection(patch))]))
        ls = lines_of(m)
        return max(ls, key=lambda l: l.length) if ls else None

    def pt(lonlat):
        x, z = project(*lonlat)
        return Point(x * 1000, z * 1000)

    def sampled(ln, step=20.0):
        n = max(2, int(ln.length / step) + 1)
        ps = [ln.interpolate(i / (n - 1), normalized=True) for i in range(n)]
        xs, zs = [p.x for p in ps], [p.y for p in ps]
        half = np.maximum(water_at(xs, zs), 0)
        return {"line": encode(LineString(zip(xs, zs))), "half": [int(round(v)) for v in half]}

    out = {}
    co = one(colorado)
    if co is not None:
        a = co.project(pt(TOM_MILLER_DAM))
        b = co.project(pt(LONGHORN_DAM))
        lo, hi = min(a, b), max(a, b)
        lbl = substring(co, lo, hi)
        austin = substring(co, 0, lo) if co.project(pt((W, N))) < lo else substring(co, hi, co.length)
        # Orient Lady Bird Lake west to east (Tom Miller Dam first).
        if Point(lbl.coords[0]).distance(pt(TOM_MILLER_DAM)) > Point(lbl.coords[-1]).distance(pt(TOM_MILLER_DAM)):
            lbl = LineString(list(lbl.coords)[::-1])
        out["ladybird"] = sampled(lbl.simplify(4))
        out["austin"] = sampled(austin.simplify(4))
        print(f"  Lady Bird Lake centreline {lbl.length / 1000:.1f} km, Lake Austin {austin.length / 1000:.1f} km")
    bc = one(barton)
    if bc is not None:
        mouth = pt(BARTON_MOUTH)
        d0 = bc.project(mouth)
        part = substring(bc, max(0, d0 - 700), d0)  # the creek below Barton Springs Pool
        out["barton"] = sampled(part.simplify(2), 12.0)
    return out


def streets(segs):
    out = {}
    for key, (names, clip) in STREETS.items():
        ls = []
        for r in segs:
            if r["subtype"] == "road" and name_of(r) in names:
                g = r["g"]
                if clip is not None:
                    box = (shapely.box(clip[0], S, clip[1], N) if key == "sixth"
                           else shapely.box(W, clip[0], E, clip[1]))
                    g = g.intersection(box)
                    if g.is_empty:
                        continue
                ls.extend(lines_of(to_m(g)))
        m = linemerge(MultiLineString(ls)) if ls else None
        out[key] = [e for ln in lines_of(m) if (e := encode(ln.simplify(1.0)))] if m else []
    return out


def polygon_named(path, names, cls=None):
    rows = bbox_rows(str(path), ["geometry", "names", "class"])
    out = []
    for r in rows:
        if (r["names"] or {}).get("primary") in names and (cls is None or r["class"] in cls):
            g = to_m(shapely.from_wkb(r["geometry"]))
            for p in (g.geoms if g.geom_type == "MultiPolygon" else [g]):
                if p.geom_type == "Polygon":
                    e = encode(LineString(p.exterior.coords))
                    if e:
                        out.append(e)
    return out


def open_lawn(park_name, canopy, hard, sd):
    """The largest open, treeless stretch of a park, as a polygon in scene metres."""
    rows = bbox_rows(str(CACHE / "land_use.parquet"), ["geometry", "names"])
    geom = next((shapely.from_wkb(r["geometry"]) for r in rows if (r["names"] or {}).get("primary") == park_name), None)
    if geom is None:
        return None
    h, w = canopy.shape
    img = Image.new("L", (w, h), 0)
    draw_polys(ImageDraw.Draw(img), to_px(geom, w, h), 255)
    m = (np.asarray(img) > 127) & (canopy < 0.12) & (hard < 0.5) & (sd < -6)
    m = ndimage.binary_opening(m, iterations=2)
    lab, n = ndimage.label(m)
    if n == 0:
        return None
    big = np.argmax(ndimage.sum(m, lab, range(1, n + 1))) + 1
    ys, xs = np.nonzero(lab == big)
    cells = shapely.union_all(shapely.box(xs, ys, xs + 1, ys + 1))
    poly = cells if cells.geom_type == "Polygon" else max(cells.geoms, key=lambda q: q.area)
    def tf(c):
        return np.column_stack([(CX_MIN * 1000 + c[:, 0] * SURFACE_PX_M), (CZ_MIN * 1000 + c[:, 1] * SURFACE_PX_M)])
    poly = shapely.transform(poly, tf).simplify(4)
    print(f"  {park_name} open lawn: {poly.area / 1e4:.1f} ha")
    return encode(LineString(poly.exterior.coords))


def landmark_footprints(bgeoms, brows):
    out = {}
    tree = shapely.STRtree(bgeoms)
    for key, (lon, lat) in LANDMARK_POINTS.items():
        p = Point(lon, lat)
        hits = tree.query(p.buffer(0.0004))
        if not len(hits):
            continue
        best = max(hits, key=lambda i: bgeoms[i].area if bgeoms[i].distance(p) < 0.0003 else -1)
        g = to_m(bgeoms[best])
        poly = g if g.geom_type == "Polygon" else max(g.geoms, key=lambda q: q.area)
        out[key] = {"outline": encode(LineString(poly.exterior.coords)), "height": brows[best]["height"]}
    for key, name in NAMED_LANDMARKS.items():
        hits = [i for i, r in enumerate(brows) if ((r["names"] or {}).get("primary") or "") == name]
        if not hits:
            print(f"  landmark not found: {name}")
            continue
        best = max(hits, key=lambda i: bgeoms[i].area)
        g = to_m(bgeoms[best])
        poly = g if g.geom_type == "Polygon" else max(g.geoms, key=lambda q: q.area)
        out[key] = {"outline": encode(LineString(poly.exterior.coords)), "height": max(brows[i]["height"] or 0 for i in hits)}
    print(f"  landmarks: {', '.join(out)}")
    return out


# ---------------------------------------------------------------- build

def build():
    t0 = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(7)

    bgeoms, brows = building_geoms()
    print(f"  {len(bgeoms):,} buildings in the patch")

    # Surface first: the terrain texture carries the canopy it computes.
    sw, sh = grid(SURFACE_PX_M)
    ss = 2
    wmask, _ = water_mask(sw, sh, ss)
    sdf_u8, sd = sdf_encode(wmask, ss)
    park, lawn = land_use(sw, sh, ss)
    segs = seg_rows()
    park = park * (1 - capitol_paving(segs, sw, sh, ss))
    hard = np.maximum(footprint_mask(bgeoms, sw, sh), road_mask(segs, sw, sh))
    blocked = np.maximum.reduce([hard, lawn, (sd > 0).astype(np.float32)])
    blocked = ndimage.grey_dilation(blocked, size=(2, 2))
    canopy = canopy_raw(sw, sh, ss) * (1 - blocked)
    canopy = ndimage.gaussian_filter(canopy, 0.6)
    fp = footprint_mask(bgeoms, sw, sh)
    # Only feeds soft glows, so it is heavily blurred and coarsely quantised (compresses well).
    dens = ndimage.gaussian_filter(fp, 7.0)
    dens = np.round(np.clip(dens / 0.3, 0, 1) ** 0.7 * 7) * (255 / 7)
    surf = np.stack([sdf_u8, np.round(park * 255).astype(np.uint8), dens.astype(np.uint8)], -1)
    Image.fromarray(surf, "RGB").save(OUT / "central_surface.webp", lossless=True, method=6)
    print(f"  central_surface.webp {sw}x{sh}, {(OUT / 'central_surface.webp').stat().st_size / 1e6:.2f} MB")

    # Terrain: elevation + canopy averaged down to the terrain grid.
    tw, th = grid(TERRAIN_PX_M)
    elev = elevation()
    dm = np.round(elev * 10).astype(np.uint16)
    rgb = np.zeros((th, tw, 3), np.uint8)
    rgb[..., 0], rgb[..., 1] = dm >> 8, dm & 0xFF
    k = int(round(TERRAIN_PX_M / SURFACE_PX_M))
    cz = np.clip(canopy, 0, 1)[: th * k, : tw * k]
    cz = np.pad(cz, ((0, th * k - cz.shape[0]), (0, tw * k - cz.shape[1])))
    rgb[..., 2] = np.round(cz.reshape(th, k, tw, k).mean(axis=(1, 3)) * 15) * 17  # 16 levels
    Image.fromarray(rgb, "RGB").save(OUT / "central_terrain.webp", lossless=True, method=6)
    print(f"  central_terrain.webp {tw}x{th} ({elev.min():.0f}-{elev.max():.0f} m), "
          f"{(OUT / 'central_terrain.webp').stat().st_size / 1e6:.2f} MB")

    grounds = capitol_grounds()
    img = Image.new("L", (sw, sh), 0)
    draw_polys(ImageDraw.Draw(img), to_px(grounds, sw, sh), 255)
    planted = np.asarray(img, dtype=np.float32) / 255
    rec = np.concatenate([trees(canopy, sd, park, rng, planted), capitol_trees(grounds, bgeoms, segs, rng)])
    rec.tofile(OUT / "central_trees.bin")
    print(f"  central_trees.bin {len(rec):,} trees, {(OUT / 'central_trees.bin').stat().st_size / 1e6:.2f} MB")

    water_at = SdfSampler(sd)
    data = {
        "paths": paths(segs),
        "trails": trail_graph(segs, water_at),
        "bridges": bridges(segs, water_at),
        "piers": piers(),
        "train": train_track(segs),
        "rivers": rivers(water_at),
        "streets": streets(segs),
        "moonlight": moonlight_towers(),
        "docks": [{"id": i, "name": n, "kind": k, "x": round(project(lon, lat)[0] * 1000),
                   "z": round(project(lon, lat)[1] * 1000)} for i, n, lon, lat, k in DOCKS],
        "pools": polygon_named(CACHE / "water.parquet", {"Barton Springs Pool", "Deep Eddy Pool"}),
        "lawns": [e for e in [open_lawn("Zilker Metropolitan Park", canopy, hard, sd)] if e],
        "landmarks": landmark_footprints(bgeoms, brows),
    }
    (OUT / "central.json").write_text(json.dumps(data, separators=(",", ":")))
    print(f"  central.json {(OUT / 'central.json').stat().st_size / 1e6:.2f} MB")

    meta_path = OUT / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    meta["central"] = {
        "bounds": [CX_MIN, CZ_MIN, C_WIDTH_KM, C_HEIGHT_KM],
        "terrain": {"width": tw, "height": th},
        "surface": {"width": sw, "height": sh, "sdfK": SDF_K},
        "trees": int(len(rec)),
    }
    meta_path.write_text(json.dumps(meta, indent=1))
    print(f"  done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    build()
