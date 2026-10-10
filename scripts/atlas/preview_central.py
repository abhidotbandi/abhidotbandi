"""QA renders of the central detail patch: surface channels with vectors on top.

  python scripts/atlas/preview_central.py [out_dir]

Writes central_overview.png plus close-ups of the river downtown, Zilker/Barton Springs
and Rainey Street, so geometry can be checked against the real city.
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from config import C_HEIGHT_KM, C_WIDTH_KM, CX_MIN, CZ_MIN, OUT, project

SDF_K = 7.33


def decode(e):
    a = np.asarray(e, dtype=np.float64).reshape(-1, 2)
    return np.cumsum(a, axis=0)


def base_image():
    s = np.asarray(Image.open(OUT / "central_surface.webp").convert("RGB")).astype(np.float32)
    v = s[..., 0] - 128
    sd = np.sign(v) * (np.abs(v) / SDF_K) ** 2
    park, canopy = s[..., 1] / 255, s[..., 2] / 255
    img = np.full(s.shape, 236.0)
    img = img * (1 - park[..., None] * 0.35) + np.array([188, 214, 160]) * park[..., None] * 0.35
    img = img * (1 - canopy[..., None] * 0.7) + np.array([96, 132, 80]) * canopy[..., None] * 0.7
    water = np.clip(sd / 2 + 0.5, 0, 1)[..., None]
    deep = np.clip(sd / 120, 0, 1)[..., None]
    wcol = np.array([150, 196, 204]) * (1 - deep) + np.array([92, 150, 178]) * deep
    img = img * (1 - water) + wcol * water
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def main():
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    img = base_image().convert("RGBA")
    W, H = img.size
    px_per_m = W / (C_WIDTH_KM * 1000)

    def to_px(pts):
        return [((x / 1000 - CX_MIN) * 1000 * px_per_m, (z / 1000 - CZ_MIN) * 1000 * px_per_m) for x, z in pts]

    data = json.loads((OUT / "central.json").read_text())
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    for cls, lines in data["paths"].items():
        for e in lines:
            d.line(to_px(decode(e)), fill=(120, 110, 95, 150), width=1)
    colors = {0: (214, 90, 40, 255), 1: (150, 60, 200, 255), 2: (30, 30, 30, 255)}
    for a, b, kind, e in data["trails"]["edges"]:
        d.line(to_px(decode(e)), fill=colors[kind], width=4)
    for n in data["trails"]["nodes"]:
        (x, y), = to_px([n])
        d.ellipse([x - 3, y - 3, x + 3, y + 3], outline=(0, 0, 0, 255))
    for b in data["bridges"]:
        d.line(to_px(decode(b["line"])), fill=(220, 30, 60, 255), width=5)
    for e in data["piers"]["polys"]:
        d.polygon(to_px(decode(e)), fill=(160, 110, 60, 255))
    for e in data["piers"]["lines"]:
        d.line(to_px(decode(e)), fill=(160, 110, 60, 255), width=3)
    for e in data["train"]:
        d.line(to_px(decode(e)), fill=(20, 120, 20, 255), width=3)
    for key, r in data["rivers"].items():
        pts = to_px(decode(r["line"]))
        d.line(pts, fill=(0, 60, 200, 255), width=2)
        for (x, y), hw in list(zip(pts, r["half"]))[::6]:
            rr = hw * px_per_m
            d.ellipse([x - rr, y - rr, x + rr, y + rr], outline=(0, 60, 200, 90))
    for key, lines in data["streets"].items():
        for e in lines:
            d.line(to_px(decode(e)), fill=(255, 170, 0, 255), width=4)
    for x, z in data["moonlight"]:
        (px, py), = to_px([[x, z]])
        d.ellipse([px - 6, py - 6, px + 6, py + 6], fill=(40, 40, 160, 255))
    for dk in data["docks"]:
        (px, py), = to_px([[dk["x"], dk["z"]]])
        d.rectangle([px - 6, py - 6, px + 6, py + 6], fill=(255, 0, 180, 255))
        d.text((px + 8, py - 6), dk["name"], fill=(0, 0, 0, 255))
    for e in data["pools"] + data["lawns"]:
        d.line(to_px(decode(e)) + to_px(decode(e))[:1], fill=(0, 200, 255, 255), width=2)
    for key, lm in data["landmarks"].items():
        pts = to_px(decode(lm["outline"]))
        d.polygon(pts, outline=(200, 0, 0, 255))
        d.text(pts[0], key, fill=(200, 0, 0, 255))
    trees = np.fromfile(OUT / "central_trees.bin", dtype=[("x", "<u2"), ("z", "<u2"), ("r", "u1"), ("v", "u1")])
    for t in trees[::3]:
        x, y = t["x"] / 4 * px_per_m, t["z"] / 4 * px_per_m
        c = (40, 90, 60, 160) if t["v"] & 128 else (60, 120, 40, 160)
        d.point((x, y), fill=c)
    img = Image.alpha_composite(img, ov).convert("RGB")
    img.resize((W // 2, H // 2), Image.LANCZOS).save(out_dir / "central_overview.png")

    def crop(name, lon0, lat0, lon1, lat1):
        x0, z0 = project(lon0, lat1)
        x1, z1 = project(lon1, lat0)
        box = [int((x0 - CX_MIN) * 1000 * px_per_m), int((z0 - CZ_MIN) * 1000 * px_per_m),
               int((x1 - CX_MIN) * 1000 * px_per_m), int((z1 - CZ_MIN) * 1000 * px_per_m)]
        c = img.crop(box)
        c.resize((c.width * 2, c.height * 2), Image.NEAREST).save(out_dir / f"central_{name}.png")

    crop("river", -97.7640, 30.2560, -97.7380, 30.2700)
    crop("zilker", -97.7780, 30.2600, -97.7620, 30.2720)
    crop("rainey", -97.7440, 30.2540, -97.7330, 30.2640)
    print("wrote", out_dir)


if __name__ == "__main__":
    main()
