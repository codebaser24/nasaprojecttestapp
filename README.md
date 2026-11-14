# ARES / Field Atlas

A responsive, dependency-free Marswalk planning prototype inspired by the Martian Map challenge. Open `dist/index.html` in a browser, or serve `dist` with any static HTTP server.

Features: procedural orbital terrain, four toggleable data layers, selectable science waypoints, three route strategies, extra science stops, local plan persistence, mission JSON export, and a step-through mission preview. Responsive desktop and mobile layouts include keyboard-operable controls.

Both dashboard tabs use the full 4,456 × 5,067 Jezero DEM. **Mission simulation** retains the original waypoint locations and routes each leg through the full raster. **DEM routing** accepts full-raster column and row coordinates and reports distance, ascent, and maximum slope.

## Run the DEM backend

Use the full `M20_JezeroCrater_CTXDEM_20m.tif` in this directory. If it is missing, download it from the [USGS Mars 2020 CTX elevation mosaic](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic).

```powershell
python -m pip install rasterio
python prepare_dem.py M20_JezeroCrater_CTXDEM_20m.tif
python prepare_full_dem.py M20_JezeroCrater_CTXDEM_20m.tif
python server.py
```

Open http://127.0.0.1:4173/terrain.html. Use `python server.py --port 4174` if another preview is already on port 4173. The prep script crops a 240 × 168 native-resolution grid near the western delta. The server needs only the generated `terrain.json` and Python's standard library after preparation.

The API serves the grid at `GET /api/terrain` and accepts `POST /api/route` with `{"start":[20,30],"goal":[140,100],"profile":"balanced"}`. A* searches eight neighboring cells using distance plus a slope penalty, rejects edges above the selected slope limit, and avoids missing elevation cells.

Files: `dist/index.html`, `dist/style.css`, `dist/app.js`. No build step. Google Fonts is optional; system fonts provide an offline fallback.


to run this python server.py --port 4174
