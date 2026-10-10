"""The atlas's binary building format (.bin), shared by build_buildings.py and preview.py.

Footprints are integer metres in scene space. The file is small on its own and compresses well
(Vercel serves it with brotli), because buildings are ordered along a Hilbert curve, so
neighbours sit together, and every number is a small varint in a stream of its kind:

  offset  size  (little-endian)
  0       4     magic b"ABLD"
  4       1     version (1)
  5       3     reserved (0)
  8       4     building count
  12      4     ring count
  16      4     vertex count
  20      4     site table length in bytes (UTF-8 JSON array of company site ids)
  24      24    byte lengths of the six streams below, u32 each
  48      ...   site table, then the streams in order:

  tags     for each building on a company site, in order: its index minus the previous tagged
           building's index, then its index into the site table
  heights  per building: height in decimetres
  rings    per building: ring count (the outer ring, then any holes)
  counts   per ring: vertex count (rings close implicitly; no repeated last vertex)
  starts   per ring: zigzag(first vertex - previous ring's first vertex), x then z
  deltas   per ring, for its remaining vertices: zigzag(vertex - previous vertex), x then z

All stream values are unsigned LEB128 varints; zigzag maps signed values to unsigned
(0, -1, 1, -2, ... -> 0, 1, 2, 3, ...). The client decoder is src/lib/atlas/buildingsCodec.ts.
"""

import json
import struct

MAGIC = b"ABLD"
VERSION = 1
STREAMS = ("tags", "heights", "rings", "counts", "starts", "deltas")
HEADER = struct.Struct("<4sB3xIIII6I")


def _varint(out, v):
    while v >= 0x80:
        out.append((v & 0x7F) | 0x80)
        v >>= 7
    out.append(v)


def _zigzag(out, v):
    _varint(out, -2 * v - 1 if v < 0 else 2 * v)


def _hilbert(x, z, order=16):
    """Distance along a Hilbert curve over a 2^order grid (x, z non-negative)."""
    d = 0
    s = 1 << (order - 1)
    while s:
        rx = 1 if x & s else 0
        rz = 1 if z & s else 0
        d += s * s * ((3 * rx) ^ rz)
        if rz == 0:
            if rx == 1:
                x, z = s - 1 - x, s - 1 - z
            x, z = z, x
        s >>= 1
    return d


def encode(sites, buildings):
    """sites: [site id]; buildings: [(height_dm, site index or -1, [ring, ...])], where a ring is a
    list of (x, z) integer metres, outer ring first. Returns the file's bytes."""
    if buildings:
        x0 = min(r[0][0][0] for _, _, r in buildings)
        z0 = min(r[0][0][1] for _, _, r in buildings)
        # 4 m cells, so the curve's 2^16 grid spans ~260 km.
        buildings = sorted(buildings, key=lambda b: _hilbert((b[2][0][0][0] - x0) // 4, (b[2][0][0][1] - z0) // 4))
    s = {k: bytearray() for k in STREAMS}
    n_rings = n_verts = 0
    last_tag = 0
    px = pz = 0
    for i, (h, site, rings) in enumerate(buildings):
        if site >= 0:
            _varint(s["tags"], i - last_tag)
            _varint(s["tags"], site)
            last_tag = i
        _varint(s["heights"], h)
        _varint(s["rings"], len(rings))
        for ring in rings:
            n_rings += 1
            n_verts += len(ring)
            _varint(s["counts"], len(ring))
            x, z = ring[0]
            _zigzag(s["starts"], x - px)
            _zigzag(s["starts"], z - pz)
            px, pz = x, z
            for nx, nz in ring[1:]:
                _zigzag(s["deltas"], nx - x)
                _zigzag(s["deltas"], nz - z)
                x, z = nx, nz
    table = json.dumps(sites, separators=(",", ":")).encode()
    head = HEADER.pack(MAGIC, VERSION, len(buildings), n_rings, n_verts, len(table), *(len(s[k]) for k in STREAMS))
    return head + table + b"".join(bytes(s[k]) for k in STREAMS)


class _Reader:
    def __init__(self, data):
        self.data = data
        self.i = 0

    def varint(self):
        v = shift = 0
        while True:
            b = self.data[self.i]
            self.i += 1
            v |= (b & 0x7F) << shift
            if b < 0x80:
                return v
            shift += 7

    def zigzag(self):
        v = self.varint()
        return -(v >> 1) - 1 if v & 1 else v >> 1


def decode(data):
    """Inverse of encode: (sites, [(height_dm, site index or -1, [ring, ...])]) in file order."""
    magic, version, n_b, _, _, table_len, *lens = HEADER.unpack_from(data)
    if magic != MAGIC or version != VERSION:
        raise ValueError(f"not an atlas building file (magic {magic!r}, version {version})")
    at = HEADER.size
    sites = json.loads(data[at : at + table_len])
    at += table_len
    r = {}
    for k, n in zip(STREAMS, lens):
        r[k] = _Reader(data[at : at + n])
        at += n
    site_of = {}
    i = 0
    while r["tags"].i < len(r["tags"].data):
        i += r["tags"].varint()
        site_of[i] = r["tags"].varint()
    out = []
    px = pz = 0
    for b in range(n_b):
        h = r["heights"].varint()
        rings = []
        for _ in range(r["rings"].varint()):
            n = r["counts"].varint()
            px += r["starts"].zigzag()
            pz += r["starts"].zigzag()
            x, z = px, pz
            ring = [(x, z)]
            for _ in range(n - 1):
                x += r["deltas"].zigzag()
                z += r["deltas"].zigzag()
                ring.append((x, z))
            rings.append(ring)
        out.append((h, site_of.get(b, -1), rings))
    return sites, out


if __name__ == "__main__":
    # Round trip on random footprints, including negative coordinates, holes and tags.
    import random

    rnd = random.Random(1)
    blds = []
    for _ in range(2000):
        x, z = rnd.randint(-40000, 40000), rnd.randint(-40000, 40000)
        rings = []
        for _ in range(1 + (rnd.random() < 0.1)):
            ring = [(x + rnd.randint(-300, 300), z + rnd.randint(-300, 300)) for _ in range(rnd.randint(3, 40))]
            rings.append(ring)
        blds.append((rnd.randint(30, 3500), rnd.choice([-1] * 20 + [0, 3, 46]), rings))
    sites, back = decode(encode(["a", "b", "c", "d"] + [f"s{i}" for i in range(43)], blds))
    assert sorted(back) == sorted(blds), "round trip failed"
    print(f"round trip ok: {len(blds)} buildings")
