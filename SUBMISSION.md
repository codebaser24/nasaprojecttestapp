# Project page text: NASA Space Apps 2026

Draft text for each field of the team's Project page. Copy each section into the matching field. Items marked **TODO** need the team's input before submitting.

---

## Project Name

ARES Field Atlas: a Marswalk planner built only on real data

## High-Level Project Summary

ARES Field Atlas is a map and route planner a Mars crew could use in their habitat or on a tablet to plan a Marswalk. It layers NASA elevation, optical imagery, mineral, thermal and geology data for one location, Jezero crater's western rim, and plans walking routes that stay under the slope limit chosen for the crew. Each planned stop shows what every data layer records there: elevation, slope, thermal inertia, the mineral detected and the geologic unit.

Our mission walks from a flat camp to outcrops where orbital spectra detect clays and olivine with carbonate, minerals that record past water, and finishes at the rim's high point. Every target was chosen from the data, not placed by hand.

The tool never invents values. It shows which data was used for each calculation, and anything the data cannot support, such as radiation, is marked as not calculated; EVA duration and oxygen use are shown only as estimates from assumptions the crew can edit. Crews can load other NASA GeoTIFFs to plan anywhere on Mars.

## Link to Project Demo

**TODO:** public link to the 7-slide deck or 30-second video (no login required).

## Link to Final Project

https://github.com/codebaser24/nasaprojecttestapp/tree/L4H1RU

(Change to the `main` branch link if the work is merged before submission.)

## Detailed Project Description

**What it does**

- **Layered map.** Elevation (shaded relief), CTX optical imagery, slope hazards, contours, CRISM mineral detections, thermal inertia and USGS geologic units, each with its own legend and source.
- **Mission plan.** Six targets on Jezero's western rim, given by latitude and longitude in `mission.json`:
  - a flat camp;
  - Fe/Mg clay, pyroxene, olivine–carbonate and weak-olivine outcrops;
  - a rim viewpoint.

  Each stop lists what the data shows at that spot.
- **Safe routes.** The A* search finds the lowest-cost walking route between stops over the 20 m elevation model. Steps steeper than the chosen limit are not allowed:

  | Profile | Slope limit |
  |---|---|
  | Lower slope | 10° |
  | Balanced | 18° |
  | Shortest | 22° |

  The default loop is 7.8 km with 427 m of ascent. Every leg is reachable even under the 10° limit.
- **Safety from the camp.** Two analyses calculated from elevation for the camp's position: **line of sight** (where the crew can see the camp's antenna, including the curvature of Mars) and **walk-back distance** (the shortest walk back to the camp within the slope limit). For the default loop, 62% of the route is in view of the camp and the farthest point is 2.83 km from it on foot.
- **EVA estimate.** From the calculated route and assumptions the crew can edit: walking time along each leg's real elevation profile (slope-dependent speed after Tobler's hiking function), planned time at each stop, contingency, the margin against the EVA time limit, and suit oxygen left, with warnings. An optional rover-assisted mode adds driving time, battery and solar energy. Clearly labelled as an estimate, not a measurement. For the default loop at 3 km/h on flat ground: 5 h 17 min in total.
- **Hazard map.** Each cell is classed by its steepest slope, using the same 10°, 18° and 22° limits.
- **Mission playback.** An animated walk along the calculated route with a heads-up display of position, elevation, slope, distance, and the estimated time and oxygen, a banner at each stop and optional spoken stop names. It can also be exported as a video file.
- **Exports.**
  - A 2D traverse map, with a scale bar computed from the data and real corner coordinates.
  - A 3D relief view, with the route at its real elevations and an elevation profile.
  - The plan as JSON.
- **Any location.** The Data files tab loads any GeoTIFFs. Their bands are identified as elevation, thermal, mineral, geology or imagery, and the files are aligned onto one grid; an alignment preview shows how they overlap. Files from another planet, or that don't overlap, are rejected with the reason.

**How it works**

- A Python server reads the GeoTIFFs with rasterio (GDAL), reprojects every layer onto the reference elevation grid and builds the map layers.
- Routes are found with A* over eight neighbouring cells. The cost is distance plus a slope penalty, and steps above the slope limit are rejected.
- Contours are interpolated with marching squares (contourpy).
- The browser draws the maps and exports with HTML canvas and SVG. There are no frameworks.

**Benefits**

- A crew can see, before leaving the habitat, how steep each leg is, how much climbing it needs and what science each stop offers.
- Because nothing is invented, the crew can trust what the map shows. The tool says plainly what it does not know.

**What we hope to achieve**

- A planning tool that grows with the data.
- Adding high-resolution HiRISE elevation for rock-scale hazards, radiation and weather data, rover-assisted traverses, and surface photos from Perseverance at each stop.

**Tools**

- Python
- rasterio / GDAL
- NumPy
- contourpy
- Pillow
- JavaScript, HTML, CSS
- Git / GitHub

## Use of Super Intelligence (SI)

Yes. We used AI coding assistants (Claude, by Anthropic, and GitHub Copilot) to help write and test parts of the code and documentation, working from our team's design and decisions. The project idea, mission design and choice of data are our team's. AI-assisted code is acknowledged in the README ("Use of AI tools") and marked in the git history with a `Co-Authored-By: Claude` line on each AI-assisted commit. No AI-generated images, video, audio or data are used; every map value comes from the data sources below.

## NASA Data

- **Elevation:** USGS Astrogeology, Mars 2020 Science Investigation CTX DEM mosaic of Jezero crater, 20 m/pixel. It is made from NASA Mars Reconnaissance Orbiter Context Camera (CTX) stereo images. https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic
- **Optical imagery:** USGS Astrogeology, Mars 2020 Science Investigation CTX orthomosaic of Jezero crater, 5 m/pixel (mission-area window, averaged to 10 m). It is made from NASA Mars Reconnaissance Orbiter Context Camera (CTX) images. https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic
- **Minerals:** CRISM-only mineral map of Jezero's western rim, from NASA Mars Reconnaissance Orbiter CRISM spectra. Valantinas et al., "Partially altered olivine in the western rim of Jezero crater, Mars: preserved pre-impact Noachian basement", GRL (in revision), CC BY 4.0. https://github.com/euchas/jezero-rim-mapping
- **Geology (USGS-NASA Planetary Geologic Mapping Program):** Sun, V.Z. and Stack, K.M. (2020), Geologic map of Jezero crater and the Nili Planum region, Mars. USGS Scientific Investigations Map 3464, USGS–NASA Planetary Geologic Mapping Program. https://pubs.usgs.gov/sim/3464/
- **Thermal inertia:** **TODO:** confirm the source of `included-data/Jezero_ThermalInertia_100m.tif` (originally `Jezero_Thermal_Inertia_v1.tiff`) (for example, a Mars Odyssey THEMIS-derived product) and add its citation and link.

## Space Agency Partner Data and Other References

- No Space Agency Partner data is used in this version.
- **Software:**
  - Python, rasterio and GDAL, NumPy, contourpy, Pillow (all open source).
  - Map rendering is our own code using the browser's canvas and SVG.
- **Team contributions:** layer and export ideas from teammates' branches, credited in the README and commit history:
  - hillshading, hazard classes, contours and the geology rasterisation (Gihan Kesara);
  - the mineral layer (`vindeep` branch);
  - the export sheet layout (Hirushi192).

---

**Before submitting (TODO):**
- Team name and members.
- Demo link.
- Thermal data source.
- Check that every team member is confirmed at the same Local Event.
- Tick "Terms and Conditions" and "Confirm All Work is Original", then **Submit for Judging** before 11:59 p.m. local time today.
