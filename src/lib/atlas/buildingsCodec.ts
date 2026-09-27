// Decoder for the atlas's binary building format. The layout is documented with the encoder in
// scripts/atlas/building_codec.py: a header, a site table, then six varint streams.

/** Building footprints as flat typed arrays, in integer scene metres. */
export interface BuildingsData {
  /** company site ids; `site` indexes into this */
  sites: string[];
  count: number;
  /** per building: height, decimetres */
  height: Uint16Array;
  /** per building: index into `sites`, or -1 */
  site: Int16Array;
  /** per building: its first ring (outer, then holes); count + 1 entries */
  ringStart: Uint32Array;
  /** per ring: its first vertex; one more entry than there are rings */
  vertStart: Uint32Array;
  x: Int32Array;
  z: Int32Array;
}

const MAGIC = 0x444c4241; // "ABLD", little-endian
const VERSION = 1;
const HEADER_BYTES = 48;

/** Unsigned LEB128 varints (and zigzag-signed ones) from one stream of the file. */
class Stream {
  constructor(
    private readonly bytes: Uint8Array,
    private i: number,
    readonly end: number,
  ) {}

  get more(): boolean {
    return this.i < this.end;
  }

  u(): number {
    let v = 0;
    let scale = 1;
    let b: number;
    do {
      b = this.bytes[this.i++];
      v += (b & 0x7f) * scale;
      scale *= 128;
    } while (b & 0x80);
    return v;
  }

  s(): number {
    const v = this.u();
    return v % 2 ? -(v + 1) / 2 : v / 2;
  }
}

export function decodeBuildings(buf: ArrayBuffer): BuildingsData {
  const dv = new DataView(buf);
  if (buf.byteLength < HEADER_BYTES || dv.getUint32(0, true) !== MAGIC || dv.getUint8(4) !== VERSION) {
    throw new Error("buildings: not an atlas building file, or an unsupported version");
  }
  const count = dv.getUint32(8, true);
  const nRings = dv.getUint32(12, true);
  const nVerts = dv.getUint32(16, true);
  const tableBytes = dv.getUint32(20, true);
  const bytes = new Uint8Array(buf);
  let at = HEADER_BYTES;
  const sites = JSON.parse(new TextDecoder().decode(bytes.subarray(at, at + tableBytes))) as string[];
  at += tableBytes;
  const streams: Stream[] = [];
  for (let k = 0; k < 6; k++) {
    const len = dv.getUint32(24 + k * 4, true);
    streams.push(new Stream(bytes, at, at + len));
    at += len;
  }
  const [tags, heights, rings, counts, starts, deltas] = streams;

  const site = new Int16Array(count).fill(-1);
  for (let b = 0; tags.more; ) {
    b += tags.u();
    site[b] = tags.u();
  }
  const height = new Uint16Array(count);
  const ringStart = new Uint32Array(count + 1);
  const vertStart = new Uint32Array(nRings + 1);
  const x = new Int32Array(nVerts);
  const z = new Int32Array(nVerts);
  let r = 0;
  let v = 0;
  let px = 0;
  let pz = 0;
  for (let b = 0; b < count; b++) {
    height[b] = heights.u();
    ringStart[b] = r;
    for (let k = rings.u(); k > 0; k--) {
      vertStart[r++] = v;
      const n = counts.u();
      px += starts.s();
      pz += starts.s();
      let cx = px;
      let cz = pz;
      x[v] = cx;
      z[v++] = cz;
      for (let j = 1; j < n; j++) {
        cx += deltas.s();
        cz += deltas.s();
        x[v] = cx;
        z[v++] = cz;
      }
    }
  }
  ringStart[count] = r;
  vertStart[r] = v;
  if (r !== nRings || v !== nVerts) throw new Error("buildings: file is truncated or inconsistent");
  return { sites, count, height, site, ringStart, vertStart, x, z };
}
