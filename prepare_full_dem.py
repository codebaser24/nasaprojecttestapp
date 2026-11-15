"""Prepare one or more GeoTIFFs from the command line and make them the loaded data.

    python prepare_full_dem.py M20_JezeroCrater_CTXDEM_20m.tif included-data/Jezero_ThermalInertia_100m.tif

The same preparation runs when files are selected in the app's Data files tab.
Files must be in the project folder or in data/.
"""
import json
from pathlib import Path
import sys

import dataset

if len(sys.argv) < 2:
    sys.exit(__doc__)
identifiers = [dataset.file_id(Path(name).resolve()) for name in sys.argv[1:]]
meta = dataset.build(identifiers, lambda message, step, total: print(f"[{step}/{total}] {message}", flush=True))
dataset.set_current(meta, identifiers)
summary = {key: meta[key] for key in ("source", "width", "height", "dx", "dy", "elevation", "routing", "derived")}
summary["files"] = [{k: f.get(k) for k in ("name", "role", "reason", "coversPercent")} for f in meta["files"]]
summary["layers"] = [{k: layer[k] for k in ("id", "kind", "file", "bands")} for layer in meta["layers"]]
print(json.dumps(summary, indent=1))
print("Restart server.py (or reload the page if it is running) to use this data.")
