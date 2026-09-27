"""QA renders of the baked assets (not shipped).

  python scripts/atlas/preview.py [out_dir]

Writes overview.png (whole region) and one close-up per company site with the
footprints the pipeline matched highlighted, to eyeball geocoding.
"""

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from building_codec import decode  # noqa: E402
from config import COMPANIES_JSON, HEIGHT_KM, OUT, WIDTH_KM, X_MAX, X_MIN, Z_MAX, Z_MIN, project  # noqa: E402

DOMAIN_COLORS = {"defense-space": "#eda100", "chips-compute": "#4a3aa7",
                 "energy-mobility": "#008300", "robotics-mfg": "#e87ba4"}


def decode_lines(lines):
    for enc in lines:
        a = np.cumsum(np.asarray(enc, dtype=float).reshape(-1, 2), axis=0) / 1000
        yield a


def base(ax, extent):
    terr = np.asarray(Image.open(OUT / "terrain.webp").convert("RGB"), dtype=float)
    elev = (terr[..., 0] * 256 + terr[..., 1]) / 10
    gy, gx = np.gradient(elev, WIDTH_KM * 1000 / elev.shape[1])
    hs = np.clip(0.75 - (gx * 2 - gy * 2) * 0.9, 0.3, 1.0)
    surf = np.asarray(Image.open(OUT / "surface.webp").convert("RGB"), dtype=float)
    water = surf[..., 0] > 128
    img = np.dstack([0.93 * hs, 0.9 * hs, 0.82 * hs])
    img = np.clip(img, 0, 1)
    full = (X_MIN, X_MAX, Z_MAX, Z_MIN)
    ax.imshow(img, extent=full, interpolation="bilinear")
    ax.imshow(np.ma.masked_where(~water, water), extent=full, cmap="Blues", vmin=0, vmax=1.4, alpha=0.9)
    vec = json.loads((OUT / "vectors.json").read_text())
    for cls, lw in [("secondary", 0.3), ("primary", 0.5), ("trunk", 0.7), ("motorway", 1.0)]:
        for a in decode_lines(vec["roads"][cls]):
            ax.plot(a[:, 0], a[:, 1], color="#b8874a", lw=lw)
    red = next(decode_lines([vec["redLine"]["line"]]))
    ax.plot(red[:, 0], red[:, 1], color="#c8102e", lw=1.2)
    ax.set_xlim(extent[0], extent[1])
    ax.set_ylim(extent[3], extent[2])
    ax.set_aspect("equal")
    return vec


def main(out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    companies = json.loads(COMPANIES_JSON.read_text())
    fig, ax = plt.subplots(figsize=(10, 10 * HEIGHT_KM / WIDTH_KM))
    base(ax, (X_MIN, X_MAX, Z_MIN, Z_MAX))
    for c in companies:
        for s in c["sites"]:
            x, z = project(s["lon"], s["lat"])
            ax.scatter([x], [z], s=18, color=DOMAIN_COLORS[c["domain"]], edgecolor="k", lw=0.4, zorder=5)
            ax.text(x + 0.4, z, s["id"], fontsize=4, zorder=6)
    fig.savefig(out_dir / "overview.png", dpi=160, bbox_inches="tight")
    plt.close(fig)

    rings = []
    for name in ("buildings.bin", "central_buildings.bin"):
        site_ids, blds = decode((OUT / name).read_bytes())
        rings += [(si, np.asarray(r[0], dtype=float) / 1000) for _, si, r in blds]
    for c in companies:
        for s in c["sites"]:
            x, z = project(s["lon"], s["lat"])
            r = max(0.6, s["radius"] * 2.2)
            fig, ax = plt.subplots(figsize=(4, 4))
            base(ax, (x - r, x + r, z - r, z + r))
            for si, pts in rings:
                if abs(pts[0, 0] - x) < r * 1.2 and abs(pts[0, 1] - z) < r * 1.2:
                    hit = si >= 0 and site_ids[si] == s["id"]
                    ax.fill(pts[:, 0], pts[:, 1], color=DOMAIN_COLORS[c["domain"]] if hit else "#777",
                            alpha=0.9 if hit else 0.35, lw=0)
            ax.scatter([x], [z], s=40, color="red", marker="x")
            ax.set_title(f"{s['id']} — {s['address']}", fontsize=6)
            fig.savefig(out_dir / f"site_{s['id']}.png", dpi=110, bbox_inches="tight")
            plt.close(fig)


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / ".cache" / "preview")
