"""Stitch Terrarium tiles into a heightmap on the scene's projected grid.

Output: public/atlas/terrain.webp (lossless). R = high byte, G = low byte of
elevation in decimetres; B = built-up density (see build_surface.density).
Metadata goes to public/atlas/meta.json.
"""

import json
import math

import numpy as np
from PIL import Image
from scipy import ndimage

from config import CACHE, HEIGHT_KM, OUT, WIDTH_KM, X_MIN, Z_MIN, unproject
from build_surface import density
from fetch import TERRAIN_ZOOM, tile_range

TERRAIN_W = 1024  # ~75 m per pixel across the region


def mosaic():
    x0, x1, y0, y1 = tile_range(TERRAIN_ZOOM)
    img = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256), dtype=np.float32)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            rgb = np.asarray(Image.open(CACHE / f"terrain_z{TERRAIN_ZOOM}" / f"{x}_{y}.png").convert("RGB"), dtype=np.float32)
            h = rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768
            img[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = h
    return img, x0 * 256, y0 * 256


def build():
    img, px0, py0 = mosaic()
    w = TERRAIN_W
    h = int(round(w * HEIGHT_KM / WIDTH_KM))
    # Pixel centres of the output grid in scene km, then lon/lat, then global mercator pixels.
    xs = X_MIN + (np.arange(w) + 0.5) * WIDTH_KM / w
    zs = Z_MIN + (np.arange(h) + 0.5) * HEIGHT_KM / h
    X, Z = np.meshgrid(xs, zs)
    lon, lat = unproject(X, Z)
    n = 256 * 2**TERRAIN_ZOOM
    mx = (lon + 180) / 360 * n - px0
    lr = np.radians(lat)
    my = (1 - np.log(np.tan(lr) + 1 / np.cos(lr)) / math.pi) / 2 * n - py0
    # Pre-blur by roughly the downsampling factor so we don't alias ~30 m DEM noise.
    src_px_km = 40075.0 * math.cos(math.radians(30.47)) / n
    sigma = 0.45 * (WIDTH_KM / w) / src_px_km
    smooth = ndimage.gaussian_filter(img, sigma)
    elev = ndimage.map_coordinates(smooth, [my, mx], order=1, mode="nearest")
    elev = np.clip(elev, 0, 6000)

    dm = np.round(elev * 10).astype(np.uint16)
    rgb = np.zeros((h, w, 3), dtype=np.uint8)
    rgb[..., 0] = dm >> 8
    rgb[..., 1] = dm & 0xFF
    rgb[..., 2] = density(w, h)
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb, "RGB").save(OUT / "terrain.webp", lossless=True, method=6)
    np.save(CACHE / "elevation.npy", elev.astype(np.float32))
    print(f"  terrain.webp {w}x{h}, {elev.min():.0f}–{elev.max():.0f} m, "
          f"{(OUT / 'terrain.webp').stat().st_size / 1e6:.2f} MB")
    return {"width": w, "height": h, "min": float(elev.min()), "max": float(elev.max())}


if __name__ == "__main__":
    meta_path = OUT / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    meta["terrain"] = build()
    meta_path.write_text(json.dumps(meta, indent=1))
