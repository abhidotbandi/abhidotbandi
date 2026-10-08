"""Austin-Bergstrom's Barbara Jordan Terminal, cut into the parts the airport scene builds it from.

Overture maps the terminal as one 41,000 m^2 footprint at 24.7 m, which drew as a single beige
block. The building (Page Southerland Page and Gensler, Larry Speck lead designer, 1999; the
East Infill added in 2019) is a crescent: a long airside concourse, glass walled under a roof
with a raised clerestory spine, and behind its middle the 60 ft "living room" hall facing the
road. Cut lines are read from USGS orthoimagery (public domain) and the architects' photographs:

  west concourse   west of the hall, 14 m, both sides gated
  hall             the middle third, north of the concourse's curve, 24.7 m (Overture's height),
                   with three skylights and an oval drum at its east end
  concourse arc    the curved airside frontage south of the hall, 16 m
  east connector   east of the hall, 15 m
  East Infill      the 2019 nine-gate block at the east end, 17 m

Every concourse part has a clerestory spine: its middle, 9 m in from the edges, 3.5 m higher.

The elevated departures roadway (Overture's bridge trestle) and the canopies over its curb
(Overture's roof outlines, which the tiles drew as solid towers) come along too.

Writes src/data/atlas/terminal.json:
  parts     [{h, ring}]: footprints (lon, lat) and heights m, extruded by the airport scene
  replaced  [ring]: footprints the detail tiles leave out (the terminal and its canopies)
  canopies  [{top, ring}]: the curb canopies, top m
  deck      ring: the departures roadway

    python scripts/atlas/build_terminal.py
"""

import json
import math
import os

import pyarrow.parquet as pq
import shapely
import shapely.affinity
from shapely.geometry import Point, Polygon, box
from shapely.ops import transform

from config import CACHE

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "src", "data", "atlas", "terminal.json")

LAT0, LON0 = 30.2022, -97.667
KX = 111320 * math.cos(math.radians(LAT0))
KY = 110574
to_m = lambda g: transform(lambda x, y: ((x - LON0) * KX, (y - LAT0) * KY), g)
to_ll = lambda g: transform(lambda x, y: (x / KX + LON0, y / KY + LAT0), g)
mx = lambda lon: (lon - LON0) * KX
my = lambda lat: (lat - LAT0) * KY

# Cut lines (lon, lat), from the imagery.
WEST = -97.66867  # the west concourse | the hall
EAST = -97.66524  # the hall | the east connector
INFILL = -97.66444  # the connector | the East Infill
HALL_S = 30.20221  # the hall's south face, along the concourse
OVAL = ((-97.66560, 30.20234), 28.0, 13.0)  # centre, semi-axes m (east-west, north-south)
SKYLIGHTS = [(-97.66717, 30.20227), (-97.66700, 30.20227), (-97.66683, 30.20227)]  # 6 by 11 m
HEIGHTS = {"west": 14.0, "hall": 24.7, "arc": 16.0, "connector": 15.0, "infill": 17.0}
SPINE_IN, SPINE_UP = 9.0, 3.5


def load(path, cols, want):
    t = pq.read_table(CACHE / path, columns=cols + ["bbox", "geometry"]).to_pylist()
    out = []
    for r in t:
        bb = r["bbox"]
        if bb["xmax"] < -97.674 or bb["xmin"] > -97.660 or bb["ymax"] < 30.2005 or bb["ymin"] > 30.2040:
            continue
        if want(r):
            r["g"] = shapely.from_wkb(r["geometry"])
            out.append(r)
    return out


def rings(g):
    """Polygons of g (m), simplified, as lon/lat rings (holes dropped: none survive the cuts)."""
    g = g.buffer(0).simplify(0.6)
    polys = list(g.geoms) if hasattr(g, "geoms") else [g]
    out = []
    for p in polys:
        if p.geom_type != "Polygon" or p.area < 20:
            continue
        ll = to_ll(Polygon(p.exterior))
        out.append([[round(x, 6), round(y, 6)] for x, y in list(ll.exterior.coords)[:-1]])
    return out


def main():
    named = lambda r: (r["names"] or {}).get("primary") == "Barbara Jordan Terminal"
    term = load("buildings.parquet", ["names", "class"], named)[0]["g"]
    roofs = load("buildings.parquet", ["names", "class", "height"], lambda r: r["class"] == "roof")
    deck = load("infrastructure.parquet", ["class", "subtype"], lambda r: r["class"] == "trestle")[0]["g"]
    T = to_m(term)
    # The curb canopies: the roof outlines between the terminal and the departures roadway. Their
    # tops: the taller pair (Overture's 21 m) at the entrances 18 m up, the rest 15 m (a canopy
    # with no height, over the east connector's door, 12 m).
    canopies = [r for r in roofs if 30.2023 < r["g"].centroid.y < 30.2027 and -97.6690 < r["g"].centroid.x < -97.6640]
    top = lambda r: 18.0 if (r["height"] or 0) > 18 else 15.0 if r["height"] else 12.0

    big = 2000.0
    west = T.intersection(box(-big, -big, mx(WEST), big))
    mid = T.intersection(box(mx(WEST), -big, mx(EAST), big))
    hall = mid.intersection(box(-big, my(HALL_S), big, big))
    arc = mid.intersection(box(-big, -big, big, my(HALL_S)))
    conn = T.intersection(box(mx(EAST), -big, mx(INFILL), big))
    infill = T.intersection(box(mx(INFILL), -big, big, big))
    (ox, oy), ax, ay = OVAL
    oval = shapely.affinity.scale(Point(mx(ox), my(oy)).buffer(1.0, 32), ax, ay).intersection(hall.buffer(4))
    hall = hall.difference(oval)

    parts = []

    def add(g, h):
        for r in rings(g):
            parts.append({"h": round(h, 1), "ring": r})

    for g, key in ((west, "west"), (arc, "arc"), (conn, "connector"), (infill, "infill")):
        h = HEIGHTS[key]
        spine = g.buffer(-SPINE_IN, join_style="mitre")
        add(g.difference(spine.buffer(0.01)), h)
        add(spine, h + SPINE_UP)
    sky = shapely.union_all([box(mx(x) - 3, my(y) - 5.5, mx(x) + 3, my(y) + 5.5) for x, y in SKYLIGHTS])
    add(hall.difference(sky), HEIGHTS["hall"])
    add(sky.intersection(hall), HEIGHTS["hall"] + 2.0)
    add(oval, HEIGHTS["hall"] + 1.5)

    data = {
        "parts": parts,
        "replaced": [[[round(x, 6), round(y, 6)] for x, y in list(g.exterior.coords)[:-1]] for g in [term] + [r["g"] for r in canopies]],
        "canopies": [
            {"top": top(r), "ring": [[round(x, 6), round(y, 6)] for x, y in list(r["g"].exterior.coords)[:-1]]}
            for r in canopies
        ],
        "deck": [[round(x, 6), round(y, 6)] for x, y in list(deck.simplify(0.000004).exterior.coords)[:-1]],
    }
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))
        f.write("\n")
    n = sum(len(p["ring"]) for p in parts)
    print(f"{len(parts)} parts ({n} points), {len(data['canopies'])} canopies -> {OUT} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()
