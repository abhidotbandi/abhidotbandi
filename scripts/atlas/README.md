# Atlas data pipeline

Bakes the static map assets in `public/atlas/` for the `/atlas` page from open data:

| Output | Built by | From |
|---|---|---|
| `terrain.webp`: elevation (R/G = decimetres, 16-bit) + built-up density (B) | `build_terrain.py` | AWS Terrain Tiles (Terrarium, z12) + Overture buildings |
| `surface.webp`: water signed-distance field (R) + parks (G) | `build_surface.py` | Overture `base/water`, `base/land_use` |
| `vectors.json`: roads, rail, Red Line + stations, creeks, labels | `build_vectors.py` | Overture `transportation/segment`, `base/water`, `divisions` |
| `surface.webp` B: tree and shrub cover | `build_surface.py` | Overture `base/land_cover` (ESA WorldCover) |
| `buildings.json`, `central_buildings.json`: footprints + heights, tagged with company sites | `build_buildings.py` | Overture `buildings/building` + `src/data/atlas/companies.json` |
| `central_terrain.webp`: ~8 m elevation (R/G) + tree canopy (B) for central Austin | `build_central.py` | Terrain Tiles z14 + Overture `base/land_cover` |
| `central_surface.webp`: 4 m water SDF (sqrt-encoded), parkland, built-up density | `build_central.py` | Overture `base/water`, `base/land_use`, buildings |
| `central.json`: paths, Butler trail graph, river bridges, piers, Zilker Eagle track, river lanes, streets, moonlight towers, docks, landmarks | `build_central.py` | Overture `transportation/segment`, `base/infrastructure`, places |
| `central_trees.bin`: 60k tree instances | `build_central.py` | canopy raster |

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
- Rerun `build_buildings.py` after editing company sites; it tags each site's footprints.
- The central patch bounds (`C_*` in `config.py`) must match `CENTRAL` in `src/lib/atlas/geo.ts`.

Attribution: © Overture Maps Foundation (CDLA Permissive 2.0) including © OpenStreetMap
contributors (ODbL); terrain from Mapzen/AWS Terrain Tiles (USGS 3DEP, SRTM).
