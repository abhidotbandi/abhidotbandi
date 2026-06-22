import * as THREE from "three";

export type Interconnection = "eastern" | "western" | "ercot";

export interface MacroNode {
  id: string;
  name: string;
  position: [number, number, number];
  interconnection: Interconnection;
  isHub?: boolean;
}

export const COLORS: Record<Interconnection, string> = {
  eastern: "#38bdf8",
  western: "#34d399",
  ercot: "#f5a623",
};

export const BASE_GREEN = "#39ff14";

export const MACRO_NODES: MacroNode[] = [
  { id: "seattle", name: "Seattle", position: [-5.2, 0, 4.4], interconnection: "western" },
  { id: "la", name: "Los Angeles", position: [-4.8, 0, -1.6], interconnection: "western" },
  { id: "phoenix", name: "Phoenix", position: [-3.2, 0, -2.8], interconnection: "western" },
  { id: "denver", name: "Denver", position: [-1.6, 0, 1.0], interconnection: "western" },
  { id: "chicago", name: "Chicago", position: [1.0, 0, 2.4], interconnection: "eastern" },
  { id: "nyc", name: "New York", position: [4.6, 0, 2.6], interconnection: "eastern" },
  { id: "atlanta", name: "Atlanta", position: [2.4, 0, -2.0], interconnection: "eastern" },
  { id: "miami", name: "Miami", position: [4.0, 0, -4.6], interconnection: "eastern" },
  { id: "detroit", name: "Detroit", position: [1.6, 0, 3.4], interconnection: "eastern" },
  { id: "kansascity", name: "Kansas City", position: [-0.6, 0, 1.2], interconnection: "eastern" },
  {
    id: "ercot",
    name: "ERCOT (Texas)",
    position: [-0.4, 0, -2.3],
    interconnection: "ercot",
    isHub: true,
  },
];

export const MACRO_LINKS: [string, string][] = [
  ["seattle", "la"],
  ["seattle", "denver"],
  ["la", "phoenix"],
  ["phoenix", "denver"],
  ["denver", "kansascity"],
  ["kansascity", "chicago"],
  ["chicago", "detroit"],
  ["chicago", "nyc"],
  ["detroit", "nyc"],
  ["chicago", "atlanta"],
  ["atlanta", "nyc"],
  ["atlanta", "miami"],
];

export const ERCOT_NODE = MACRO_NODES.find((n) => n.id === "ercot")!;

export interface TexasCity {
  id: string;
  name: string;
  offset: [number, number, number];
  isFocus?: boolean;
}

export const TEXAS_CITIES: TexasCity[] = [
  { id: "dallas", name: "Dallas", offset: [-0.9, 0, -0.7] },
  { id: "houston", name: "Houston", offset: [0.7, 0, -1.1] },
  { id: "austin", name: "Austin", offset: [-0.3, 0, 0.9], isFocus: true },
  { id: "sanantonio", name: "San Antonio", offset: [-1.1, 0, 1.3] },
];

export const AUSTIN_CITY = TEXAS_CITIES.find((c) => c.isFocus)!;

export const TEXAS_LOCAL_SCALE = 1.4;

export function texasCityWorldPos(city: TexasCity, scale = TEXAS_LOCAL_SCALE): THREE.Vector3 {
  return new THREE.Vector3(
    ERCOT_NODE.position[0] + city.offset[0] * scale,
    ERCOT_NODE.position[1],
    ERCOT_NODE.position[2] + city.offset[2] * scale
  );
}

export const NEIGHBORHOOD_HOUSE_SLOTS: [number, number][] = [
  [0, 0],
  [0.9, 0.3],
  [-0.9, 0.3],
  [0.6, -0.9],
  [-0.6, -0.9],
  [1.5, -0.5],
  [-1.5, -0.5],
  [0, 1.2],
  [1.6, 1.0],
  [-1.6, 1.0],
  [2.2, 0.1],
  [-2.2, 0.1],
];

export const CAMERA_KEYFRAMES = {
  hero: { position: new THREE.Vector3(0, 9, 14), target: new THREE.Vector3(0, 0, 0) },
  macro: { position: new THREE.Vector3(0, 7, 9), target: new THREE.Vector3(0, 0, 0) },
  meso: {
    position: new THREE.Vector3(
      ERCOT_NODE.position[0] + 0.2,
      2.4,
      ERCOT_NODE.position[2] + 3.4
    ),
    target: new THREE.Vector3(ERCOT_NODE.position[0], 0, ERCOT_NODE.position[2]),
  },
  micro: (() => {
    const p = texasCityWorldPos(AUSTIN_CITY);
    return {
      position: new THREE.Vector3(p.x + 0.2, 0.9, p.z + 1.9),
      target: new THREE.Vector3(p.x, 0.4, p.z),
    };
  })(),
  vpp: (() => {
    const p = texasCityWorldPos(AUSTIN_CITY);
    return {
      position: new THREE.Vector3(p.x + 1.2, 2.6, p.z + 4.6),
      target: new THREE.Vector3(p.x, 0, p.z),
    };
  })(),
  finale: { position: new THREE.Vector3(0.5, 10, 12), target: new THREE.Vector3(-0.2, 0, -1) },
};
