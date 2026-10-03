"""Paint the map's "surface" raster: public/atlas/surface.webp (lossless)

  R: signed distance to water (128 = shoreline, >128 = on water), 4 levels / px
  G: parks, preserves and golf courses, and the mown grass of airfields
  B: tree and shrub cover (Hill Country woodland), 16 levels

Built-up density lives in the terrain texture's B channel (lower resolution is
fine for a glow). Both are sampled in the terrain fragment shader.
"""

import json

import numpy as np
import pyarrow.parquet as pq
import shapely
from PIL import Image, ImageDraw
from scipy import ndimage

from config import CACHE, HEIGHT_KM, OUT, WIDTH_KM, X_MIN, Z_MIN, project

SURF_W = 2048
SS = 2  # supersampling for the water mask
SDF_LEVELS_PER_PX = 4

# Rivers drawn from centerlines where OSM has no riverbank polygon.
BIG_RIVERS = {"Colorado River", "San Gabriel River", "Pedernales River"}
PARK_CLASSES = {"park", "dog_park", "nature_reserve", "golf_course", "fairway", "green", "rough",
                "tee", "recreation_ground", "cemetery", "grave_yard", "garden", "meadow"}
# Airfield bounds (Overture infrastructure, subtype "airport"), and how green their mown grass is
# painted (of a park's 255).
AIRFIELD_CLASSES = {"airport", "international_airport", "municipal_airport", "regional_airport", "military_airport"}
AIRFIELD_GRASS = 220


def size():
    return SURF_W, int(round(SURF_W * HEIGHT_KM / WIDTH_KM))


def to_px(geoms, w, h):
    """Project shapely geometries (lon/lat) into raster pixel space (float)."""
    def tf(coords):
        x, z = project(coords[:, 0], coords[:, 1])
        return np.column_stack([(x - X_MIN) / WIDTH_KM * w, (z - Z_MIN) / HEIGHT_KM * h])
    return shapely.transform(geoms, tf)


def draw_polys(draw, geom, fill):
    parts = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
    for p in parts:
        if p.is_empty:
            continue
        draw.polygon([tuple(c) for c in np.asarray(p.exterior.coords)], fill=fill)
        for hole in p.interiors:
            draw.polygon([tuple(c) for c in np.asarray(hole.coords)], fill=0)


def water_sdf(w, h):
    t = pq.read_table(CACHE / "water.parquet", columns=["geometry", "subtype", "class", "names"]).to_pylist()
    geoms = shapely.from_wkb([r["geometry"] for r in t])
    W, H = w * SS, h * SS
    geoms = to_px(geoms, W, H)
    mask = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(mask)
    px_m = WIDTH_KM * 1000 / W
    for r, g in zip(t, geoms):
        kind, cls = r["subtype"], r["class"]
        name = (r["names"] or {}).get("primary") or ""
        if g.geom_type in ("Polygon", "MultiPolygon"):
            area_m2 = g.area * px_m * px_m
            if kind in ("lake", "river"):
                keep = area_m2 > 4000
            elif cls == "reservoir":
                keep = area_m2 > 30000  # skip the thousands of stock tanks
            elif kind in ("water", "stream", "pond", "canal"):
                keep = area_m2 > 25000 and cls not in ("wastewater", "basin")
            else:
                keep = False
            if keep:
                draw_polys(d, g, 255)
        elif g.geom_type in ("LineString", "MultiLineString") and name in BIG_RIVERS:
            lines = g.geoms if g.geom_type == "MultiLineString" else [g]
            for ln in lines:
                d.line([tuple(c) for c in np.asarray(ln.coords)], fill=255, width=max(2, round(50 / px_m)))
    m = np.asarray(mask) > 127
    inside = ndimage.distance_transform_edt(m)
    outside = ndimage.distance_transform_edt(~m)
    sdf = (inside - outside) / SS  # in output pixels, + on water
    sdf = sdf.reshape(h, SS, w, SS).mean(axis=(1, 3))
    return np.clip(128 + sdf * SDF_LEVELS_PER_PX, 0, 255).astype(np.uint8)


def density(w, h):
    t = pq.read_table(CACHE / "buildings.parquet", columns=["geometry"])
    geoms = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))
    c = shapely.centroid(geoms)
    lon, lat = shapely.get_x(c), shapely.get_y(c)
    # Footprint area in m^2 from a local equal-area-ish scale.
    area = shapely.area(geoms) * (111320 * np.cos(np.radians(lat))) * 110574
    x, z = project(lon, lat)
    ix = (x - X_MIN) / WIDTH_KM * w
    iz = (z - Z_MIN) / HEIGHT_KM * h
    grid, _, _ = np.histogram2d(iz, ix, bins=[h, w], range=[[0, h], [0, w]], weights=area)
    cell_m2 = (WIDTH_KM * 1000 / w) ** 2
    cover = ndimage.gaussian_filter(grid / cell_m2, 0.8)
    v = np.clip(cover / 0.3, 0, 1) ** 0.6
    return (np.round(v * 15) * 17).astype(np.uint8)  # 16 levels is plenty for a glow


def airfield_grass(t):
    """The mown grass inside the airfields (Overture land use "grass" within their bounds): the
    infields between runways and taxiways, so an airport reads as one from afar. (The runways,
    taxiways and aprons are drawn over it: Airport.tsx and the detail tiles.)"""
    infra = pq.read_table(CACHE / "infrastructure.parquet", columns=["geometry", "subtype", "class"]).to_pylist()
    fields = [shapely.from_wkb(r["geometry"]) for r in infra
              if r["subtype"] == "airport" and r["class"] in AIRFIELD_CLASSES]
    fields = shapely.union_all([g for g in fields if g.geom_type in ("Polygon", "MultiPolygon")])
    grass = shapely.from_wkb([r["geometry"] for r in t if r["class"] == "grass"])
    grass = grass[shapely.intersects(grass, fields)]
    out = shapely.intersection(grass, fields)
    print(f"  airfield grass: {shapely.area(shapely.union_all(out)) * 111e3 * 96e3 / 1e4:,.0f} ha")
    return out


def parks(w, h):
    t = pq.read_table(CACHE / "land_use.parquet", columns=["geometry", "class"]).to_pylist()
    keep = [r for r in t if r["class"] in PARK_CLASSES]
    geoms = to_px(shapely.from_wkb([r["geometry"] for r in keep]), w, h)
    img = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(img)
    for g in to_px(airfield_grass(t), w, h):
        if g.geom_type in ("Polygon", "MultiPolygon"):
            draw_polys(d, g, AIRFIELD_GRASS)
        elif g.geom_type == "GeometryCollection":
            for p in g.geoms:
                if p.geom_type in ("Polygon", "MultiPolygon"):
                    draw_polys(d, p, AIRFIELD_GRASS)
    for g in geoms:
        if g.geom_type in ("Polygon", "MultiPolygon"):
            draw_polys(d, g, 255)
    v = ndimage.gaussian_filter(np.asarray(img, dtype=np.float32), 0.7) / 255
    return (np.round(v * 7) * (255 / 7)).astype(np.uint8)


def canopy(w, h):
    """Forest and shrub cover from Overture land_cover (ESA WorldCover-derived)."""
    t = pq.read_table(CACHE / "land_cover.parquet", columns=["geometry", "subtype"]).to_pylist()
    region = shapely.box(*unproject_box())
    ss = 2
    img = Image.new("L", (w * ss, h * ss), 0)
    d = ImageDraw.Draw(img)
    for sub, val in (("shrub", 130), ("forest", 255)):
        geoms = [shapely.from_wkb(r["geometry"]).intersection(region) for r in t if r["subtype"] == sub]
        for g in to_px(shapely.GeometryCollection([g for g in geoms if not g.is_empty]).geoms, w * ss, h * ss):
            if g.geom_type in ("Polygon", "MultiPolygon"):
                draw_polys(d, g, val)
    a = np.asarray(img, dtype=np.float32).reshape(h, ss, w, ss).mean(axis=(1, 3)) / 255
    a = ndimage.gaussian_filter(a, 0.6)
    return (np.round(np.clip(a, 0, 1) * 15) * 17).astype(np.uint8)


def unproject_box():
    from config import EAST, NORTH, SOUTH, WEST
    return WEST, SOUTH, EAST, NORTH


def build():
    w, h = size()
    rgb = np.stack([water_sdf(w, h), parks(w, h), canopy(w, h)], axis=-1)
    Image.fromarray(rgb, "RGB").save(OUT / "surface.webp", lossless=True, method=6)
    print(f"  surface.webp {w}x{h}, {(OUT / 'surface.webp').stat().st_size / 1e6:.2f} MB")
    return {"width": w, "height": h, "sdfLevelsPerPx": SDF_LEVELS_PER_PX}


if __name__ == "__main__":
    meta_path = OUT / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    meta["surface"] = build()
    meta_path.write_text(json.dumps(meta, indent=1))
