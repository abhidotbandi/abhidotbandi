import { Newsreader, Nunito } from "next/font/google";
import { firstViewFiles } from "@/lib/atlas/files";
import "./atlas.css";

const serif = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-serif",
  display: "swap",
});

/** The heavy rounded face of the loader's name and the title card. */
const rounded = Nunito({
  subsets: ["latin"],
  weight: "900",
  variable: "--font-rounded",
  display: "swap",
});

/**
 * Runs while the page is still parsing, long before the app's scripts: starts downloading the
 * map's data for this device's tier (the same test as lib/atlas/tier.ts), while the loader draws.
 */
const early = `(function(){try{
var h=document.head;
var lo=matchMedia("(pointer: coarse)").matches||(navigator.hardwareConcurrency||8)<=4;
var f=lo?${JSON.stringify(firstViewFiles(true))}:${JSON.stringify(firstViewFiles(false))};
for(var i=0;i<f.length;i++){var l=document.createElement("link");l.rel="preload";l.as="fetch";l.crossOrigin="anonymous";l.href="/atlas/"+f[i];h.appendChild(l);}
}catch(e){}})();`;

export default function AtlasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${serif.variable} ${rounded.variable}`}>
      <script dangerouslySetInnerHTML={{ __html: early }} />
      {children}
    </div>
  );
}
