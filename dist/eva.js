// EVA estimate: how long the planned traverse takes and what it uses, from the calculated route
// and assumptions the planner can edit. Nothing here is measured; every input is shown and editable.
// Resource forecasting after Gihan Kesara's mission resource forecast on the kesara branch,
// extended with slope-dependent walking speed and the planned time at each stop.
(() => {
  const STORAGE_KEY = "ares-eva-assumptions";
  // Defaults are planning assumptions. Where a default comes from somewhere, the source says so.
  const FIELDS = [
    {id: "walkSpeedKmH", label: "Walking speed on flat ground (km/h)", value: 3, min: 0.1, max: 20, step: 0.1,
      source: "Assumption: a steady pace in a spacesuit; set from your own suit tests."},
    {id: "contingencyMin", label: "Contingency time (min)", value: 30, min: 0, max: 600, step: 5,
      source: "Assumption: time held back for problems."},
    {id: "evaLimitH", label: "EVA time limit (h)", value: 8, min: 0.5, max: 24, step: 0.5,
      source: "Assumption: set to your spacesuit's rated EVA duration."},
    {id: "oxygenSupplyKg", label: "Suit oxygen supply (kg)", value: 1, min: 0.01, max: 100, step: 0.01,
      source: "Assumption (demonstration default from the kesara branch); set to your suit's supply."},
    {id: "oxygenUseKgH", label: "Oxygen use (kg/h)", value: 0.076, min: 0, max: 10, step: 0.001,
      source: "Assumption (demonstration default from the kesara branch); set to the crew's metabolic rate."},
    {id: "reservePercent", label: "Reserve warning level (%)", value: 20, min: 0, max: 100, step: 1,
      source: "Warn when a supply is expected to fall below this level."}
  ];
  const ROVER_FIELDS = [
    {id: "roverSpeedKmH", label: "Rover driving speed (km/h)", value: 8, min: 0.1, max: 100, step: 0.1},
    {id: "batteryKWh", label: "Rover battery capacity (kWh)", value: 2.5, min: 0.01, max: 10000, step: 0.1},
    {id: "batteryStartPercent", label: "Battery charge at start (%)", value: 82, min: 0, max: 100, step: 1},
    {id: "driveKWhPerKm", label: "Energy per km driven (kWh/km)", value: 0.085, min: 0, max: 100, step: 0.001},
    {id: "climbKWhPerM", label: "Energy per metre climbed (kWh/m)", value: 0.00015, min: 0, max: 10, step: 0.00001},
    {id: "solarW", label: "Solar panel input (W)", value: 120, min: 0, max: 100000, step: 1},
    {id: "solarEfficiencyPercent", label: "Solar collection efficiency (%)", value: 70, min: 0, max: 100, step: 1}
  ];
  // Line-of-sight and walk-back settings; the server uses the same defaults and limits.
  const ANALYSIS_FIELDS = [
    {id: "antennaM", label: "Camp antenna height (m)", value: 3, min: 0, max: 100, step: 0.5,
      source: "Assumption: height of the antenna above the camp, for line of sight."},
    {id: "personM", label: "Person height (m)", value: 2, min: 0, max: 100, step: 0.1,
      source: "Assumption: height of the crew member's helmet or suit radio."},
    {id: "viewshedRadiusKm", label: "Line-of-sight search distance (km)", value: 15, min: 1, max: 30, step: 1,
      source: "How far from the camp to check line of sight."},
    {id: "walkbackRadiusKm", label: "Walk-back search distance (km)", value: 10, min: 1, max: 15, step: 1,
      source: "How far from the camp to work out the walk back."}
  ];
  const ROVER_SOURCE = "Assumptions (demonstration defaults from the kesara branch); set them to your rover's values.";

  const panel = document.getElementById("evaPlan");
  if (!panel) return;
  const escape = escapeWaypointText;
  const defaults = Object.fromEntries([...FIELDS, ...ROVER_FIELDS, ...ANALYSIS_FIELDS].map(field => [field.id, field.value]));
  let assumptions = {...defaults, rover: false};
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === "object") assumptions = {...assumptions, ...saved};
  } catch {}

  const inputHtml = field => `<label><span>${escape(field.label)}</span>
    <input type="number" data-eva="${field.id}" min="${field.min}" max="${field.max}" step="${field.step}" value="${assumptions[field.id]}">
    ${field.source ? `<small>${escape(field.source)}</small>` : ""}</label>`;

  panel.innerHTML = `<div class="eva-head"><span class="eyebrow">EVA ESTIMATE</span>
      <small>From the calculated route and the editable assumptions below. Not measured; not operational guidance.</small></div>
    <div id="evaResult"></div>
    <details class="eva-assumptions"><summary>Assumptions (editable)</summary>
      <div class="eva-fields">${FIELDS.map(inputHtml).join("")}</div>
      <label class="eva-rover"><input type="checkbox" data-eva="rover"${assumptions.rover ? " checked" : ""}> Rover-assisted traverse (the crew drives between stops)</label>
      <div class="eva-fields eva-rover-fields"${assumptions.rover ? "" : " hidden"}>${ROVER_FIELDS.map(inputHtml).join("")}<small class="eva-wide">${escape(ROVER_SOURCE)}</small></div>
      <p class="eva-group">Line of sight and walk-back layers</p>
      <div class="eva-fields">${ANALYSIS_FIELDS.map(inputHtml).join("")}</div>
      <p class="muted">Walking speed changes with slope using the shape of Tobler's hiking function (Tobler, 1993), an Earth walking model, scaled so flat ground matches the speed above. It is an assumption, not a Mars measurement.</p>
      <button type="button" class="quiet" id="evaReset">Restore defaults</button>
      <p class="file-error" id="evaError" hidden></p>
    </details>`;

  function readAssumptions() {
    const next = {rover: panel.querySelector('[data-eva="rover"]').checked};
    for (const field of [...FIELDS, ...ROVER_FIELDS, ...ANALYSIS_FIELDS]) {
      const value = Number(panel.querySelector(`[data-eva="${field.id}"]`).value);
      if (!Number.isFinite(value) || value < field.min || value > field.max) {
        throw new Error(`${field.label}: enter a number from ${field.min} to ${field.max}.`);
      }
      next[field.id] = value;
    }
    return next;
  }

  // Walking speed factor for a slope, from the shape of Tobler's hiking function, equal to 1 on flat ground.
  const slopeFactor = grade => Math.exp(-3.5 * (Math.abs(grade + 0.05) - 0.05));

  function travelHours(leg, a) {
    if (a.rover) return leg.distanceM / 1000 / a.roverSpeedKmH;
    let seconds = 0;
    leg.path.forEach(([x, y], i) => {
      if (!i) return;
      const [px, py] = leg.path[i - 1];
      const run = Math.hypot((x - px) * grid.dx, (y - py) * grid.dy);
      const grade = (leg.elevationsM[i] - leg.elevationsM[i - 1]) / run;
      seconds += run / (a.walkSpeedKmH / 3.6 * slopeFactor(grade));
    });
    return seconds / 3600;
  }

  function hoursText(hours) {
    const minutes = Math.round(hours * 60);
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
  }

  function estimate(summary, a) {
    const points = state.ids.map(id => catalog.find(point => point.id === id));
    const legs = summary.legs.map((leg, index) => {
      const to = index + 1 < points.length ? points[index + 1] : points[0];
      const stopHours = index + 1 < points.length ? (Number(to.time) || 0) / 60 : 0;
      return {from: points[index].name, to: to.name, distanceM: leg.distanceM, ascentM: leg.ascentM,
        travelHours: travelHours(leg, a), stopHours};
    });
    const travel = legs.reduce((sum, leg) => sum + leg.travelHours, 0);
    const stops = legs.reduce((sum, leg) => sum + leg.stopHours, 0);
    const total = travel + stops + a.contingencyMin / 60;
    const oxygenUsedKg = total * a.oxygenUseKgH;
    const result = {legs, travelHours: travel, stopHours: stops, contingencyHours: a.contingencyMin / 60, totalHours: total,
      limitMarginHours: a.evaLimitH - total, oxygenUsedKg, oxygenLeftPercent: 100 - 100 * oxygenUsedKg / a.oxygenSupplyKg,
      assumptions: {...a}, method: a.rover ? "constant rover speed" : "slope-dependent walking speed (Tobler shape)"};
    if (a.rover) {
      const energy = summary.distanceM / 1000 * a.driveKWhPerKm + summary.ascentM * a.climbKWhPerM;
      Object.assign(result, {energyUsedKWh: energy, batteryLeftPercent: a.batteryStartPercent - 100 * energy / a.batteryKWh,
        solarCollectedKWh: a.solarW / 1000 * a.solarEfficiencyPercent / 100 * total});
    }
    const warnings = [];
    if (result.limitMarginHours < 0) warnings.push(`The EVA exceeds the ${a.evaLimitH} h time limit by ${hoursText(-result.limitMarginHours)}.`);
    for (const [label, left] of [["Suit oxygen", result.oxygenLeftPercent], ["Rover battery", result.batteryLeftPercent]]) {
      if (left === undefined) continue;
      if (left < 0) warnings.push(`${label} runs out before the end of the EVA.`);
      else if (left < a.reservePercent) warnings.push(`${label} falls below the ${a.reservePercent}% reserve (${left.toFixed(0)}% left).`);
    }
    result.warnings = warnings;
    return result;
  }

  function render() {
    const result = panel.querySelector("#evaResult");
    const duration = document.getElementById("duration");
    const summary = typeof missionDemSummary !== "undefined" ? missionDemSummary : null;
    let a;
    try {
      a = readAssumptions();
      panel.querySelector("#evaError").hidden = true;
    } catch (error) {
      panel.querySelector("#evaError").hidden = false;
      panel.querySelector("#evaError").textContent = error.message;
      return;
    }
    panel.querySelector(".eva-rover-fields").hidden = !a.rover;
    if (!summary?.legs?.length || !grid) {
      result.innerHTML = '<p class="muted">Calculate the route to estimate the EVA.</p>';
      duration.textContent = "N/A";
      duration.classList.add("not-available");
      duration.title = "Calculate the route to estimate the EVA duration from the editable assumptions";
      if (summary) summary.eva = null;
      return;
    }
    const e = estimate(summary, a);
    summary.eva = e;
    duration.textContent = hoursText(e.totalHours);
    duration.classList.remove("not-available");
    duration.title = "Estimate from the route and the EVA assumptions; not measured";
    const rows = e.legs.map(leg => `<tr><td>${escape(leg.from)} → ${escape(leg.to)}</td><td>${distanceText(leg.distanceM)}</td>
      <td>${hoursText(leg.travelHours)}</td><td>${leg.stopHours ? hoursText(leg.stopHours) : "—"}</td></tr>`).join("");
    const figures = [
      ["Total EVA", hoursText(e.totalHours)],
      [a.rover ? "Driving" : "Walking", hoursText(e.travelHours)],
      ["At stops", hoursText(e.stopHours)],
      ["Contingency", hoursText(e.contingencyHours)],
      ["Time limit margin", `${e.limitMarginHours < 0 ? "−" : ""}${hoursText(Math.abs(e.limitMarginHours))}`],
      ["Suit oxygen left", `${Math.max(0, e.oxygenLeftPercent).toFixed(0)}%`],
      ...(a.rover ? [["Rover battery left", `${Math.max(0, e.batteryLeftPercent).toFixed(0)}%`],
        ["Solar collected", `${e.solarCollectedKWh.toFixed(2)} kWh (not added to the battery)`]] : [])
    ];
    result.innerHTML = `<div class="eva-figures">${figures.map(([label, value]) => `<div><span>${label}</span><b>${escape(value)}</b></div>`).join("")}</div>
      ${e.warnings.length ? `<ul class="eva-warnings">${e.warnings.map(text => `<li>${escape(text)}</li>`).join("")}</ul>` : ""}
      <table class="eva-legs"><thead><tr><th>Leg</th><th>Distance</th><th>${a.rover ? "Drive" : "Walk"}</th><th>Stop</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // The last valid line-of-sight and walk-back settings, read by terrain.js for every request.
  let analysis = Object.fromEntries(ANALYSIS_FIELDS.map(field => [field.id, assumptions[field.id]]));
  window.analysisSettings = () => ({...analysis});
  let analysisTimer;
  panel.addEventListener("input", event => {
    try {
      assumptions = readAssumptions();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(assumptions));
      const next = Object.fromEntries(ANALYSIS_FIELDS.map(field => [field.id, assumptions[field.id]]));
      if (JSON.stringify(next) !== JSON.stringify(analysis)) {
        analysis = next;
        clearTimeout(analysisTimer);
        analysisTimer = setTimeout(() => window.onAnalysisSettingsChange?.(), 600);
      }
    } catch {}
    render();
  });
  panel.querySelector("#evaReset").onclick = () => {
    for (const [id, value] of Object.entries(defaults)) panel.querySelector(`[data-eva="${id}"]`).value = value;
    panel.querySelector('[data-eva="rover"]').checked = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    analysis = Object.fromEntries(ANALYSIS_FIELDS.map(field => [field.id, field.value]));
    window.onAnalysisSettingsChange?.();
    render();
  };
  // Called by terrain.js whenever the mission route is calculated or cleared.
  window.updateEvaEstimate = render;
  // The same time and oxygen model, for the playback (playback.js): seconds for one route step.
  window.evaModel = () => {
    const a = {...assumptions};
    return {assumptions: a,
      stepSeconds: (run, grade) => a.rover ? run / (a.roverSpeedKmH / 3.6) : run / (a.walkSpeedKmH / 3.6 * slopeFactor(grade))};
  };
  render();
})();
