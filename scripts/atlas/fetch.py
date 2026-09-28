"""Download raw inputs for the atlas into the cache.

  python scripts/atlas/fetch.py            # everything
  python scripts/atlas/fetch.py terrain buildings

Overture Maps GeoParquet is read straight from the public S3 bucket with a
bbox predicate, so only the row groups covering Greater Austin are pulled.
Terrain comes from the AWS Terrain Tiles (Terrarium encoding) bucket.
"""

import io
import math
import os
import sys
import time
import urllib.request

import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as pafs
import pyarrow.parquet as pq

from config import (C_EAST, C_NORTH, C_SOUTH, C_WEST, CACHE, EAST, NORTH, OVERTURE_BUCKET,
                    OVERTURE_RELEASE, SOUTH, WEST)

TERRAIN_ZOOM = 12
PAD = 0.02  # degrees of slack around the region for everything we fetch


def s3():
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    kw = {"proxy_options": proxy} if proxy else {}
    return pafs.S3FileSystem(anonymous=True, region="us-west-2", **kw)


def bbox_filter():
    w, s, e, n = WEST - PAD, SOUTH - PAD, EAST + PAD, NORTH + PAD
    return (
        (pc.field("bbox", "xmax") >= w)
        & (pc.field("bbox", "xmin") <= e)
        & (pc.field("bbox", "ymax") >= s)
        & (pc.field("bbox", "ymin") <= n)
    )


# The landscape beyond the map (build_outer.py): ~80 km of relief, water and towns all round.
OUTER = (-98.95, 29.30, -96.45, 31.66)


def outer_filter():
    w, s, e, n = OUTER
    return (
        (pc.field("bbox", "xmax") >= w)
        & (pc.field("bbox", "xmin") <= e)
        & (pc.field("bbox", "ymax") >= s)
        & (pc.field("bbox", "ymin") <= n)
    )


def central_filter():
    """The central detail patch plus slack (covers Pennybacker Bridge and Mount Bonnell)."""
    w, s, e, n = C_WEST - 0.07, C_SOUTH - 0.026, C_EAST + 0.035, C_NORTH + 0.045
    return (
        (pc.field("bbox", "xmax") >= w)
        & (pc.field("bbox", "xmin") <= e)
        & (pc.field("bbox", "ymax") >= s)
        & (pc.field("bbox", "ymin") <= n)
    )


def overture(theme, kind, columns, out_name, extra=None, area=None):
    out = CACHE / out_name
    if out.exists():
        print(f"  cached {out.name}")
        return
    t = time.time()
    path = f"{OVERTURE_BUCKET}/release/{OVERTURE_RELEASE}/theme={theme}/type={kind}"
    dataset = ds.dataset(path, filesystem=s3(), format="parquet")
    cols = [c for c in columns if c in dataset.schema.names] if columns else None
    base = area if area is not None else bbox_filter()
    flt = base if extra is None else base & extra
    table = dataset.to_table(filter=flt, columns=cols)
    pq.write_table(table, out, compression="zstd")
    print(f"  {out.name}: {table.num_rows:,} rows in {time.time() - t:.0f}s")


def fetch_overture(which):
    common = ["id", "geometry", "bbox", "names", "subtype", "class"]
    if "places" in which:
        overture("places", "place", ["id", "geometry", "bbox", "names", "basic_category",
                                     "confidence", "addresses", "websites"], "places.parquet")
    if "addresses" in which:
        overture("addresses", "address", ["id", "geometry", "bbox", "number", "street",
                                          "postcode", "postal_city"], "addresses.parquet")
    if "buildings" in which:
        overture("buildings", "building", common + ["height", "num_floors", "min_height",
                                                    "roof_shape", "is_underground"], "buildings.parquet")
    if "roads" in which:
        overture("transportation", "segment", common + ["subclass", "routes"], "segments.parquet",
                 extra=pc.field("class").isin(["motorway", "trunk", "primary", "secondary",
                                               "tertiary", "standard_gauge"]))
    if "water" in which:
        overture("base", "water", common + ["is_intermittent", "is_salt"], "water.parquet")
    if "landuse" in which:
        overture("base", "land_use", common + ["surface"], "land_use.parquet")
    if "divisions" in which:
        overture("divisions", "division", ["id", "geometry", "bbox", "names", "subtype", "class",
                                           "population"], "divisions.parquet")
    if "landcover" in which:
        overture("base", "land_cover", ["subtype", "geometry", "bbox"], "land_cover.parquet",
                 extra=pc.field("subtype").isin(["forest", "shrub"]))
    if "streets" in which:
        # Every street and path below the arterials, for the detail tiles.
        overture("transportation", "segment", ["geometry", "bbox", "names", "subtype", "class", "subclass"],
                 "segments_local.parquet",
                 extra=pc.field("class").isin(["residential", "unclassified", "living_street", "service",
                                               "track", "footway", "cycleway", "path", "pedestrian",
                                               "steps", "bridleway"]))
    if "infrastructure" in which:
        # Runways, taxiways, aprons, dams, towers and piers across the region.
        overture("base", "infrastructure", ["geometry", "bbox", "names", "subtype", "class", "height",
                                            "surface"], "infrastructure.parquet")
    if "outer" in which:
        # Lakes and rivers, and towns, around the map (the relief comes from terrain tiles).
        overture("base", "water", ["geometry", "bbox", "names", "subtype", "class"], "water_outer.parquet",
                 extra=pc.field("subtype").isin(["lake", "river", "reservoir", "water", "canal"]), area=outer_filter())
        overture("divisions", "division", ["geometry", "bbox", "names", "subtype", "population"],
                 "divisions_outer.parquet", extra=pc.field("subtype") == "locality", area=outer_filter())
    if "central" in which:
        # Every path class, piers and towers, and land cover for the central detail patch.
        overture("transportation", "segment", None, "segments_central.parquet", area=central_filter())
        overture("base", "infrastructure", None, "infrastructure_central.parquet", area=central_filter())
        overture("base", "land_cover", None, "land_cover_central.parquet", area=central_filter())


def tile_range(zoom):
    def tx(lon):
        return int((lon + 180) / 360 * 2**zoom)

    def ty(lat):
        r = math.radians(lat)
        return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2**zoom)

    return tx(WEST - PAD), tx(EAST + PAD), ty(NORTH + PAD), ty(SOUTH - PAD)


def fetch_terrain():
    d = CACHE / f"terrain_z{TERRAIN_ZOOM}"
    d.mkdir(parents=True, exist_ok=True)
    x0, x1, y0, y1 = tile_range(TERRAIN_ZOOM)
    n = 0
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
                    n += 1
                    break
                except Exception as e:  # noqa: BLE001 - retry any transient network error
                    if attempt == 3:
                        raise
                    print(f"  retry {x}/{y}: {e}")
                    time.sleep(2**attempt)
    print(f"  terrain: {(x1 - x0 + 1) * (y1 - y0 + 1)} tiles ({n} new)")


if __name__ == "__main__":
    CACHE.mkdir(parents=True, exist_ok=True)
    targets = set(sys.argv[1:]) or {"terrain", "places", "addresses", "buildings", "roads",
                                     "water", "landuse", "divisions", "landcover", "central",
                                     "streets", "infrastructure", "outer"}
    if "terrain" in targets:
        fetch_terrain()
    fetch_overture(targets)
