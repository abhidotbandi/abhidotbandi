"""Half-resolution copies of the four map rasters, for phones and other low-power devices.

  terrain_lo.webp          from terrain.webp          (~150 m/px)
  surface_lo.webp          from surface.webp          (~75 m/px)
  central_terrain_lo.webp  from central_terrain.webp  (~16 m/px)
  central_surface_lo.webp  from central_surface.webp  (~8 m/px)

Phones already draw coarser terrain meshes (about 240 m cells regionally and 28 m in central
Austin), so these cost about a third of the bytes and lose little; the hillshading softens when
zoomed into the hill country, since its normals come from the raster. Channels that only
tint the map keep fewer levels (8 or 16), and the regional elevation 0.5 m steps (its texels are
~150 m apart); central Austin keeps full elevation precision, since at 16 m texels coarser steps
would terrace gentle slopes in the lighting.

The channels can't be resized as a picture: elevation is split across two bytes and the water
distance fields are nonlinear. Each channel is decoded to its real values, box-filtered over the
same geographic extent (so texel centres still line up with the region's edges), and re-encoded:
  terrain         R/G = elevation (decimetres, 16-bit), B = built-up density or tree canopy
  surface         R = water signed distance in output pixels x sdfLevelsPerPx (so it halves
                  with the pixel size), G = parkland, B = tree canopy
  central_surface R = water signed distance in metres, sqrt-encoded with sdfK, G = parkland,
                  B = built-up density
"""

import json

import numpy as np
from PIL import Image

from config import OUT


def load(name):
    return np.asarray(Image.open(OUT / name).convert("RGB"), dtype=np.float64)


def half(a):
    """Box-filter a float channel to half size (rounded up), over the same extent."""
    h, w = a.shape
    img = Image.fromarray(a.astype(np.float32), "F")
    return np.asarray(img.resize(((w + 1) // 2, (h + 1) // 2), Image.Resampling.BOX), dtype=np.float64)


def u8(a, step=1):
    """To bytes, optionally in `step`-sized levels."""
    return np.clip(np.round(a / step) * step, 0, 255).astype(np.uint8)


def save(name, r, g, b):
    Image.fromarray(np.dstack([r, g, b]), "RGB").save(OUT / name, lossless=True, method=6)
    src = (OUT / name.replace("_lo", "")).stat().st_size
    dst = (OUT / name).stat().st_size
    print(f"  {name} {r.shape[1]}x{r.shape[0]}, {dst / 1e6:.2f} MB ({dst / src:.0%} of the full raster)")


def terrain(name, elev_step_dm):
    a = load(name)
    dm = half(a[..., 0] * 256 + a[..., 1])
    dm = np.clip(np.round(dm / elev_step_dm) * elev_step_dm, 0, 65535).astype(np.int64)
    save(name.replace(".webp", "_lo.webp"), (dm >> 8).astype(np.uint8), (dm & 255).astype(np.uint8), u8(half(a[..., 2]), 16))


def build():
    meta = json.loads((OUT / "meta.json").read_text())

    terrain("terrain.webp", 5)
    terrain("central_terrain.webp", 1)

    # Regional surface: the distance field is in pixels, so it halves along with them.
    a = load("surface.webp")
    sdf = half(a[..., 0] - 128) / 2
    save("surface_lo.webp", u8(128 + sdf), u8(half(a[..., 1]), 32), u8(half(a[..., 2]), 32))

    # Central surface: the distance field is in metres, sqrt-encoded.
    k = meta["central"]["surface"]["sdfK"]
    a = load("central_surface.webp")
    e = a[..., 0] - 128
    m = half(np.sign(e) * (np.abs(e) / k) ** 2)
    save("central_surface_lo.webp", u8(128 + np.sign(m) * k * np.sqrt(np.abs(m))), u8(half(a[..., 1]), 32), u8(half(a[..., 2]), 32))


if __name__ == "__main__":
    build()
