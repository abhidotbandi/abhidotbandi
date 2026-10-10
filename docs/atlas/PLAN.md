# The Silicon Hills: a living atlas of Austin's hard tech

Plan for recreating [levels.fyi/atlas](https://www.levels.fyi/atlas) ("The Peninsula") for Austin, focused on
deep tech, hard tech and defense tech. This document is the build plan. Everything below it in the
repo (`scripts/atlas`, `src/**/atlas`, `public/atlas`) implements it.

---

## 1. What we are recreating

levels.fyi's atlas can't be loaded from the build sandbox (egress-blocked), so this is reconstructed from
their own page metadata, launch posts and team write-ups:

| levels.fyi "The Peninsula" | Evidence |
|---|---|
| A living 3D atlas of the Bay Area with compensation data on top of company HQs and offices | page description, team posts |
| **Scroll mode**: scroll from the Golden Gate to San José and the camera flies down the peninsula | page description |
| **Explore mode**: toggle to drag around the map yourself | team posts |
| **Ride the Caltrain** | team posts |
| A local character: "meet Karl the Fog" | page description |
| Chip per company showing median SWE pay | page description |
| Inspired by the *Silicon Valley* (HBO) title sequence and the Yamauchi No.10 Family Office site | team posts |
| Sequel: "The Five Boroughs" (NYC), from the Verrazzano to the Bronx | levels.fyi/atlas/new-york |

The format: **a real place, rendered as a toy-like 3D map, told as a scroll story, with one number per
company and a way to wander off the rails.**

### Austin translation

| Peninsula | Silicon Hills (Austin) |
|---|---|
| Golden Gate → San José | A clockwise loop: Downtown → East (Giga Texas, Bastrop) → Taylor → North Austin → Cedar Park → Briggs Rocket Ranch → the Hill Country → back downtown at dusk |
| Karl the Fog | **The Congress Avenue bats**: up to 1.5M Mexican free-tailed bats leave the bridge at dusk. They're the finale. |
| Ride the Caltrain | **Ride the CapMetro Red Line**, Leander → Downtown, past Firefly, the Domain and UT |
| Median SWE pay chip | **What they build** chip (e.g. "Autonomous warships"). Capital raised / ticker / founding year sit in the detail card. We have no pay data and won't invent it. |
| Big Tech HQs | Deep/hard/defense tech: warships, rockets, satellites, humanoids, reactors, fabs, chips, and the Army command that moved in |
| Peninsula geography | Real Central Texas: the Balcones Escarpment ("the Silicon Hills are actual hills"), the Colorado River chain of lakes, I-35/MoPac/183/130 |

---

## 2. Experience design

### Three modes
1. **Tour (scroll)**. Default. A sticky full-bleed canvas with story cards scrolling over it. Scroll position
   *scrubs* the camera continuously (not triggered animations), so reversing the scroll reverses the flight.
2. **Explore**. Free map controls (drag = pan, right-drag/two-finger = rotate/tilt, wheel/pinch = zoom), with
   search (⌘K), domain filters, a "defense ties" filter, and a list/table view. Click a company to fly to it.
3. **Ride the Red Line**. The camera chases a train from Leander to Downtown with stops and a live
   "nearby" panel showing which companies you are passing.

### The tour (≈10 stops, clockwise, one day from dawn to night)

| # | Stop | Time of day | Featured |
|---|---|---|---|
| 0 | **The Silicon Hills** (whole region) | dawn | Balcones Escarpment, the river, headline stats |
| 1 | **Downtown**: where the Army moved in | morning | Army T2COM (ex-Futures Command) HQ, Army Software Factory, Capital Factory, Silicon Labs, Cirrus Logic, Base Power, UT Austin |
| 2 | **East**: gigafactory country | late morning | Saronic, Base Power factory, Tesla Giga Texas, NXP, SpaceX Starlink (Bastrop), The Boring Company |
| 3 | **Taylor & Round Rock**: the fab frontier | noon | Samsung Taylor, Infinitum, … |
| 4 | **North Austin**: robots, radars, research | afternoon | Samsung Austin fab, Applied Materials, NI, Apptronik, Mythic, Canon Nanotechnologies, Pickle Research Campus (TIE, ARL:UT, TACC) |
| 5 | **Cedar Park**: launch control | afternoon | Firefly HQ campus, Hyliion |
| 6 | **Briggs**: the Rocket Ranch | late afternoon | Firefly test stands (with an engine test plume) |
| 7 | **The Hills**: satellites in the cedar | golden hour | CesiumAstro, Ambiq, AMD, NXP Oak Hill |
| 8 | **Congress Avenue** at dusk | sunset → dusk | **The bats** |
| 9 | **The Silicon Hills at night** | night | City lights, CTA: Explore / Ride the Red Line |

Stops get finalized once every company is geocoded (§4.1). Each stop has a *dwell* (camera holds and drifts
while you read) and a *transit* (the flight to the next stop). Scroll length per transit is proportional to
flight length so perceived speed stays constant.

### "Living" details (the levels.fyi charm)
- Bats swarm out of the Congress Avenue Bridge at dusk and stream east.
- A Red Line train shuttles along the real track the whole time.
- Headlights crawl along I-35 and MoPac at night.
- Firefly's test stand fires at the Briggs stop.
- Giga Texas and the fabs light up after sunset.

---

## 3. Visual design system

**Art direction: "field atlas".** A printed topographic atlas by day (limestone cream, sepia contours, teal
water with engraved shoreline ripples) that turns into a night-lights map at dusk. UI is warm "paper" panels
with hairline borders that read over both day and night.

- **Terrain**: real DEM, vertical exaggeration ~3×. Shaded by hypsometric tint + hillshade + contour lines
  every 20 m (index every 100 m), computed per-pixel in the fragment shader from a half-float heightmap.
- **Water**: signed-distance-field mask → crisp shorelines at any zoom, plus 2–3 offset "engraved" ripple
  lines along each shore (classic atlas cartography).
- **Urban fabric**: building-density raster → a warm tint by day, glowing streetlight texture at night.
- **Buildings**: real Overture footprints, extruded, flat-shaded via screen-space derivatives (no normals
  shipped). Downtown/UT plus every company campus. A company's own buildings are painted in its domain color.
- **Roads**: interstate/highway/arterial hierarchy as screen-space-width lines, draped on terrain.
- **Sky**: gradient dome + sun, with exponential haze whose color follows the time of day.

### Color: domains (validated)
Sector color is categorical identity on a map, so any two sectors can sit side by side and all pairs must
be distinguishable. Per the data-viz method, a map form caps out around 3–4 hues. Ran the validator
(`--pairs all`) against the light (cream `#efe8d8`) and dark (night `#0e1626`) map surfaces; only two
4-hue sets pass in both modes. We use the one with no blue, so markers never read as water:

| Domain | Glyph | Day | Night |
|---|---|---|---|
| Defense & Space | ▲ delta | `#eda100` | `#c98500` |
| Chips & Compute | ▣ chip | `#4a3aa7` | `#9085e9` |
| Energy & Mobility | ⚡ bolt | `#008300` | `#008300` |
| Robotics & Manufacturing | ⬢ hex nut | `#e87ba4` | `#d55181` |
| Big Tech (added 2026-10-04) | ☁ cloud | `#5d8ff0` | `#4859dd` |
| Finance & Trading (added 2026-10-04) | 🏛 bank | `#931848` | `#904651` |

Light-mode contrast is < 3:1 for two slots and dark-mode CVD sits in the 6–8 warn band, so **relief is
mandatory and built in**: every marker has a domain glyph (shape), a direct text label, and a white/ink
2px ring, and there is a table view. Institutions (Army, UT labs, TACC) use a diamond marker in their
domain's color. Text is always ink, never the domain color.

### Type
- Display: a high-contrast serif for titles and water names (cartographic convention: water in italic serif).
- UI: Geist (already in the app) for labels and body. Geist Mono for coordinates and numbers.
- Town names: small caps, letter-spaced. Company chips: 12–13px medium.

### Motion
- Camera flights follow the van Wijk–Nuij "smooth zoom-pan" curve (the math behind `d3.interpolateZoom`
  and Mapbox `flyTo`). Long hops zoom out, pan, then zoom in. Scroll-scrubbed, then critically damped.
- Cards fade/slide 12px. Label chips fade in/out with the declutter pass.
- `prefers-reduced-motion`: no ambient animation (bats, traffic, drift). Scroll still drives the camera,
  with a stiffer damping so nothing floats.

---

## 4. Data

### 4.1 Companies (`src/data/atlas/companies.ts`)

Inclusion: builds physical/deep technology (or is a defense/space/semiconductor institution) **and** has a
real operating site in the Austin region (HQ, factory, fab, lab, test site). ~50–65 entries. Since
2026-10-04, also the big tech and finance firms in Levels.fyi's atlases that have a real Austin office
(see 2.22).

```ts
{
  id: "saronic",
  name: "Saronic",
  domain: "defense-space",          // one of 4 (color + glyph)
  tags: ["defense", "maritime", "autonomy"],
  builds: "Autonomous surface vessels",   // the chip text
  blurb: "…",                              // 1–2 sentences
  facts: ["…", "…"],                       // 2–3 "why it matters" bullets
  site: { kind: "HQ + factory", name: "Eastside Commerce Center", address: "…", lon, lat, radius },
  founded: 2022,
  status: { kind: "private", raised: 2.6e9, valuation: 9.25e9, asOf: "2026-03" }
        | { kind: "public", ticker: "NASDAQ: FLY" }
        | { kind: "institution", est: 2018 } | { kind: "subsidiary", parent: "Samsung" },
  defense: true,                          // has DoD/IC customers → "defense ties" filter
  url: "https://…",
  sources: ["https://…"],
  tier: 1 | 2 | 3,                        // marker size + label priority
}
```

**Sourcing policy.** Every number has a source URL and an as-of date. No compensation, headcount or
valuation gets estimated; if it isn't reported, the field is omitted. Coordinates come from Overture
Places (address-matched) or the company's published address, then get snapped to the building footprint
and checked visually in debug renders.

### 4.2 Geodata (baked at build time, committed to `public/atlas/`)

| Layer | Source | Processing | Shipped as |
|---|---|---|---|
| Terrain | AWS Terrain Tiles (Terrarium, z12), USGS/SRTM-derived | stitch → crop → resample to ~1024×1300 | terrarium-encoded RGB PNG |
| Water | Overture `base/water` (OSM) | rasterize → SDF | R channel of `surface.png` |
| Urban density | Overture `buildings/building` (whole region) | rasterize coverage → blur | G channel of `surface.png` |
| Parks/green | Overture `base/land_use` | rasterize | B channel of `surface.png` |
| Roads | Overture `transportation/segment` (motorway → secondary) | simplify, quantize | `roads.json` |
| Red Line | Overture rail segments + station points | graph path Leander → Downtown | `rail.json` |
| Buildings | Overture buildings (downtown + every company site) | clean, height fill-in, quantize | `buildings.bin` (footprints; extruded on client) |
| Labels | Overture `divisions` + curated landmarks/water names | — | `labels.json` |

Projection: local equirectangular around (30.27°N, 97.74°W), 1 scene unit = 1 km, north = −z.
It's shared by the Python pipeline and `src/lib/atlas/geo.ts`, so both sides agree to the meter.

Budget: **≤ 5 MB transferred** for all map data (brotli on JSON, PNG for rasters).

Licenses/attribution (shown in the credits panel): Overture Maps Foundation (CDLA-Permissive-2.0), which includes
OpenStreetMap data (© OpenStreetMap contributors, ODbL); Terrain Tiles by Mapzen/AWS Open Data from
USGS 3DEP/SRTM.

---

## 5. Architecture

**Stack** (already in the repo): Next.js 16 App Router, React 19, three r184 + @react-three/fiber 9 +
drei 10, zustand, Tailwind 4. New route **`/atlas`**; the existing Grid site at `/` is untouched.

```
docs/atlas/PLAN.md                    this plan
scripts/atlas/                        Python data pipeline (pyarrow → Overture on S3, numpy, shapely, scipy)
public/atlas/                         baked assets
src/app/atlas/page.tsx                server: metadata + SEO/no-WebGL company list, mounts the client app
src/components/atlas/AtlasApp.tsx     client root: mode switch, scroll engine, overlays
src/components/atlas/scene/*          Canvas, Terrain, Water/Surface, Roads, Rail+Train, Buildings,
                                      Beacons, Bats, Traffic, Plume, Sky, CameraDirector
src/components/atlas/ui/*             Intro/loader, StoryCards, LabelLayer, CompanyCard, Legend+Filters,
                                      Search, Minimap, ListView, RideHud, Credits
src/lib/atlas/*                       geo (projection + heightmap sampling), assets (decoders), tour
                                      (keyframes, flyTo curve, scroll mapping), labels (declutter),
                                      timeOfDay (palette interpolation), store (zustand)
src/data/atlas/*                      companies, chapters, stations, domains
```

### Rendering layers (draw-call budget ≈ 25)
1. **Sky dome**: gradient shader, sun disc, stars at night.
2. **Terrain**: one 512×650 grid mesh displaced in the vertex shader; the fragment shader does hypsometric
   tint, hillshade (normals from the heightmap), contours, water SDF (color + shore ripples), urban tint
   and night lights, park tint. Everything that's "paint" happens here in one pass.
3. **Roads**: `LineSegments2` per class (screen-space width), draped via CPU heightmap sampling.
4. **Buildings**: one merged `BufferGeometry` extruded on the client (earcut roofs), flat shading from
   `dFdx/dFdy`, per-vertex company index → highlight/hover via uniform, windows lit at night.
5. **Beacons**: instanced stems + rings per company, pulsing in the focused chapter.
6. **Red Line + train**: tube/line for track, small procedural 2-car train.
7. **Ambient life**: bats (instanced, vertex-animated flap), traffic dots (shader-advected along paths),
   rocket plume (additive particles).

### Tour engine
- Keyframe = `{ target:[lon,lat], dist, tilt, bearing, tod }`.
- `progress ∈ [0,1]` from the scroll container → segment lookup → dwell (hold + slow bearing drift) or
  transit (van Wijk–Nuij on target/dist, eased tilt/bearing/tod) → desired camera → damped actual camera.
- Story cards are in normal document flow (accessible, selectable), spaced so each is centered during its
  stop's dwell. Canvas is `position: fixed` behind them.

### Labels
DOM chips positioned every frame via `transform` (no React re-render), projected from each beacon top.
Greedy declutter by priority (selected > hovered > current chapter > tier), trying 4 anchor positions
per chip, hidden if no slot, with fade transitions. ~70 chips means O(n²) overlap tests: trivial.

### State (zustand)
`mode`, `progress`, `activeChapter`, `selectedId`, `hoveredId`, `filters`, `ride` state, `assetsReady`,
`quality`. URL sync: `?c=saronic`, `?mode=explore`, `?ride=1` for deep links.

### Loading & fallback
- SSR renders title, intro copy and the full company list (SEO and no-JS). The canvas mounts client-side
  with `next/dynamic` (no SSR) and fades in when terrain + surface are decoded.
- No WebGL2 → the page stays a well-designed list/table view with the story text.

---

## 6. Performance budget
- 60 fps on an M1 laptop, ≥ 30 fps on a mid-range phone.
- DPR clamp `[1, 2]` desktop, `[1, 1.5]` mobile. `PerformanceMonitor` steps quality down (DPR, bats count,
  traffic off, shadow of beacons off).
- Terrain mesh 512×650 (≈333k verts) desktop, 256×325 mobile; the fragment shader carries the detail.
- Buildings extruded in chunks during idle frames (no long task > 50 ms).
- No postprocessing composer. Glows are additive sprites/emissive colors (keeps it crisp and cheap).

## 7. Accessibility & responsive
- Story text and company details are real DOM; keyboard reachable (Tab / Enter / Esc, ⌘K search).
- Table view of every company (sortable) = accessible equivalent of the map.
- Domain identity is never color-alone: glyph + label + legend.
- Mobile: story cards become bottom sheets, fewer chips (priority threshold), touch controls in Explore.
- `prefers-reduced-motion` honored (see §3 Motion).

## 8. QA
- `npm run lint`, `npm run build`.
- Playwright + Chromium screenshots at every stop, desktop 1440×900 and mobile 390×844, plus explore,
  ride, and table view. Console must be error-free.
- Pipeline debug renders (PNG) of every company site with matched footprints for coordinate QA.
- Asset size report and frame-time sampling in headless runs.

## 9. Build order
1. Plan (this doc) ✔
2. Company research + geocoding
3. Geodata pipeline → baked assets
4. Scene: terrain shader → surface → roads → buildings → beacons → sky/time of day
5. Tour engine + story cards + labels
6. Company card, legend/filters, search, explore mode, minimap, table view
7. Red Line ride, bats, traffic, plume
8. Perf/a11y/mobile pass, screenshots, fix, ship

## 10. Risks
| Risk | Mitigation |
|---|---|
| Stale or wrong company facts | Sources + as-of dates on every number; omit what isn't reported |
| Geocoding errors | Overture address match + footprint snap + visual QA renders |
| Heavy assets | Quantized JSON + PNG rasters, client-side extrusion, budget check in pipeline |
| Low-end GPUs | Quality tiers, adaptive DPR, reduced mesh, ambient effects optional |
| Being mistaken for a Levels.fyi product | Own name and identity; credit line "inspired by Levels.fyi's The Peninsula" |

---

## Status (2026-09-27): built, first QA pass done

The atlas is live at `/atlas` (the Grid site at `/` is untouched). Everything in §2 is built.

**Modes**
- **Tour**: 14 stops scrubbed by scroll, running from dawn to night. Transits are van Wijk flights, and each
  stop dwells while its card is read. The intro card is centred at scroll 0. The chapter rail jumps
  between stops.
- **Explore**: MapControls with filters for domain and "defense customers". You can set the time of day,
  search (⌘K or `/`) and open a sortable table of every company. Picking a company flies to it and
  opens its panel.
- **Ride**: the Red Line from Leander to Downtown in 80 s, set as a morning commute. There are
  previous, play/pause and next buttons, a scrubbable track and a list of companies near the train.
  Big jumps fly rather than drag the low camera.
- **Details**: bats pour off the Congress Ave bridge at dusk. Firefly test-fires at the Rocket Ranch.
  Headlights and taillights move on the highways at night, with lit windows and two-scale city lights.
  The map fades into paper along an uneven edge.
- **Deep links**: `?c=<site id>`, `?mode=explore`, `?ride=1`.

**Accessibility**
- Reduced motion means camera cuts instead of flights, and no bats, plume or traffic movement. The
  ride waits for Play.
- Story text, the company panel, search and the table are real DOM and reachable by keyboard. Esc
  backs out one layer at a time. Opening a company moves focus to its panel.
- Domains always carry a glyph as well as a colour.

**QA**
- `eslint` and `tsc` are clean, and `next build` passes (`/atlas` prerenders as static).
- Playwright with headless Chromium on SwiftShader covered:
  - desktop 1440×900: every stop, Explore, search to panel, the table, and the ride (boarding flight
    and chase cam);
  - phones at 390, 360 and 320 px: landing, a stop, Explore, the ride and the panel. The header fits
    at every width.
- The console is clean apart from react-three-fiber's own `THREE.Clock` deprecation warning.
- Payload: about 2.9 MB of compressed map data plus 0.45 MB of compressed JS. Buildings are about 1M
  triangles in one draw call. The terrain uses 560 segments on desktop and 320 on low-power devices.

**Changed from the plan**
- Quality uses static tiers (coarse pointer or ≤4 cores means low power), not `PerformanceMonitor`.
  Low power drops traffic, uses fewer bats, a coarser terrain and skips buildings under 120 m².
- There is no minimap. The table and search cover finding things.
- Buildings are extruded in one pass while the loader is up, not in idle-frame chunks.
- Four sites have no matched footprint and show as beacons only: `aalo`, `aeon-industrial`,
  `base-power-factory-2` and `saronic`.

**Next**
1. Test on real hardware: GPU frame times (SwiftShader only reaches ~1 fps, so frame rate is
   unmeasured), iOS Safari, and touch gestures in Explore.
2. If phones struggle, add adaptive quality (DPR, then effects) and chunked building extrusion.
3. Keep the data fresh. Figures carry as-of dates in `companies.json`, and `scripts/atlas/` rebuilds
   geodata from new Overture releases.

---

## Phase 2 — Living Austin (planned 2026-09-27)

Goal: at street scale, central Austin should feel alive and unmistakably Austin: the river through
downtown with its rowers and paddleboarders, Zilker and Barton Springs, Rainey Street, and the
landmarks locals navigate by. The hard-tech story stays the spine; this is the city around it.

### 2.1 Central detail patch
A high-resolution layer over central Austin, from Red Bud Isle to Longhorn Dam and from South
Congress to the UT Tower (lon −97.795…−97.705, lat 30.236…30.296, 8.7 × 6.6 km):
- `central_terrain.webp`: z14 Terrarium (~8 m/px) elevation, so Barton Creek's valley, the Zilker
  hillside and the river banks have real shape.
- `central_surface.webp`: 4 m/px. R = water signed distance (crisp shores at any zoom), G = lawns
  and parks, B = tree canopy (clipped land cover plus park woods), A = sand, plazas and pitches.
- Its own terrain mesh (~16 m grid; coarser on low-power devices). The base terrain discards
  fragments inside it; the patch blends to the base heights in its border band and carries a
  skirt, so there are no cracks.
- `central.json`: trails (Butler loop, Boardwalk, greenbelts), docks and piers, bridge decks, the
  Zilker Eagle track, river lanes (centreline + half-width, from the SDF), and landmark points.

### 2.2 Living water
Animated ripples, sun glints and a sky-tinted Fresnel sheen, a lapping band at the shore, and warm
light glints on the water at night. Wakes trail every boat.

### 2.3 Life (instanced, time-of-day driven)
| Where | What | When |
|---|---|---|
| Lady Bird Lake | rowing eights, fours and singles with oar strokes, in lanes | dawn and evening |
| Rental docks (Texas Rowing Center, Rowing Dock, Zilker Park Boat Rentals, Congress Avenue Kayaks, EpicSUP) | paddleboarders, kayaks, canoes wandering near their docks | mid-morning to sunset |
| Congress Ave Bridge | Lone Star Riverboat by day; bat boats and a crowd on the bridge at dusk | dusk |
| Butler Hike-and-Bike Trail and Boardwalk | walkers, runners, cyclists | all day, peaks at morning and evening |
| Barton Springs Pool | swimmers, sunbathers on the south slope | day |
| Zilker Great Lawn | kites with tails, people on the lawn | day |
| Zilker Park | the Zilker Eagle mini train on its track | day |
| Rainey Street, East 6th | string lights, crowds | night |

Agents are low-poly instanced meshes. Their scale is exaggerated with camera distance (true
size up close, capped at ~6×; rowing shells at 2.5×) so they read at downtown zoom. They fade
out beyond ~8 km and fall back to fewer instances on low-power devices.

### 2.4 Landmarks (procedural low-poly models)
- **Texas State Capitol**: wings, drum and dome in sunset-red granite.
- **UT Tower**: glows burnt orange at night.
- **The 13 moonlight towers**: 165 ft lattice towers whose lamp rings glow cool white at night.
- **Bridges**: Congress Avenue (arches, with the bats), the Pfluger Pedestrian Bridge and
  Pennybacker Bridge (steel arch over Lake Austin).
- **Mount Bonnell**: the overlook.
- **Barton Springs Pool**: the pool and its bathhouse.
- **Rainey Street**: bungalows under string lights.

### 2.5 Story and exploration
- **Paddle Lady Bird Lake**: a journey mode like the Red Line ride. The camera follows a
  paddleboarder from Red Bud Isle to Longhorn Dam, and a HUD names what you pass.
- **Places**: landmark cards (what it is, one sourced fact) in search and in an Explore layer.
- **Tour chapters**: morning on Lady Bird Lake, midday at Zilker and Barton Springs, and Rainey
  Street at night, woven between the company stops.

### 2.6 Budget
- The central assets load after first paint, and the map upgrades in place.
- The patch adds ≤ 2.5 MB compressed.
- Detail layers render only when the camera is within ~15 km, and add about +15 draw calls.

### 2.7 Build order (each step pushed with a Vercel preview)
1. Pipeline: central assets and QA renders.
2. Patch terrain and living water.
3. River life and docks.
4. Parks, trails, people and trees.
5. Landmarks and the night city.
6. The paddle journey, places and tour chapters.
7. QA, perf and mobile.

### 2.8 Status (2026-09-27): built

Everything in 2.1–2.5 is in, plus an offices-and-skyline pass that the owner asked for mid-way,
using levels.fyi's atlas as the reference.

- **Patch and water** (2.1, 2.2): the central patch covers lon −97.800…−97.705,
  lat 30.236…30.325, so it reaches Mount Bonnell and Tom Miller Dam, a little larger than
  planned.
- **Life** (2.3), all instanced and driven by time of day:
  - rowing shells, paddleboards, kayaks, canoes on Barton Creek, the Lone Star Riverboat and bat
    boats (`RiverLife`)
  - ~700 trail users on the Butler trail graph, swimmers and sunbathers at Barton Springs and
    Deep Eddy, and picnics, canopy tents, kites, frisbees, strollers and dogs on the Great Lawn
    (`ParkLife`)
  - the Zilker Eagle on its track
  - crowds on Rainey Street (under string lights), East 6th (under neon) and South Congress,
    bat watchers on the Congress Avenue Bridge, and the sunset crowd on Mount Bonnell
    (`CityLife`)
  - Low-power devices get about 40% of the crowds.
  - The bat emergence (`Bats`) is one stream of 12,000 bats (4,000 on low-power devices). They
    pour out along the Congress Avenue Bridge, funnel down Lady Bird Lake and climb away
    east-southeast, leaving in waves and peeling off as the ribbon disperses. Each bat faces its
    direction of travel, beats its wings at 8-11 Hz, and is drawn a few pixels across at any
    zoom. They're out from golden hour on, and held still under reduced motion.
- **Landmarks** (2.4), in `Landmarks`:
  - the Capitol, the UT Tower (burnt orange at night), the 13 moonlight towers (glowing lamp
    rings), the Pennybacker arch, Mount Bonnell's pavilion, Tom Miller and Longhorn dams, and
    arches under the Congress Avenue Bridge
  - Frost Bank Tower's crown, The Independent's stacked blocks, Block 185's sail, the DKR
    stadium bowl and Moody Center, found by their Overture names in the pipeline
    (`NAMED_LANDMARKS`)
  - Their plain extrusions are left out of the building mesh.
- **Buildings**:
  - Walls carry a stable facade coordinate (`aU`), which fixed shimmering lit windows and drives
    daytime detail: curtain-wall glass with mullions and reflected sky on towers, punched
    windows in stone, stucco and brick.
  - Houses get hip or gable roofs, and larger roofs get HVAC plant and penthouses.
  - All of it fades back to the paper look beyond ~14 km.
- **Story and exploration** (2.5):
  - Paddle Lady Bird Lake: a fourth mode following a paddleboarder from Red Bud Isle to Longhorn
    Dam through golden hour, with a HUD of landmarks and bridges ahead.
  - 17 place cards, each fact checked against the listed Wikipedia article. They open from map
    labels, search and `?p=`.
  - Three new tour chapters (lake in the morning, Zilker and Barton Springs at midday, Rainey
    Street after dark).
  - Company labels carry a sourced figure (valuation, amount raised, or ticker).
- **Budget** (2.6):
  - The regional map (~2.85 MB on the wire) opens the atlas. Central Austin (~3.6 MB: patch
    terrain 0.95, surface 1.48, trees 0.35, paths 0.10, buildings 0.76) loads behind it, and the
    scene upgrades in place.
  - Buildings use a binary format (`scripts/atlas/building_codec.py`). Footprints are ordered
    along a Hilbert curve and stored as varint streams, which is about 40% smaller on the wire
    than the JSON it replaced, lossless, and decoded straight into typed arrays.
  - Phones and other low-power devices load the four rasters at half resolution
    (`build_lowres.py`), which matches their coarser meshes. Their regional map is ~1.1 MB and
    central Austin ~2.1 MB, inside the target. The cost is softer hillshading when zoomed into
    the hill country.
  - Desktop's patch is still over the 2.5 MB target. The next win is sorting the trees
    spatially (about 25% off that file).

### 2.9 Beyond downtown (2026-09-27)

Asked for after 2.8: more detail outside central Austin.

- **Detail tiles** (`build_tiles.py`, `DetailTiles`, `src/lib/atlas/detail/`): everything the
  always-loaded files leave out, cut into 2 km tiles. They load for everything in view while
  the camera is within 18 km of its target (up to 26 km from the camera; 8 and 11 km on
  phones), nearest first, and around every company site in view from as far as 42 km (20 km on
  phones), so the tour's outer stops show whole neighbourhoods around each office, as central
  Austin does. A tile holds:
  - every other building in the region (824k footprints), rising out of the ground as its tile
    arrives
  - local streets, service roads, parking aisles, paths and tracks at their real width, with
    kerbs, a double yellow on arterials and streetlights after dark
  - runways and taxiways with their markings, white edge lights and green centreline lights
  - parking lots, aprons, backyard pools (lit at night) and small ponds
  - trees over the regional land cover, clear of roofs, streets and water: woods where it says
    forest (thinner where it's built up), a scatter over shrubland, and yard trees through the
    neighbourhoods
- The pipeline writes 2,136 tiles, 20.6 MB in all. Most are a few KB and the densest is 75 KB.
  A worker decodes and meshes them, so they stream in without stalling a frame. At most 84 are
  drawn at once (24 on phones). From afar, local streets fade out first, then arterials and
  parking lots, and single trees give way to the terrain's canopy tint beyond 8 km.
- The tour's outer stops (the industrial belt, the Domain and Cedar Park, at 11–12.5 km) now
  draw 5.0–6.2M triangles on desktop and ~3.2M on phones, about what a downtown view already
  draws (6.5M and 4.3M), in ~200 draw calls.
- **Offices**:
  - Company buildings keep their materials (glass, brick, windows) from further out than the
    paper city around them.
  - Saronic's plant, Aalo's factory and Aeon Industrial's HQ aren't in Overture yet, so the
    pipeline gives each a placeholder footprint of plausible size at its address, aligned with
    the buildings around it (`PLACEHOLDERS` in `build_buildings.py`).
  - Base Power's planned Factory 2 is shown going up (`Construction`): a graded pad and slab, a
    steel frame part raised and part roofed, and two tower cranes slewing over it.
- **Traffic** (`Cars`): up to 1,400 cars (350 on phones) around the camera once it's within
  ~5.5 km, on the tiles' streets and arterials and, inside central Austin, on its roads (the
  tiles carry those as lanes that aren't drawn). They keep right, spread over the lanes of
  one-way carriageways, cross the river on the bridge decks, and show headlights and
  taillights after dark.
- **Austin-Bergstrom** (`Airport`):
  - airliners on final over East Austin to 17R, rolling out and turning off for the terminal
  - departures lining up on 17L and climbing out to the south
  - aircraft nose-in at the Barbara Jordan Terminal's gates and at the South Terminal
  - landing lights, beacons and wingtip lights at night

Known limits:
- Crowds, boats and the tower shapes are impressions, not surveys.
- The UT Tower is shown orange every night, while the real tower is orange for occasions (its
  card says so).
- The regional terrain softens the Pennybacker's bluffs, so its deck slopes gently between
  banks.
- Outside central Austin the land cover is coarse, so woods follow generalised outlines. The
  three placeholder footprints are approximations until Overture maps the real buildings.
  Streets lie flat on the terrain (no overpasses), and buildings without an Overture height
  get one from their size.

### 2.10 Past the edge, and steady labels (2026-09-28)

Asked for after 2.9: no dead space where the map cuts off, and no glitching when a company's
label is hovered.

- **The country around the map** (`build_outer.py`, `Terrain`): relief, lakes and rivers for
  ~80 km on every side (to San Antonio, Killeen and Temple), at ~264 m a pixel (0.58 MB, 0.21 MB
  on phones).
  - The terrain's grid carries on over it in cells that grow to 2.2 km. Heights ease from the
    map's onto the coarse relief within 3 km, and the map's canopy and park tints thin out over
    its last 5 km along an uneven line, so there's no seam.
  - Its far edge fades into the ground colour over 16 km. Below the horizon the sky draws the
    ground fogged exactly as the terrain is, so wherever the land runs out, even zoomed all
    the way out, the two meet without a line.
  - The fog our shaders show is lighter than three's fog colour (three hands it over encoded
    for the screen, and our shaders blend before encoding). The sky's horizon and ground use
    that same colour (`sky.uFogColor`), so the land meets the sky without a band. After dark
    that reads as the towns' glow along the horizon.
  - Towns of 1,500 people or more around the map light up after dark (`TownLights`), sized by
    population and fading into the haze with distance.
  - Highways and roads stop along an uneven line just inside the map's edge instead of on a
    straight cut.
- **Labels**:
  - A hovered label no longer re-lays out its neighbours. It keeps its place and expands where
    it is, over the others.
  - Beacon stems take their height from the site's emphasis without hover. A stem growing under
    the pointer used to carry the label out from under it, so the hover flickered.

### 2.11 Every company site, modelled (2026-09-28)

Asked for with 2.10, then NXP and The Boring Company, then every company. All 47 sites are
models (`siteModels/`, `SiteModels`) instead of plain extrusions in their domain colour. Base
Power's Factory 2 is the construction site from 2.9.

- The buildings stand on their mapped footprints, in central Austin's file as well as the
  regional one. Models are rebuilt once the patch loads.
- The plant and props around them go where the map has no building or street: each spot was
  checked against every footprint and street nearby. The detail tiles keep their trees off them.
- The signature sites are modelled one by one (`signature.ts`). The rest go by the kind of place
  they are (`archetypes.ts`), each with a prop where one plausibly stands.
- Trim carries the site's domain colour, and when a site is picked or in the tour's focus the
  whole model takes it on.
- Glass reads as curtain wall: mullions and floor slabs by day, and at night windows lit floor
  by floor, about as many as in the city around.
- Floodlights come on after dark, and red obstruction lights blink on the tall structures.
- ~70k triangles in all, in one draw call.

Signature sites:
- **Giga Texas**: the 1.2 km hall in white panels over a grey plinth, with a band of windows.
  Its roof carries solar arrays at both ends and Tesla's T between them, top to the north, as the
  real roof does. The outbuildings have rooftop plant.
- **Samsung, Austin and Taylor**: fabs in white, and rooftop air handlers and exhaust stacks in
  rows. The utility building carries a bank of cooling towers with steam drifting off them. A
  gas yard holds air-separation columns, a cold box and storage tanks. Taylor's heights (40,
  26, 30 and 28 m) are estimates: the map has none.
- **NXP, Oak Hill and Ed Bluestein**: the same kit, in the tan precast of fabs from Motorola's
  day.
- **Firefly's Rocket Ranch**: the shop buildings, and a test area east of them:
  - a 44 m steel stage stand with a first stage in it, over a flame trench, with floodlights
  - the horizontal engine stand the existing plume now fires from
  - a propellant farm, a water tower and a bermed control bunker
- **Starlink, Bastrop**: the factory in white with a black band, rooftop plant, skylights, and
  trailers backed up to the docks on the truck-court side.
- **The Boring Company, Bastrop**: the factory in grey metal. North of it a tunnel boring
  machine is staged on cradles (cutterhead, shield, trailing gantries). East of it, stacks of
  tunnel-lining rings stand under a gantry crane, clear of Snailbrook's houses.

By kind:
- **Fabs** (the fab kit): SkyWater's Fab 25 and TIE's Montopolis fab, each with a gas yard.
  Applied Materials gets the rooftop plant and cooling towers over its cleanroom manufacturing,
  without a gas yard.
- **Factories**: walls in tilt-up concrete or metal, rooftop units and skylights, and a glass
  office front across the end nearest the address. Loading docks where there's a truck court.
  - Saronic: finished boats on their trailers in a paved yard.
  - Aalo: a reactor vessel on a low trailer.
  - Hyliion: generators in container-sized enclosures, lined up to ship.
  - ICON: a construction printer's gantry over a small house going up in layers.
  - Base Power (Factory 1, the old Statesman plant): home batteries on pallets.
  - Firefly's HQ: a dish on the roof for mission control.
  - Also Allen Control Systems (both), Aeon Industrial, Last Energy, Infinitum, Apptronik and
    Fox Robotics.
- **Labs**: ribbon windows floor by floor, a penthouse with fume-hood stacks.
  - ARL: radomes on two roofs and a 34 m antenna mast.
  - UT's Center for Space Research: a ground-station dish.
  - TACC: chillers in the yard beside the machine room.
  - CesiumAstro: radomes and a mast on the roof.
  - EnergyX: a small process skid.
  - Also BAE Systems, Nanohmics and Canon Nanotechnologies.
- **Offices**: curtain-wall glass (AMD, Ambiq, Mythic, Neurophos, NI, and downtown T2COM's
  tower, the Army Applications Laboratory, Silicon Labs, Cirrus Logic and Diligent Robotics),
  or punched windows (Perseus Defense, Ideal Power, the Army Software Factory). Penthouses on
  the taller ones.
  - Skyways: a landing pad on legs over the rooftop plant, with one of its VTOL drones on it.

Also: the detail tiles keep trees off every tile a footprint reaches into. Before, only the tile
holding its first corner was masked, so a building across a tile edge could grow trees.

### 2.12 The University of Texas (2026-09-28)

Asked for after 2.11: the campus, stadium, tower and West Campus weren't looking as they should.

- **Campus**: inside UT's main campus (Overture's "University of Texas at Austin" polygon,
  `campus.ts`), buildings wear Leuders limestone and buff brick with punched windows.
  - They sit under red clay tile hip roofs, and keep those materials from further out than the
    city around them.
  - `roofs.ts` builds the roofs for any footprint: it rasterises the footprint on its own axes,
    merges the cells into rectangles, and puts a hip roof on each. Wings get their own roofs,
    which cross where they meet.
  - Flat roofs, by rule: towers over 40 m, halls over 12,000 m², six buildings known to be
    flat-roofed (LBJ Library, Sid Richardson Hall, PCL, Jester, the Memorial Museum, Bass
    Concert Hall), and everything south of MLK, where the medical school's towers are.
  - Some modern halls north of MLK get tile roofs they don't have.
- **Main Building and Tower**: the Main Building in the campus style under hipped tile roofs,
  with a columned loggia over the south steps. The shaft stands on a rusticated plinth with three
  bays of windows up each face, under the clocks, the colonnade and the temple. It is still
  burnt orange after dark.
  - Littlefield Fountain at the foot of the South Mall: a pool behind a limestone rim, levelled
    on the slope, and Coppini's bronze group on a stepped island (the ship, Columbia on its prow
    between a soldier and a sailor, three sea horses ahead). Its water used to sit exactly level
    with the basin's top, and the two flickered against each other.
- **Darrell K Royal–Texas Memorial Stadium**, rebuilt inside its footprint:
  - the field, with burnt-orange end zones, a line every five yards and a midfield circle
  - a burnt-orange lower bowl with aisles, a concourse and a ring of suites
  - upper decks, tallest on the west under the glass press box
  - the north end-zone building, the video board over the south stands, and LED light bars
    along the rims
  - After dark the field and seats light up under the lights while the structure stays dark.
    The Moody Center stays dark too, instead of glowing as floodlit stone.
- **West Campus** (Guadalupe to San Gabriel, MLK to 29th St): apartment blocks from three
  storeys up in stucco and brick, with wide windows and a balcony slab at every floor. The
  towers get pool decks on their roofs, an impression, not a survey.
- **Night**: the hemisphere light's ground colour now goes dark with the night. Before, walls
  lit by it kept a beige glow after dark.

### 2.13 The Capitol, and creeks that read as creeks (2026-09-28)

Asked for after 2.12: more detail around the Capitol, the fountain fixed, and the "river" between
the campus and the stadium.

- **Creeks**: the blue ribbon by San Jacinto Boulevard is Waller Creek, which runs 20-30 m from
  the road there.
  - Overture tags most of Austin's creeks "river", and the pipeline drew every named river line
    14 m wide in pale lake blue, so the creeks read as rivers.
  - Named creek lines are now 5 m (the Colorado and Barton Creek keep 14). Where banks are
    mapped, their polygons (5-11 m for Waller Creek) give the width.
  - The terrain shader treats water as a creek when it is nowhere more than a few metres from a
    bank within 9 m. Creeks are drawn darker, greener and stiller, as in the shade of the trees
    along them.
- **The Capitol** (`capitol.ts` places everything in the building's own frame, turned 17.7° with
  the street grid):
  - sunset-red granite walls in a style of their own in the buildings' shader: tall windows
    between pilasters over a rusticated ground floor, floodlit after dark
  - the south portico (six columns, entablature, pediment) over the steps down to the Great
    Walk, the north portico, pediments on the east and west ends, and the chambers' skylights
  - the dome, over the rotunda: a colonnaded drum with windows, an attic, a ribbed shell with
    lucarnes, and the lantern under the Goddess of Liberty and her gilt star, 92 m up. It
    glows above the floodlit walls at night.
- **The grounds** (Capitol Square):
  - The Great Walk runs from the 11th Street gate to the steps, lamps along it, and the iron
    fence and granite gate piers run along 11th.
  - On the south lawn: the two fountains, and the monuments (from Overture places), each drawn
    in a rough version of its form.
  - On the north lawn: the Capitol Extension's skylights (in the building files they were
    little grey blocks) and its open-air rotunda, looking down to the star on its floor.
  - The drives and walks are cut out of the lawns.
  - The grounds are mapped as lawns, which the canopy sampler leaves bare, so they get their own
    planting: about 240 live oaks and pecans, clear of the Great Walk's view of the south front
    and of the lawns over the Extension.
  - The patch's trees now keep off every site model's and landmark's clearing. The tree
    sampler draws its random numbers for the whole grid, so a change in one place only moves
    the trees there.
- **Around it**:
  - The state's office buildings (listed by a point inside each) wear Texas limestone and pink
    granite, their roofs clear of plant.
  - The Governor's Mansion: Greek Revival, six columns and a gallery facing Colorado Street.
  - The Old Land Office (the Visitors Center), with its crenellations.
  - St. Mary Cathedral, with its tower and spire.

### 2.14 Opening on the city, in colour (2026-09-30)

Asked for after 2.13, comparing with the levels.fyi atlases: they open close in on the city and
look vibrant, while this one opened on the whole region at dawn and looked drab.

- **The opening view** is now central Austin at street scale, 4.4 km out, looking up Congress
  Avenue: Lady Bird Lake in front, the skyline, the Capitol and the UT Tower and stadium behind.
  - The opener's text describes that view. The Balcones Escarpment line moved to the Hills
    stop, which is where the real hills are.
  - The tour's first stops moved later into the morning, so the light keeps brightening from
    the opener. Downtown now looks north-northwest from the south shore, closer than the opener.
  - The whole region still closes the tour, at night.
- **Loading**: central Austin's detail now loads alongside the regional map, not after it, and
  the loader stays up until both are in. Before, the first view had no downtown until the
  detail arrived. The first reveal costs about 8 MB on desktop and 4.5 MB on phones, up from
  3.8 and 1.7 (file sizes; JSON and binaries travel compressed).
- **Colour**:
  - Sky: a clear blue by day, with a light blue horizon instead of cream, and a little less haze.
  - Light: stronger sun against cooler, sky-lit shade, so buildings read in relief.
  - Water: deep blue-teal, lighter in the shallows; creeks greener.
  - Land and trees: warm sand land; saturated lawns, canopy and trees (live oak and pecan greens,
    darker cedar and cypress).
  - Buildings:
    - glass towers in blue, teal, steel and bronze
    - mid-rises in limestone, sand, concrete and brick
    - houses painted white, butter, pale blue and terracotta, under mostly grey, brown and metal
      roofs
    - rooftop plant lighter, so it doesn't read as black boxes
  - Streets: asphalt grey instead of paper white, with dashed centre lines on two-lane streets up
    close. Parking lots are grey, pools a brighter blue.
- **Phones**: portrait screens get a wider field of view (up to 48° vertical, from 32°), so a phone
  sees about as much of the city across as a laptop. In the tour, each stop's subject sits in the
  open map above its card.

### 2.15 Instant first view, toy-model shading, clouds and water (2026-09-30)

Asked for after 2.14: drifting clouds and toy-model shading; less blocky, more detailed; more
realistic water; and a first view as instant as the levels.fyi atlases'.

- **The first view is a picture, straight away.** The opening view is pre-rendered as two images
  (`public/atlas/poster.webp`, 2400×1200 and about 550 KB, and `poster-portrait.webp` for phones,
  about 260 KB), shown the moment the page loads, over a tiny blurred copy inlined in the page
  (1 KB for both) until the image itself arrives. Each is the tour's first view from the live
  camera's own position and direction, so fitting it to any screen is only a scale (the field of
  view) and a shift (the focal point): CSS does it before any script runs, and the live map
  cross-fades in over it, lined up, when ready. Scrolling waits for the live map, and the tour card's hint
  reads "Loading the live map" with a progress bar until then. The posters are renders of the
  app (`scripts/atlas/render_poster.py`): re-render them whenever the opening view's look changes.
- **Loading starts with the HTML.** A small inline script in the atlas's layout asks for the poster
  and the first view's data files (the phone set on phones, by the same test the app uses) as
  the page arrives, before any JavaScript loads; the app's own requests then reuse them.
- **The heavy lifting moved off the main thread.** A worker (`src/lib/atlas/prep/`) decodes the
  images and does all the preparation (terrain textures, building extrusion, the site models, the
  central patch's grid, trees, the lakes' water levels), handing back plain arrays, so the page
  stays responsive while it loads. Where workers can't decode images, the same code runs on the
  main thread.
- **No fly-in.** The camera is on the opening view from the first frame.
- **Measured**: the page's `atlas:*` performance marks break the load down (see
  `scripts/atlas/README.md`). Locally, the data files start downloading about 60 ms into the page
  load instead of 1.4 s; the rest is download size and the GPU.
- **Toy-model shading:**
  - Sun shadows from buildings, company sites, landmarks, bridges and trees, sharp up close and
    broader from afar. They fade out at dusk.
  - Contact shadows: the ground darkens where buildings meet it and down narrow streets, walls
    darken lower down between towers, and roofs darken around their plant rooms. The buildings
    are drawn from straight above into a height map around the view, redrawn as it moves, and
    each surface looks at the heights around it. Desktop only, up close.
  - Walls darken toward the ground, and rooflines catch a bright edge.
- **Detail:**
  - Flat roofs sit behind parapets.
  - Towers are crowned with a penthouse, a smaller plant room on top of it, and plant units either
    side.
  - Mid-rises and towers have dark glazed shopfronts and lobbies under a pale fascia at street level.
  - Curtain-wall glass varies panel by panel.
- **Clouds:** fair-weather cumulus, soft flat-bottomed cushions drifting on a south-easterly
  breeze and casting soft shadows on the ground and buildings.
  - They keep to the edges of the picture: any drifting over the middle, around what the camera
    looks at, or too close to the camera, shrinks away.
  - They thin out in the widest views.
  - Three are placed to frame the opening view. They're in the poster, and start drifting when the
    live map appears.
  - At night they're dark, with the city's glow underneath.
- **Water:**
  - Lady Bird Lake and Lake Austin mirror the skyline, bridges and trees, broken up by wind
    ripples. The scene is drawn again from below the surface each frame. Desktop only, up close.
  - Ripples at two scales everywhere.
  - Deeper colour, from green shallows to deep blue, with more of the sky at a glancing angle and
    the sun's glint (not in shadow).
  - Wet, darker banks. The drawn shorelines are gone.
- **Phones** get smaller shadow maps and fewer clouds, and no reflections or contact shadows.
- **Slow GPUs**: if frames stay under about 42 fps for a second and a half once the map is up,
  quality steps down, one step at a time: a pixel ratio of 1.5, then no contact shadows, then no
  lake reflections, then a pixel ratio of 1. Automated renders (the posters, QA screenshots) keep
  full quality.

### 2.16 Smooth again (2026-10-01)

Reported after 2.15: very laggy. Measured at the opening view (triangles drawn per frame, all
passes): 15.2 million at rest and about 21 million flying the tour, against about 7.5 million
before 2.15. The lakes' reflection drew the whole city again every frame; the sun's shadow map
and the contact shadows' height map redrew it on every frame the camera moved.

- **The reflection draws only what shows in it**: the buildings 12 m and up, as a small mesh of
  their own (extruded in the prep worker, desktop only), the bridges, the sky and its clouds:
  0.4 million triangles instead of 7.6.
- **Shadows redraw when it matters**: when the view has moved 4% of the way across the shadow
  box, zoomed a step, or the sun has turned about half a degree (flying between stops turns it),
  not every frame; in between, the box and its map stay together, so shadows stay
  right. Trees cast shadows only within 2 km.
- **Contact shadows**: the trees are left out of the height map (2.6 million triangles), it
  redraws after the view moves a tenth of its width rather than a sixteenth, and each pixel takes
  12 samples on the ground and 6 on walls, down from 16 and 10.
- **Trees**: indexed (about 55 vertices a tree instead of 300), and the ones over 1.6 km from the
  camera, a few pixels across, are low-poly crowns without trunks (26 triangles instead of 100).
- **Cloud shadows** loop over the clouds near the view only (at most 12).
- **Result** at the opening view: 5.8 million triangles a frame at rest (fewer than before 2.15),
  and about 7 million flying.
- **Slow GPUs** step down sooner and gentler: a pixel ratio of 1.5 first.

### 2.17 A quicker, smoother start (2026-10-01)

Reported after 2.16: smooth once running, but the start was laggy and slow. Profiled the main
thread through a first visit (this container's software GPU, so times are long; what matters is
what blocks):

- **The page's first script carried three.js**: 1.5 MB of JavaScript before the app could start,
  pulled in by the labels and the camera maths. Now the first script is the page itself (0.6 MB),
  and three.js, the map and its labels load alongside the data as soon as the app starts. Here the
  app starts at 0.3 s instead of 1 to 3 s.
- **A throwaway WebGL context**, made only to check for WebGL 2 (0.6 s here), is gone: the API's
  presence is checked instead. If the map's own context can't be made, or the scene fails to start,
  the page falls back to the list as before.
- **Two glow textures drawn on a 2D canvas** (1.5 s here, as the browser started its 2D renderer for
  them) are computed directly.
- **The detail tiles' worker** was sent copies of the regional rasters twice over; they're handed
  over now.
- **Label sizes** were measured with a page layout for each label (0.3 s); now three layouts in all.
- **Shaders compile in the background** before the scene is first drawn (nothing is drawn until
  they're ready, while the poster is still up), so the page never stops dead waiting on them.
- **What the opening view doesn't show** (traffic, boats and rowers, people in the parks and
  streets, the bats, the airport, the town lights, the launch plume) is built only once the live
  map has faded in, a piece at a time when the browser is idle, each shown once its shaders are
  ready. (Each is 7 to 25 ms of script here.)
- **The reveal waits at most 0.6 s** for the detail tiles at the far edge of the opening view
  (it was 2.5 s); they fade in if they're later.
- **The story scrolls from the start.** It used to wait for the live map; now the cards move over
  the poster, and the live map opens on whichever stop the reader has reached.
- **Less to draw per frame, from the first frame:**
  - Desktops render at up to 1.5 device pixels a CSS pixel, not 2: a Retina laptop shades 45%
    fewer pixels, for a picture that's barely softer (labels are HTML, unaffected).
  - Contact shadows only within about 4 km (they're under a pixel further out), so the opening
    view doesn't draw them.
  - The lakes' skyline is the city mesh's own triangles (the buildings 12 m and up, over the same
    vertices), not a second extrusion: less work in the worker, nothing extra to upload.
- **The quality governor acts from the reveal**, judging the median of the last 40 frames (or the
  last second's, if fewer), so a tile or a piece arriving doesn't count: if frames stay under about
  42 fps for most of a second, contact shadows go, then the reflections, then the pixel ratio drops
  to 1.25, then 1. A step that would change nothing in the current view (no contact shadows or
  reflections drawn in it) is passed straight over.
- **Waiting on shaders never hangs**: three's compileAsync never resolves if a material is disposed
  while it waits, which with the draw held for compiles could have left the map behind the poster
  for good. The atlas polls readiness itself, skips materials that went away, and stops waiting
  after 6 s regardless.
- **Result** on the preview, as a phone (this container's software GPU): the live map at 11 s
  instead of 17 s. Locally, main-thread stalls before the reveal down from 8.1 s to 2.5 s, and
  central Austin prepared at about 3 s instead of 7.3 s. Shaders themselves compile in 2 to 15 ms
  each (about 250 ms for all 38, measured with the shader cache bypassed); the rest of the wait
  here is the software renderer drawing its first frames, which a real GPU does in milliseconds.

### 2.18 Cards that hold with their stop (2026-10-02)

Reported: the tour's cards scrolled away too soon, before the map had moved on. Each card was
pinned to a point in the scrolling page, so it moved at full scroll speed the whole time, while
the camera holds still on each stop for 1.1 to 1.5 screens of scrolling: by the end of a hold
the card was half off the screen and fading.

- **Each card now holds still for as long as the camera holds on its stop.** It sits in a lane
  that spans its stop's hold: it scrolls in with the page as the camera arrives, sticks (CSS
  sticky, so it's as smooth as the scroll itself) for the whole hold, then scrolls on and fades
  as the camera flies to the next stop. Fully opaque throughout the hold; it fades in over the
  last 0.4 screens of the flight in, and out over the first 0.3 of the flight away.
- **Where it holds is measured**: its middle at the usual anchor (the middle of the screen; two
  thirds down on phones), but never under the header or past the bottom edge.
- **Short laptop screens** (under 860 px tall) list a stop's companies one line each, what they
  build cut short after the name (the map's labels carry it in full), so the longest cards (seven
  or eight companies) fit while they hold: 481 px instead of 661 at 1440×740.
- The tour is as long as before (the lanes past either end are clipped).

### 2.19 The opening, as the Levels.fyi atlases open (2026-10-03)

Reported: the atlas skipped the opening screens the Levels.fyi atlases have. It opened straight
on the poster (2.15) and the first card. It now opens the way theirs do, in Austin's own terms:

- **A loader drawn for Austin.** A paper panel with an inset rule. The Capitol rises against a
  dusk sun, downtown's towers grow either side (the Austonian, the Independent, Frost Bank Tower,
  Sixth and Guadalupe), the Congress Avenue Bridge's arches draw in over Lady Bird Lake, and bats
  stream out from under it. Below: "AUSTIN" rising letter by letter, a progress bar with a Red
  Line train riding it, and a line saying what's being built ("Filling Lady Bird Lake",
  "Building downtown"...). The bar creeps on while a step reports nothing (the shader compile at
  the end), so the train never stands still. Bar and train move by transforms, which the
  compositor keeps smooth while the page is busy. When the map is up, the bar fills and the whole
  panel wipes away upward (0.9 s). With reduced motion the scene is drawn in full and the wipe is
  a fade. Every visit gets it, deep links included; a browser that can't run the map still gets
  the table.
- **The title card.** Centred over the opening view: "An atlas of who builds what", THE SILICON
  HILLS (Nunito Black, the name in burnt orange), and an italic line: "Austin, rendered: the
  companies building warships, rockets, humanoids, reactors and the chips inside all of them."
  Its parts rise into place as the wipe passes. It goes as the tour sets off and comes back at
  the top. × puts it away until the chapter list's first entry. It steps aside for a company's
  panel. It replaces the first story card. Under it the camera puts the city lower on the
  screen: Downtown, the Capitol and the lake below the card, north Austin and the clouds above.
- **"Scroll to descend"** with a bobbing ▾ at the bottom, while the title card is up.
- **The chapter list** down the left on screens 1100 px and wider. It shows each stop with its
  number, the current one underlined, and jumps to any of them. The tour's cards move right to
  clear it (max(280 px, 16vw)), and the camera's focal point moves right with them.
- **The rail is a Red Line**: a stop for each chapter at its place along the scroll, and a train
  that rides down to where the story is. The line fills red behind it, and each stop turns red as
  the train reaches it. Names show on hover. On phones it sits higher, out of the cards' way.
  The list and the rail slide away outside the tour.
- **A soft vignette** darkens the map's corners, under the labels and panels.
- **The poster is gone**: its images, the blurred copies inlined in the page, its preload and
  the script that rendered them. The loader covers the screen until the map is up, and the
  map's own files load sooner without the poster competing for the connection.

### 2.20 Musk country in two stops, and an airport that reads as one (2026-10-03)

Reported: the Highway 71 stop looked odd. It framed 21 km of empty country from 23 km up, with
Giga Texas small at one edge and the Bastrop sites specks under the header. Separately, the
airport looked undetailed, especially from further out.

- **The stop is two now.** "05 · Giga Texas" (Musk country) frames the gigafactory from 4 km:
  the solar roof and its T, SH-130 alongside, the Colorado River curving behind. Its card carries
  the facts the company data already had (2,500 acres, 10M+ sq ft, Model Y, Cybertruck, 4680
  cells, Cortex). "06 · Bastrop" ("Dishes and tunnel machines") frames SpaceX's Starlink
  factory and The Boring Company side by side from 2 km. The later chapters are renumbered
  (07 Zilker through 16 Rainey Street).
- **Austin-Bergstrom** (Airport.tsx, with its facts in lib/atlas/airport.ts):
  - Both runways are drawn by the airport itself, from any distance. They are never thinner than
    about a pixel and a half, and are painted the FAA way: twelve threshold bars, the designators
    (17R/35L, 17L/35R, letter nearest the threshold), touchdown zone bars, aiming points, the
    dashed centreline, edge lines, and tyre rubber in the touchdown zones. Every marking is
    box-filtered, so from afar it averages to grey instead of shimmering. After dark they get
    edge lights and green threshold bars. The detail tiles no longer draw ABIA's runways.
  - Aircraft park at the 27 real gate stands (Overture's gate points on the Barbara Jordan
    Terminal's edge, thinned where two share a spot). They face the concourse, with jet bridges
    out to their doors. They're drawn at 1.2x, so neighbours' wings clear, and up to half as
    large again from further out (growing from the nose, which stays at its stand). Before, they
    vanished beyond 7.5 km. Taxiing and landing aircraft grow the same way.
  - The control tower is modelled: a concrete shaft on the octagon Overture maps at the south
    corner of its footprint, a flared deck, a slanted glass cab that glows at night with a red
    beacon, the roof and antenna, and the base building and annex beside it. Overture gives the
    whole complex one 69.5 m footprint, which the tiles drew as a glass office block; they now
    leave it out.
  - The infield is grass: the mown grass inside airfields (Overture land use "grass" within
    their bounds, 607 ha at ABIA) is painted into the surface raster's park channel at 220/255
    (build_surface.py; only those pixels changed, in both rasters).
  - Paving reads as three materials: runways darkest, asphalt taxiways (yellow centrelines kept
    about a pixel wide out to ~6 m/px), and concrete aprons in 7.5 m slabs.
- **A bug that hid every parking lot, apron, pool and pond outside central Austin.** The tiles'
  polygons come out of the triangulator facing down, and the paint material only drew front
  faces, so they were all culled. Paint is now double-sided. Polygons wider than 40 m are also
  cut along a 40 m grid (gridCut, crack-free between neighbouring triangles) so they lie on the
  ground instead of having the terrain rise through them. Ponds and stormwater basins (one class
  in the tile data) take the map's water colour instead of a pool's cyan.
- The ground paint's lighting moved to scene/paint.ts, shared by the tiles and the airport.


### 2.21 Smooth all the way through, and Austin-Bergstrom in its own colours (2026-10-03)

Asked: find anywhere the atlas wouldn't load or run smoothly, and fix it. Also, the airport was
better but still drab: show its real colours and finer detail.

**Smoothness.** The audit scrolled the whole tour at a reader's pace, then went through explore,
night, the Red Line ride and the paddle, in headless Chromium. It recorded a CPU profile, every
long task, and every WebGL call that compiles a shader or uploads a buffer, with its stack.
Nearly every long frame was a shader compiling at the moment it was first drawn, not
JavaScript. Three kinds escaped the background precompile (Precompile):

- **The other passes' programs.** Drawing into a render target takes programs of its own,
  because its colour space isn't the screen's. So these compiled the first time they drew:
  - the sun's shadow map (three's depth material, a program per kind of caster and side), as
    each new kind of thing first came into the sun's box mid-tour;
  - the contact shadows' height map, at the first close view;
  - the lake reflection.

  Precompile now compiles these as well, with stand-ins that match how each pass draws
  (AtlasCanvas `compilePasses`). The shadow map draws without the scene, so without its fog,
  which three's program keys record.
- **The lights.** Three keeps one light setup per scene, and the shadow map draws before each
  frame sets up its own. The height map's camera saw no lights, so the shadow map drawn after it
  needed "no lights" programs, compiled there and then. The lights are now on every pass's
  layer.
- **The first frames.** The map drew a few frames before the precompile had begun. Everything
  in view compiled there and then, a shader at a time, while the loader stood still. Nothing is
  drawn now until the first precompile is done (`runtime.compiling` starts true).
- `compiled()` now waits for exactly the programs a compile created (the renderer's program
  list before and after). It used to check one program per material.

Where the browser has KHR_parallel_shader_compile (Chrome and Edge do), all of this now compiles
in the background. In one without it, compiles block wherever they happen, but they all happen
behind the loader, or as each deferred piece mounts.

Uploads:

- Detail tiles join the scene a few at a time, about 3 MB of buffers a frame. Before, every tile
  that landed between two frames was added at once.
- The tile trees refill at most every 0.3 s while tiles stream in.
- Instance pools upload only the instances in use (`uploadInstances`). Before, these sent their
  whole pools:
  - the central trees sent all 26,000 slots of four pools, about 8 MB, at every refill;
  - the tile trees sent 16,000 slots of two;
  - the car sim and the river's boats sent theirs every frame.

**Austin-Bergstrom**, in colours matched to USGS orthoimagery (public domain):

- **Turf.** The airfield is olive turf, mown in north-south stripes, with drier, yellower
  patches. It covers everything inside the aerodrome boundary (Overture's, simplified to 20 m)
  in the terrain shader, beneath the paving, woods and water. No more trees are scattered over
  the mown infield; only the woods along its edge stand in it.
- **Runways.** Light, warm concrete in 7.5 m slabs. Tyre rubber streaks dark down the middle,
  from the touchdown zones along the rollout. The west runway keeps the 300 ft width Bergstrom
  Air Force Base built for its B-52s: it's marked at 150 ft, and the rest is paved shoulder,
  hatched in yellow. Past each threshold, Overture's stopways are dark asphalt blast pads with
  yellow chevrons pointing in. The old parallel runway in the west infield is there too, closed,
  with a yellow X every 300 m (not in the map data: traced from the imagery).
- **Taxiways and aprons.** Taxiways are concrete with darker shoulders, and aprons are pale
  concrete. The general aviation and cargo aprons on the east side are asphalt.
- **Car parks**, in every tile, are full of cars, on asphalt paler than the streets' (from the
  air, car parks read lighter than the grass around them):
  - stalls 2.6 by 5.5 m, either side of 7 m aisles, laid along each lot's longest side (the
    heading travels in the area's kind);
  - four in five taken, in the colours cars come in, with the stalls' lines;
  - further out, each stall in the colour it averages to (2x2 supersampled), so the rows still
    show; from afar, the grey it all averages to.
- **Airliners in their liveries.** Southwest's blue Heart livery (about a third of the gates),
  American in silver, and the rest white with their tails: Delta, United, Alaska, JetBlue,
  Frontier, Allegiant. Each airline holds a run of neighbouring gates, and the wings are grey.
  Every stand has a yellow lead-in line and stop bar.
- **Solar.** The canopies over the car park by Highway 71 are traced from the imagery: eight
  blocks over a 317 by 243 m lot, casting shadows on the cars. Panels also cover the top decks
  of the Blue Garage (rows east-west) and the Red Garage (north-south).

### 2.22 Big tech and finance, as in the Levels.fyi atlases (2026-10-04)

Asked: add the firms the Levels.fyi atlases have that are relevant in Austin, thinking big tech
and high finance.

**Which firms.** The five Levels.fyi atlases (the Bay Area, Seattle, New York, London and
Bangalore) carry 166 firms between them, read from the atlases' own scene data. Each big tech,
chip and finance firm among them was checked for an Austin office: the building, what the
office does, and a public source. A store, a bank branch or a wealth adviser's branch office
doesn't count. Dell and Indeed aren't in any of them, being headquartered here, but an Austin
atlas couldn't leave them out. 29 firms qualify:

- **Big Tech** (new domain, 15): Apple (the Parmer Lane campus and the Americas Operations
  Center), Google (Sail Tower and 500 W 2nd St), Meta (Third + Shoal, 300 W 6th), Amazon (Domain
  9 and 10, with Annapurna Labs), Oracle (its lakeside HQ), IBM (Domain 12 and its Burnet Road
  campus), Dell (Round Rock), Indeed (Indeed Tower and Domain Tower), Cisco, Salesforce
  (Tableau's office), Atlassian, TikTok, Expedia (Vrbo's tower), Electronic Arts, Microsoft.
- **Chips & Compute** (4 more): NVIDIA (One Uptown and Lakeline), Intel, Qualcomm, Broadcom
  (VMware's River Place office).
- **Finance & Trading** (new domain, 10): Citadel Securities, Hudson River Trading, Optiver,
  Goldman Sachs, JPMorgan Chase, Charles Schwab, Dimensional Fund Advisors, Wise, PayPal, Visa.

Left out, for want of an Austin office: Jane Street, Two Sigma, D. E. Shaw, Point72, Millennium,
BlackRock, Bloomberg, Citi, Barclays, HSBC and the rest of London's and New York's banks; HP
(whose Texas hub is Houston), Adobe and eBay (small sales offices); KLA, Micron, Marvell and Lam
(small offices, or none we could confirm); Apollo announced an Austin hub in August 2026 but
hasn't chosen its building.

**Colour.** A map can't hold many hues before two neighbours can't be told apart: the four
domains were the most that passed every check in both modes (above). The validator was run
over every pair of candidate hues added to those four, day and night together. Blues, and
purples close to Chips' violet, were nearly all that passed. Big Tech takes cornflower blue (the
colour of most big tech logos), and Finance a claret: the one red that clears both modes.
Worst pairs with all six, all-pairs:
- day: normal vision ΔE 19.6, colour-blind ΔE 11.2;
- night: normal vision 15.2, colour-blind 6.9, the 6–8 warn band where Defense and Energy
  already sat.

So the glyph, ring and label stay mandatory, as before. The glyphs are a cloud and a bank's
columns.

**Buildings.** Overture's heights are missing or wrong for several of these towers. For some it
has only the parking podium's height (Domain 9 at 6 m for 18 storeys; One American Center at 24 m
for 32), and for some nothing at all. `TOWERS` in build_buildings.py fixes these. Each such
footprint is drawn as its podium, with a tower rising from the middle at its real height (the
developers' storey counts, at ~4 m a storey), sized to the share of the footprint its floor plate
covers.

**Co-tenants.** Some firms share a building:
- Goldman Sachs and HRT share RiverSouth;
- Wise and PayPal share Domain Tower 2.

The building is painted as one of them (the site that claims it). The other's site `shares` it:
the pipeline doesn't claim a footprint for it, and its beacon stands on the shared roof. Google's
Sail Tower is drawn as a landmark model (Block 185), whose extrusion is left out. A company
building left out for a landmark now still sets its site's roof height (`skip` returning "roof"),
so the beacon stands on the model.

**The site table** in the building shaders grew from 64 to 128 (84 sites now).

**Tour.** Six new chapters (the tour has 22 now):
- 03 Downtown's towers: big tech on the skyline;
- 04 Along the river: the traders;
- 05 East Riverside: Oracle;
- 13 Round Rock: Dell;
- 15 West Parmer Lane: Apple and EA;
- 16 The Domain: Amazon, IBM, Indeed, Vrbo, PayPal, Wise, Optiver, NVIDIA and Schwab.

The old Domain chapter is now the Pickle Research Campus's. The hills chapter adds Intel and
Dimensional.

### 2.23 The skyline at its real heights, and every company's logo (2026-10-04)

Asked: fix the rest of the skyline's heights, and the companies' logos. The screenshot showed
downtown's labels, each with only its domain's glyph.

**Heights.** Overture has many of Austin's towers at their parking podiums' height, or with no
height at all, which the pipeline draws at 10 m. Sixth and Guadalupe, the city's second tallest
at 267 m, stood 18.7 m tall; the Fairmont stood at 20.6 m; The Travis had no height. Two fixes:

- `skyline.py` lists 26 towers to draw at their real heights. The 15 tallest that Overture has
  short or missing take their CTBUH heights from Wikipedia's list of the tallest buildings in
  Austin, matched to Overture's footprints by name and position. The rest are shorter towers,
  most of them the Domain's, from their storey counts. Each is found by position (the footprint
  under its point), not by company site as `TOWERS` was, so any building can be listed. A tower
  on a podium gives its floor plate: the footprint is drawn at the podium's height (Overture's,
  or the one given) and the tower rises from its middle, covering that many m².
- A storey rule for the rest of the city: where Overture gives at least 4 floors and a height
  under 2.2 m a floor, the height is only the podium's, so the building is drawn at 3.5 m a
  floor.

Together they raise 65 of the central patch's buildings (15 of them by more than 30 m), 5 in the
regional file and a few in the detail tiles, which were rebuilt. Overture already had the rest of
the list right, Waterline (the tallest) among them.

**Logos.** The labels now carry each company's logo in place of its domain's glyph, as the
Levels.fyi atlases do.

- *Sources.* Each company's own app icon or favicon, where it is sharp enough. Otherwise its
  vector mark:
  - Simple Icons (CC0): AMD, Apple, Atlassian, Cisco, EA, IBM, Intel, NVIDIA, Qualcomm, The
    Boring Company and Visa;
  - the logo on the company's own site, with the mark cut out of the lockup: CesiumAstro's C,
    Cirrus Logic's swoosh, Fox Robotics' fox, Neurophos's N, TIE's grid, and UT's shield for
    the Center for Space Research;
  - Salesforce's cloud from Wikimedia Commons.

  Where each came from is in `LOGOS` in `build_logos.py`, and the files are in
  `scripts/atlas/logos/`.
- *The sprite.* `build_logos.py` makes each logo a 64 px tile. An icon with its own background
  fills the tile; any other mark is trimmed and centred on white, or on black or navy for the
  light marks (Firefly, Neurophos, CesiumAstro, EA). The 71 tiles pack into one 58 KB WebP,
  `public/atlas/logos.webp`, and `src/data/atlas/logos.json` gives the grid. The page preloads
  it.
- *On the page.* `CompanyLogo` shows a tile as a rounded square ringed in its domain's colour
  (on the map after dark, the domain's night colour). It is used on the map's labels, the tour's company rows,
  the company card (40 px, beside the name), search, the table and the ride's nearby list. A
  company missing from the sprite falls back to its glyph.
- *Domain shapes.* The legend (which filters by domain), the card's domain line and the table
  keep the glyphs, so a domain never rests on colour alone. The table's glyph no longer wraps
  onto a line of its own.
- *Trademarks.* The About panel says the logos are trademarks of their owners, shown only to
  say whose site is whose.

### 2.24 Austin-Bergstrom's landside, as it is (2026-10-07)

Asked: fix this part of the airport, with a screenshot of the landside: the loop north of the
terminal, its garages and car parks. Compared with USGS orthoimagery (public domain), it was
wrong in six ways.

- **A haze over the lawns.** The terrain pales built-up ground, for the ground between a
  neighbourhood's buildings. On the airport it lay over the turf around every building, in
  patches like fog. It is off inside the airfield now; the airport's paving is drawn as it is.
- **Paving missing.** The old air base's concrete west of the loop isn't in the map data, so it
  was grass crossed by service roads, and so was the Yellow Garage's site. `airport_areas.py`
  adds 17 paved areas and 6 small car parks, and the site as bare ground (a new area kind). The
  paving is traced from the imagery: the light, unsaturated ground Overture has nothing for, in
  blobs of 600 m^2 and up, each checked by eye and joined across the roads that cross it.
- **Garages drawn as office blocks.** The Red and Blue Garages and the rental car facility had
  windows, and the Blue Garage stood 4.7 m tall (Overture's height) instead of its six levels.
  They are open parking decks now (`STYLE_GARAGE`):
  - a concrete edge and barrier every 3.2 m, over an open storey in the shade of the deck above;
  - a column every 9 m, and cars along the barriers up close;
  - grey bands from further out, and their decks lit white after dark.

  The Blue Garage is 18 m tall: `skyline.py`'s corrections now apply to the detail tiles too.
- **The Yellow Garage**, going up on the old Economy Lot B since February 2025 (seven levels,
  about 7,000 spaces, its first phase due late in 2026), is modelled mid-build. One end is at
  full height, with barriers, yellow-topped stair cores and light poles on its top deck. The
  rest is four levels up, its columns rising. Two yellow tower cranes work over it. Which half
  opens first isn't public.
- **Houses and brick tanks.** The airport's small buildings took houses' pitched roofs, and the
  fuel farm's tanks and the water tank by the fire station were brick with windows. Its
  buildings are flat-roofed in pale cladding with ribbon windows now (`STYLE_AIRPORT`), and its
  round tanks are white (`STYLE_TANK`). The terminal is drawn as before.
- **Car parks, everywhere.** From middling distances each stall was a pixel or two wide, so a
  car park read as coloured speckle.
  - Rows now take over there: each run of eight stalls is the colour its cars average to (a
    little darker than their paint, for their glass and shadows), with the aisles bare between.
  - Up close the single cars stay, and how full a car park is varies block by block, from half
    to nearly all of its stalls.
  - The rows run along the parking aisles mapped in the lot, shifted so an aisle falls on each.
    Before, they followed the lot's longest side, and crossed the mapped aisles wherever those
    ran the other way. The heading and the shift ride in the area's kind.

### 2.25 The Barbara Jordan Terminal, as built (2026-10-08)

Asked: fix the terminal building too. Overture maps it as one 41,000 m^2 footprint at 24.7 m,
which the tiles drew as a single beige block with office windows. The four curb canopies in
front of it (Overture roof outlines at 15 and 21 m) stood as solid grey towers.

The building, from the architects' photographs (Page Southerland Page and Gensler, Larry Speck
lead designer, 1999) and USGS imagery, is a crescent. A long airside concourse, glass-walled
under a pale metal roof with a raised clerestory, curves along the apron. Behind its middle is
the 60 ft "living room" hall facing the road, in grey metal panels over glass. The departures
roadway runs along the front on its own deck.

- **The parts.** `build_terminal.py` cuts Overture's footprint along lines read from the
  imagery, into `src/data/atlas/terminal.json`:
  - the west concourse (14 m);
  - the hall (24.7 m), with its three skylights and the oval drum at its east end;
  - the concourse's curved frontage south of the hall (16 m);
  - the east connector (15 m) and the 2019 East Infill (17 m).

  Every concourse part has a clerestory spine 3.5 m higher, 9 m in from its edges. The tiles
  leave the footprint and its canopies out, and the airport scene extrudes the parts with the
  map's building shader in a new style (`STYLE_TERMINAL`).
- **Walls.** Glass curtain walls run from a metre up to the metal fascia, in 9 m bays between
  grey piers. Mullions every 1.5 m and a transom every 4.5 m show up close, and the glass holds
  the sky. The hall's glass stops at 60% of its height, with grey metal panels above, as on its
  landside front. After dark the glass glows warm: the terminal is lit all night.
- **Roofs.** Pale metal, kept clear of the random rooftop plant other buildings get.
- **The landside.** The departures roadway is a concrete deck 7.5 m up, with its parapet and
  the skybridges to the Red Garage, on piers every 16 m (Overture's trestle outline). Its curb
  canopies are gull-winged steel roofs, white frames over red panels as in the photographs, on
  posts from the deck. They stand where the grey towers stood.


### 2.26 Pease Park, filled in (2026-10-08)

Asked: flesh out Pease Park. It drew as a pale lawn with scattered trees along Shoal Creek,
with nobody in it, and no place card.

- **The woods.** The canopy raster has the park as solid forest, but the central patch's
  60,000-tree budget thins every wood alike, and along the creek that left a lawn. In
  `build_central.py`, `pease()` fills the park (Overture's Pease District Park and Shoal Creek
  Greenbelt south of 29th Street) on a 7 m jittered grid where the canopy has trees. Trees stay
  clear of lawns, courts, paths and water, and 4 m from the trees already there. That adds about
  3,100 trees beyond the budget. They are a mix of round crowns, plus junipers and cypress drawn
  as cones: 55% cones by the creek and 22% on the slopes. Small clearings leave room for the
  Treehouse, the splash pad, the cottage and the entry wall. The wall's two big live oaks are
  set either side of it.
- **The lawns.** Overture's two meadows, Kingsbury Commons' Great Lawn and Live Oak Meadow, now
  count as lawn, so they are mown open ground with no trees on them.
- **Kingsbury Commons.** Its 2021 rebuild (Ten Eyck Landscape Architects) is modelled from the
  Conservancy's plans and photographs. Pieces with a footprint use their Overture outline:
  - the basketball court (Overture's paved pitch), painted, with hoops;
  - three sand volleyball courts (its sand pitches) with nets;
  - the playground on wood chips: timber towers, cargo nets and a slide.

  The rest are placed from the plans:
  - the splash pad with its limestone seat wall;
  - the ribbon wall round the Great Lawn;
  - the seat terraces;
  - the limestone entry wall at Parkway and Kingsbury Street, with "Pease Park" carved in it,
    between two big live oaks;
  - the restored CCC-era picnic tables under the trees.

  The Treehouse (Mell Lawrence Architects) is a steel geodesic orb, 12 m across and green at its
  foot, with its cargo-net floor, walkway ring, ledgestone seat wall and the bridge in from the
  hillside along Overture's bridge line. The park's buildings in Overture get their own
  styles. The two new support buildings (Clayton Korte), a restroom and a storage building, are
  weathering-steel mesh over board-formed concrete under painted steel roofs
  (`STYLE_PAVILION`). The 1920s Tudor Cottage is white half-timber under a shake roof
  (`STYLE_TUDOR`).
- **People** (`PeasePark.tsx`, drawn only within a few hundred metres of the park):
  - walkers and runners on the park's paths, which are snapped into a graph, most with dogs;
  - dogs and their owners on Live Oak Meadow;
  - picnics and frisbee on the Great Lawn;
  - children on the playground and in the splash pad's jets;
  - games on the volleyball and basketball courts;
  - people lying on the Treehouse net;
  - up to 30 hammocks slung between pairs of trees 4 to 6.5 m apart near the paths and lawns.

  The crowd thins out at night and the splash pad runs only in the day. Phones get under half
  the people.
- **Place card.** "Pease Park" opens on Kingsbury Commons, with the creek woods behind. Its
  sources are Wikipedia, the Conservancy and ARQA. Not modelled:
  - Thomas Dambo's troll Malin, which burned in May 2026;
  - the disc golf course, which closed when the Commons was rebuilt;
  - the Commons' bocce court, which no map has yet.

### 2.27 No centreline down the lakes (2026-10-08)

Asked: get rid of the white line through the water. The creek layer draws every named creek
and river over 2.5 km as a thin pale line. That included the Colorado's centreline, so the
line ran down the middle of Lake Travis, Lake Austin, Lady Bird Lake and the wide river below
town, forking where creeks joined it. `build_vectors.py` now cuts creek lines where they cross
open water: lakes, reservoirs and mapped river banks over 2 ha, from 15 m inside their shores.
That takes out about 400 km of line. Creeks keep their lines up to the shore, and so do creeks
running through their own narrow polygons.

### 2.28 The locator map (2026-10-08)

Asked: a relational map like the Levels.fyi atlases' card ("N ↑ · THE BAY"), with a dot and a
view cone on a small outline of the region.

- **The card** (`ui/Locator.tsx`) sits in the bottom-right corner. It is a north-up map of the
  whole region, drawn from `build_locator.py`:
  - Travis County as the land, outlined, among the paler counties round it;
  - the lakes cut out, and the Colorado as a line where it runs narrow.
- **The marks.** A burnt-orange dot (the UI accent) marks the middle of the view, and a cone shows
  the way the camera faces, as wide as the view is across. They follow `runtime.cam` on their own
  animation frame and only write when the camera moves, so React never re-renders.
- **The caption** reads "N ↑ ·" and the city under the camera, or else its county (a 0.5 km grid
  built from Overture's city and county outlines). Outside the region it reads "Central Texas".
- **Room for it.** Its data (9 kB gzipped) loads once the map is up. Phones and screens under
  560 px tall go without. It steps aside for an open company or place panel, and for the
  ride's controls on screens under 1000 px wide. While it shows, the tour's Red Line rail rides
  up to stay clear of it.

### 2.29 The moonlight towers' glow (2026-10-10)

Asked: what are the white lights over the city at night? They were the halos of the 13
moonlight towers, the 1890s arc-light masts, and two bugs blew them up into big flat-bottomed
blobs:
- **Size.** Their point size was multiplied by the screen's pixel ratio, but three.js already
  scales points by the renderer's pixel ratio. On phones and Retina screens they drew at up to
  twice their size, and more where the renderer runs at a lower resolution. The same applied to
  the bulbs and neon in `CityLife`.
- **Clipping.** A point sprite has one depth for all of it, so the ground in front of each tower
  cut off the lower half of its glow.

The glows are now sized in screen pixels and shrink as the view pulls back. At 30 px close up
and 6 px from across town, a tower reads as one bright lamp among the city's lights rather than
a beacon. `glow.ts`'s `pullTowardCamera` draws them 200 m nearer the camera along the line of
sight, so they stay in place on screen and clear of the ground in front.
