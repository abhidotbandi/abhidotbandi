import type { Metadata } from "next";
import AtlasApp from "@/components/atlas/AtlasApp";

export const metadata: Metadata = {
  title: "Silicon Hills: a living atlas of Austin's hard tech",
  description:
    "Fly a 3D map of Central Texas and meet the companies building warships, rockets, humanoid robots, reactors and chips around Austin.",
};

export default function AtlasPage() {
  return <AtlasApp />;
}
