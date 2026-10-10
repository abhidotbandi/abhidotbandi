"""Shared constants for the Silicon Hills atlas data pipeline.

The projection here MUST match src/lib/atlas/geo.ts: a local equirectangular
projection centred on downtown Austin, 1 scene unit = 1 km, +x east, -z north.
"""

import math
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(os.environ.get("ATLAS_CACHE", ROOT / "scripts" / "atlas" / ".cache"))
OUT = ROOT / "public" / "atlas"
COMPANIES_JSON = ROOT / "src" / "data" / "atlas" / "companies.json"

OVERTURE_RELEASE = os.environ.get("OVERTURE_RELEASE", "2026-09-23.0")
OVERTURE_BUCKET = "overturemaps-us-west-2"

# Greater Austin: Briggs (N) to Buda (S), Lake Travis (W) to Bastrop (E).
WEST, SOUTH, EAST, NORTH = -98.10, 29.98, -97.30, 30.96

# Projection origin: Congress Ave & 6th St.
LON0, LAT0 = -97.7431, 30.2672
KM_PER_DEG_LAT = 110.574
KM_PER_DEG_LON = 111.320 * math.cos(math.radians(LAT0))


def project(lon, lat):
    """lon/lat (deg) -> scene (x, z) in km. Works on scalars and numpy arrays."""
    return (lon - LON0) * KM_PER_DEG_LON, -(lat - LAT0) * KM_PER_DEG_LAT


def unproject(x, z):
    return x / KM_PER_DEG_LON + LON0, -z / KM_PER_DEG_LAT + LAT0


# Scene-space extent of the region (km).
X_MIN, Z_MAX = project(WEST, SOUTH)
X_MAX, Z_MIN = project(EAST, NORTH)
WIDTH_KM = X_MAX - X_MIN
HEIGHT_KM = Z_MAX - Z_MIN


# Central Austin detail patch: Red Bud Isle and Mount Bonnell (W/N) to Longhorn Dam (E) and
# South Congress (S). Everything in it gets high-resolution terrain, surface and vectors.
C_WEST, C_SOUTH, C_EAST, C_NORTH = -97.800, 30.236, -97.705, 30.325
CX_MIN, CZ_MAX = project(C_WEST, C_SOUTH)
CX_MAX, CZ_MIN = project(C_EAST, C_NORTH)
C_WIDTH_KM = CX_MAX - CX_MIN
C_HEIGHT_KM = CZ_MAX - CZ_MIN
