"""Run the whole atlas data pipeline: fetch (cached) -> rasters -> vectors -> buildings."""

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
STEPS = ["fetch.py", "build_terrain.py", "build_surface.py", "build_vectors.py", "build_buildings.py",
         "build_central.py", "build_lowres.py"]

if __name__ == "__main__":
    for step in STEPS:
        print(f"== {step}")
        subprocess.run([sys.executable, str(HERE / step)], check=True, cwd=HERE)
