"""Bake the company logos into one sprite for the /atlas labels and panels.

Each company's logo is in `logos/<id>.png|svg`, taken from where `LOGOS` says. It is the company's
own favicon or app icon where that is sharp enough, or else its vector mark: Simple Icons (CC0)
or the logo on the company's site, with the mark cut out of the lockup. The logos are trademarks
of their owners.

Each logo becomes a CELL px tile. An icon that has its own background ("fill") covers the tile.
Any other mark is trimmed to its ink and centred on the tile colour (white unless `bg` is
given), `pad` of the tile in from each edge. `color` recolours a one-colour mark, `crop` keeps a
box of the source (fractions of its size), and `part` keeps only the first or last piece of a
lockup, split where the ink has a gap wider than `gap` of its height.

The tiles go into public/atlas/logos.webp row by row in companies.json order, and
src/data/atlas/logos.json gives the grid. The page rounds the corners.

    python scripts/atlas/build_logos.py
"""

import io
import json
import math
import os

import cairosvg
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
SRC = os.path.join(HERE, "logos")
CELL = 64
COLS = 9

SI = "https://cdn.jsdelivr.net/npm/simple-icons@16.34.0/icons/"
GS = "https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=256&url="

LOGOS = {
    # Defense & Space
    "saronic": dict(src="https://www.saronic.com/icon.png", fill=True),
    "firefly": dict(src="https://fireflyspace.com/wp-content/uploads/2022/01/cropped-Firefly-Aerospace-Icon-Pantone-389-192x192.png", bg="#111111", pad=0.14),
    "cesiumastro": dict(src="https://www.cesiumastro.com (the C of the header's inline SVG wordmark)", part="first", bg="#000000", pad=0.2),
    "allen-control-systems": dict(src="https://cdn.prod.website-files.com/671a2be71d74ef267e25631c/674639b127f2a47434e4eeb9_Webclip.jpg", pad=0.1),
    "aeon-industrial": dict(src="https://www.aeonindustrial.com/apple-touch-icon.png", fill=True),
    "perseus-defense": dict(src="https://framerusercontent.com/images/B57kKwUweKdCUTry6zxAWrpBWU.png", fill=True),
    "bae-systems": dict(src=GS + "https://www.baesystems.com", fill=True),
    "spacex": dict(src="https://www.spacex.com/assets/favicon-spacex.ico", fill=True),
    "skyways": dict(src=GS + "https://www.skyways.com", fill=True),
    "nanohmics": dict(src="https://images.squarespace-cdn.com/content/v1/59cda4ecf5e231e7a156e203/1507509979231-2TFY8UTQFQ3D31UL9FEB/favicon.ico", pad=0.04),
    "t2com": dict(src=GS + "https://www.army.mil", fill=True),
    "army-software-factory": dict(src=GS + "https://www.army.mil", fill=True),
    "army-applications-lab": dict(src="https://aal.mil/assets/img/icons/apple-touch-icon-144x144.png", fill=True),
    "arl-ut": dict(src="https://www.arlut.utexas.edu/android-icon-192x192.png", pad=0.06),
    "ut-csr": dict(src="https://csr.utexas.edu/wp-content/uploads/2024/07/Cockrell_KO_formal_SpaceResearch.svg", part="first", color="#bf5700", pad=0.1),
    # Chips & Compute
    "samsung": dict(src="https://semiconductor.samsung.com/etc.clientlibs/semiconductor/designs/global/common/resources/img/icon/Favicon.png", fill=True),
    "nxp": dict(src=GS + "https://www.nxp.com", fill=True),
    "applied-materials": dict(src=GS + "https://www.appliedmaterials.com", pad=0.04),
    "amd": dict(src=SI + "amd.svg", part="last", pad=0.16),
    "skywater": dict(src="https://www.skywatertechnology.com/wp-content/uploads/2022/02/cropped-Group-374-1-192x192.png", pad=0.06),
    "silicon-labs": dict(src=GS + "https://www.silabs.com", crop=(0, 0, 1, 0.58), pad=0.1),
    "cirrus-logic": dict(src="https://www.cirrus.com/images/cirrus-logic-white-b2ff6e75ea.svg", part="first", gap=0.03, color="#0033ab", pad=0.1),
    "ambiq": dict(src="https://ambiq.com/wp-content/uploads/2025/05/cropped-favicon.png", pad=0.04),
    "mythic": dict(src="https://images.squarespace-cdn.com/content/v1/6a4af3e56b8574535c41cb4f/c3b7dc9f-3fca-4135-a56b-e00c8d0183cf/favicon.ico", fill=True),
    "neurophos": dict(src="https://www.neurophos.com/assets/neurophos-logo-light.svg", part="first", bg="#1c2130", pad=0.2),
    "canon-nanotechnologies": dict(src="https://global.canon/apple-touch-icon.png", pad=0.04),
    "ideal-power": dict(src="https://idealpower.com/wp-content/uploads/2025/12/cropped-faviconV2-192x192.png", pad=0.06),
    "ni": dict(src="https://www.ni.com/apple-touch-icon.png", pad=0.12),
    "tie": dict(src="https://www.txie.org/wp-content/uploads/2023/11/tie-logo.svg", part="first", gap=0.15, pad=0.1),
    "tacc": dict(src="https://tacc.utexas.edu/static/site_cms/img/favicons/favicon.3cdc89ea1a50.ico", fill=True),
    "nvidia": dict(src=SI + "nvidia.svg", color="#76b900", pad=0.1),
    "intel": dict(src=SI + "intel.svg", color="#0071c5", pad=0.1),
    "qualcomm": dict(src=SI + "qualcomm.svg", color="#3253dc", pad=0.14),
    "broadcom": dict(src="https://www.broadcom.com/favicon-96x96.png", pad=0.04),
    # Energy & Mobility
    "tesla": dict(src=GS + "https://www.tesla.com", pad=0.1),
    "base-power": dict(src="https://www.basepowercompany.com/_bpc/assets/apple-touch-icon.png", fill=True),
    "aalo": dict(src="https://cdn.prod.website-files.com/6a041fc89fb1bebfac0d93d2/6a43a69a153a7946b8aa345a_favicon-light-mode.png", pad=0.1),
    "last-energy": dict(src="https://cdn.prod.website-files.com/637baf1c933a04670d122e32/637e3f917b1078cb43a50229_Favbig.png", pad=0.1),
    "hyliion": dict(src="https://www.hyliion.com/wp-content/themes/bigdrop-theme/dist/images/favicon/apple-icon.png", pad=0.06),
    "infinitum": dict(src="https://goinfinitum.com/wp-content/uploads/2024/07/cropped-20x20-Infinitum-Favicon-192x192.webp", pad=0.04),
    "energyx": dict(src=GS + "https://energyx.com", fill=True),
    # Robotics & Manufacturing
    "apptronik": dict(src="https://cdn.prod.website-files.com/6a0dd86942776facbc2f6ba4/6a0dd86942776facbc2f6e8f_apptronik-webclip.png", pad=0.06),
    "icon": dict(src="https://cdn.prod.website-files.com/696aa403bbe74c1adbd1ed11/6980559ff7cfeb7efbb0d078_icon-webclip.png", pad=0.1),
    "boring-company": dict(src=SI + "theboringcompany.svg", pad=0.08),
    "diligent-robotics": dict(src="https://images.squarespace-cdn.com/content/v1/606f1bb0f7e05e3329035ff8/a4e4d3b6-4adb-494d-97d2-6473c97e2114/favicon.ico", pad=0.06),
    "fox-robotics": dict(src="https://foxrobotics.com/hubfs/FoxRobotics_logo.svg", part="first", pad=0.08),
    # Big Tech
    "apple": dict(src=SI + "apple.svg", pad=0.14),
    "google": dict(src=GS + "https://www.google.com", pad=0.1),
    "meta": dict(src=GS + "https://www.meta.com", pad=0.1),
    "amazon": dict(src="https://www.amazon.com/favicon.ico", fill=True),
    "oracle": dict(src="https://www.oracle.com/asset/web/favicons/favicon-192.png", pad=0.08),
    "ibm": dict(src="https://cdn.jsdelivr.net/npm/simple-icons@12/icons/ibm.svg", color="#0f62fe", pad=0.1),
    "dell": dict(src="https://www.dell.com/apple-touch-icon.png", fill=True),
    "indeed": dict(src=GS + "https://www.indeed.com", pad=0.1),
    "cisco": dict(src=SI + "cisco.svg", color="#1ba0d7", pad=0.1),
    "salesforce": dict(src="https://commons.wikimedia.org/wiki/Special:FilePath/Salesforce.com_logo.svg", pad=0.06),
    "atlassian": dict(src=SI + "atlassian.svg", color="#0052cc", pad=0.14),
    "tiktok": dict(src="https://www.tiktok.com/apple-touch-icon.png", fill=True),
    "expedia": dict(src="https://www.expediagroup.com/favicon.ico", pad=0.1),
    "electronic-arts": dict(src=SI + "ea.svg", color="#ffffff", bg="#000000", pad=0.16),
    "microsoft": dict(src="https://www.microsoft.com/favicon.ico", pad=0.12),
    # Finance & Trading
    "citadel-securities": dict(src=GS + "https://www.citadelsecurities.com", pad=0.08),
    "hudson-river-trading": dict(src="https://www.hudsonrivertrading.com/wp-content/uploads/2023/11/cropped-HRT-Avatar-Profile-Photo-Favicon-192x192.png", fill=True),
    "optiver": dict(src="https://www.optiver.com/favicon/favicon.png", pad=0.1),
    "goldman-sachs": dict(src="https://cdn.gs.com/images/goldman-sachs/v2/gs-favicon.ico", pad=0.12),
    "jpmorgan": dict(src=GS + "https://www.jpmorganchase.com", fill=True),
    "schwab": dict(src="https://www.schwab.com/themes/custom/sch_beacon_retail/favicons/apple-icon.png", fill=True),
    "dimensional": dict(src="https://www.dimensional.com/static/media/favicon.ico", pad=0.08),
    "wise": dict(src="https://wise.com/public-resources/assets/icons/wise-personal/android_chrome_256x256.png", fill=True),
    "paypal": dict(src="https://www.paypalobjects.com/marketing/web/icons/monogram/pp258.png", pad=0.08),
    "visa": dict(src=SI + "visa.svg", color="#1a1f71", pad=0.1),
}


def load(cid: str) -> Image.Image:
    svg = os.path.join(SRC, f"{cid}.svg")
    if os.path.exists(svg):
        return Image.open(io.BytesIO(cairosvg.svg2png(url=svg, output_height=512))).convert("RGBA")
    return Image.open(os.path.join(SRC, f"{cid}.png")).convert("RGBA")


def hexrgb(h: str) -> tuple[int, int, int]:
    return tuple(int(h[i : i + 2], 16) for i in (1, 3, 5))


def ink(a: np.ndarray) -> np.ndarray:
    """Pixels that are part of the mark: opaque, and unlike an opaque corner (a JPEG's white)."""
    mask = a[..., 3] > 24
    corner = a[0, 0]
    if corner[3] > 200:
        mask &= np.abs(a[..., :3].astype(int) - corner[:3].astype(int)).sum(-1) > 40
    return mask


def runs(on: np.ndarray, bridge: int) -> list[tuple[int, int]]:
    """[start, end) spans of True, joining spans whose gap is at most `bridge`."""
    out: list[list[int]] = []
    for i in np.flatnonzero(on):
        if out and i - out[-1][1] <= bridge:
            out[-1][1] = i + 1
        else:
            out.append([i, i + 1])
    return [(s, e) for s, e in out]


def trim(im: Image.Image, part: str | None, gap: float, crop: tuple | None) -> Image.Image:
    if crop:
        im = im.crop(tuple(round(f * im.size[i % 2]) for i, f in enumerate(crop)))
    a = np.asarray(im)
    m = ink(a)
    ys, xs = np.flatnonzero(m.any(1)), np.flatnonzero(m.any(0))
    y0, y1, x0, x1 = ys[0], ys[-1] + 1, xs[0], xs[-1] + 1
    if part in ("first", "last"):
        spans = runs(m[y0:y1].any(0), int(gap * (y1 - y0)))
        x0, x1 = spans[0] if part == "first" else spans[-1]
        rows = np.flatnonzero(m[:, x0:x1].any(1))
        y0, y1 = rows[0], rows[-1] + 1
    return im.crop((int(x0), int(y0), int(x1), int(y1)))


def edge_colour(im: Image.Image) -> tuple[int, int, int]:
    """An icon's own background: the median of the opaque pixels around the middle of its edges."""
    a = np.asarray(im)
    h, w = a.shape[:2]
    k = max(1, round(min(w, h) * 0.04))
    band = np.concatenate(
        [
            a[k, w // 4 : 3 * w // 4],
            a[h - 1 - k, w // 4 : 3 * w // 4],
            a[h // 4 : 3 * h // 4, k],
            a[h // 4 : 3 * h // 4, w - 1 - k],
        ]
    )
    band = band[band[:, 3] > 200]
    return tuple(int(v) for v in np.median(band[:, :3], axis=0))


def tile(cid: str, spec: dict) -> Image.Image:
    im = load(cid)
    if spec.get("fill"):
        a = np.asarray(im)
        ys, xs = np.flatnonzero((a[..., 3] > 24).any(1)), np.flatnonzero((a[..., 3] > 24).any(0))
        im = im.crop((xs[0], ys[0], xs[-1] + 1, ys[-1] + 1))
        out = Image.new("RGBA", (CELL, CELL), edge_colour(im) + (255,))
        s = CELL / min(im.size)
        im = im.resize((max(CELL, round(im.width * s)), max(CELL, round(im.height * s))), Image.LANCZOS)
        out.alpha_composite(im, ((CELL - im.width) // 2, (CELL - im.height) // 2))
        return out
    mark = trim(im, spec.get("part"), spec.get("gap", 0.08), spec.get("crop"))
    if "color" in spec:
        solid = Image.new("RGBA", mark.size, hexrgb(spec["color"]) + (255,))
        solid.putalpha(mark.getchannel("A"))
        mark = solid
    box = CELL * (1 - 2 * spec.get("pad", 0.12))
    s = box / max(mark.size)
    mark = mark.resize((max(1, round(mark.width * s)), max(1, round(mark.height * s))), Image.LANCZOS)
    out = Image.new("RGBA", (CELL, CELL), hexrgb(spec.get("bg", "#ffffff")) + (255,))
    out.alpha_composite(mark, ((CELL - mark.width) // 2, (CELL - mark.height) // 2))
    return out


def main() -> None:
    companies = json.load(open(os.path.join(ROOT, "src/data/atlas/companies.json")))
    ids = [c["id"] for c in companies]
    missing = [i for i in ids if i not in LOGOS]
    if missing:
        raise SystemExit(f"no logo for {missing}")
    rows = math.ceil(len(ids) / COLS)
    sheet = Image.new("RGB", (COLS * CELL, rows * CELL), "white")
    for i, cid in enumerate(ids):
        sheet.paste(tile(cid, LOGOS[cid]).convert("RGB"), ((i % COLS) * CELL, (i // COLS) * CELL))
    out = os.path.join(ROOT, "public/atlas/logos.webp")
    sheet.save(out, quality=92, method=6)
    with open(os.path.join(ROOT, "src/data/atlas/logos.json"), "w") as f:
        json.dump({"cols": COLS, "rows": rows, "ids": ids}, f)
        f.write("\n")
    print(f"{len(ids)} logos -> {out} ({os.path.getsize(out) // 1024} KB)")


if __name__ == "__main__":
    main()
