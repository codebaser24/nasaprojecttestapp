const form = document.querySelector("#route");
const result = document.querySelector("#result");
const canvas = document.querySelector("canvas");
const context = canvas.getContext("2d");
const theme = getComputedStyle(document.documentElement);
const startColor = theme.getPropertyValue("--start-marker").trim();
const endColor = theme.getPropertyValue("--end-marker").trim();
const submit = form.querySelector("button");
const resetDem = document.getElementById("resetDem");
let demRequest;
const fields = ["sx", "sy", "ex", "ey"].map(id => document.getElementById(id));
let grid, base, start, goal, path = [];
let choosingStart = true;
let loadedMission = [];
let loadedLegs = [];
let demZoom = 1, demX = 0, demY = 0;
const demLayers = new Set();
const demOverlays = {};

function setDemZoom(value) {
  demZoom = Math.min(12, Math.max(1, value));
  const limitX = canvas.width * (demZoom - 0.5) / 2;
  const limitY = canvas.height * (demZoom - 0.5) / 2;
  demX = Math.max(-limitX, Math.min(limitX, demX));
  demY = Math.max(-limitY, Math.min(limitY, demY));
  if (grid) draw();
}

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error), {code: payload.code});
  return payload;
}

function draw() {
  if (!canvas.clientWidth || !base) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(canvas.width / 2 + demX, canvas.height / 2 + demY);
  context.scale(demZoom, demZoom);
  context.translate(-canvas.width / 2, -canvas.height / 2);
  // With elevation colours off, the shaded base map is drawn in grey so other layers stand out.
  context.filter = grid.baseLayer === "elevation" && !demLayers.has("elevation") ? "grayscale(1)" : "none";
  context.drawImage(base, 0, 0);
  context.filter = "none";
  for (const layer of demLayers) {
    const overlay = demOverlays[layer];
    context.globalAlpha = OPAQUE_OVERLAYS.has(layer) ? 1 : overlayOpacity;
    if (overlay?.complete && overlay.naturalWidth) context.drawImage(overlay, 0, 0);
  }
  context.globalAlpha = 1;
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
  for (const [point, color] of [[start, startColor], [goal, endColor]]) {
    if (!point) continue;
    if (loadedMission.some(([x, y]) => point[0] === x && point[1] === y)) continue;
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

function formatValue(value) {
  return Math.abs(value) >= 100 ? value.toFixed(0) : String(+value.toPrecision(3));
}

function sourceText(source) {
  if (!source) return "";
  return [source.citation || source.title, source.license].filter(Boolean).join(" · ");
}

// Legend data comes from the build: the base elevation, derived overlays, and each loaded layer.
function legendEntry(id) {
  if (!grid?.legends) return null;
  if (id === "elevation-base") return grid.legends.elevation && {title: "Elevation (base map)", legend: grid.legends.elevation};
  if (id === "hazards") return grid.legends.hazards && {title: "Slope hazards", legend: grid.legends.hazards};
  if (id === "contours") return grid.legends.contours && {title: "Topography contours", legend: grid.legends.contours};
  if (CAMP_ANALYSES[id]) return grid.legends[id] && {title: CAMP_ANALYSES[id].title, legend: grid.legends[id]};
  const layer = grid.layers.find(entry => entry.id === id);
  return layer?.legend && {title: `${KIND_LABELS[layer.kind]} · ${layer.file}`, legend: layer.legend,
    note: layer.note, source: sourceText(layer.source), units: layer.units};
}

function legendHtml(ids) {
  return ids.map(legendEntry).filter(Boolean).map(({title, legend, note, source}) => {
    let body = "";
    if (legend.type === "ramp") {
      const units = legend.units ? ` ${escapeText(legend.units)}` : "";
      const [low, high] = legend.labels || [`${formatValue(legend.low)}${units}`, `${formatValue(legend.high)}${units}`];
      body = `<div class="legend-ramp" style="background:linear-gradient(90deg,${legend.colours.join(",")})"></div>
        <div class="legend-scale"><span>${escapeText(low)}</span><span>${escapeText(high)}</span></div>
        ${legend.units || legend.labels ? "" : "<small>Units are not stated in the file.</small>"}`;
    } else {
      body = `<ul class="legend-classes">${legend.items.map(item => {
        const swatch = legend.type === "lines"
          ? `<i class="legend-line" style="border-top:${item.width}px solid ${item.colour}"></i>`
          : `<i${item.colour && !item.hidden ? ` style="background:${item.colour}"` : ' class="legend-none"'}></i>`;
        const share = item.gridPercent != null ? ` <small>${item.gridPercent}% of grid</small>` : "";
        const hidden = item.hidden ? ` <small>not shown: ${escapeText(item.reason || "hidden")}</small>` : "";
        return `<li class="${item.hidden ? "legend-hidden" : ""}">${swatch}<span>${escapeText(item.name)}${share}${hidden}</span></li>`;
      }).join("")}</ul>`;
    }
    const notes = [legend.note, note, source && `Source: ${source}`].filter(Boolean)
      .map(text => `<small>${escapeText(text)}</small>`).join("");
    return `<div class="legend-block"><b>${escapeText(title)}</b>${body}${notes}</div>`;
  }).join("");
}

// ------------------------------------------------ what the route crosses in each loaded layer
// After Gihan Kesara's route geology analysis (kesara branch), extended to every loaded layer.

function distanceText(metres) {
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;
}

// Adds up the per-leg results of a multi-leg mission into one result per layer.
function combineAlongRoute(legs) {
  const combined = new Map();
  for (const leg of legs) {
    for (const entry of leg.alongRoute || []) {
      const total = combined.get(entry.layer) || {...entry, classes: [], noDataM: 0, boundaries: 0, coveredM: 0,
        minimum: null, maximum: null, weightedSum: 0};
      total.noDataM += entry.noDataM;
      if (entry.type === "classes") {
        total.boundaries += entry.boundaries;
        for (const item of entry.classes) {
          const existing = total.classes.find(other => other.name === item.name);
          if (existing) existing.distanceM += item.distanceM;
          else total.classes.push({...item});
        }
      } else if (entry.minimum !== null) {
        total.coveredM += entry.coveredM;
        total.weightedSum += entry.mean * entry.coveredM;
        total.minimum = total.minimum === null ? entry.minimum : Math.min(total.minimum, entry.minimum);
        total.maximum = total.maximum === null ? entry.maximum : Math.max(total.maximum, entry.maximum);
      }
      combined.set(entry.layer, total);
    }
  }
  return [...combined.values()].map(total => {
    if (total.type === "classes") total.classes.sort((a, b) => b.distanceM - a.distanceM);
    else total.mean = total.coveredM ? total.weightedSum / total.coveredM : null;
    return total;
  });
}

function alongRouteHtml(entries) {
  if (!entries?.length) return "";
  const blocks = entries.map(entry => {
    const title = `${KIND_LABELS[entry.kind] || entry.kind} · ${escapeText(entry.file)}`;
    if (entry.type === "classes") {
      const total = entry.classes.reduce((sum, item) => sum + item.distanceM, 0) + entry.noDataM;
      const share = metres => total ? (100 * metres / total).toFixed(0) : 0;
      const bar = entry.classes.map(item => `<i style="width:${share(item.distanceM)}%;background:${item.colour || "#5d675b"}" title="${escapeText(item.name)}"></i>`).join("");
      const rows = entry.classes.slice(0, 6).map(item => `<li><i style="background:${item.colour || "#5d675b"}"></i><span>${escapeText(item.name)}${item.hidden ? " <small>(not drawn on the map)</small>" : ""}</span><b>${distanceText(item.distanceM)} · ${share(item.distanceM)}%</b></li>`).join("");
      const more = entry.classes.length > 6 ? `<li class="muted">+ ${entry.classes.length - 6} more</li>` : "";
      const gaps = entry.noDataM ? `<li class="muted"><i></i><span>No data in this file</span><b>${distanceText(entry.noDataM)} · ${share(entry.noDataM)}%</b></li>` : "";
      return `<div class="along-layer"><b>${title}</b><div class="along-bar">${bar}</div><ul>${rows}${more}${gaps}</ul>
        <small>${entry.boundaries} boundar${entry.boundaries === 1 ? "y" : "ies"} crossed</small></div>`;
    }
    if (entry.kind === "walkback") {
      const text = entry.minimum === null ? "Outside the walk-back analysis area"
        : `Farthest point on this route is ${distanceText(entry.maximum)} from the camp on foot (average ${distanceText(entry.mean)}).`;
      return `<div class="along-layer"><b>${title}</b><p>${text}${entry.noDataM ? ` No walking route back for ${distanceText(entry.noDataM)} of it.` : ""}</p></div>`;
    }
    const units = entry.units ? ` ${escapeText(entry.units)}` : "";
    const values = entry.minimum === null ? "No data along this route"
      : `${formatValue(entry.minimum)} to ${formatValue(entry.maximum)}${units}, average ${formatValue(entry.mean)}${units}${entry.units ? "" : " (units not stated in the file)"}`;
    const gaps = entry.noDataM ? ` · no data for ${distanceText(entry.noDataM)}` : "";
    return `<div class="along-layer"><b>${title}</b><p>${values}${gaps}</p></div>`;
  });
  return `<div class="along-route-title"><span class="eyebrow">ALONG THIS ROUTE</span><small>From the loaded files at every route cell. Shown only; not used to choose the route.</small></div>${blocks.join("")}`;
}

// The elevation colour legend is shown only while elevation colours are switched on.
function baseLegendIds(active = ["elevation"]) {
  if (grid?.baseLayer === "elevation") return active.includes("elevation") ? ["elevation-base"] : [];
  return grid?.baseLayer ? [grid.baseLayer] : [];
}

function updateDemLegend() {
  if (grid) document.getElementById("demLegend").innerHTML = legendHtml([...baseLegendIds([...demLayers]), ...demLayers]);
}

// Called by render() in app.js whenever the mission map's layers change.
function updateMissionLegend() {
  if (!grid) return;
  const active = state.layers.filter(id => availableLayers.has(id));
  document.getElementById("missionLegend").innerHTML = legendHtml([...baseLegendIds(active), ...active]);
  const missionBase = document.getElementById("missionBase");
  if (missionBase) missionBase.style.filter = grid.baseLayer === "elevation" && !active.includes("elevation") ? "grayscale(1)" : "";
  refreshMissionAnalyses(active);
}

// Loads line-of-sight and walk-back overlays for the camp's current position and route profile.
// Waits briefly so dragging the camp does not start a calculation at every step.
const analysisTimers = {};
function refreshMissionAnalyses(active) {
  for (const kind of Object.keys(CAMP_ANALYSES)) {
    const group = document.getElementById(kind);
    if (!group || !active.includes(kind)) continue;
    const key = `${campCell()}|${kind === "walkback" ? missionProfile() : ""}`;
    if (group.dataset.key === key) continue;
    group.dataset.key = key;
    clearTimeout(analysisTimers[kind]);
    analysisTimers[kind] = setTimeout(() => loadCampAnalysis(kind, missionProfile())
      .then(url => {
        if (group.dataset.key !== key) return;
        setTerrainImage(group, url);
        document.getElementById("missionLegend").innerHTML = legendHtml([...baseLegendIds(state.layers), ...state.layers.filter(id => availableLayers.has(id))]);
      })
      .catch(error => {
        group.dataset.key = "";
        notify(`${CAMP_ANALYSES[kind].title}: ${error.message}`);
      }), 400);
  }
}

// Legends sit under the map normally. In fullscreen that space is gone, so the legend moves
// onto the map in a collapsible panel, and moves back when fullscreen ends.
function floatLegendInFullscreen(mapElement, legend) {
  const overlay = document.createElement("div");
  overlay.className = "legend-overlay";
  overlay.hidden = true;
  overlay.innerHTML = '<button type="button" class="legend-toggle" aria-expanded="true">LEGEND</button>';
  mapElement.append(overlay);
  const home = document.createComment("Legend location outside fullscreen");
  legend.before(home);
  const toggle = overlay.querySelector("button");
  toggle.onclick = () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    legend.hidden = !open;
  };
  const sync = () => {
    const expanded = document.fullscreenElement === mapElement || mapElement.classList.contains("map-expanded");
    if (expanded === !overlay.hidden) return;
    overlay.hidden = !expanded;
    if (expanded) {
      overlay.append(legend);
    } else {
      home.after(legend);
      legend.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
    }
  };
  document.addEventListener("fullscreenchange", sync);
  new MutationObserver(sync).observe(mapElement, {attributes: true, attributeFilter: ["class"]});
}

floatLegendInFullscreen(document.getElementById("map"), document.getElementById("missionLegend"));
floatLegendInFullscreen(document.getElementById("dem-map"), document.getElementById("demLegend"));

function showSlopeHazards() {
  setTerrainImage(document.getElementById("hazards"), buildUrl("hazards.png"));
}

let missionRouteRequest;
let missionDemSummary = null;
let calculatedPlan;
let calculatedDisplay;
const routeDisplayIds = ["distance", "ascent", "slope", "advisoryTitle", "advisoryText"];
const KIND_LABELS = {elevation: "Elevation", imagery: "Imagery", mineral: "Minerals", thermal: "Thermal", geology: "Geology", unknown: "Unidentified",
  lineOfSight: "Line of sight to the camp", walkback: "Walk-back to the camp"};
// Safety analyses calculated from elevation for the camp's current position.
const CAMP_ANALYSES = {
  viewshed: {label: "◎ Line of sight", title: "Line of sight from the camp",
    hint: "Where a person can see the camp's antenna (radio line of sight), calculated from elevation"},
  walkback: {label: "↩ Walk-back", title: "Walk-back distance to the camp",
    hint: "Shortest walking distance back to the camp within the route's slope limit, calculated from elevation"}
};
const OPAQUE_OVERLAYS = new Set(["contours", "hazards", ...Object.keys(CAMP_ANALYSES)]);

// Grid cell of the mission's camp (the first stop), wherever it has been moved to.
function campCell() {
  const camp = catalog.find(point => point.id === "hab");
  return camp && grid ? [Math.floor(camp.x / 1000 * grid.width), Math.floor(camp.y / 700 * grid.height)] : null;
}

function missionProfile() {
  return {balanced: "balanced", safe: "low-exposure", science: "shortest"}[state.mode];
}

async function loadCampAnalysis(kind, profile) {
  const [x, y] = campCell();
  const result = await request(`/api/analysis?type=${kind}&x=${x}&y=${y}&profile=${profile}`);
  grid.legends[kind] = result.legend;
  return buildUrl(result.image);
}
const KIND_ICONS = {elevation: "▲", imagery: "▣", mineral: "◇", thermal: "☀", geology: "▦", unknown: "?"};
// Kinds that are shown for reference when a loaded file has them.
const OPTIONAL_KINDS = ["imagery", "mineral", "thermal", "geology"];
const SHOWN_ONLY = "Shown only; not used in route calculations";
let overlayOpacity = 0.8;

const escapeText = escapeWaypointText;

function buildUrl(name) {
  return `${grid.buildUrl}/${name}`;
}

function includedFiles() {
  return grid.files.filter(file => file.role !== "excluded");
}

function shortName(name) {
  return name.length > 24 ? name.slice(0, 22) + "…" : name;
}

// Thresholds and intervals recorded by the build (older builds used 10°/18° and 50 m).
function derivedText(kind) {
  if (kind === "hazards") {
    const limits = grid.derived.hazardThresholdsDeg || [10, 18];
    return limits.map(value => `${value}°`).join(", ").replace(/, ([^,]*)$/, " and $1");
  }
  return (grid.derived.contourIntervalsM || [50]).map(value => `${value} m`).join(" and ");
}

// Every layer button, including disabled placeholders for kinds no loaded file contains.
function mapLayers() {
  const needsRouting = "Needs elevation that meets the routing requirements";
  const layers = [
    // Elevation colours on the base map, after Gihan Kesara's elevation control on the kesara branch.
    ...(grid.baseLayer === "elevation" ? [{id: "elevation", label: "▲ Elevation colours", present: true, derived: true,
      title: "Colour the shaded base map by elevation. Turn off for a grey shaded map that makes other layers easier to read."}] : []),
    {id: "contours", label: "◉ Topography", image: "contours.png", present: grid.derived.contours, derived: true,
      title: grid.derived.contours ? `Contours every ${derivedText("contours")}, interpolated from elevation` : needsRouting},
    {id: "hazards", label: "△ Hazards", image: "hazards.png", present: grid.derived.hazards, derived: true,
      title: grid.derived.hazards ? `Slopes steeper than ${derivedText("hazards")}, computed from elevation` : needsRouting},
    ...Object.entries(CAMP_ANALYSES).map(([id, analysis]) => ({id, label: analysis.label, derived: true, analysis: true,
      present: Boolean(grid.derived.slope && campCell()), title: grid.derived.slope ? analysis.hint : needsRouting})),
    ...grid.layers.map(layer => ({id: layer.id, image: layer.image, present: true,
      label: `${KIND_ICONS[layer.kind]} ${KIND_LABELS[layer.kind]} · ${shortName(layer.file)}`,
      title: `${KIND_LABELS[layer.kind]} from ${layer.file}, band ${layer.bands.join(", ")}. ${SHOWN_ONLY}.`}))
  ];
  for (const kind of OPTIONAL_KINDS) {
    if (!grid.layers.some(layer => layer.kind === kind)) {
      layers.push({id: `missing-${kind}`, label: `${KIND_ICONS[kind]} ${KIND_LABELS[kind]}`, present: false, title: "Not in any loaded file"});
    }
  }
  return layers;
}

function layerButtonsHtml(attribute) {
  return mapLayers().map(layer => `<button type="button" class="layer" ${attribute}="${layer.id}" aria-pressed="false" title="${escapeText(layer.title)}"${layer.present ? "" : " disabled"}>${escapeText(layer.label)}</button>`).join("");
}

function routingStatus() {
  const routing = grid?.routing;
  if (!routing) return {available: false, message: "No data files are loaded. Select files in the Data files tab."};
  if (routing.available) return {available: true};
  const needed = routing.requires.filter(item => routing.missing.includes(item.id)).map(item => item.label);
  return {available: false, message: `Not enough data available to generate a route. At least this data is required: ${needed.join("; ")}.`};
}

function dataUsageText(dataUsed) {
  const shownOnly = grid.layers.map(layer => `${KIND_LABELS[layer.kind]} (${layer.file})`);
  const present = new Set(grid.layers.map(layer => layer.kind));
  const absent = OPTIONAL_KINDS.filter(kind => !present.has(kind)).map(kind => KIND_LABELS[kind]);
  return [`Calculated from: ${dataUsed.join("; ")}.`,
    shownOnly.length ? `Loaded but not used in route calculations: ${shownOnly.join(", ")}.` : "",
    absent.length ? `Not in the loaded files: ${absent.join(", ")}.` : "",
    "Duration and oxygen use are not calculated."].filter(Boolean).join(" ");
}

function fileRoleText(file) {
  if (file.role === "reference") return "Reference grid: kept at its own pixels";
  if (file.role === "aligned") return `Reprojected onto the reference grid · its outline covers ${file.coversPercent}% of the grid`;
  return `Not loaded: ${file.reason}`;
}

function inventoryHtml(meta) {
  const size = meta.horizontalUnits ? `${meta.dx} m/pixel` : "pixel size in metres unknown";
  const elevationEntries = meta.elevation.available ? [{
    file: meta.elevation.file, bands: [meta.elevation.band], identifiedBy: meta.elevation.identifiedBy,
    units: meta.elevation.units, notes: meta.elevation.assumptions,
    use: meta.routing.available ? "Used for route calculations" : "Loaded, but the routing requirements are not met"
  }] : [];
  const items = ["elevation", ...OPTIONAL_KINDS].map(kind => {
    const entries = [...(kind === "elevation" ? elevationEntries : []),
      ...meta.layers.filter(layer => layer.kind === kind).map(layer => ({...layer,
        notes: [`has data on ${layer.coveragePercent}% of the grid.`,
          layer.legend?.type === "classes" ? `${layer.legend.items.filter(item => !item.hidden).length} classes shown.` : "",
          layer.source ? `Source: ${sourceText(layer.source)}.` : ""].filter(Boolean),
        use: kind === "elevation" ? "Shown only; another elevation band is used for routing" : SHOWN_ONLY}))];
    const details = entries.length ? entries.map(entry => `<p><b>${escapeText(entry.file)}</b> · band ${entry.bands.join(", ")} · identified by ${escapeText(entry.identifiedBy)}${entry.units ? ` · units: ${escapeText(entry.units)}` : ""}${entry.notes?.length ? " · " + entry.notes.map(escapeText).join(" ") : ""}<br><span class="${entry.use.startsWith("Used") ? "use-routing" : "use-shown"}">${escapeText(entry.use)}</span></p>`).join("")
      : "<p>Not in any loaded file · not included in any calculation</p>";
    return `<div class="inventory-item ${entries.length ? "is-available" : "is-missing"}"><span>${KIND_LABELS[kind].toUpperCase()}</span><strong>${entries.length ? "Available" : "Not in loaded files"}</strong>${details}</div>`;
  }).join("");
  const unknown = meta.layers.filter(layer => layer.kind === "unknown")
    .map(layer => `Band ${layer.bands.join(", ")} of ${escapeText(layer.file)} could not be identified. It is shown, but not used in any calculation.`);
  const files = meta.files.map(file => `<li><b>${escapeText(file.name)}</b> — ${escapeText(fileRoleText(file))}</li>`).join("");
  const derived = meta.derived.slope
    ? `Slope, hazards (slopes steeper than ${derivedText("hazards")}) and contours every ${derivedText("contours")} are computed from elevation.` : "";
  const status = routingStatus();
  const route = status.available
    ? `<p><b>Route calculation uses:</b> elevation from ${escapeText(meta.elevation.file)} and the slope computed from it. ${escapeText(derived)} No other layer affects the route.</p>`
    : `<p class="inventory-warning"><b>${escapeText(status.message)}</b></p>`;
  const notCalculated = NOT_CALCULATED.map(item => `${escapeText(item.output)}: needs ${escapeText(item.requires)}`).join("; ");
  return `<div class="conditions-title"><span class="eyebrow">DATA IN THE LOADED FILES</span><span>${includedFiles().length} file${includedFiles().length === 1 ? "" : "s"} · grid ${meta.width} × ${meta.height} px · ${escapeText(size)}</span></div>
    <div class="inventory-grid">${items}</div>
    <div class="inventory-notes"><ul class="inventory-files">${files}</ul>${route}${unknown.length ? `<p>${unknown.join(" ")}</p>` : ""}<p><b>Not calculated because the data is not available:</b> ${notCalculated}.</p></div>`;
}
function missionPlanKey() {
  return JSON.stringify([state.mode, state.ids.map(id => {
    const point = catalog.find(entry => entry.id === id);
    return [id, point.x, point.y];
  })]);
}

function refreshMissionRouteDisplay() {
  if (calculatedPlan === missionPlanKey() && calculatedDisplay) {
    document.getElementById("routeLine").setAttribute("d", calculatedDisplay.path);
    routeDisplayIds.forEach((id, index) => {
      document.getElementById(id).textContent = calculatedDisplay.fields[index];
    });
    document.getElementById("missionAlongRoute").innerHTML = calculatedDisplay.along || "";
    return;
  }
  document.getElementById("missionAlongRoute").innerHTML = "";
  missionRouteRequest?.abort();
  missionRouteRequest = null;
  missionDemSummary = null;
  calculatedPlan = calculatedDisplay = undefined;
  const status = grid ? routingStatus() : {available: true};
  calculateMission.disabled = state.ids.length < 2 || !status.available;
  calculateMission.textContent = "Calculate route";
  stopMission.disabled = true;
  resetMission.disabled = true;
  document.getElementById("routeLine").setAttribute("d", "");
  for (const id of ["distance", "ascent", "slope"]) document.getElementById(id).textContent = "—";
  if (!status.available) {
    document.getElementById("advisoryTitle").textContent = "Not enough data available";
    document.getElementById("advisoryText").textContent = status.message;
    return;
  }
  document.getElementById("advisoryTitle").textContent = "Route not calculated";
  document.getElementById("advisoryText").textContent = state.ids.length < 2
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
  loadedMission = state.ids.map(id => {
    const point = catalog.find(entry => entry.id === id);
    return [Math.floor(point.x / 1000 * grid.width), Math.floor(point.y / 700 * grid.height)];
  });
  loadedLegs = missionDemSummary?.legs || [];
  start = loadedMission[0];
  goal = loadedMission.length > 1 ? loadedMission[loadedMission.length - 1] : null;
  fields.forEach((field, index) => field.value = [...start, ...(goal || ["", ""])][index]);
  document.getElementById("profile").value = {balanced: "balanced", safe: "low-exposure", science: "shortest"}[state.mode];
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
  document.getElementById("advisoryText").textContent = "Click Calculate route to try again.";
};
calculateMission.onclick = () => {
  if (!grid) {
    document.getElementById("advisoryTitle").textContent = "DEM not loaded";
    document.getElementById("advisoryText").textContent = "Open the dashboard through the local server and reload to load the elevation data.";
    return;
  }
  const status = routingStatus();
  if (!status.available) {
    document.getElementById("advisoryTitle").textContent = "Not enough data available";
    document.getElementById("advisoryText").textContent = status.message;
    return;
  }
  routeMissionOnDem();
};

async function routeMissionOnDem() {
  if (!grid) return;
  missionRouteRequest?.abort();
  const controller = new AbortController();
  missionRouteRequest = controller;
  missionDemSummary = null;
  calculatedPlan = missionPlanKey();
  const routeLine = document.getElementById("routeLine");
  const status = document.getElementById("advisoryText");
  const title = document.getElementById("advisoryTitle");
  const distance = document.getElementById("distance");
  const ascent = document.getElementById("ascent");
  const slope = document.getElementById("slope");
  const points = state.ids.map(id => catalog.find(point => point.id === id));
  const cells = [...points, points[0]].map(point => [
    Math.floor(point.x / 1000 * grid.width),
    Math.floor(point.y / 700 * grid.height)
  ]);
  const profile = {balanced: "balanced", safe: "low-exposure", science: "shortest"}[state.mode];
  routeLine.setAttribute("d", "");
  distance.textContent = "—";
  ascent.textContent = "—";
  slope.textContent = "—";
  title.textContent = "Calculating DEM route";
  calculateMission.disabled = true;
  stopMission.disabled = false;
  resetMission.disabled = false;
  calculateMission.textContent = "Calculating route… 0%";
  status.textContent = "Checking every leg, including the return to habitat.";
  const missionAlong = document.getElementById("missionAlongRoute");
  missionAlong.innerHTML = "";
  function rememberDisplay() {
    calculatedDisplay = {
      path: routeLine.getAttribute("d"),
      fields: routeDisplayIds.map(id => document.getElementById(id).textContent),
      along: missionAlong.innerHTML
    };
  }
  rememberDisplay();
  try {
    const legs = [];
    // Bound memory use by keeping only one full-raster search in flight per mission.
    for (const [index, goal] of cells.slice(1).entries()) {
      const leg = await request("/api/route", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({start: cells[index], goal, profile, coverage: "full", camp: campCell()}),
      signal: controller.signal
    }).catch(error => {
      throw new Error(`${points[index].name} → ${(points[index + 1] || points[0]).name}: ${error.message}`);
      });
      if (controller.signal.aborted) return;
      legs.push(leg);
      calculateMission.textContent = `Calculating route… ${Math.floor(100 * legs.length / (cells.length - 1))}%`;
    }
    if (controller.signal.aborted) return;
    const path = legs.flatMap(leg => leg.path.map(([x, y], index) =>
      `${index ? "L" : "M"}${(x + 0.5) / grid.width * 1000} ${(y + 0.5) / grid.height * 700}`
    )).join(" ");
    routeLine.setAttribute("d", path);
    const total = legs.reduce((sum, leg) => sum + leg.distanceM, 0);
    const totalAscent = legs.reduce((sum, leg) => sum + leg.ascentM, 0);
    missionDemSummary = {
      source: grid.source,
      profile,
      dataUsed: legs[0].dataUsed,
      distanceM: total,
      ascentM: totalAscent,
      maxSlopeDeg: Math.max(...legs.map(leg => leg.maxSlopeDeg)),
      legs
    };
    distance.innerHTML = `${(total / 1000).toFixed(2)} <small>km</small>`;
    ascent.innerHTML = `${totalAscent} <small>m</small>`;
    slope.innerHTML = `${Math.max(...legs.map(leg => leg.maxSlopeDeg)).toFixed(1)} <small>°</small>`;
    title.textContent = "DEM route calculated";
    status.textContent = `${legs.length} legs including return. ${dataUsageText(legs[0].dataUsed)}`;
    missionDemSummary.alongRoute = combineAlongRoute(legs);
    missionAlong.innerHTML = alongRouteHtml(missionDemSummary.alongRoute);
    rememberDisplay();
    await new Promise(resolve => setTimeout(resolve, 450));
  } catch (error) {
    if (controller.signal.aborted) return;
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
  image.setAttribute("href", url);
  if (replace) target.replaceWith(image);
  else target.replaceChildren(image);
}

function showMissionTerrain() {
  const world = document.getElementById("mapWorld");
  const svg = document.getElementById("terrain");
  const frameHeight = 1000 * grid.height / grid.width;
  svg.setAttribute("viewBox", `0 0 1000 ${frameHeight}`);
  const frame = document.createElementNS(world.namespaceURI, "g");
  frame.setAttribute("transform", `scale(1 ${frameHeight / 700})`);
  world.before(frame);
  frame.append(world);
  // Mission targets from mission.json, placed on this grid by the build, replace the built-in stops.
  const targets = new Map((grid.targets || []).map(target => [target.id, target]));
  for (const point of catalog) {
    if (point.id.startsWith("custom-")) continue;
    const target = targets.get(point.id);
    if (target) {
      Object.assign(point, {name: target.name, type: target.type, time: target.time, detail: target.detail,
        dataHere: target.data, x: (target.cell[0] + 0.5) / grid.width * 1000, y: (target.cell[1] + 0.5) / grid.height * 700});
      continue;
    }
    point.x = (grid.cropOrigin[0] + Math.floor(point.x / 1000 * 240) + 0.5) / grid.width * 1000;
    point.y = (grid.cropOrigin[1] + Math.floor(point.y / 700 * 168) + 0.5) / grid.height * 700;
  }
  if (grid.mission) document.querySelector(".planner-title p").textContent = `Mission: ${grid.mission.name}`;
  applyWaypointEdits();
  if (base) {
    setTerrainImage(document.getElementById("terrainFallback"), base.src, true);
    document.querySelector("#mapWorld > image").id = "missionBase";
    document.getElementById("map").classList.add("has-real-terrain");
  } else {
    document.querySelector("#terrainFallback text").textContent = "NO DISPLAYABLE LAYER IN THE LOADED FILES";
  }
  if (grid.derived.contours) setTerrainImage(document.getElementById("contours"), buildUrl("contours.png"));
  if (grid.derived.hazards) showSlopeHazards();
  for (const kind of Object.keys(CAMP_ANALYSES)) {
    const group = document.createElementNS(world.namespaceURI, "g");
    group.id = kind;
    group.style.display = "none";
    document.getElementById("hazards").before(group);
  }
  const overlays = document.getElementById("overlays");
  overlays.style.opacity = overlayOpacity;
  for (const layer of grid.layers) {
    const group = document.createElementNS(overlays.namespaceURI, "g");
    group.id = layer.id;
    group.style.display = "none";
    overlays.append(group);
    setTerrainImage(group, buildUrl(layer.image));
  }
  const baseLabel = grid.baseLayer === "elevation" ? "ELEVATION"
    : grid.baseLayer ? KIND_LABELS[grid.layers.find(layer => layer.id === grid.baseLayer).kind].toUpperCase() : "NO DISPLAYABLE LAYER";
  const count = includedFiles().length;
  document.querySelector(".map-badge").innerHTML = `<span class="live"></span> ${count} FILE${count === 1 ? "" : "S"} <span> / </span> BASE: ${baseLabel}`;
  document.querySelector(".map-caption").textContent = grid.horizontalUnits ? `${grid.dx} M/PIXEL GRID` : "";
  const bounds = grid.lonLatBounds;
  const latitude = value => `${Math.abs(value).toFixed(2)}° ${value < 0 ? "S" : "N"}`;
  const longitude = value => `${Math.abs(value).toFixed(2)}° ${value < 0 ? "W" : "E"}`;
  document.querySelector(".coordinates").textContent = bounds
    ? `${latitude(bounds[1])} – ${latitude(bounds[3])} · ${longitude(bounds[0])} – ${longitude(bounds[2])}`
    : "—";
  document.getElementById("terrain").setAttribute("aria-label", `Map of ${grid.source} with planned mission waypoints`);
  updateMapTransform();
  render();
}

async function init() {
  if (location.protocol === "file:") throw new Error("Start python server.py and open the HTTP address it prints.");
  const {meta} = await request("/api/dataset");
  if (!meta) {
    throw Object.assign(new Error("No data files are loaded yet. Open the Data files tab, select one or more GeoTIFF files and click Load selected files."), {code: "no_data"});
  }
  grid = meta;
  if (meta.baseImage) {
    base = new Image();
    base.src = buildUrl(meta.baseImage);
    await base.decode();
  }
  for (const layer of mapLayers()) if (layer.present) availableLayers.add(layer.id);
  document.getElementById("missionLayers").innerHTML = layerButtonsHtml("data-layer");
  document.getElementById("demLayers").innerHTML = layerButtonsHtml("data-dem-layer");
  if (grid.baseLayer === "elevation") {
    demLayers.add("elevation");
    const button = document.querySelector('[data-dem-layer="elevation"]');
    button.classList.add("active");
    button.setAttribute("aria-pressed", "true");
  }
  document.getElementById("missionInventory").innerHTML = inventoryHtml(meta);
  document.getElementById("demInventory").innerHTML = inventoryHtml(meta);
  document.getElementById("dataStatus").textContent = `DATA: ${includedFiles().map(file => file.name).join(" + ")}`;
  canvas.width = grid.width;
  canvas.height = grid.height;
  fields.forEach((field, i) => field.max = (i % 2 ? grid.height : grid.width) - 1);
  start = [grid.cropOrigin[0] + 40, grid.cropOrigin[1] + 80];
  goal = [grid.cropOrigin[0] + 190, grid.cropOrigin[1] + 100];
  const [camp, firstStop] = [grid.targets?.find(target => target.id === "hab"), grid.targets?.find(target => target.id !== "hab")];
  if (camp && firstStop) [start, goal] = [[...camp.cell], [...firstStop.cell]];
  [...start, ...goal].forEach((value, index) => fields[index].value = value);
  showMissionTerrain();
  canvas.hidden = !base;
  draw();
  updateDemLegend();
  updateMissionLegend();
  const status = routingStatus();
  submit.disabled = !status.available;
  if (!status.available) {
    result.textContent = status.message;
    return;
  }
  const assumptions = grid.elevation.assumptions.join(" ");
  result.textContent = `Routing on ${grid.elevation.file} · ${grid.dx.toFixed(0)} m/pixel · elevation ${grid.minimum.toFixed(0)} to ${grid.maximum.toFixed(0)} m.${assumptions ? " " + assumptions : ""}`;
}

let demDragged = false;
canvas.onclick = event => {
  if (submit.disabled || demDragged) return;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * grid.width;
  const y = (event.clientY - rect.top) / rect.height * grid.height;
  const point = [Math.floor((x - grid.width / 2 - demX) / demZoom + grid.width / 2),
    Math.floor((y - grid.height / 2 - demY) / demZoom + grid.height / 2)];
  if (point[0] < 0 || point[0] >= grid.width || point[1] < 0 || point[1] >= grid.height) return;
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
  result.textContent = choosingStart ? "Ready to find a route." : "Choose the destination.";
  draw();
};

const demAlongRoute = document.createElement("div");
demAlongRoute.className = "along-route";
demAlongRoute.id = "demAlongRoute";
result.after(demAlongRoute);

function clearDemRoute() {
  demAlongRoute.innerHTML = "";
  demRequest?.abort();
  demRequest = undefined;
  submit.disabled = !grid;
  submit.textContent = "Find route";
  resetDem.disabled = true;
  path = [];
  draw();
}

resetDem.onclick = () => {
  clearDemRoute();
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
  return new Promise(resolve => {
    dialog.addEventListener("close", () => {
      const approved = dialog.returnValue === "continue";
      dialog.remove();
      resolve(approved);
    }, {once: true});
    dialog.showModal();
  });
}

let confirmingDemRoute = false;
form.onsubmit = async event => {
  event.preventDefault();
  if (!grid || demRequest || confirmingDemRoute) return;
  const nextStart = fields.slice(0, 2).map(field => field.valueAsNumber);
  const nextGoal = fields.slice(2).map(field => field.valueAsNumber);
  const profile = document.getElementById("profile").value;
  const distanceKm = Math.hypot((nextGoal[0] - nextStart[0]) * grid.dx,
    (nextGoal[1] - nextStart[1]) * grid.dy) / 1000;
  const extended = distanceKm >= longRouteThresholdKm;
  if (extended) {
    confirmingDemRoute = true;
    try {
      if (!await confirmLongRoute(distanceKm)) return;
    } finally {
      confirmingDemRoute = false;
    }
  }
  const controller = new AbortController();
  demRequest = controller;
  start = nextStart;
  goal = nextGoal;
  path = [];
  demAlongRoute.innerHTML = "";
  draw();
  submit.disabled = true;
  resetDem.disabled = false;
  submit.textContent = "Finding route…";
  const started = performance.now();
  const timer = setInterval(() => {
    if (demRequest !== controller) {
      clearInterval(timer);
      return;
    }
    // The server does not report search progress, so show elapsed time only.
    submit.textContent = `Finding route… ${Math.floor((performance.now() - started) / 1000)}s`;
  }, 200);
  result.textContent = "Calculating route…";
  try {
      const route = await request("/api/route", {
      method: "POST",
      signal: controller.signal,
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({start, goal, profile, coverage: "full", extended, camp: campCell()})
    });
    if (demRequest !== controller) return;
    clearInterval(timer);
    path = route.path;
    draw();
    result.textContent = `${route.distanceM} m distance · ${route.ascentM} m ascent · ${route.maxSlopeDeg}° maximum slope. ${dataUsageText(route.dataUsed)}`;
    demAlongRoute.innerHTML = alongRouteHtml(route.alongRoute);
    await new Promise(resolve => setTimeout(resolve, 450));
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

new ResizeObserver(() => { if (grid && canvas.clientWidth) draw(); }).observe(canvas);
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
  result
];
const originalLocations = fullscreenControls.map(control => {
  const placeholder = document.createComment("Fullscreen control location");
  control.before(placeholder);
  return placeholder;
});

function syncDemFullscreen() {
  const expanded = document.fullscreenElement === demMap || demMap.classList.contains("map-expanded");
  if (expanded === !demFullscreenTools.hidden) return;
  demFullscreenTools.hidden = !expanded;
  fullscreenControls.forEach((control, index) => {
    if (expanded) demFullscreenTools.append(control);
    else originalLocations[index].after(control);
  });
}

document.addEventListener("fullscreenchange", syncDemFullscreen);
new MutationObserver(syncDemFullscreen).observe(demMap, {attributes: true, attributeFilter: ["class"]});
document.getElementById("dem-layer-info").onclick = event => {
  const notes = document.getElementById("dem-layer-notes");
  notes.hidden = !notes.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!notes.hidden));
};
document.getElementById("dem-zoom-in").onclick = () => setDemZoom(demZoom * 1.5);
document.getElementById("dem-zoom-out").onclick = () => setDemZoom(demZoom / 1.5);
document.getElementById("dem-reset").onclick = () => {
  demX = demY = 0;
  setDemZoom(1);
};
demFullscreen.onclick = async () => {
  if (document.fullscreenElement === demMap) await document.exitFullscreen();
  else if (!demMap.classList.toggle("map-expanded", !demMap.classList.contains("map-expanded"))) return;
  else {
    try {
      await demMap.requestFullscreen();
      demMap.classList.remove("map-expanded");
    } catch {
      // Keep the in-page expanded view if native fullscreen is unavailable.
    }
  }
};
document.addEventListener("keydown", event => {
  if (event.key === "Escape") demMap.classList.remove("map-expanded");
});
// Layer buttons are created once the loaded files are known, so listen on their container.
document.getElementById("demLayers").addEventListener("click", event => {
  const button = event.target.closest("[data-dem-layer]");
  if (!button || button.disabled || !grid) return;
  const layer = button.dataset.demLayer;
  const active = !demLayers.has(layer);
  if (active) demLayers.add(layer);
  else demLayers.delete(layer);
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", String(active));
  if (CAMP_ANALYSES[layer] && active) {
    loadDemAnalysis(layer);
    return;
  }
  const source = mapLayers().find(entry => entry.id === layer)?.image;
  if (source && !demOverlays[layer]) {
    const image = new Image();
    demOverlays[layer] = image;
    image.onload = () => draw();
    image.src = buildUrl(source);
  }
  draw();
  updateDemLegend();
});

// Line of sight and walk-back for the camp; walk-back follows the route profile chosen above.
const demAnalysisKeys = {};
async function loadDemAnalysis(kind) {
  const profile = document.getElementById("profile").value;
  const key = `${campCell()}|${kind === "walkback" ? profile : ""}`;
  if (demAnalysisKeys[kind] === key && demOverlays[kind]) {
    draw();
    updateDemLegend();
    return;
  }
  demAnalysisKeys[kind] = key;
  result.textContent = `Calculating ${CAMP_ANALYSES[kind].title.toLowerCase()}…`;
  try {
    const url = await loadCampAnalysis(kind, profile);
    if (demAnalysisKeys[kind] !== key) return;
    const image = new Image();
    image.onload = () => draw();
    image.src = url;
    demOverlays[kind] = image;
    result.textContent = `${CAMP_ANALYSES[kind].title} shown. ${grid.legends[kind].note}`;
  } catch (error) {
    demAnalysisKeys[kind] = "";
    result.textContent = error.message;
  }
  draw();
  updateDemLegend();
}
document.getElementById("profile").addEventListener("change", () => {
  if (demLayers.has("walkback")) loadDemAnalysis("walkback");
});
document.getElementById("overlayOpacity").addEventListener("input", event => {
  overlayOpacity = event.target.valueAsNumber / 100;
  document.getElementById("overlays").style.opacity = overlayOpacity;
  if (grid) draw();
});

const demPointers = new Map();

function pinchGeometry() {
  const [a, b] = demPointers.values();
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    span: Math.hypot(a.x - b.x, a.y - b.y)
  };
}

canvas.addEventListener("pointerdown", event => {
  if (event.button !== 0 || demPointers.size >= 2 ||
      (demPointers.size && event.pointerType !== "touch")) return;
  demDragged = demPointers.size > 0;
  demPointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", event => {
  const pointer = demPointers.get(event.pointerId);
  if (!pointer) return;
  if (demPointers.size === 2) {
    const before = pinchGeometry();
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const after = pinchGeometry();
    if (before.span < 1) return;
    const nextZoom = Math.min(12, Math.max(1, demZoom * after.span / before.span));
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
  demX += dx * canvas.width / canvas.clientWidth;
  demY += dy * canvas.height / canvas.clientHeight;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  setDemZoom(demZoom);
});
canvas.addEventListener("lostpointercapture", event => {
  demPointers.delete(event.pointerId);
  if (!demPointers.size) canvas.classList.remove("dem-dragging");
});
init().catch(error => {
  result.textContent = error.message;
  document.getElementById("dataStatus").textContent = "NO DATA LOADED";
  document.getElementById("missionInventory").innerHTML =
    `<div class="conditions-title"><span class="eyebrow">DATA IN THE LOADED FILES</span></div><p class="inventory-warning">${escapeText(error.message)}</p>`;
  refreshMissionRouteDisplay();
  if (error.code === "no_data" && typeof showView === "function") showView("files-panel");
});
