"""Vector layers: roads, rail + the CapMetro Red Line, creeks, and map labels.

Output: public/atlas/vectors.json

Lines are polylines in integer metres of scene space, delta-encoded:
[x0, z0, dx1, dz1, dx2, dz2, ...]. The client decodes to km floats.
"""

import json
import math

import networkx as nx
import numpy as np
import pyarrow.parquet as pq
import shapely
from shapely.geometry import LineString, MultiLineString, Point
from shapely.ops import linemerge, nearest_points

from config import CACHE, OUT, X_MAX, X_MIN, Z_MAX, Z_MIN, project

ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary"]
SIMPLIFY_M = {"motorway": 12, "trunk": 12, "primary": 15, "secondary": 18, "tertiary": 20,
              "rail": 12, "creek": 25}

# Highway shields: (label, [(network, ref), ...], spacing_km)
SHIELDS = [
    ("I-35", [("US:I", "35")], 14),
    ("MoPac", [("US:TX:Loop", "1")], 9),
    ("183", [("US:US", "183")], 13),
    ("130", [("US:TX:Toll", "130")], 16),
    ("71", [("US:TX", "71")], 14),
    ("290", [("US:US", "290")], 16),
    ("45", [("US:TX:Toll", "45"), ("US:TX", "45")], 14),
    ("360", [("US:TX:Loop", "360")], 9),
    ("79", [("US:US", "79")], 14),
    ("620", [("US:TX:RM", "620")], 12),
]

RED_LINE_STATIONS = [
    ("Leander", 30.58640, -97.85580),
    ("Lakeline", 30.48074, -97.78747),
    ("Howard", 30.44015, -97.70145),
    ("Kramer", 30.39050, -97.71250),
    ("McKalla", 30.38772, -97.71941),
    ("Crestview", 30.33920, -97.71520),
    ("Highland", 30.32853, -97.71620),
    ("MLK Jr.", 30.27992, -97.70922),
    ("Plaza Saltillo", 30.26223, -97.72773),
    ("Downtown", 30.26506, -97.73933),
]

TOWNS_WANTED = {
    # name: rank (1 = biggest type)
    "Austin": 1, "Round Rock": 2, "Georgetown": 2, "Cedar Park": 2, "Pflugerville": 2, "Leander": 2,
    "Taylor": 2, "Bastrop": 2, "Hutto": 3, "Manor": 3, "Elgin": 3, "Buda": 3, "Kyle": 3,
    "Lakeway": 3, "Bee Cave": 3, "Dripping Springs": 3, "Liberty Hill": 3, "West Lake Hills": 3,
    "Del Valle": 3, "Briggs": 3, "Jonestown": 3, "Lago Vista": 3, "Florence": 3,
    "Bertram": 3, "Jarrell": 3, "Coupland": 3, "Webberville": 3, "Mustang Ridge": 3, "Creedmoor": 3,
}

# Unincorporated places Overture doesn't carry as locality points.
EXTRA_TOWNS = [("Del Valle", 30.1810, -97.6480)]

NEIGHBORHOODS = ["Downtown", "Hyde Park", "Mueller", "Zilker", "Travis Heights", "East Cesar Chavez",
                 "Montopolis", "Tech Ridge", "North Burnet", "Oak Hill", "Clarksville", "Bouldin Creek",
                 "St. Elmo", "Crestview", "Windsor Park", "Allandale", "Brentwood", "Govalle"]

WATER_LABELS = [
    ("Lake Travis", 30.435, -97.975, "lake"),
    ("Lake Austin", 30.335, -97.800, "lake"),
    ("Lady Bird Lake", 30.2625, -97.7560, "lake"),
    ("Colorado River", 30.2295, -97.6530, "river"),
    ("Colorado River", 30.1780, -97.5120, "river"),
    ("Walter E. Long Lake", 30.2890, -97.5930, "lake"),
    ("Lake Georgetown", 30.6770, -97.7320, "lake"),
    ("Granger Lake", 30.7050, -97.3500, "lake"),
    ("Lake Pflugerville", 30.4640, -97.5650, "lake"),
    ("San Gabriel River", 30.6350, -97.5800, "river"),
]

LANDMARKS = [
    ("Texas Capitol", 30.27474, -97.74035, 1),
    ("UT Tower", 30.28619, -97.73943, 1),
    ("Congress Ave. Bridge", 30.26175, -97.74516, 1),
    ("Pennybacker Bridge", 30.34991, -97.79703, 2),
    ("Mount Bonnell", 30.32161, -97.77325, 2),
    ("Austin-Bergstrom Airport", 30.19700, -97.66640, 1),
    ("Circuit of the Americas", 30.13280, -97.64110, 2),
    ("Q2 Stadium", 30.38772, -97.71941, 3),
    ("Mansfield Dam", 30.39189, -97.90737, 3),
    ("Tom Miller Dam", 30.29412, -97.78710, 3),
    ("Longhorn Dam", 30.25076, -97.71334, 3),
    ("Zilker Park", 30.26837, -97.77278, 2),
    ("The Domain", 30.40207, -97.72589, 2),
]


def to_m(lon, lat):
    x, z = project(np.asarray(lon), np.asarray(lat))
    return np.column_stack([x * 1000, z * 1000])


def geom_to_m(g):
    return shapely.transform(g, lambda c: to_m(c[:, 0], c[:, 1]))


def encode(line):
    """LineString in metres -> delta-encoded integer list."""
    c = np.round(np.asarray(line.coords)).astype(np.int64)
    if len(c) < 2:
        return None
    d = np.vstack([c[:1], np.diff(c, axis=0)])
    keep = np.ones(len(d), bool)
    keep[1:] = np.any(d[1:] != 0, axis=1)
    return d[keep].ravel().tolist() if keep.sum() >= 2 else None


def lines_of(g):
    if g.is_empty:
        return []
    if g.geom_type == "LineString":
        return [g]
    if g.geom_type == "MultiLineString":
        return list(g.geoms)
    return [p for p in getattr(g, "geoms", []) if p.geom_type == "LineString"]


def merged(geoms, tol):
    m = linemerge(MultiLineString([ln for g in geoms for ln in lines_of(g)]))
    return [ln.simplify(tol) for ln in lines_of(m)]


def in_region(pt_m):
    x, z = pt_m[0] / 1000, pt_m[1] / 1000
    return X_MIN <= x <= X_MAX and Z_MIN <= z <= Z_MAX


def roads(segs):
    out, shields = {}, []
    for cls in ROAD_CLASSES:
        geoms = [geom_to_m(shapely.from_wkb(r["geometry"])) for r in segs if r["class"] == cls]
        lines = merged(geoms, SIMPLIFY_M[cls])
        enc = [e for e in (encode(ln) for ln in lines if ln.length > 60) if e]
        out[cls] = enc
        print(f"  {cls}: {len(enc)} lines, {sum(len(e) for e in enc) // 2} pts")
    for label, refs, spacing in SHIELDS:
        geoms = []
        for r in segs:
            for rt in r["routes"] or []:
                if (rt.get("network"), rt.get("ref")) in refs:
                    geoms.append(geom_to_m(shapely.from_wkb(r["geometry"])))
                    break
        if not geoms:
            continue
        pts = []
        for ln in sorted(merged(geoms, 30), key=lambda l: -l.length):
            if ln.length < spacing * 400:
                continue
            n = max(1, int(ln.length // (spacing * 1000)))
            for i in range(n):
                p = ln.interpolate((i + 0.5) / n, normalized=True)
                if in_region((p.x, p.y)) and all(math.dist((p.x, p.y), q) > spacing * 600 for q in pts):
                    pts.append((p.x, p.y))
        shields += [{"text": label, "x": round(p[0]), "z": round(p[1])} for p in pts]
    return out, shields


def rail(segs):
    geoms = [geom_to_m(shapely.from_wkb(r["geometry"])) for r in segs if r["class"] == "standard_gauge"]
    all_lines = merged(geoms, SIMPLIFY_M["rail"])

    # Graph over raw segment vertices so we can route the Red Line.
    g = nx.Graph()
    for geom in geoms:
        for ln in lines_of(geom):
            c = [tuple(np.round(p, 1)) for p in ln.coords]
            for a, b in zip(c, c[1:]):
                g.add_edge(a, b, w=math.dist(a, b))
    # Heal tiny gaps between segments that don't share an exact vertex.
    nodes = np.array(list(g.nodes))
    tree = shapely.STRtree([Point(p) for p in nodes])
    for i, p in enumerate(nodes):
        if g.degree[tuple(p)] == 1:
            for j in tree.query(Point(p).buffer(8)):
                if j != i:
                    g.add_edge(tuple(p), tuple(nodes[j]), w=float(np.hypot(*(p - nodes[j]))))

    stations, path = [], []
    network = MultiLineString([ln for geom in geoms for ln in lines_of(geom)])
    for name, lat, lon in RED_LINE_STATIONS:
        p = Point(to_m([lon], [lat])[0])
        snap = nearest_points(network, p)[0]
        idx = tree.query_nearest(snap)[0]
        stations.append({"name": name, "node": tuple(nodes[idx]), "x": round(snap.x), "z": round(snap.y)})
    for a, b in zip(stations, stations[1:]):
        leg = nx.shortest_path(g, a["node"], b["node"], weight="w")
        path += leg if not path else leg[1:]
    red = LineString(path).simplify(4)
    total = red.length
    for s in stations:
        s["at"] = round(red.project(Point(s["x"], s["z"])) / total, 5)
        del s["node"]
    print(f"  rail: {len(all_lines)} lines; Red Line {total / 1000:.1f} km, {len(red.coords)} pts")
    return [e for e in (encode(ln) for ln in all_lines) if e], encode(red), stations


def creeks():
    t = pq.read_table(CACHE / "water.parquet", columns=["geometry", "class", "names"]).to_pylist()
    by_name = {}
    for r in t:
        name = (r["names"] or {}).get("primary")
        if r["class"] in ("river", "stream") and name:
            g = shapely.from_wkb(r["geometry"])
            if g.geom_type in ("LineString", "MultiLineString"):
                by_name.setdefault(name, []).append(geom_to_m(g))
    out = []
    for name, geoms in by_name.items():
        for ln in merged(geoms, SIMPLIFY_M["creek"]):
            if ln.length > 2500:
                e = encode(ln)
                if e:
                    out.append(e)
    print(f"  creeks: {len(out)} lines, {sum(len(e) for e in out) // 2} pts")
    return out


def labels():
    div = pq.read_table(CACHE / "divisions.parquet").to_pylist()
    towns, hoods = [], []
    seen = set()
    for r in sorted(div, key=lambda r: -(r["population"] or 0)):
        name = (r["names"] or {}).get("primary")
        g = shapely.from_wkb(r["geometry"])
        if g.geom_type != "Point" or not name:
            continue
        x, z = to_m([g.x], [g.y])[0]
        if not in_region((x, z)):
            continue
        if r["subtype"] == "locality" and name in TOWNS_WANTED and name not in seen:
            seen.add(name)
            towns.append({"text": name, "rank": TOWNS_WANTED[name], "x": round(x), "z": round(z)})
        elif r["subtype"] in ("neighborhood", "macrohood") and name in NEIGHBORHOODS and name not in seen:
            seen.add(name)
            hoods.append({"text": name, "x": round(x), "z": round(z)})
    for name, lat, lon in EXTRA_TOWNS:
        if name not in seen:
            x, z = to_m([lon], [lat])[0]
            seen.add(name)
            towns.append({"text": name, "rank": TOWNS_WANTED[name], "x": round(x), "z": round(z)})
    missing = set(TOWNS_WANTED) - seen
    if missing:
        print("  towns not found:", sorted(missing))
    water = []
    for text, lat, lon, kind in WATER_LABELS:
        x, z = to_m([lon], [lat])[0]
        water.append({"text": text, "kind": kind, "x": round(x), "z": round(z)})
    marks = []
    for text, lat, lon, rank in LANDMARKS:
        x, z = to_m([lon], [lat])[0]
        marks.append({"text": text, "rank": rank, "x": round(x), "z": round(z)})
    return {"towns": towns, "neighborhoods": hoods, "water": water, "landmarks": marks}


def build():
    segs = pq.read_table(CACHE / "segments.parquet", columns=["geometry", "class", "routes"]).to_pylist()
    road_lines, shields = roads(segs)
    rail_lines, red_line, stations = rail(segs)
    data = {
        "units": "m",
        "roads": road_lines,
        "rail": rail_lines,
        "redLine": {"line": red_line, "stations": stations},
        "creeks": creeks(),
        "labels": {**labels(), "shields": shields},
    }
    path = OUT / "vectors.json"
    path.write_text(json.dumps(data, separators=(",", ":")))
    print(f"  vectors.json {path.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    build()
