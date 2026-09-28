"""The landscape beyond the map: coarse relief, lakes and rivers out to ~80 km all round, so the
map's detail fades into open country instead of ending at an edge.

Output:
  public/atlas/outer.webp  R/G = elevation in decimetres (16-bit, 1 m steps), B = water signed
                           distance (output pixels x 4, 128 at the shore, + on water). ~264 m/px.
                           Under the map itself (bar a band at its edge) it's left flat.
  public/atlas/outer_lo.webp  the same at half resolution, for phones
  meta.json "outer"        its bounds in scene km, its size, and the towns around the map
                           (x, z km, population) for their lights after dark

The terrain comes from AWS Terrain Tiles (Terrarium) at z9; water from Overture base/water
(fetch.py outer); towns from Overture divisions (localities).
"""

import json
import math
import time
import urllib.request

import numpy as np
import pyarrow.parquet as pq
import shapely
from PIL import Image, ImageDraw
from scipy import ndimage

from config import CACHE, OUT, X_MAX, X_MIN, Z_MAX, Z_MIN, project, unproject
from fetch import OUTER

ZOOM = 9
PX_KM = 0.264
SS = 3  # supersampling for the water mask
SDF_LEVELS_PER_PX = 4
TOWN_MIN_POP = 1500
ELEV_STEP_DM = 10  # 1 m: plenty for relief seen from afar
INNER_BAND = 6.0  # km inside the map's edge that the blend can reach


def tile_xy(lon, lat, z):
    n = 2**z
    r = np.radians(lat)
    return (lon + 180) / 360 * n, (1 - np.log(np.tan(r) + 1 / np.cos(r)) / math.pi) / 2 * n


def fetch_tiles():
    d = CACHE / f"terrain_z{ZOOM}"
    d.mkdir(parents=True, exist_ok=True)
    w, s, e, n = OUTER
    x0, y0 = (int(v) for v in tile_xy(w, n, ZOOM))
    x1, y1 = (int(v) for v in tile_xy(e, s, ZOOM))
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            out = d / f"{x}_{y}.png"
            if out.exists():
                continue
            url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{ZOOM}/{x}/{y}.png"
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(url, timeout=60) as r:
                        out.write_bytes(r.read())
                    break
                except Exception as err:  # noqa: BLE001 - retry any transient network error
                    if attempt == 3:
                        raise
                    print(f"  retry {x}/{y}: {err}")
                    time.sleep(2**attempt)
    return d, x0, y0, x1, y1


def grid():
    """Output raster over the outer extent in scene km: (x0, z0, width km, height km, w px, h px)."""
    w, s, e, n = OUTER
    x0, z1 = project(w, s)
    x1, z0 = project(e, n)
    wp = int(round((x1 - x0) / PX_KM))
    hp = int(round((z1 - z0) / PX_KM))
    return x0, z0, x1 - x0, z1 - z0, wp, hp


def elevation():
    d, tx0, ty0, tx1, ty1 = fetch_tiles()
    mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), np.float32)
    for x in range(tx0, tx1 + 1):
        for y in range(ty0, ty1 + 1):
            a = np.asarray(Image.open(d / f"{x}_{y}.png").convert("RGB"), dtype=np.float32)
            mosaic[(y - ty0) * 256 : (y - ty0 + 1) * 256, (x - tx0) * 256 : (x - tx0 + 1) * 256] = (
                a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
            )
    x0, z0, wk, hk, wp, hp = grid()
    xs = x0 + (np.arange(wp) + 0.5) * wk / wp
    zs = z0 + (np.arange(hp) + 0.5) * hk / hp
    X, Z = np.meshgrid(xs, zs)
    lon, lat = unproject(X, Z)
    tx, ty = tile_xy(lon, lat, ZOOM)
    px = (tx - tx0) * 256 - 0.5
    py = (ty - ty0) * 256 - 0.5
    elev = ndimage.map_coordinates(mosaic, [py, px], order=1, mode="nearest")
    return np.clip(elev, 0, None)


def to_px(geoms, wp, hp, ss):
    x0, z0, wk, hk, _, _ = grid()

    def tf(c):
        x, z = project(c[:, 0], c[:, 1])
        return np.column_stack([(x - x0) / wk * wp * ss, (z - z0) / hk * hp * ss])

    return shapely.transform(geoms, tf)


def water_sdf(wp, hp):
    rows = pq.read_table(CACHE / "water_outer.parquet", columns=["geometry", "subtype", "class", "names"]).to_pylist()
    geoms = to_px(shapely.from_wkb([r["geometry"] for r in rows]), wp, hp, SS)
    mask = Image.new("L", (wp * SS, hp * SS), 0)
    d = ImageDraw.Draw(mask)
    px_m = PX_KM * 1000 / SS
    for r, g in zip(rows, geoms):
        name = (r["names"] or {}).get("primary") or ""
        if g.geom_type in ("Polygon", "MultiPolygon"):
            # Lakes, reservoirs and the wide rivers; not the stock tanks and ponds.
            if g.area * px_m * px_m < (40000 if r["class"] == "reservoir" else 60000):
                continue
            for p in g.geoms if g.geom_type == "MultiPolygon" else [g]:
                d.polygon([tuple(c) for c in np.asarray(p.exterior.coords)], fill=255)
                for h in p.interiors:
                    d.polygon([tuple(c) for c in np.asarray(h.coords)], fill=0)
        elif g.geom_type in ("LineString", "MultiLineString") and r["subtype"] == "river" and name.endswith("River"):
            for ln in g.geoms if g.geom_type == "MultiLineString" else [g]:
                d.line([tuple(c) for c in np.asarray(ln.coords)], fill=255, width=max(2, round(90 / px_m)))
    m = np.asarray(mask) > 127
    sdf = (ndimage.distance_transform_edt(m) - ndimage.distance_transform_edt(~m)) / SS
    sdf = sdf.reshape(hp, SS, wp, SS).mean(axis=(1, 3))
    return np.clip(np.round(128 + sdf * SDF_LEVELS_PER_PX), 0, 255).astype(np.uint8)


def towns():
    """Localities around (not in) the map, for their lights after dark."""
    out = []
    for r in pq.read_table(CACHE / "divisions_outer.parquet").to_pylist():
        pop = r["population"] or 0
        g = shapely.from_wkb(r["geometry"])
        if pop < TOWN_MIN_POP or g.geom_type != "Point":
            continue
        x, z = project(g.x, g.y)
        if X_MIN + 2 < x < X_MAX - 2 and Z_MIN + 2 < z < Z_MAX - 2:
            continue  # the map has its own lights
        out.append([round(float(x), 2), round(float(z), 2), int(pop)])
    return sorted(out, key=lambda t: -t[2])


def encode(elev, sdf, name):
    dm = np.clip(np.round(elev * 10 / ELEV_STEP_DM) * ELEV_STEP_DM, 0, 65535).astype(np.uint32)
    rgb = np.dstack([(dm >> 8).astype(np.uint8), (dm & 255).astype(np.uint8), sdf])
    Image.fromarray(rgb, "RGB").save(OUT / name, lossless=True, method=6)
    return (OUT / name).stat().st_size


def build():
    x0, z0, wk, hk, wp, hp = grid()
    elev = elevation()
    # Voids in the tiles read as 0 m; fill them from their surroundings.
    bad = elev < 30
    if bad.any():
        elev[bad] = ndimage.median_filter(elev, size=9)[bad]
    # Under the map itself nothing of this is drawn (bar a band at its edge): keep it flat, which
    # costs next to nothing, and smooth the rest a touch, which the relief shading doesn't miss.
    xs = x0 + (np.arange(wp) + 0.5) * wk / wp
    zs = z0 + (np.arange(hp) + 0.5) * hk / hp
    X, Z = np.meshgrid(xs, zs)
    inner = (X > X_MIN + INNER_BAND) & (X < X_MAX - INNER_BAND) & (Z > Z_MIN + INNER_BAND) & (Z < Z_MAX - INNER_BAND)
    elev = ndimage.gaussian_filter(elev, 0.6)
    elev[inner] = float(np.median(elev[inner]))
    sdf = water_sdf(wp, hp)
    sdf[inner] = 0
    size = encode(elev, sdf, "outer.webp")
    # Phones: half resolution, the distance field halving with the pixels.
    lo_e = np.asarray(Image.fromarray(elev.astype(np.float32), "F").resize(((wp + 1) // 2, (hp + 1) // 2), Image.Resampling.BOX))
    lo_s = np.asarray(Image.fromarray((sdf.astype(np.float32) - 128), "F").resize(((wp + 1) // 2, (hp + 1) // 2), Image.Resampling.BOX))
    lo_size = encode(lo_e, np.clip(np.round(128 + lo_s / 2), 0, 255).astype(np.uint8), "outer_lo.webp")
    t = towns()
    meta_path = OUT / "meta.json"
    meta = json.loads(meta_path.read_text())
    meta["outer"] = {
        "bounds": [round(x0, 4), round(z0, 4), round(wk, 4), round(hk, 4)],
        "width": wp,
        "height": hp,
        "sdfLevelsPerPx": SDF_LEVELS_PER_PX,
        "towns": t,
    }
    meta_path.write_text(json.dumps(meta, indent=1))
    print(f"  outer.webp {wp}x{hp} ({elev.min():.0f}-{elev.max():.0f} m), {size / 1e6:.2f} MB; "
          f"outer_lo.webp {lo_size / 1e6:.2f} MB; {len(t)} towns")


if __name__ == "__main__":
    build()
