# Atlas data pipeline

Bakes the static map assets in `public/atlas/` for the `/atlas` page from open data:

| Output | Built by | From |
|---|---|---|
| `terrain.webp`: elevation (R/G = decimetres, 16-bit) + built-up density (B) | `build_terrain.py` | AWS Terrain Tiles (Terrarium, z12) + Overture buildings |
| `surface.webp`: water signed-distance field (R) + parks and airfield grass (G) | `build_surface.py` | Overture `base/water`, `base/land_use`, `base/infrastructure` (airfield bounds) |
| `vectors.json`: roads, rail, Red Line + stations, creeks, labels | `build_vectors.py` | Overture `transportation/segment`, `base/water`, `divisions` |
| `surface.webp` B: tree and shrub cover | `build_surface.py` | Overture `base/land_cover` (ESA WorldCover) |
| `buildings.bin`, `central_buildings.bin`: footprints + heights, tagged with company sites (binary; the format is documented in `building_codec.py`) | `build_buildings.py` | Overture `buildings/building` + `src/data/atlas/companies.json` |
| `central_terrain.webp`: ~8 m elevation (R/G) + tree canopy (B) for central Austin | `build_central.py` | Terrain Tiles z14 + Overture `base/land_cover` |
| `central_surface.webp`: 4 m water SDF (sqrt-encoded), parkland, built-up density | `build_central.py` | Overture `base/water`, `base/land_use`, buildings |
| `central.json`: paths, Butler trail graph, river bridges, piers, Zilker Eagle track, river lanes, streets, moonlight towers, docks, landmark footprints (by point, and by Overture name for the modelled towers and arenas in `NAMED_LANDMARKS`) | `build_central.py` | Overture `transportation/segment`, `base/infrastructure`, `buildings`, places |
| `central_trees.bin`: 60k tree instances, plus the Capitol grounds' own planting | `build_central.py` | canopy raster, Overture `base/land_use` (Capitol Square) |
| `*_lo.webp`: the four rasters above at half resolution, for phones and other low-power devices | `build_lowres.py` | the full rasters |
| `outer.webp` (+ `outer_lo.webp` for phones): the country for ~80 km around the map, elevation (R/G, 1 m steps) and a water distance field (B) at ~264 m a pixel; `meta.json` `outer` gives its bounds and the towns around the map for their lights after dark | `build_outer.py` | Terrain Tiles z9, Overture `base/water` and `divisions` (localities) |
| `tiles/*.bin` + `tiles/index.json`: 2 km detail tiles loaded around the camera: every other building, local streets, paths, runways and taxiways, parking lots, pools and small ponds (layout in `build_tiles.py`) | `build_tiles.py` | Overture `buildings`, `transportation/segment` (all classes), `base/infrastructure`, `base/water` |

```bash
pip install -r scripts/atlas/requirements.txt
python scripts/atlas/build_all.py          # fetches into scripts/atlas/.cache, then bakes
python scripts/atlas/preview.py            # QA renders of the region and every company site
python scripts/atlas/preview_central.py    # QA renders of the central Austin detail patch
```

- The projection (local equirectangular around Congress Ave & 6th St, 1 unit = 1 km, north = -z)
  lives in `config.py` and must match `src/lib/atlas/geo.ts`.
- Overture is read straight from `s3://overturemaps-us-west-2` with a bbox filter, so only
  Greater Austin row groups are downloaded. Set `OVERTURE_RELEASE` to pin a different release.
- Rerun `build_buildings.py` and then `build_tiles.py` after editing company sites: the first tags each
  site's footprints (and draws `TOWERS` at their real heights), and the tiles leave out whatever it carries.
- The central patch bounds (`C_*` in `config.py`) must match `CENTRAL` in `src/lib/atlas/geo.ts`.

## Measuring the load

The page records `atlas:*` performance marks: `start`, `got <file>` and `decoded <file>` for each
download, the prep worker's steps (`regional textures`, `central buildings`, ...),
`regional prepared`, `central prepared`, `first frame` and `ready` (the loader wipes away to the
live map). In
the browser console:

```js
performance.getEntriesByType("mark").filter((m) => m.name.startsWith("atlas:")).map((m) => [m.name, Math.round(m.startTime)])
```

Attribution: © Overture Maps Foundation (CDLA Permissive 2.0) including © OpenStreetMap
contributors (ODbL); terrain from Mapzen/AWS Terrain Tiles (USGS 3DEP, SRTM).
