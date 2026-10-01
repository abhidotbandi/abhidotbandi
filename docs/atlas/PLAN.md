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
real operating site in the Austin region (HQ, factory, fab, lab, test site). ~50–65 entries.

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

