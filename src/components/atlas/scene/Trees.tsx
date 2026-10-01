"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Trees as TreeData } from "@/lib/atlas/central";
import { CX_MIN, CZ_MIN, C_HEIGHT_KM, C_WIDTH_KM, groundY, type HeightField } from "@/lib/atlas/geo";
import { runtime } from "@/lib/atlas/store";

// Central Austin's trees as low-poly instances: live oaks, cedar elms and pecans as rounded
// crowns, bald cypress along the river and Ashe juniper in the western hills as cones. Only
// the trees around the camera are drawn; the terrain's canopy tint carries the rest. Trees well
// away from the camera, a few pixels across, are drawn with a fifth of the triangles.

const CELL = 0.25; // km
export const TREE_EXAG = 1.3; // matches the buildings' gentle vertical boost

interface Grid {
  nx: number;
  nz: number;
  start: Int32Array; // per cell, into order[]
  order: Int32Array; // tree indices sorted by cell
}

function buildGrid(t: TreeData): Grid {
  const nx = Math.ceil(C_WIDTH_KM / CELL);
  const nz = Math.ceil(C_HEIGHT_KM / CELL);
  const cellOf = new Int32Array(t.count);
  const counts = new Int32Array(nx * nz + 1);
  for (let i = 0; i < t.count; i++) {
    const cx = Math.min(nx - 1, Math.max(0, Math.floor((t.x[i] - CX_MIN) / CELL)));
    const cz = Math.min(nz - 1, Math.max(0, Math.floor((t.z[i] - CZ_MIN) / CELL)));
    cellOf[i] = cz * nx + cx;
    counts[cellOf[i] + 1]++;
  }
  for (let c = 1; c <= nx * nz; c++) counts[c] += counts[c - 1];
  const start = counts.slice();
  const fill = counts.slice(0, nx * nz);
  const order = new Int32Array(t.count);
  for (let i = 0; i < t.count; i++) order[fill[cellOf[i]]++] = i;
  return { nx, nz, start, order };
}

/** Beyond this from the camera (km) a tree is a few pixels across: drawn low-poly, no trunk. */
const LOD_KM = 1.6;

export function crownGeometry(conical: boolean, far = false): THREE.BufferGeometry {
  // Unit tree standing at the origin; crown colour comes from the instance, the trunk is a
  // darker vertex colour multiplied by it.
  const crown = conical ? new THREE.ConeGeometry(1, 3.2, far ? 5 : 7, 1) : new THREE.IcosahedronGeometry(1, far ? 0 : 1);
  if (conical) crown.translate(0, 1.6 + 0.5, 0);
  else {
    crown.scale(1, 0.82, 1);
    crown.translate(0, 1.35, 0);
  }
  const trunk = new THREE.CylinderGeometry(0.1, 0.14, conical ? 0.8 : 0.9, 5, 1);
  trunk.translate(0, conical ? 0.4 : 0.45, 0);
  const parts = far ? [crown.toNonIndexed()] : [crown.toNonIndexed(), trunk.toNonIndexed()];
  const pos: number[] = [];
  const nrm: number[] = [];
  const colr: number[] = [];
  parts.forEach((g, k) => {
    pos.push(...(g.attributes.position.array as Float32Array));
    nrm.push(...(g.attributes.normal.array as Float32Array));
    const c = k === 0 ? [1, 1, 1] : [0.62, 0.5, 0.42];
    for (let i = 0; i < g.attributes.position.count; i++) colr.push(...c);
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(colr, 3));
  // Shared corners merged (same position, normal and colour): ~55 vertices a tree, not ~300, for
  // tens of thousands of trees.
  return mergeVertices(out);
}

/**
 * Whether trees cast sun shadows: only close in, where they show (and not on low-power devices,
 * where the shadow pass keeps to buildings), as tens of thousands of trees are a lot to draw again.
 */
export function treesCastShadows(dist: number, lowPower: boolean): boolean {
  return !lowPower && dist < 2;
}

export const ROUND = ["#3f8a35", "#4f9a3c", "#62a845", "#357a30", "#6fb24c", "#4b8d40"].map((c) => new THREE.Color(c));
export const CONE = ["#2a6a38", "#347a40", "#448846", "#5a8c3e"].map((c) => new THREE.Color(c));

interface Layer {
  grid: Grid;
  round: THREE.InstancedMesh;
  cone: THREE.InstancedMesh;
  /** the same, low-poly, for trees beyond LOD_KM from the camera */
  roundFar: THREE.InstancedMesh;
  coneFar: THREE.InstancedMesh;
  /** target and camera at the last fill */
  last: { x: number; z: number; r: number; ex: number; ey: number; ez: number };
}

function makeLayer(trees: TreeData, capacity: number): THREE.Group {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mk = (conical: boolean, far = false) => {
    const m = new THREE.InstancedMesh(crownGeometry(conical, far), mat, capacity);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    m.count = 0;
    m.frustumCulled = false;
    m.receiveShadow = true;
    return m;
  };
  const root = new THREE.Group();
  const layer: Layer = {
    grid: buildGrid(trees),
    round: mk(false),
    cone: mk(true),
    roundFar: mk(false, true),
    coneFar: mk(true, true),
    last: { x: 1e9, z: 1e9, r: 0, ex: 1e9, ey: 1e9, ez: 1e9 },
  };
  root.add(layer.round, layer.cone, layer.roundFar, layer.coneFar);
  root.userData.layer = layer;
  return root;
}

const m4 = new THREE.Matrix4();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const quat = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);

export default function Trees({ trees, ground, lowPower }: { trees: TreeData; ground: HeightField; lowPower: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const capacity = lowPower ? 9000 : 26000;
  const root = useMemo(() => makeLayer(trees, capacity), [trees, capacity]);

  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    const cam = runtime.cam;
    const show = cam.dist < 6.5;
    g.visible = show;
    if (!show) return;
    const layer = g.userData.layer as Layer;
    layer.round.castShadow = layer.cone.castShadow = treesCastShadows(cam.dist, lowPower);
    const radius = Math.min(4.2, Math.max(0.9, cam.dist * 1.7));
    const last = layer.last;
    const eye = state.camera.position;
    // Refill only when the view (or the camera, for which trees are near) has moved enough to matter.
    if (
      Math.hypot(cam.x - last.x, cam.z - last.z) < radius * 0.12 &&
      Math.abs(radius - last.r) < last.r * 0.15 &&
      Math.hypot(eye.x - last.ex, eye.y - last.ey, eye.z - last.ez) < Math.max(0.15, radius * 0.12)
    )
      return;
    Object.assign(last, { x: cam.x, z: cam.z, r: radius, ex: eye.x, ey: eye.y, ez: eye.z });
    const { grid, round, cone, roundFar, coneFar } = layer;
    let nr = 0;
    let nc = 0;
    let fr = 0;
    let fc = 0;
    const cx = Math.floor((cam.x - CX_MIN) / CELL);
    const cz = Math.floor((cam.z - CZ_MIN) / CELL);
    const reach = Math.ceil(radius / CELL);
    // Rings of cells outward from the camera target, so the nearest trees win when full.
    for (let ring = 0; ring <= reach; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const ix = cx + dx;
          const iz = cz + dz;
          if (ix < 0 || iz < 0 || ix >= grid.nx || iz >= grid.nz) continue;
          const c = iz * grid.nx + ix;
          for (let k = grid.start[c]; k < grid.start[c + 1]; k++) {
            const i = grid.order[k];
            const conical = (trees.v[i] & 128) !== 0;
            if (conical ? nc + fc >= capacity : nr + fr >= capacity) continue;
            const x = trees.x[i];
            const z = trees.z[i];
            if (Math.hypot(x - cam.x, z - cam.z) > radius) continue;
            const r = trees.r[i];
            const tint = trees.v[i] & 127;
            quat.setFromAxisAngle(up, (tint / 127) * Math.PI * 2);
            pos.set(x, groundY(ground, x, z) - 0.0004, z);
            scl.set(r, r * TREE_EXAG, r);
            m4.compose(pos, quat, scl);
            const far = pos.distanceTo(eye) > LOD_KM;
            if (conical) {
              const m = far ? coneFar : cone;
              const n = far ? fc++ : nc++;
              m.setMatrixAt(n, m4);
              m.setColorAt(n, CONE[tint % CONE.length]);
            } else {
              const m = far ? roundFar : round;
              const n = far ? fr++ : nr++;
              m.setMatrixAt(n, m4);
              m.setColorAt(n, ROUND[tint % ROUND.length]);
            }
          }
        }
      }
    }
    round.count = nr;
    cone.count = nc;
    roundFar.count = fr;
    coneFar.count = fc;
    for (const m of [round, cone, roundFar, coneFar]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });

  return <primitive ref={ref} object={root} />;
}
