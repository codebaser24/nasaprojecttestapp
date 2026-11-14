# ARES / Field Atlas

A responsive Marswalk planning prototype inspired by the Martian Map challenge. It loads one or more GeoTIFF files, aligns them onto one grid, and plans slope-limited routes over the elevation data.

Features: a **Data files** tab for choosing and adding GeoTIFFs, an alignment preview, map layers for whatever the loaded files contain, editable mission waypoints, three slope-limited route strategies, local plan persistence, mission JSON export, and a step-through mission preview. Responsive desktop and mobile layouts include keyboard-operable controls.

## Run it

```powershell
python -m pip install rasterio numpy
python server.py --port 4174
```

Open http://127.0.0.1:4174/ and go to the **Data files** tab. Tick one or more files, check the alignment preview, then click **Load selected files**.

Files are found in the project folder and in `data/`. **Browse computer…** copies a file into `data/`. Elevation for Jezero is available from the [USGS Mars 2020 CTX elevation mosaic](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic).

Files can also be loaded from the command line; reload the page afterwards:

```powershell
python prepare_full_dem.py M20_JezeroCrater_CTXDEM_20m.tif Jezero_Thermal_Inertia_v1.tiff
```

## Only real data is used

Every band of every selected file is classified as elevation, thermal, mineral, imagery or unknown, together with how it was identified (band description or metadata, units, colour interpretation, or file name).

- **Alignment.** One file is the reference grid: the finest-resolution file with elevation, or else the finest projected file. Every other file is reprojected onto it using its own coordinates. Files from a different planetary body, or that do not overlap the reference area, are not loaded and the reason is shown.
- **Routing uses only elevation.** Routes are calculated from one elevation band and the slope computed from it. Thermal, mineral, imagery and other bands are shown for reference only and never affect a route.
- **Not enough data.** Routing needs an elevation band, a projected coordinate system with linear units, and elevation units convertible to metres. If any is missing, the app and `POST /api/route` report "Not enough data available" and list what is required.
- Kinds of data that no loaded file contains are marked "Not in loaded files" and their layer buttons are disabled.
- Duration, oxygen reserve, surface conditions and science value are not calculated, because no raster layer supplies them.

When a GeoTIFF does not describe its bands, place a sidecar file next to it named `<file>.layers.json`:

```json
{"bands": {"1": {"kind": "elevation", "units": "m"}, "2": {"kind": "thermal", "units": "K"}}}
```

## How it works

- `dataset.py` inspects files, plans the alignment and builds each selection into `builds/<key>/`: a base map, elevation for routing, hazard and contour overlays, and one image per layer. A selection that was built before is reused instantly. `builds/current.json` records which selection is loaded.
- `server.py` serves the app and the API:
  - `GET /api/files` lists the GeoTIFFs and what they contain.
  - `POST /api/files/upload` adds a file to `data/`, with its name in the `X-File-Name` header.
  - `POST /api/alignment` with `{"files": [...]}` previews how a selection lines up.
  - `POST /api/dataset` with `{"files": [...]}` loads a selection; `GET /api/dataset` returns the loaded data and build progress.
  - `POST /api/route` with `{"start":[x,y],"goal":[x,y],"profile":"balanced"}` returns a route and `dataUsed`.
- A* searches eight neighbouring cells using distance plus a slope penalty, rejects steps above the selected slope limit, and avoids missing elevation cells.
- Frontend: `dist/index.html`, `dist/style.css`, `dist/app.js`, `dist/terrain.js`, `dist/files.js`, `dist/views.js`. No build step.
