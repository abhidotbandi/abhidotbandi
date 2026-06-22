"use client";

import Scene from "@/components/canvas/Scene";
import ProgressBar from "@/components/ui/ProgressBar";
import BadgeToast from "@/components/ui/BadgeToast";
import Hero from "@/components/sections/Hero";
import ChapterMacro from "@/components/sections/ChapterMacro";
import ChapterMeso from "@/components/sections/ChapterMeso";
import ChapterMicro from "@/components/sections/ChapterMicro";
import ChapterVpp from "@/components/sections/ChapterVpp";
import Finale from "@/components/sections/Finale";

export default function Home() {
  return (
    <main className="h-screen w-full overflow-hidden bg-[#050a14]">
      <ProgressBar />
      <BadgeToast />
      <Scene>
        <Hero />
        <ChapterMacro />
        <ChapterMeso />
        <ChapterMicro />
        <ChapterVpp />
        <Finale />
      </Scene>
    </main>
  );
}
