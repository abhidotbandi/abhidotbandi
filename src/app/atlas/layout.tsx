import { Newsreader } from "next/font/google";
import { PORTRAIT_POSTER_MEDIA, POSTERS } from "@/data/atlas/poster";
import { firstViewFiles } from "@/lib/atlas/files";
import "./atlas.css";

const serif = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-serif",
  display: "swap",
});

/**
 * Runs while the page is still parsing, long before the app's scripts: starts downloading the
 * opening shot's poster (see data/atlas/poster.ts) and the map's data for this device's tier (the
 * same test as lib/atlas/tier.ts). Deep links open somewhere other than the opening shot, so
 * they skip the poster and get the full loader instead (a style, not a class on the page's own
 * elements, which React would find changed when it hydrates).
 */
const early = `(function(){try{
var h=document.head;
function pre(href,as,x){var l=document.createElement("link");l.rel="preload";l.as=as;l.href=href;if(x)l.crossOrigin="anonymous";else l.setAttribute("fetchpriority","high");h.appendChild(l);}
if(/[?&](c|p|at|mode|ride|paddle|poster)=/.test(location.search)){var st=document.createElement("style");st.textContent=".atlas-poster{display:none}.loader:not(.is-failed){display:grid}";h.appendChild(st);}
else pre(matchMedia(${JSON.stringify(PORTRAIT_POSTER_MEDIA)}).matches?${JSON.stringify(POSTERS.portrait.src)}:${JSON.stringify(POSTERS.landscape.src)},"image");
var lo=matchMedia("(pointer: coarse)").matches||(navigator.hardwareConcurrency||8)<=4;
var f=lo?${JSON.stringify(firstViewFiles(true))}:${JSON.stringify(firstViewFiles(false))};
for(var i=0;i<f.length;i++)pre("/atlas/"+f[i],"fetch",1);
}catch(e){}})();`;

export default function AtlasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={serif.variable}>
      <script dangerouslySetInnerHTML={{ __html: early }} />
      {children}
    </div>
  );
}
