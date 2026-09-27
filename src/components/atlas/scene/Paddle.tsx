"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Central } from "@/lib/atlas/central";
import { groundY, type HeightField } from "@/lib/atlas/geo";
import { PADDLE_SECONDS, makePaddleRoute } from "@/lib/atlas/paddle";
import { runtime, useAtlas } from "@/lib/atlas/store";
import { box, headGeo, merge, standGeo } from "./figures";

// Paddle Lady Bird Lake: a paddleboarder working down the lake from Red Bud Isle to Longhorn
// Dam, with the camera riding along behind. Modelled in metres, forward along +z.

const M = 0.001;

function makeBoarder(): THREE.Group {
  const lit = (color: string) => new THREE.MeshLambertMaterial({ color });
  const g = new THREE.Group();
  // Board: a long, slightly pointed deck.
  const board = merge([box(0.8, 0.14, 2.6, 0, 0.07, 0), box(0.5, 0.14, 0.7, 0, 0.07, 1.6)]);
  g.add(new THREE.Mesh(board, lit("#f2c230")));
  const body = new THREE.Mesh(standGeo(), lit("#2f6fb0"));
  body.position.set(0, 0.14, -0.1);
  g.add(body);
  const head = new THREE.Mesh(headGeo(), lit("#d9a47f"));
  head.position.set(0, 1.76, -0.1);
  g.add(head);
  // Paddle: shaft and blade, pivoting at the paddler's hands.
  const paddle = new THREE.Group();
  paddle.add(new THREE.Mesh(merge([box(0.05, 2.0, 0.05, 0, -0.6, 0), box(0.2, 0.45, 0.04, 0, -1.55, 0)]), lit("#20242b")));
  paddle.position.set(0.35, 1.25, 0.1);
  g.add(paddle);
  // A V of wake spreading behind.
  const wake = new THREE.BufferGeometry();
  // prettier-ignore
  wake.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.35, 0.02, -1.2, -0.2, 0.02, -1.4, -3.4, 0.02, -13,
     0.35, 0.02, -1.2,  3.4, 0.02, -13,  0.2, 0.02, -1.4,
  ], 3));
  const wm = new THREE.Mesh(wake, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
  g.add(wm);
  g.userData.paddle = paddle;
  return g;
}

export default function Paddle({ central, ground }: { central: Central; ground: HeightField }) {
  const ref = useRef<THREE.Group>(null);
  const route = useMemo(() => makePaddleRoute(central), [central]);
  const boarder = useMemo(() => makeBoarder(), []);
  const lastUi = useRef(0);

  useFrame((state, rawDt) => {
    const g = ref.current;
    const st = useAtlas.getState();
    const on = st.mode === "paddle" && !!route;
    if (g) g.visible = on;
    if (!g || !on || !route) return;
    const dt = Math.min(rawDt, 0.1);
    const t = state.clock.elapsedTime;
    if (!st.paddlePaused) runtime.paddleS = Math.min(1, runtime.paddleS + dt / PADDLE_SECONDS);
    const s = runtime.paddleS;
    if (t - lastUi.current > 0.2 || (s >= 1 && st.paddleProgress < 1)) {
      lastUi.current = t;
      st.setPaddleProgress(s);
    }

    // Look a little ahead so the heading turns smoothly through the centreline's kinks.
    const L = route.path.length;
    const here = { x: 0, z: 0, dx: 0, dz: 0 };
    const ahead = { x: 0, z: 0, dx: 0, dz: 0 };
    route.path.at(s * L, here);
    route.path.at(Math.min(L, s * L + 0.08), ahead);
    let fx = ahead.x - here.x;
    let fz = ahead.z - here.z;
    if (Math.hypot(fx, fz) < 1e-6) {
      fx = here.dx;
      fz = here.dz;
    }
    const want = Math.atan2(fx, -fz);
    const p = runtime.paddlePos;
    let dh = want - p.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    p.heading += runtime.reducedMotion ? dh : dh * (1 - Math.exp(-2.5 * dt));
    p.x = here.x;
    p.z = here.z;

    const E = Math.min(8, Math.max(2.5, runtime.cam.dist / 0.075));
    const b = g.children[0];
    b.position.set(p.x, groundY(ground, p.x, p.z) + 0.0002, p.z);
    b.rotation.set(0, Math.PI - p.heading, 0);
    b.scale.setScalar(E * M);
    // Stroke: pull back along the board, switching sides every few strokes.
    const stroke = st.paddlePaused || runtime.reducedMotion ? 0 : t * 1.4;
    const paddle = b.userData.paddle as THREE.Group;
    const side = Math.floor(stroke / 3) % 2 ? -1 : 1;
    paddle.position.x = 0.35 * side;
    paddle.rotation.set(Math.sin(stroke * Math.PI * 2) * 0.55, 0, side * 0.12);
  });

  return (
    <group ref={ref}>
      <primitive object={boarder} />
    </group>
  );
}
