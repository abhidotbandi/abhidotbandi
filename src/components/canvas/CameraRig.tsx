"use client";

import { useScroll } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { CAMERA_KEYFRAMES } from "@/lib/network";
import { useGridStore } from "@/lib/store";
import { chapterAt, smoothstep } from "@/lib/chapters";

type KeyName = keyof typeof CAMERA_KEYFRAMES;

const ANCHORS: { p: number; key: KeyName }[] = [
  { p: 0, key: "hero" },
  { p: 0.12, key: "macro" },
  { p: 0.32, key: "meso" },
  { p: 0.52, key: "micro" },
  { p: 0.74, key: "vpp" },
  { p: 0.9, key: "finale" },
  { p: 1, key: "finale" },
];

export default function CameraRig() {
  const scroll = useScroll();
  const { camera } = useThree();
  const desiredPos = useRef(new THREE.Vector3().copy(CAMERA_KEYFRAMES.hero.position));
  const desiredTarget = useRef(new THREE.Vector3().copy(CAMERA_KEYFRAMES.hero.target));
  const smoothedTarget = useRef(new THREE.Vector3().copy(CAMERA_KEYFRAMES.hero.target));
  const setScrollProgress = useGridStore((s) => s.setScrollProgress);
  const setActiveChapter = useGridStore((s) => s.setActiveChapter);

  useFrame(() => {
    const p = scroll.offset;
    setScrollProgress(p);
    setActiveChapter(chapterAt(p));

    let lower = ANCHORS[0];
    let upper = ANCHORS[ANCHORS.length - 1];
    for (let i = 0; i < ANCHORS.length - 1; i++) {
      if (p >= ANCHORS[i].p && p <= ANCHORS[i + 1].p) {
        lower = ANCHORS[i];
        upper = ANCHORS[i + 1];
        break;
      }
    }

    const t = smoothstep(lower.p, upper.p, p);
    const a = CAMERA_KEYFRAMES[lower.key];
    const b = CAMERA_KEYFRAMES[upper.key];

    desiredPos.current.copy(a.position).lerp(b.position, t);
    desiredTarget.current.copy(a.target).lerp(b.target, t);

    camera.position.lerp(desiredPos.current, 0.07);
    smoothedTarget.current.lerp(desiredTarget.current, 0.07);
    camera.lookAt(smoothedTarget.current);
  });

  return null;
}
