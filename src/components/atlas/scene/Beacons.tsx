"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { SITES } from "@/data/atlas/companies";
import { groundY, type HeightField } from "@/lib/atlas/geo";
import { sky } from "@/lib/atlas/timeOfDay";
import { useAtlas } from "@/lib/atlas/store";
import { siteColor, siteEmphasis, siteRestEmphasis } from "./siteState";

/** World-space label anchors (x, y, z per site), written every frame, read by the label layer. */
export const siteAnchors = new Float32Array(SITES.length * 3);
/** World units per CSS pixel at each site's distance, for the label layer. */
export const sitePx = new Float32Array(SITES.length);

const dummy = new THREE.Object3D();
const color = new THREE.Color();
const white = new THREE.Color("#ffffff");

export default function Beacons({ height, siteTop }: { height: HeightField; siteTop: Float32Array }) {
  const stems = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const rings = useRef<THREE.InstancedMesh>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const selectSite = useAtlas((s) => s.selectSite);
  const hoverSite = useAtlas((s) => s.hoverSite);

  const bases = useMemo(
    () =>
      SITES.map((s) => {
        const g = groundY(height, s.x, s.z);
        const top = siteTop[s.index];
        return Number.isFinite(top) ? Math.max(g, top) : g;
      }),
    [height, siteTop],
  );

  const { stemGeo, headGeo, ringGeo, stemMat, headMat, ringMat } = useMemo(() => {
    const stemGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    stemGeo.translate(0, 0.5, 0);
    const headGeo = new THREE.SphereGeometry(1, 16, 12);
    const ringGeo = new THREE.RingGeometry(0.72, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const stemMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, fog: true, toneMapped: false });
    const headMat = new THREE.MeshBasicMaterial({ fog: true, toneMapped: false });
    const ringMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      fog: true,
      toneMapped: false,
    });
    return { stemGeo, headGeo, ringGeo, stemMat, headMat, ringMat };
  }, []);

  useFrame(() => {
    const st = stems.current;
    const hd = heads.current;
    const rg = rings.current;
    if (!st || !hd || !rg) return;
    const night = sky.uNight.value;
    const t = sky.uTime.value;
    // World units per CSS pixel at unit distance.
    const k = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, size.height);
    for (const s of SITES) {
      const i = s.index;
      const e = siteEmphasis[i];
      const base = bases[i];
      const d = camera.position.distanceTo(dummy.position.set(s.x, base, s.z));
      const px = d * k;
      sitePx[i] = px;
      if (e < 0) {
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        st.setMatrixAt(i, dummy.matrix);
        hd.setMatrixAt(i, dummy.matrix);
        rg.setMatrixAt(i, dummy.matrix);
        siteAnchors[i * 3] = Number.NaN;
        continue;
      }
      const tierBoost = s.company.tier === 1 ? 1.15 : s.company.tier === 2 ? 1 : 0.85;
      const len = px * (26 + 34 * siteRestEmphasis[i]) * tierBoost;
      const r = px * (3.2 + 2.2 * e);
      dummy.position.set(s.x, base, s.z);
      dummy.scale.set(px * 0.55, len, px * 0.55);
      dummy.updateMatrix();
      st.setMatrixAt(i, dummy.matrix);

      dummy.position.set(s.x, base + len, s.z);
      dummy.scale.setScalar(r * (s.primary ? 1 : 0.8));
      dummy.updateMatrix();
      hd.setMatrixAt(i, dummy.matrix);
      siteAnchors[i * 3] = s.x;
      siteAnchors[i * 3 + 1] = base + len + px * (3.2 + 2.2 * siteRestEmphasis[i]);
      siteAnchors[i * 3 + 2] = s.z;

      const pulse = (t * 0.6 + i * 0.137) % 1;
      const ringR = e > 0.8 ? px * (8 + 22 * pulse) : 0;
      dummy.position.set(s.x, base + px * 0.4, s.z);
      dummy.scale.setScalar(ringR);
      dummy.updateMatrix();
      rg.setMatrixAt(i, dummy.matrix);

      siteColor(s, night, color);
      hd.setColorAt(i, color);
      st.setColorAt(i, color.lerp(white, 0.15 * (1 - night)));
      rg.setColorAt(i, siteColor(s, night, color));
    }
    st.instanceMatrix.needsUpdate = true;
    hd.instanceMatrix.needsUpdate = true;
    rg.instanceMatrix.needsUpdate = true;
    if (st.instanceColor) st.instanceColor.needsUpdate = true;
    if (hd.instanceColor) hd.instanceColor.needsUpdate = true;
    if (rg.instanceColor) rg.instanceColor.needsUpdate = true;
  });

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined) hoverSite(SITES[e.instanceId].id);
  };
  const onOut = () => hoverSite(null);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined) selectSite(SITES[e.instanceId].id);
  };

  return (
    <group>
      <instancedMesh ref={stems} args={[stemGeo, stemMat, SITES.length]} frustumCulled={false} renderOrder={20} />
      <instancedMesh
        ref={heads}
        args={[headGeo, headMat, SITES.length]}
        frustumCulled={false}
        renderOrder={21}
        onPointerOver={onOver}
        onPointerOut={onOut}
        onClick={onClick}
      />
      <instancedMesh ref={rings} args={[ringGeo, ringMat, SITES.length]} frustumCulled={false} renderOrder={19} />
    </group>
  );
}
