# ARES / Field Atlas

A responsive Marswalk planning prototype inspired by the Martian Map challenge. It loads one or more GeoTIFF files, aligns them onto one grid, and plans slope-limited routes over the elevation data.

Features: a **Data files** tab for choosing and adding GeoTIFFs, an alignment preview, map layers for whatever the loaded files contain, editable mission waypoints, three slope-limited route strategies, local plan persistence, mission JSON export, and a step-through mission preview. Responsive desktop and mobile layouts include keyboard-operable controls.

## Run it

```powershell
python -m pip install rasterio numpy contourpy pillow
python server.py --port 4174
```

Open http://127.0.0.1:4174/ and go to the **Data files** tab. Tick one or more files, check the alignment preview, then click **Load selected files**.

Files are found in the project folder and in `data/`. **Browse computer…** copies a file into `data/`. Elevation for Jezero is available from the [USGS Mars 2020 CTX elevation mosaic](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic) (download `M20_JezeroCrater_CTXDEM_20m.tif` into the project folder; it is too large for git).

### Data files included in the repository

| File | Contents | Source |
|---|---|---|
| `Jezero_Thermal_Inertia_v1.tiff` | Thermal inertia, 100 m pixels | Source not recorded in the file |
| `Jezero_CRISM_Minerals_WesternRim.tif` | Mineral classes of Jezero's western rim (olivine, Fe/Mg phyllosilicates, pyroxene) | Valantinas et al., GRL (in revision), `geologic_map_CRISM_only.tif`, unchanged. CC BY 4.0. First added on the `vindeep` branch. |
| `Jezero_USGS_Geology_SIM3464.tif` | 14 geologic map units | Sun and Stack (2020), USGS SIM 3464. Rasterised onto the CTX DEM grid by `prepare_geology.py` on the `kesara` branch, then stored as a GeoTIFF. Display colours, not official USGS colours. |

Each has a `.layers.json` file next to it naming its classes and source.

Files can also be loaded from the command line; reload the page afterwards:

```powershell
python prepare_full_dem.py M20_JezeroCrater_CTXDEM_20m.tif Jezero_Thermal_Inertia_v1.tiff
```

## Only real data is used

Every band of every selected file is classified as elevation, thermal, mineral, geology, imagery or unknown, together with how it was identified (band description or metadata, units, colour interpretation, or file name).

- **Alignment.** One file is the reference grid: the finest-resolution file with elevation, or else the finest projected file. Every other file is reprojected onto it using its own coordinates. Files from a different planetary body, or that do not overlap the reference area, are not loaded and the reason is shown.
- **Routing uses only elevation.** Routes are calculated from one elevation band and the slope computed from it. Thermal, mineral, imagery and other bands are shown for reference only and never affect a route.
- **Not enough data.** Routing needs an elevation band, a projected coordinate system with linear units, and elevation units convertible to metres. If any is missing, the app and `POST /api/route` report "Not enough data available" and list what is required.
- Kinds of data that no loaded file contains are marked "Not in loaded files" and their layer buttons are disabled.
- Duration, oxygen reserve, surface conditions and science value are not calculated, because no raster layer supplies them.

When a GeoTIFF does not describe its bands, place a sidecar file next to it named `<file>.layers.json`:

```json
{"source": {"citation": "Author (year), title", "license": "CC BY 4.0", "url": "https://..."},
 "bands": {"1": {"kind": "mineral", "note": "How to read this layer",
                 "classes": {"1": {"name": "Bulk rim", "hidden": true, "reason": "not a mineral detection"},
                             "2": {"name": "Olivine-bearing"}}},
           "2": {"kind": "thermal", "units": "K"}}}
```

Bands with a colour table, or with declared `classes`, are drawn as class maps with a legend. The source is shown with the layer. Every visible layer has a legend under the map.

## Map layers computed from elevation

These are shown for reference. Routes use the elevation and slope directly, not these images.

- **Base map:** elevation coloured from low to high and hillshaded as if lit from the upper left.
- **Hazards:** each cell's steepest slope to a neighbouring cell, in three classes: steeper than 10°, 18° and 22°, the limits of the three route profiles. Cells without a valid neighbour are left unshaded.
- **Topography:** contours every 50 m, with brighter lines every 250 m. They are placed by marching squares, which interpolates where the surface crosses each level between cell centres.

The hillshading, three-level hazards and interpolated contours are adapted from Gihan Kesara's `prepare_full_dem.py`, `prepare_hazards.py` and `prepare_contours.py` on the `kesara` branch.

## How it works

- `dataset.py` inspects files, plans the alignment and builds each selection into `builds/<key>/`: a base map, elevation for routing, hazard and contour overlays, and one image per layer. A selection that was built before is reused instantly. `builds/current.json` records which selection is loaded.
- `server.py` serves the app and the API:
  - `GET /api/files` lists the GeoTIFFs and what they contain.
  - `POST /api/files/upload` adds a file to `data/`, with its name in the `X-File-Name` header.
  - `POST /api/alignment` with `{"files": [...]}` previews how a selection lines up.
  - `POST /api/dataset` with `{"files": [...]}` loads a selection; `GET /api/dataset` returns the loaded data and build progress.
  - `POST /api/route` with `{"start":[x,y],"goal":[x,y],"profile":"balanced"}` returns a route, the elevation of every step (`elevationsM`) and `dataUsed`.
  - `GET /api/region?x0=&y0=&x1=&y1=&size=` returns the corner coordinates of a grid window and, when elevation is loaded, its elevation averaged into at most `size` samples per side.
- A* searches eight neighbouring cells using distance plus a slope penalty, rejects steps above the selected slope limit, and avoids missing elevation cells.
- Frontend: `dist/index.html`, `dist/style.css`, `dist/app.js`, `dist/terrain.js`, `dist/files.js`, `dist/views.js`, `dist/export.js`. No build step.

## Exporting a mission

**Export mission** offers three downloads:

- **2D traverse map (PNG):** the area around the waypoints with the base map and visible layers, the calculated route, waypoint labels with elevations, a scale bar computed from the pixel size, corner coordinates from the reference file, legends and data sources.
- **3D relief and route profile (PNG):** the same area drawn in 3D from the elevation data, with the visible layers draped on it, the route at its real elevations, and a chart of elevation against distance along the route. The vertical exaggeration is printed on the sheet.
- **Mission data (JSON):** waypoints, the route, and which data was and was not used.

If the route has not been calculated, the sheets join the waypoints with dashed lines and say so. Duration, oxygen use, surface conditions and science value are listed as not calculated. The sheet layout follows Hirushi192's export on the `Nethsara` branch; the drawn values come only from the loaded data.
