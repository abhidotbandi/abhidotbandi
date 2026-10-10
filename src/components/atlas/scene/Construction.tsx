"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SITE_BY_ID } from "@/data/atlas/companies";
import { BUILDING_EXAG, groundY, type HeightField } from "@/lib/atlas/geo";
import { runtime } from "@/lib/atlas/store";
import { box, merge } from "./figures";

// Planned facilities are shown going up rather than finished: a graded pad, a steel frame half
// raised, part of the roof on, and tower cranes turning over it.

const M = 0.001;
const V = BUILDING_EXAG;

interface Works {
  site: string;
  /** building length and width (m), and the angle of its long side from +x (radians) */
  length: number;
  width: number;
  angle: number;
  /** share of the frame up so far, 0..1 */
  progress: number;
}

// Base Power's second factory at MetCenter, aligned with the buildings around it.
const WORKS: Works[] = [{ site: "base-power-factory-2", length: 190, width: 110, angle: (43.4 * Math.PI) / 180, progress: 0.62 }];

const STEEL = new THREE.Color("#7d8894");
const DECK = new THREE.Color("#c9c6bf");
const PAD = new THREE.Color("#c8b28c");
const CRANE = new THREE.Color("#f2b705");

/** The static parts of a site, in metres around its centre (x along the building's length). */
function siteGeometry(w: Works): { steel: THREE.BufferGeometry; deck: THREE.BufferGeometry; pad: THREE.BufferGeometry } {
  const colH = 12;
  const bayL = 15;
  const bayW = 22;
  const nx = Math.round(w.length / bayL);
  const nz = Math.round(w.width / bayW);
  const built = Math.round(nx * w.progress);
  const steel: THREE.BufferGeometry[] = [];
  const deck: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= built; i++) {
    const x = -w.length / 2 + i * bayL;
    for (let j = 0; j <= nz; j++) {
      const z = -w.width / 2 + j * bayW;
      steel.push(box(0.6, colH, 0.6, x, colH / 2, z)); // column
    }
    steel.push(box(0.5, 0.9, w.width, x, colH, 0)); // girder across
  }
  for (let j = 0; j <= nz; j++) {
    const z = -w.width / 2 + j * bayW;
    steel.push(box(built * bayL, 0.7, 0.4, -w.length / 2 + (built * bayL) / 2, colH - 0.2, z)); // purlins along
  }
  // Roof deck over the first half of what's framed.
  const roofed = Math.max(1, Math.floor(built * 0.55)) * bayL;
  deck.push(box(roofed, 0.4, w.width, -w.length / 2 + roofed / 2, colH + 0.6, 0));
  // Slab poured under the rest of the footprint.
  deck.push(box(w.length, 0.3, w.width, 0, 0.15, 0));
  const pad = box(w.length + 70, 0.2, w.width + 60, 8, 0.05, 0);
  return { steel: merge(steel), deck: merge(deck), pad: merge([pad]) };
}

/** A tower crane in metres, standing at the origin: the mast, and the slewing jib as a separate part. */
function craneGeometry(): { mast: THREE.BufferGeometry; jib: THREE.BufferGeometry } {
  const h = 46;
  const mast = merge([box(2, h, 2, 0, h / 2, 0), box(6, 1.5, 6, 0, 0.75, 0)]);
  const jib = merge([
    box(52, 1.6, 1.6, 22, h + 1.5, 0), // jib
    box(16, 1.6, 1.8, -10, h + 1.5, 0), // counter-jib
    box(4, 3, 4, -14, h + 0.2, 0), // counterweight
    box(3, 2.6, 2.6, 0, h - 0.4, 0), // cab
    box(0.5, 7, 0.5, 0, h + 5.8, 0), // tower top
    box(0.15, 20, 0.15, 30, h - 9, 0), // hoist line
    box(1.2, 1.2, 1.2, 30, h - 19.5, 0), // hook block
  ]);
  return { mast, jib };
}

interface Crane {
  jib: THREE.Mesh;
  speed: number;
  phase: number;
}

function makeWorks(ground: HeightField): THREE.Group {
  const root = new THREE.Group();
  const lambert = (c: THREE.Color) => new THREE.MeshLambertMaterial({ color: c });
  const cranes: Crane[] = [];
  const { mast, jib } = craneGeometry();
  const yellow = lambert(CRANE);
  for (const w of WORKS) {
    const s = SITE_BY_ID.get(w.site);
    if (!s) continue;
    const g = new THREE.Group();
    const y = groundY(ground, s.x, s.z);
    g.position.set(s.x, y, s.z);
    // Scene +z is south, so a rotation of -angle about y turns local +x onto the building's axis.
    g.rotation.y = -w.angle;
    g.scale.set(M, M * V, M);
    const parts = siteGeometry(w);
    g.add(new THREE.Mesh(parts.pad, lambert(PAD)), new THREE.Mesh(parts.deck, lambert(DECK)), new THREE.Mesh(parts.steel, lambert(STEEL)));
    // Two cranes: one over the frame going up, one over the part still to come.
    for (const [cx, cz, speed, phase] of [
      [-w.length * 0.1, -w.width * 0.5 - 8, 0.07, 0.4],
      [w.length * 0.32, w.width * 0.5 + 8, -0.05, 2.1],
    ]) {
      const m = new THREE.Mesh(mast, yellow);
      m.position.set(cx, 0, cz);
      const j = new THREE.Mesh(jib, yellow);
      j.position.set(cx, 0, cz);
      g.add(m, j);
      cranes.push({ jib: j, speed, phase });
    }
    root.add(g);
  }
  root.userData.cranes = cranes;
  return root;
}

export default function Construction({ ground }: { ground: HeightField }) {
  const ref = useRef<THREE.Group>(null);
  const root = useMemo(() => makeWorks(ground), [ground]);
  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    g.visible = runtime.cam.dist < 45;
    if (!g.visible) return;
    const t = runtime.reducedMotion ? 0 : state.clock.elapsedTime;
    for (const c of g.userData.cranes as Crane[]) {
      // Slewing back and forth over the site rather than spinning.
      c.jib.rotation.y = c.phase + Math.sin(t * c.speed * 2 + c.phase) * 1.1;
    }
  });
  return <primitive ref={ref} object={root} />;
}
