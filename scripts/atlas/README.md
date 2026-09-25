# Atlas data pipeline

Bakes the static map assets in `public/atlas/` for the `/atlas` page from open data:

| Output | Built by | From |
|---|---|---|
| `terrain.webp`: elevation (R/G = decimetres, 16-bit) + built-up density (B) | `build_terrain.py` | AWS Terrain Tiles (Terrarium, z12) + Overture buildings |
| `surface.webp`: water signed-distance field (R) + parks (G) | `build_surface.py` | Overture `base/water`, `base/land_use` |
| `vectors.json`: roads, rail, Red Line + stations, creeks, labels | `build_vectors.py` | Overture `transportation/segment`, `base/water`, `divisions` |
| `buildings.json`: footprints + heights, tagged with company sites | `build_buildings.py` | Overture `buildings/building` + `src/data/atlas/companies.json` |

```bash
pip install -r scripts/atlas/requirements.txt
python scripts/atlas/build_all.py          # fetches into scripts/atlas/.cache, then bakes
python scripts/atlas/preview.py            # QA renders of the region and every company site
```

- The projection (local equirectangular around Congress Ave & 6th St, 1 unit = 1 km, north = -z)
  lives in `config.py` and must match `src/lib/atlas/geo.ts`.
- Overture is read straight from `s3://overturemaps-us-west-2` with a bbox filter, so only
  Greater Austin row groups are downloaded. Set `OVERTURE_RELEASE` to pin a different release.
- Rerun `build_buildings.py` after editing company sites; it tags each site's footprints.

Attribution: © Overture Maps Foundation (CDLA Permissive 2.0) including © OpenStreetMap
contributors (ODbL); terrain from Mapzen/AWS Terrain Tiles (USGS 3DEP, SRTM).
