# ARES / Field Atlas

A Marswalk planning tool for the NASA Space Apps 2026 challenge "Interplanetary Survival Guide: Martian Map". It layers elevation, optical imagery, thermal, mineral and geology data for a location on Mars, plans slope-limited walking routes over the elevation, and shows what each data layer records at every planned stop. Nothing on the map is invented: anything the loaded data cannot support is marked as not calculated.

Features: a planned mission on Jezero crater's western rim, a **Data files** tab for loading any GeoTIFFs, an alignment preview, map layers with legends, editable waypoints, three slope-limited route strategies, a breakdown of what each route crosses in every loaded layer (after Gihan Kesara's route geology analysis), 2D and 3D map exports with an elevation profile, and a responsive layout for desktop and tablet.

## Run it

Tested with Python 3.15 in Chrome and Edge.

```powershell
python -m pip install rasterio numpy contourpy pillow
python server.py --port 4174
```

Open http://127.0.0.1:4174/. On the first start the server loads the mission data automatically, then the map opens on the mission. It uses the full Jezero elevation model if `M20_JezeroCrater_CTXDEM_20m.tif` is in the project folder; otherwise it uses the 14 km mission-area window included in this repository (about 2 seconds). Click **Calculate route** in the planner, then try the map layers, the **DEM routing** tab and **Export mission**.

To use other data, open the **Data files** tab, tick one or more GeoTIFFs and click **Load selected files**. Files are found in `included-data/` (marked **Included with the repository** and listed first), the project folder and `data/`; **Browse computer…** copies a file into `data/`. **Hide** removes a file from the list without deleting it. The full 20 m Jezero elevation model is available from the [USGS Mars 2020 CTX elevation mosaic](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic) (`M20_JezeroCrater_CTXDEM_20m.tif`, 90 MB, too large for git).

## The mission

`mission.json` defines the mission "Water on Jezero's western rim": walk from a flat camp to outcrops where CRISM spectra detect Fe/Mg clays and olivine with carbonate, compare them with pyroxene-rich rock, and finish at the rim's high point. The targets were chosen from the data, not placed by hand:

- each outcrop sits on a patch of CRISM mineral detections;
- the camp is the nearest ground with no slope steeper than 4° within 120 m;
- the viewpoint is the highest elevation within 2 km of the centre of the outcrop cluster;
- every leg is reachable under all three slope limits. The default loop is 7.8 km with 427 m of ascent on the balanced profile.

Targets are given as longitude and latitude, so they land in the right place on any loaded grid that covers them. For each target the build records what every loaded layer shows there (elevation, slope, thermal inertia, mineral class, geologic unit), and the waypoint card lists it.

### Data files included in the repository

All in `included-data/`, so the app works straight after cloning:

| File | Contents | Source |
|---|---|---|
| `Jezero_WesternRim_Elevation_CTX_20m.tif` | Elevation, 20 m pixels, 14 × 14 km around the mission | Unchanged 700 × 700 pixel window of the USGS Mars 2020 Science Investigation CTX DEM mosaic (from NASA MRO Context Camera images) |
| `Jezero_WesternRim_Optical_CTX_10m.tif` | Black-and-white orbital photograph, 10 m pixels, same 14 × 14 km area | USGS Mars 2020 Science Investigation CTX orthomosaic (from NASA MRO Context Camera images), window averaged from 5 m to 10 m |
| `Jezero_ThermalInertia_100m.tif` | Thermal inertia, 100 m pixels (originally `Jezero_Thermal_Inertia_v1.tiff`) | Source not recorded in the file |
| `Jezero_WesternRim_Minerals_CRISM.tif` | Mineral classes of Jezero's western rim (olivine, Fe/Mg phyllosilicates, pyroxene) | Valantinas et al., GRL (in revision), `geologic_map_CRISM_only.tif`, unchanged. CC BY 4.0. First added on the `vindeep` branch. |
| `Jezero_Geology_USGS_SIM3464.tif` | 14 geologic map units | Sun and Stack (2020), USGS SIM 3464. Rasterised onto the CTX DEM grid by `prepare_geology.py` on the `kesara` branch, then stored as a GeoTIFF. Display colours, not official USGS colours. |

Each has a `.layers.json` file next to it naming its contents, classes and source.

Files can also be loaded from the command line; reload the page afterwards:

```powershell
python prepare_full_dem.py M20_JezeroCrater_CTXDEM_20m.tif included-data/Jezero_ThermalInertia_100m.tif
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

## Safety analyses from the camp

Two layers are calculated from the elevation model for the camp's current position (they follow the camp if it is moved):

- **Line of sight:** where a person 2 m tall can see an antenna 3 m above the camp, so is in visual and radio line of sight. Terrain in the elevation model blocks the view, and the curvature of Mars is included (the surface drops about 33 m below a straight line over 15 km). Calculated within 15 km of the camp. Radio range, dust and buildings are not modelled.
- **Walk-back distance:** the shortest walking distance from every point back to the camp without a step steeper than the selected route profile's slope limit, over the same eight-neighbour grid the route search uses. Calculated within 10 km. Areas with no walking route back are marked.

For every calculated route, the along-route results show how much of it is in view of the camp and the farthest walk back. These analyses are reported for planning; they do not change the route.

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
  - `POST /api/route` with `{"start":[x,y],"goal":[x,y],"profile":"balanced"}` returns a route, the elevation of every step (`elevationsM`), `dataUsed`, and `alongRoute`: what every other loaded layer shows along the route (distance on each class, boundaries crossed, or the lowest, average and highest value). `alongRoute` is for reporting only and never affects the route.
  - `GET /api/analysis?type=viewshed|walkback&x=&y=&profile=` calculates line of sight or walk-back distance from the camp at grid cell (x, y) and returns an overlay image and legend. Route requests that include `"camp": [x, y]` also report both along the route.
  - `GET /api/region?x0=&y0=&x1=&y1=&size=` returns the corner coordinates of a grid window and, when elevation is loaded, its elevation averaged into at most `size` samples per side.
- A* searches eight neighbouring cells using distance plus a slope penalty, rejects steps above the selected slope limit, and avoids missing elevation cells.
- Frontend: `dist/index.html`, `dist/style.css`, `dist/app.js`, `dist/terrain.js`, `dist/files.js`, `dist/views.js`, `dist/export.js`. No build step.

## Exporting a mission

**Export mission** offers three downloads:

- **2D traverse map (PNG):** the area around the waypoints with the base map and visible layers, the calculated route, waypoint labels with elevations, a scale bar computed from the pixel size, corner coordinates from the reference file, legends and data sources.
- **3D relief and route profile (PNG):** the same area drawn in 3D from the elevation data, with the visible layers draped on it, the route at its real elevations, and a chart of elevation against distance along the route. The vertical exaggeration is printed on the sheet.
- **Mission data (JSON):** waypoints, the route, and which data was and was not used.

If the route has not been calculated, the sheets join the waypoints with dashed lines and say so. Duration, oxygen use, surface conditions and science value are listed as not calculated. The sheet layout follows Hirushi192's export on the `Nethsara` branch; the drawn values come only from the loaded data.

## Limitations

- The 20 m elevation pixels cannot show individual rocks or obstacles smaller than one pixel.
- Radiation, weather, traverse speed, oxygen use and EVA duration are not modelled, because no loaded data supplies them.
- CRISM mineral positions are accurate to about 28–75 m.
- Routes are not validated for operational navigation.

## Use of AI tools

Parts of this project's code and documentation were written with the help of an AI coding assistant (Claude, by Anthropic), working from the team's design and instructions. AI-assisted commits are marked with a `Co-Authored-By: Claude` line in the git history. No AI-generated images, video or audio are used. All map data comes from the sources listed above; no data was generated by AI.
