const form = document.querySelector("#route");
const result = document.querySelector("#result");
const geologyPanel = document.createElement("div");
geologyPanel.className = "geology-route-panel";
result.after(geologyPanel);
geologyPanel.hidden = true;
const canvas = document.querySelector("canvas");
const context = canvas.getContext("2d");
const theme = getComputedStyle(document.documentElement);
const startColor = theme.getPropertyValue("--start-marker").trim();
const endColor = theme.getPropertyValue("--end-marker").trim();
const submit = form.querySelector("button");
const resetDem = document.getElementById("resetDem");
let demRequest;
const fields = ["sx", "sy", "ex", "ey"].map((id) =>
  document.getElementById(id),
);
let grid,
  base,
  start,
  goal,
  path = [];
let choosingStart = true;
let loadedMission = [];
let loadedLegs = [];
let demZoom = 1,
  demX = 0,
  demY = 0;
const demLayers = new Set();
const demOverlays = {};
const rasterLayerOrder = ["geology", "contours", "hazards"];
let geologyMetadataPromise;

function setGeologyLegendVisible(view, visible) {
  const legend = document.getElementById(`${view}-geology-legend`);
  if (legend) legend.hidden = !visible;
  if (visible) loadGeologyLegend();
}

function loadGeologyLegend() {
  if (!geologyMetadataPromise) {
    geologyMetadataPromise = request("jezero-geology.json")
      .then((metadata) => {
        if (
          metadata.schema !== "ares-geology-v1" ||
          !Array.isArray(metadata.units)
        )
          throw new Error("Unexpected geology metadata format");
        for (const legend of document.querySelectorAll(".geology-legend")) {
          legend.querySelector(".geology-legend-count").textContent =
            `(${metadata.units.length} units)`;
          const content = legend.querySelector(".geology-legend-content");
          content.replaceChildren();
          const list = document.createElement("ul");
          list.className = "geology-unit-list";
          for (const unit of metadata.units) {
            const item = document.createElement("li");
            const swatch = document.createElement("i");
            swatch.className = "geology-swatch";
            // Colour is display-only, never used as a geological identifier.
            if (/^#[0-9a-fA-F]{6}$/.test(unit.color))
              swatch.style.backgroundColor = unit.color;
            const name = document.createElement("span");
            name.textContent = `${unit.symbol} — ${(unit.names || []).join(" / ")}`;
            item.append(swatch, name);
            list.append(item);
          }
          const note = document.createElement("p");
          note.textContent =
            "USGS Sun & Stack (2020), SIM 3464. ARES display colours (not official USGS colours). Geological units are interpretations, not mineral detections or rover safety ratings. Transparent areas are unmapped.";
          content.append(list, note);
        }
      })
      .catch((error) => {
        for (const content of document.querySelectorAll(
          ".geology-legend-content",
        ))
          content.textContent = `Geology legend unavailable: ${error.message}`;
      });
  }
  return geologyMetadataPromise;
}

function setDemZoom(value) {
  demZoom = Math.min(12, Math.max(1, value));
  const limitX = (canvas.width * (demZoom - 0.5)) / 2;
  const limitY = (canvas.height * (demZoom - 0.5)) / 2;
  demX = Math.max(-limitX, Math.min(limitX, demX));
  demY = Math.max(-limitY, Math.min(limitY, demY));
  if (grid) draw();
}

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(payload.error), { code: payload.code });
  return payload;
}

function draw() {
  if (!canvas.clientWidth) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(canvas.width / 2 + demX, canvas.height / 2 + demY);
  context.scale(demZoom, demZoom);
  context.translate(-canvas.width / 2, -canvas.height / 2);
  context.save();
  context.filter = demLayers.has("elevation") ? "none" : "grayscale(1)";
  context.drawImage(base, 0, 0);
  context.restore();
  for (const layer of rasterLayerOrder) {
    if (!demLayers.has(layer)) continue;
    const overlay = demOverlays[layer];
    if (overlay?.complete && overlay.naturalWidth)
      context.drawImage(overlay, 0, 0);
  }
  context.save();
  context.scale(canvas.width / 1000, canvas.height / 700);
  if (demLayers.has("minerals")) {
    context.fillStyle = "#80e0ad55";
    context.fill(new Path2D("M220 300L295 270 370 324 340 390 265 368Z"));
  }
  if (demLayers.has("thermal")) {
    context.fillStyle = "#ff9b4055";
    context.fill(new Path2D("M570 435a85 52 0 1 0 170 0a85 52 0 1 0 -170 0"));
  }
  context.restore();
  context.strokeStyle = "#d4f394";
  const scale = canvas.width / canvas.clientWidth / demZoom;
  context.lineWidth = 2 * scale;
  context.beginPath();
  for (const leg of loadedLegs) {
    leg.path.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(x + 0.5, y + 0.5);
      else context.lineTo(x + 0.5, y + 0.5);
    });
  }
  path.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x + 0.5, y + 0.5);
    else context.lineTo(x + 0.5, y + 0.5);
  });
  context.stroke();
  loadedMission.forEach(([x, y], index) => {
    context.beginPath();
    context.arc(x + 0.5, y + 0.5, 8 * scale, 0, Math.PI * 2);
    context.fillStyle = index ? "#d4f394" : startColor;
    context.fill();
    context.strokeStyle = "#111513";
    context.lineWidth = scale;
    context.stroke();
    context.fillStyle = "#111513";
    context.font = `bold ${9 * scale}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(index ? String(index) : "⌂", x + 0.5, y + 0.5);
  });
  for (const [point, color] of [
    [start, startColor],
    [goal, endColor],
  ]) {
    if (!point) continue;
    if (loadedMission.some(([x, y]) => point[0] === x && point[1] === y))
      continue;
    context.fillStyle = color;
    context.beginPath();
    context.arc(point[0] + 0.5, point[1] + 0.5, 5 * scale, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#111513";
    context.lineWidth = scale;
    context.stroke();
  }
  context.restore();
}

function showSlopeHazards() {
  const legend = document.createElement("div");
  legend.className = "slope-legend";

  // These thresholds correspond to the route-profile slope limits.
  legend.innerHTML = `
    <strong>DEM slope hazards</strong>
    <span><i class="slope-moderate"></i> &gt;10&deg;&ndash;18&deg;</span>
    <span><i class="slope-steep"></i> &gt;18&deg;&ndash;22&deg;</span>
    <span class="hazard-v2-only">
      <i class="slope-very-steep"></i> &gt;22&deg;
    </span>
  `;

  legend.title =
    "Maximum local neighboring slope. A hazardous pixel does not necessarily block every route through it.";

  document.getElementById("map").append(legend);

  // Load the new hazard overlay after the legend exists.
  setTerrainImage(document.getElementById("hazards"), "jezero-hazards-v2.png");
}

let missionRouteRequest;
let missionDemSummary = null;
let calculatedPlan;
let calculatedDisplay;
const routeDisplayIds = [
  "distance",
  "duration",
  "slope",
  "advisoryTitle",
  "advisoryText",
];
function missionPlanKey() {
  return JSON.stringify([
    state.mode,
    state.ids.map((id) => {
      const point = catalog.find((entry) => entry.id === id);
      return [id, point.x, point.y];
    }),
  ]);
}

function refreshMissionRouteDisplay() {
  if (calculatedPlan === missionPlanKey() && calculatedDisplay) {
    document
      .getElementById("routeLine")
      .setAttribute("d", calculatedDisplay.path);
    routeDisplayIds.forEach((id, index) => {
      document.getElementById(id).textContent = calculatedDisplay.fields[index];
    });
    return;
  }
  missionRouteRequest?.abort();
  missionRouteRequest = null;
  missionDemSummary = null;
  calculatedPlan = calculatedDisplay = undefined;
  resetResourceForecast();
  calculateMission.disabled = state.ids.length < 2;
  calculateMission.textContent = "Calculate route";
  stopMission.disabled = true;
  resetMission.disabled = true;
  document.getElementById("routeLine").setAttribute("d", "");
  for (const id of ["distance", "duration", "slope"])
    document.getElementById(id).textContent = "—";
  document.getElementById("advisoryTitle").textContent = "Route not calculated";
  document.getElementById("advisoryText").textContent =
    state.ids.length < 2
      ? "Add a waypoint to plan a route."
      : "Arrange your waypoints, then click Calculate route.";
}

const calculateMission = document.getElementById("calculateMission");
document.getElementById("loadMissionData").onclick = () => {
  if (!grid) {
    result.textContent = "Wait for the Jezero elevation map to load.";
    return;
  }
  clearDemRoute();
  loadedMission = state.ids.map((id) => {
    const point = catalog.find((entry) => entry.id === id);
    return [
      Math.floor((point.x / 1000) * grid.width),
      Math.floor((point.y / 700) * grid.height),
    ];
  });
  loadedLegs = missionDemSummary?.legs || [];
  start = loadedMission[0];
  goal =
    loadedMission.length > 1 ? loadedMission[loadedMission.length - 1] : null;
  fields.forEach(
    (field, index) => (field.value = [...start, ...(goal || ["", ""])][index]),
  );
  document.getElementById("profile").value = {
    balanced: "balanced",
    safe: "low-exposure",
    science: "shortest",
  }[state.mode];
  path = [];
  choosingStart = true;
  demX = demY = 0;
  setDemZoom(1);
  result.textContent = `Loaded ${loadedMission.length} mission waypoints.${loadedLegs.length ? " The calculated mission route is shown." : ""} Find route calculates between the start and destination fields.`;
};
const stopMission = document.getElementById("stopMission");
const resetMission = document.getElementById("resetMission");
function clearMissionCalculation() {
  calculatedPlan = undefined;
  refreshMissionRouteDisplay();
}

resetMission.onclick = clearMissionCalculation;
stopMission.onclick = () => {
  clearMissionCalculation();
  document.getElementById("advisoryTitle").textContent = "Calculation stopped";
  document.getElementById("advisoryText").textContent =
    "Click Calculate route to try again.";
};
calculateMission.onclick = () => {
  if (!grid) {
    document.getElementById("advisoryTitle").textContent = "DEM not loaded";
    document.getElementById("advisoryText").textContent =
      "Open the dashboard through the local server and reload to load the elevation data.";
    return;
  }
  routeMissionOnDem();
};
function calculateOxygenForecast(distanceM) {
  // Demonstration assumptions
  const speedKmH = 8;
  const scienceHours = 0.5;
  const contingencyHours = 0.5;

  const oxygenCapacityKg = 1.0;
  const startingOxygenPercent = 91;
  const oxygenRateKgH = 0.076;

  // Convert route distance from meters to kilometers
  const distanceKm = distanceM / 1000;

  // Calculate total mission duration
  const travelHours = distanceKm / speedKmH;
  const missionHours = travelHours + scienceHours + contingencyHours;

  // Calculate oxygen consumption
  const oxygenUsedKg = missionHours * oxygenRateKgH;

  // Calculate remaining oxygen
  const startingOxygenKg = oxygenCapacityKg * (startingOxygenPercent / 100);

  const remainingOxygenKg = startingOxygenKg - oxygenUsedKg;

  const remainingOxygenPercent = (remainingOxygenKg / oxygenCapacityKg) * 100;

  return {
    missionHours,
    oxygenUsedKg,
    remainingOxygenPercent,
  };
}
// Demonstration-only parameters; not validated Mars vehicle or EVA specifications.
const RESOURCE_MODEL = Object.freeze({
  startingBatteryPercent: 82,
  batteryCapacityKWh: 2.5,
  driveKWhPerKm: 0.085,
  climbKWhPerMeter: 0.00015,
  solarPowerKW: 0.12,
  solarEfficiency: 0.7,
  reserveWarningPercent: 20,
});

function resetResourceForecast() {
  for (const id of ["oxygenForecast", "batteryForecast", "solarForecast"]) {
    const element = document.getElementById(id);
    if (element) element.textContent = "Awaiting route";
  }
  const duration = document.getElementById("forecastDuration");
  if (duration) duration.textContent = "Mission duration: Awaiting route";
  const warning = document.getElementById("resourceWarning");
  if (warning) {
    warning.textContent = "";
    warning.hidden = true;
  }
}

function calculateResourceForecast(distanceM, ascentM) {
  const oxygen = calculateOxygenForecast(distanceM);
  const energyUsedKWh =
    (distanceM / 1000) * RESOURCE_MODEL.driveKWhPerKm +
    ascentM * RESOURCE_MODEL.climbKWhPerMeter;
  const batteryRemainingPercent =
    RESOURCE_MODEL.startingBatteryPercent -
    (energyUsedKWh / RESOURCE_MODEL.batteryCapacityKWh) * 100;
  const solarHarvestKWh =
    RESOURCE_MODEL.solarPowerKW *
    RESOURCE_MODEL.solarEfficiency *
    oxygen.missionHours;
  return { ...oxygen, energyUsedKWh, batteryRemainingPercent, solarHarvestKWh };
}

function showResourceForecast(forecast) {
  const display = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };
  display(
    "oxygenForecast",
    `${Math.max(0, forecast.remainingOxygenPercent).toFixed(1)}%`,
  );
  display(
    "batteryForecast",
    `${Math.max(0, forecast.batteryRemainingPercent).toFixed(1)}%`,
  );
  display("solarForecast", `${forecast.solarHarvestKWh.toFixed(2)} kWh`);
  display(
    "forecastDuration",
    `Mission duration: ${forecast.missionHours.toFixed(2)} h (including science and contingency)`,
  );

  const alerts = [];
  for (const [label, value] of [
    ["Battery", forecast.batteryRemainingPercent],
    ["Oxygen", forecast.remainingOxygenPercent],
  ]) {
    if (value < 0)
      alerts.push(`${label} demand exceeds the simulated starting supply`);
    else if (value < RESOURCE_MODEL.reserveWarningPercent)
      alerts.push(
        `${label} below ${RESOURCE_MODEL.reserveWarningPercent}% reserve`,
      );
  }
  const warning = document.getElementById("resourceWarning");
  if (warning) {
    warning.hidden = alerts.length === 0;
    warning.textContent = alerts.length
      ? `Simulation warning: ${alerts.join("; ")}.`
      : "";
  }
}

async function routeMissionOnDem() {
  if (!grid) return;
  missionRouteRequest?.abort();
  const controller = new AbortController();
  missionRouteRequest = controller;
  missionDemSummary = null;
  resetResourceForecast();
  calculatedPlan = missionPlanKey();
  const routeLine = document.getElementById("routeLine");
  const status = document.getElementById("advisoryText");
  const title = document.getElementById("advisoryTitle");
  const distance = document.getElementById("distance");
  const slope = document.getElementById("slope");
  const points = state.ids.map((id) =>
    catalog.find((point) => point.id === id),
  );
  const cells = [...points, points[0]].map((point) => [
    Math.floor((point.x / 1000) * grid.width),
    Math.floor((point.y / 700) * grid.height),
  ]);
  const profile = {
    balanced: "balanced",
    safe: "low-exposure",
    science: "shortest",
  }[state.mode];
  routeLine.setAttribute("d", "");
  distance.textContent = "—";
  slope.textContent = "—";
  document.getElementById("duration").textContent = "—";
  title.textContent = "Calculating DEM route";
  calculateMission.disabled = true;
  stopMission.disabled = false;
  resetMission.disabled = false;
  calculateMission.textContent = "Calculating route… 0%";
  status.textContent = "Checking every leg, including the return to habitat.";
  function rememberDisplay() {
    calculatedDisplay = {
      path: routeLine.getAttribute("d"),
      fields: routeDisplayIds.map(
        (id) => document.getElementById(id).textContent,
      ),
    };
  }
  rememberDisplay();
  try {
    const legs = [];
    // Bound memory use by keeping only one full-raster search in flight per mission.
    for (const [index, goal] of cells.slice(1).entries()) {
      const leg = await request("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: cells[index],
          goal,
          profile,
          coverage: "full",
        }),
        signal: controller.signal,
      }).catch((error) => {
        throw new Error(
          `${points[index].name} → ${(points[index + 1] || points[0]).name}: ${error.message}`,
        );
      });
      if (controller.signal.aborted) return;
      legs.push(leg);
      calculateMission.textContent = `Calculating route… ${Math.floor((100 * legs.length) / (cells.length - 1))}%`;
    }
    if (controller.signal.aborted) return;
    const path = legs
      .flatMap((leg) =>
        leg.path.map(
          ([x, y], index) =>
            `${index ? "L" : "M"}${((x + 0.5) / grid.width) * 1000} ${((y + 0.5) / grid.height) * 700}`,
        ),
      )
      .join(" ");
    routeLine.setAttribute("d", path);
    const total = legs.reduce((sum, leg) => sum + leg.distanceM, 0);
    missionDemSummary = {
      source: grid.source,
      profile,
      distanceM: total,
      ascentM: legs.reduce((sum, leg) => sum + leg.ascentM, 0),
      maxSlopeDeg: Math.max(...legs.map((leg) => leg.maxSlopeDeg)),
      legs,
    };
    // The route already includes the return leg; never double its distance.
    const resources = calculateResourceForecast(
      total,
      missionDemSummary.ascentM,
    );
    missionDemSummary.resources = {
      ...resources,
      model: "illustrative-v1",
      assumptions: RESOURCE_MODEL,
    };
    showResourceForecast(resources);
    document.getElementById("duration").textContent =
      `${Math.floor(resources.missionHours)}h ${Math.round((resources.missionHours % 1) * 60)}m`;
    distance.innerHTML = `${(total / 1000).toFixed(2)} <small>km</small>`;
    slope.innerHTML = `${Math.max(...legs.map((leg) => leg.maxSlopeDeg)).toFixed(1)} <small>°</small>`;
    title.textContent = "DEM route calculated";
    status.textContent = `${legs.length} legs including return · ${legs.reduce((sum, leg) => sum + leg.ascentM, 0)} m total ascent. Resource forecasts use illustrative assumptions; not operational guidance.`;
    rememberDisplay();
    await new Promise((resolve) => setTimeout(resolve, 450));
  } catch (error) {
    if (controller.signal.aborted) return;
    missionDemSummary = null;
    resetResourceForecast();
    title.textContent = "Mission route unavailable";
    status.textContent = error.message;
    rememberDisplay();
  } finally {
    if (missionRouteRequest === controller) {
      calculateMission.disabled = false;
      stopMission.disabled = true;
      calculateMission.textContent = "Calculate route";
    }
  }
}

function setTerrainImage(target, url, replace = false) {
  const image = document.createElementNS(target.namespaceURI, "image");

  image.setAttribute("width", "1000");
  image.setAttribute("height", "700");
  image.setAttribute("preserveAspectRatio", "none");

  // Keep original overlays available if a v2 asset cannot load.
  const fallbacks = {
    "jezero-contours-v2.png": "jezero-contours.png",
    "jezero-hazards-v2.png": "jezero-hazards.png",
  };

  const fallback = fallbacks[url];

  if (fallback) {
    image.addEventListener("error", () => {
      if (image.getAttribute("href") !== fallback) {
        console.warn(`${url} unavailable; loading ${fallback}.`);
        image.setAttribute("href", fallback);

        // The original hazard image contains only two categories.
        if (url === "jezero-hazards-v2.png") {
          const legend = document.querySelector(".slope-legend");
          if (legend) {
            legend.classList.add("hazard-legacy");
            const steepLabel =
              legend.querySelector(".slope-steep")?.parentElement;
            if (steepLabel) {
              steepLabel.innerHTML = '<i class="slope-steep"></i> &gt;18&deg;';
            }
          }
        }
      }
    });
  }

  image.setAttribute("href", url);

  if (replace) target.replaceWith(image);
  else target.replaceChildren(image);
}

function showMissionTerrain() {
  const world = document.getElementById("mapWorld");
  const svg = document.getElementById("terrain");
  const frameHeight = (1000 * grid.height) / grid.width;
  svg.setAttribute("viewBox", `0 0 1000 ${frameHeight}`);
  const frame = document.createElementNS(world.namespaceURI, "g");
  frame.setAttribute("transform", `scale(1 ${frameHeight / 700})`);
  world.before(frame);
  frame.append(world);
  for (const point of catalog) {
    if (point.id.startsWith("custom-")) continue;
    point.x =
      ((grid.cropOrigin[0] + Math.floor((point.x / 1000) * 240) + 0.5) /
        grid.width) *
      1000;
    point.y =
      ((grid.cropOrigin[1] + Math.floor((point.y / 700) * 168) + 0.5) /
        grid.height) *
      700;
  }
  applyWaypointEdits();
  setTerrainImage(document.getElementById("terrainFallback"), base.src, true);

  const missionBase = document.querySelector("#mapWorld > image");
  if (missionBase) {
    missionBase.style.filter = state.layers.includes("elevation")
      ? "none"
      : "grayscale(1)";
  }
  // Identical DEM-aligned image placement; below contours, hazards and routes.
  const geology = document.getElementById("geology");
  setTerrainImage(geology, "jezero-geology.png");
  geology.querySelector("image").addEventListener("error", () => {
    console.warn("Geology raster unavailable on mission map.");
  });
  setGeologyLegendVisible("mission", state.layers.includes("geology"));
  // Use the same interpolated contours in the mission map.
  setTerrainImage(
    document.getElementById("contours"),
    "jezero-contours-v2.png",
  );
  document.getElementById("map").classList.add("has-real-terrain");
  world.querySelectorAll(".terrain-label").forEach((label) => label.remove());
  document.querySelector("#map .scale").hidden = true;
  document.querySelector(".map-badge").innerHTML =
    '<span class="live"></span> JEZERO CTX DEM / SIMULATED MISSION';
  document.querySelector(".map-caption").textContent =
    "USGS MARS 2020 CTX DEM · 20 M/PIXEL";
  document.querySelector(".coordinates").textContent = "18.47° N · 77.40° E";
  document
    .getElementById("terrain")
    .setAttribute(
      "aria-label",
      "Jezero elevation map with simulated mission waypoints",
    );
  showSlopeHazards();
  updateMapTransform();
  render();
}

async function init() {
  if (location.protocol === "file:")
    throw new Error(
      "Start python server.py and open the HTTP address it prints.",
    );
  const metadata = await request("jezero-full.json");
  base = new Image();
  // Use the native-resolution CTX elevation visualization.
  // The source DEM and routing calculations remain unchanged.
  base.src = "jezero-elevation.png";
  await base.decode();
  // Display the actual elevation range from the CTX DEM metadata.
  // The colour scale describes elevation, not surface composition.
  const legend = document.createElement("div");
  legend.className = "elevation-legend";
  legend.hidden = true;

  const legendTitle = document.createElement("strong");
  legendTitle.textContent = "Elevation (m)";

  const legendGradient = document.createElement("div");
  legendGradient.className = "elevation-gradient";

  const legendLabels = document.createElement("div");
  legendLabels.className = "elevation-labels";

  const lowLabel = document.createElement("span");
  lowLabel.textContent = `${Math.round(metadata.minimum).toLocaleString()} m`;

  const highLabel = document.createElement("span");
  highLabel.textContent = `${Math.round(metadata.maximum).toLocaleString()} m`;

  legendLabels.append(lowLabel, highLabel);
  legend.append(legendTitle, legendGradient, legendLabels);

  document.getElementById("dem-map").appendChild(legend);
  const missionLegend = legend.cloneNode(true);
  missionLegend.id = "mission-elevation-legend";
  missionLegend.hidden = !state.layers.includes("elevation");
  document.getElementById("map").appendChild(missionLegend);
  if (!Array.isArray(metadata.cropOrigin))
    throw new Error("Full DEM preparation is required.");
  grid = metadata;
  canvas.width = grid.width;
  canvas.height = grid.height;
  fields.forEach(
    (field, i) => (field.max = (i % 2 ? grid.height : grid.width) - 1),
  );
  start = [grid.cropOrigin[0] + 40, grid.cropOrigin[1] + 80];
  goal = [grid.cropOrigin[0] + 190, grid.cropOrigin[1] + 100];
  [...start, ...goal].forEach((value, index) => (fields[index].value = value));
  showMissionTerrain();
  canvas.hidden = false;
  draw();
  submit.disabled = false;
  result.textContent = `${grid.source} · ${grid.dx.toFixed(0)} m/pixel · elevation ${grid.minimum.toFixed(0)} to ${grid.maximum.toFixed(0)} m.`;
}

let demDragged = false;
canvas.onclick = (event) => {
  if (submit.disabled || demDragged) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * grid.width;
  const y = ((event.clientY - rect.top) / rect.height) * grid.height;
  const point = [
    Math.floor((x - grid.width / 2 - demX) / demZoom + grid.width / 2),
    Math.floor((y - grid.height / 2 - demY) / demZoom + grid.height / 2),
  ];
  if (
    point[0] < 0 ||
    point[0] >= grid.width ||
    point[1] < 0 ||
    point[1] >= grid.height
  )
    return;
  if (choosingStart) {
    start = point;
    fields[0].value = point[0];
    fields[1].value = point[1];
  } else {
    goal = point;
    fields[2].value = point[0];
    fields[3].value = point[1];
  }
  choosingStart = !choosingStart;
  path = [];
  geologyPanel.hidden = true;
  result.textContent = choosingStart
    ? "Ready to find a route."
    : "Choose the destination.";
  draw();
};

function clearDemRoute() {
  demRequest?.abort();
  demRequest = undefined;
  submit.disabled = !grid;
  submit.textContent = "Find route";
  resetDem.disabled = true;
  path = [];
  geologyPanel.hidden = true;
  draw();
}

resetDem.onclick = () => {
  clearDemRoute();
  geologyPanel.hidden = true;
  result.textContent = "Ready to find a route.";
};

const longRouteThresholdKm = 30;

function confirmLongRoute(distanceKm) {
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `<form method="dialog">
    <h2>Continue with a long route?</h2>
    <p>These points are ${distanceKm.toFixed(1)} km apart in a straight line. Searching the full Jezero map may take longer.</p>
    <button class="quiet" value="cancel" autofocus>Cancel</button>
    <button class="primary" value="continue">Continue</button>
  </form>`;
  (document.fullscreenElement || document.body).append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        const approved = dialog.returnValue === "continue";
        dialog.remove();
        resolve(approved);
      },
      { once: true },
    );
    dialog.showModal();
  });
}

let confirmingDemRoute = false;
form.onsubmit = async (event) => {
  event.preventDefault();
  if (!grid || demRequest || confirmingDemRoute) return;
  const nextStart = fields.slice(0, 2).map((field) => field.valueAsNumber);
  const nextGoal = fields.slice(2).map((field) => field.valueAsNumber);
  const profile = document.getElementById("profile").value;
  const distanceKm =
    Math.hypot(
      (nextGoal[0] - nextStart[0]) * grid.dx,
      (nextGoal[1] - nextStart[1]) * grid.dy,
    ) / 1000;
  const extended = distanceKm >= longRouteThresholdKm;
  if (extended) {
    confirmingDemRoute = true;
    try {
      if (!(await confirmLongRoute(distanceKm))) return;
    } finally {
      confirmingDemRoute = false;
    }
  }
  const controller = new AbortController();
  demRequest = controller;
  start = nextStart;
  goal = nextGoal;
  path = [];
  draw();
  submit.disabled = true;
  resetDem.disabled = false;
  submit.textContent = "Finding route… 0%";
  const started = performance.now();
  const timer = setInterval(() => {
    if (demRequest !== controller) {
      clearInterval(timer);
      return;
    }
    const estimated = Math.floor(
      95 * (1 - Math.exp(-(performance.now() - started) / 3500)),
    );
    submit.textContent = `Finding route… ~${estimated}%`;
  }, 200);
  result.textContent = "Calculating route…";
  geologyPanel.hidden = true;
  try {
    const route = await request("/api/route", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start,
        goal,
        profile,
        coverage: "full",
        extended,
      }),
    });
    if (demRequest !== controller) return;
    clearInterval(timer);
    submit.textContent = "Finding route… 100%";
    path = route.path;
    draw();
    result.textContent = `${route.distanceM} m distance · ${route.ascentM} m ascent · ${route.maxSlopeDeg}° maximum slope`;
    if (route.geology?.units) {
      const geology = route.geology;

      const formations = geology.units.map(
        (unit) =>
          `${unit.name} (${unit.symbol}): ${unit.distanceM} m (${unit.percentage}%)`,
      );

      if (route.geology?.units) {
        geologyPanel.replaceChildren();

        const heading = document.createElement("h3");
        heading.textContent = "Geological Route Intelligence";

        geologyPanel.append(heading);
        for (const unit of route.geology.units) {
          const formation = document.createElement("div");
          formation.className = "geology-formation";

          const details = document.createElement("div");
          details.className = "geology-formation-details";

          const name = document.createElement("span");
          name.className = "geology-formation-name";
          name.textContent = `${unit.name} (${unit.symbol})`;

          const distance = document.createElement("span");
          distance.className = "geology-formation-distance";
          distance.textContent = `${unit.distanceM.toFixed(1)} m`;

          const percentage = document.createElement("span");
          percentage.className = "geology-formation-percentage";
          percentage.textContent = `${unit.percentage.toFixed(1)}%`;

          details.append(name, distance);
          formation.append(details, percentage);
          geologyPanel.append(formation);
        }
        const coverage = document.createElement("p");
        coverage.textContent = `Mapped geological coverage: ${route.geology.mappedPercentage.toFixed(1)}%`;

        const coverageBar = document.createElement("div");
        coverageBar.className = "geology-coverage-bar";

        const mappedFill = document.createElement("div");
        mappedFill.className = "geology-coverage-fill";

        mappedFill.style.width = `${route.geology.mappedPercentage}%`;

        coverageBar.append(mappedFill);
        geologyPanel.append(coverage, coverageBar);
        const coverageLabels = document.createElement("div");
        coverageLabels.className = "geology-coverage-labels";

        const mappedLabel = document.createElement("span");
        mappedLabel.textContent = `Mapped ${route.geology.mappedPercentage.toFixed(1)}%`;

        const unmappedLabel = document.createElement("span");
        unmappedLabel.textContent = `Unmapped ${(100 - route.geology.mappedPercentage).toFixed(1)}%`;

        coverageLabels.append(mappedLabel, unmappedLabel);
        geologyPanel.append(coverageLabels);
        const unmapped = document.createElement("p");

        unmapped.textContent = `Unmapped geological distance: ${route.geology.unmappedDistanceM.toFixed(1)} m`;

        const transitions = document.createElement("p");
        transitions.textContent = `Geological transitions: ${route.geology.transitions.length}`;

        geologyPanel.append(unmapped, transitions);
        geologyPanel.hidden = false;
      }
    }
    if (route.geology.units.length === 0) {
      const note = document.createElement("p");
      note.textContent =
        "No geological classification is available along this route. " +
        "This does not indicate unsafe terrain.";

      geologyPanel.append(note);
    }
    console.log("ARES geological analysis:", route.geology);
    await new Promise((resolve) => setTimeout(resolve, 450));
  } catch (error) {
    if (demRequest === controller) result.textContent = error.message;
  } finally {
    clearInterval(timer);
    if (demRequest === controller) {
      demRequest = undefined;
      submit.disabled = false;
      submit.textContent = "Find route";
    }
  }
};

new ResizeObserver(() => {
  if (grid && canvas.clientWidth) draw();
}).observe(canvas);
const demMap = document.getElementById("dem-map");
const demFullscreen = document.getElementById("dem-fullscreen");
const demFullscreenTools = document.createElement("div");
demFullscreenTools.className = "dem-fullscreen-tools";
demFullscreenTools.hidden = true;
demMap.append(demFullscreenTools);
submit.setAttribute("form", form.id);
const routeProfile = document.getElementById("profile");
routeProfile.setAttribute("form", form.id);

const fullscreenControls = [
  demMap.nextElementSibling,
  document.getElementById("dem-layer-notes"),
  routeProfile.closest("label"),
  submit,
  resetDem,
  result,
];
const originalLocations = fullscreenControls.map((control) => {
  const placeholder = document.createComment("Fullscreen control location");
  control.before(placeholder);
  return placeholder;
});

function syncDemFullscreen() {
  const expanded =
    document.fullscreenElement === demMap ||
    demMap.classList.contains("map-expanded");
  if (expanded === !demFullscreenTools.hidden) return;
  demFullscreenTools.hidden = !expanded;
  fullscreenControls.forEach((control, index) => {
    if (expanded) demFullscreenTools.append(control);
    else originalLocations[index].after(control);
  });
}

document.addEventListener("fullscreenchange", syncDemFullscreen);
new MutationObserver(syncDemFullscreen).observe(demMap, {
  attributes: true,
  attributeFilter: ["class"],
});
document.getElementById("dem-layer-info").onclick = (event) => {
  const notes = document.getElementById("dem-layer-notes");
  notes.hidden = !notes.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!notes.hidden));
};
document.getElementById("dem-zoom-in").onclick = () =>
  setDemZoom(demZoom * 1.5);
document.getElementById("dem-zoom-out").onclick = () =>
  setDemZoom(demZoom / 1.5);
document.getElementById("dem-reset").onclick = () => {
  demX = demY = 0;
  setDemZoom(1);
};
demFullscreen.onclick = async () => {
  if (document.fullscreenElement === demMap) await document.exitFullscreen();
  else if (
    !demMap.classList.toggle(
      "map-expanded",
      !demMap.classList.contains("map-expanded"),
    )
  )
    return;
  else {
    try {
      await demMap.requestFullscreen();
      demMap.classList.remove("map-expanded");
    } catch {
      // Keep the in-page expanded view if native fullscreen is unavailable.
    }
  }
};
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") demMap.classList.remove("map-expanded");
});
document.querySelectorAll("[data-dem-layer]").forEach((button) => {
  button.onclick = () => {
    const layer = button.dataset.demLayer;
    const active = !demLayers.has(layer);
    if (active) demLayers.add(layer);
    else demLayers.delete(layer);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    const source = {
      // Interpolated CTX DEM contours: 50 m minor, 250 m major.
      contours: "jezero-contours-v2.png",
      hazards: "jezero-hazards-v2.png",
      geology: "jezero-geology.png",
    }[layer];
    if (source && !demOverlays[layer]) {
      const image = new Image();
      demOverlays[layer] = image;

      // Redraw when the selected overlay finishes loading.
      image.onload = () => {
        if (grid) draw();
      };

      // If interpolated contours are unavailable, use the original overlay.

      image.onerror = () => {
        // Each enhanced layer falls back independently to its original image.
        const fallbacks = {
          contours: "jezero-contours.png",
          hazards: "jezero-hazards.png",
        };

        const fallback = fallbacks[layer];

        if (fallback && !image.src.endsWith("/" + fallback)) {
          console.warn(`${layer} v2 unavailable; loading original overlay.`);
          image.src = fallback;
        } else {
          console.error(`Unable to load ${layer} overlay.`);
        }
      };

      image.src = source;
    }
    if (layer === "geology") setGeologyLegendVisible("dem", active);
    if (layer === "elevation") {
      document.querySelector("#dem-map .elevation-legend").hidden = !active;
    }
    if (grid) draw();
  };
});

document
  .querySelector('[data-layer="elevation"]')
  .addEventListener("click", () => {
    const missionBase = document.querySelector("#mapWorld > image");

    if (missionBase) {
      missionBase.style.filter = state.layers.includes("elevation")
        ? "none"
        : "grayscale(1)";
    }
  });

const demPointers = new Map();

function pinchGeometry() {
  const [a, b] = demPointers.values();
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    span: Math.hypot(a.x - b.x, a.y - b.y),
  };
}

canvas.addEventListener("pointerdown", (event) => {
  if (
    event.button !== 0 ||
    demPointers.size >= 2 ||
    (demPointers.size && event.pointerType !== "touch")
  )
    return;
  demDragged = demPointers.size > 0;
  demPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  const pointer = demPointers.get(event.pointerId);
  if (!pointer) return;
  if (demPointers.size === 2) {
    const before = pinchGeometry();
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const after = pinchGeometry();
    if (before.span < 1) return;
    const nextZoom = Math.min(
      12,
      Math.max(1, (demZoom * after.span) / before.span),
    );
    const ratio = nextZoom / demZoom;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const anchorX = (before.x - rect.left - rect.width / 2) * sx;
    const anchorY = (before.y - rect.top - rect.height / 2) * sy;
    demX = anchorX - (anchorX - demX) * ratio + (after.x - before.x) * sx;
    demY = anchorY - (anchorY - demY) * ratio + (after.y - before.y) * sy;
    setDemZoom(nextZoom);
    return;
  }
  const dx = event.clientX - pointer.x;
  const dy = event.clientY - pointer.y;
  if (!demDragged && Math.hypot(dx, dy) < 4) return;
  demDragged = true;
  canvas.classList.add("dem-dragging");
  demX += (dx * canvas.width) / canvas.clientWidth;
  demY += (dy * canvas.height) / canvas.clientHeight;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  setDemZoom(demZoom);
});
canvas.addEventListener("lostpointercapture", (event) => {
  demPointers.delete(event.pointerId);
  if (!demPointers.size) canvas.classList.remove("dem-dragging");
});
init().catch((error) => (result.textContent = error.message));
