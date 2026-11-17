// EVA playback: an animated walk along the calculated route, on the mission map or as a video file.
// After Hirushi192's EVA traverse animation (nethsara branch), rebuilt so every value comes from the
// loaded data along the calculated route; time and oxygen are the EVA estimate's (eva.js) assumptions.
(() => {
  const TRAVEL_SECONDS = 20;    // Playback length of the walking at 1× speed (a display setting).
  const STOP_SECONDS = 1.4;     // Pause at each stop.
  const VIDEO = {width: 1280, height: 720, map: 560, fps: 30};
  const escape = escapeWaypointText;
  let live = null;

  // ---------------------------------------------------------------- the route as a track
  function buildTrack() {
    const summary = typeof missionDemSummary !== "undefined" ? missionDemSummary : null;
    if (!summary?.legs?.length || !grid) return null;
    const model = window.evaModel?.();
    const points = state.ids.map(id => catalog.find(point => point.id === id));
    const samples = [], stops = [];
    let distance = 0, ascent = 0, hours = 0;
    summary.legs.forEach((leg, legIndex) => {
      leg.path.forEach(([x, y], i) => {
        if (legIndex > 0 && i === 0) return;  // Each leg starts where the previous one ended.
        let slope = 0;
        if (i > 0) {
          const [px, py] = leg.path[i - 1];
          const run = Math.hypot((x - px) * grid.dx, (y - py) * grid.dy);
          const rise = leg.elevationsM[i] - leg.elevationsM[i - 1];
          distance += run;
          ascent += Math.max(0, rise);
          slope = Math.atan(Math.abs(rise) / run) * 180 / Math.PI;
          if (model) hours += model.stepSeconds(run, rise / run) / 3600;
        }
        samples.push({x, y, z: leg.elevationsM[i], lonLat: leg.lonLat?.[i] || null, slope, distance, ascent, hours, leg: legIndex});
      });
      const last = legIndex + 1 >= points.length;
      const to = last ? points[0] : points[legIndex + 1];
      const stopHours = last ? 0 : (Number(to.time) || 0) / 60;
      stops.push({sample: samples.length - 1, name: to.name, label: last ? "Back at camp" : `Stop ${String(legIndex + 1).padStart(2, "0")}`, stopHours});
      hours += stopHours;
    });
    return {samples, stops, points, total: distance, model, code: grid.mission?.code || "Mission plan",
      summary: {distanceM: summary.distanceM, ascentM: summary.ascentM, maxSlopeDeg: summary.maxSlopeDeg}};
  }

  // Travel segments and pauses at stops, so the playback and the video share one timeline.
  function timeline(track) {
    const segments = [];
    let t = 0, from = 0;
    for (const stop of track.stops) {
      const to = track.samples[stop.sample].distance;
      const travel = Math.max(0.2, (to - from) / Math.max(1, track.total) * TRAVEL_SECONDS);
      segments.push({t0: t, t1: t + travel, d0: from, d1: to, stop, pause: false});
      t += travel;
      segments.push({t0: t, t1: t + STOP_SECONDS, d0: to, d1: to, stop, pause: true});
      t += STOP_SECONDS;
      from = to;
    }
    return {segments, duration: t};
  }

  // Playback time at which the estimated oxygen used reaches the suit supply, or null if it lasts.
  // Estimated time only grows along the playback, so a binary search finds the moment.
  function oxygenOutTime(track, line) {
    const a = track.model?.assumptions;
    if (!a || !(a.oxygenUseKgH > 0)) return null;
    const limit = a.oxygenSupplyKg / a.oxygenUseKgH;
    if (frameAt(track, line, line.duration).hours < limit) return null;
    let lo = 0, hi = line.duration;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (frameAt(track, line, mid).hours >= limit) hi = mid; else lo = mid;
    }
    return hi;
  }

  // Everything shown at playback time t: position and values interpolated between route steps.
  function frameAt(track, line, t) {
    const segment = line.segments.find(s => t < s.t1) || line.segments[line.segments.length - 1];
    const f = Math.min(1, Math.max(0, (t - segment.t0) / (segment.t1 - segment.t0 || 1)));
    const distance = segment.d0 + (segment.d1 - segment.d0) * f;
    const s = track.samples;
    let lo = 0, hi = s.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid].distance <= distance) lo = mid; else hi = mid;
    }
    const a = s[lo], b = s[hi];
    const k = b.distance > a.distance ? (distance - a.distance) / (b.distance - a.distance) : 0;
    const mix = (p, q) => p + (q - p) * k;
    const lonLat = a.lonLat && b.lonLat ? [mix(a.lonLat[0], b.lonLat[0]), mix(a.lonLat[1], b.lonLat[1])] : null;
    const hours = mix(a.hours, b.hours) + (segment.pause ? segment.stop.stopHours * f : 0);
    const arrived = track.stops.filter(stop => track.samples[stop.sample].distance <= distance + 0.01 && (segment.pause || stop !== segment.stop));
    return {x: mix(a.x, b.x), y: mix(a.y, b.y), z: mix(a.z, b.z), slope: b.slope, ascent: mix(a.ascent, b.ascent), distance,
      lonLat, hours, index: lo, pause: segment.pause ? segment.stop : null, leg: b.leg, arrived: arrived.length, done: t >= line.duration};
  }

  function values(track, frame) {
    const a = track.model?.assumptions;
    const oxygen = a ? 100 - 100 * frame.hours * a.oxygenUseKgH / a.oxygenSupplyKg : null;
    const coordinate = (v, p, n) => `${Math.abs(v).toFixed(4)}° ${v < 0 ? n : p}`;
    return [
      ["Position", frame.lonLat ? `${coordinate(frame.lonLat[1], "N", "S")}, ${coordinate(frame.lonLat[0], "E", "W")}` : "Not available"],
      ["Elevation", `${Math.round(frame.z)} m`],
      ["Slope of this step", `${frame.slope.toFixed(1)}°`],
      ["Ascent so far", `${Math.round(frame.ascent)} m`],
      ["Distance", `${(frame.distance / 1000).toFixed(2)} / ${(track.total / 1000).toFixed(2)} km`],
      ["EVA time (estimate)", a ? hoursText(frame.hours) : "Not estimated"],
      ["Suit oxygen left (estimate)", oxygen === null ? "Not estimated" : oxygen <= 0 ? "0%: out of oxygen" : `${oxygen.toFixed(0)}%`, oxygen !== null && oxygen <= 0]
    ];
  }

  function hoursText(hours) {
    const minutes = Math.round(hours * 60);
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
  }

  function statusText(track, frame) {
    if (frame.done) return `${track.stops[track.stops.length - 1].label}: playback complete`;
    if (frame.pause) return `${frame.pause.label}: ${frame.pause.name}`;
    const to = track.stops[frame.leg];
    return `Walking to ${to.label === "Back at camp" ? "camp" : to.name}`;
  }

  // ---------------------------------------------------------------- optional sound
  let audio;
  function beep(final) {
    try {
      audio ||= new AudioContext();
      [final ? 660 : 880, final ? 880 : 1100].forEach((frequency, i) => {
        const osc = audio.createOscillator(), gain = audio.createGain();
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.08, audio.currentTime + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + i * 0.12 + 0.18);
        osc.connect(gain).connect(audio.destination);
        osc.start(audio.currentTime + i * 0.12);
        osc.stop(audio.currentTime + i * 0.12 + 0.2);
      });
    } catch {}
  }
  function say(text) {
    try {
      speechSynthesis.cancel();
      speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(text), {rate: 1.05}));
    } catch {}
  }

  // ---------------------------------------------------------------- the astronaut (for fun)
  // A walking figure that faces its direction of travel, waves at each stop and celebrates back at
  // camp. After the walking astronaut on the nethsara branch. It only illustrates the playback.
  let lastFacing = 1;
  function pose(track, frame, t, fall = 0) {
    const ahead = track.samples[Math.min(track.samples.length - 1, frame.index + 3)];
    const behind = track.samples[Math.max(0, frame.index - 3)];
    if (ahead.x !== behind.x) lastFacing = ahead.x > behind.x ? 1 : -1;
    if (fall > 0) {
      // Out of oxygen: a short stagger, then it topples forward and lies still with a dark visor.
      const eased = Math.min(1, Math.max(0, (fall - 0.25) / 0.75)) ** 2;
      const stagger = fall < 0.35 ? Math.sin(fall * 60) * 7 : 0;
      return {facing: lastFacing, waving: false, swing: 0, bob: 0, wave: 0, jump: 0, fall: eased * 84 * lastFacing + stagger, dark: fall > 0.5};
    }
    const waving = Boolean(frame.pause) || frame.done;
    return {fall: 0, dark: false,
      facing: lastFacing,
      waving,
      swing: waving ? 0 : Math.sin(frame.distance / 24) * 28,           // one stride every ~150 m of playback
      bob: waving ? 0 : Math.abs(Math.sin(frame.distance / 24)) * 1.2,
      wave: Math.sin(t * 9) * 22,
      jump: frame.done ? Math.abs(Math.sin(t * 5)) * 4 : 0
    };
  }

  // Figure in its own units: feet at (0, 0), about 32 units tall.
  const ASTRONAUT_SVG = `<ellipse class="pb-a-shadow" rx="7" ry="2.2"/>
    <g class="pb-a-body">
      <g class="pb-a-leg-back"><rect x="-1.8" y="0" width="3.6" height="9" rx="1.6"/><rect class="pb-a-boot" x="-2.2" y="7.6" width="4.8" height="2.4" rx="1"/></g>
      <g class="pb-a-arm-back"><rect x="-1.5" y="0" width="3" height="8" rx="1.4"/></g>
      <rect class="pb-a-pack" x="-8.5" y="-22" width="4.5" height="11" rx="1.5"/>
      <g class="pb-a-leg-front"><rect x="-1.8" y="0" width="3.6" height="9" rx="1.6"/><rect class="pb-a-boot" x="-2.2" y="7.6" width="4.8" height="2.4" rx="1"/></g>
      <rect class="pb-a-torso" x="-5" y="-22" width="10" height="13.5" rx="3"/>
      <rect class="pb-a-badge" x="-1.5" y="-19" width="3" height="2.2" rx=".6"/>
      <g class="pb-a-arm-front"><rect x="-1.5" y="0" width="3" height="8" rx="1.4"/><circle class="pb-a-glove" cx="0" cy="8.3" r="1.8"/></g>
      <circle class="pb-a-helmet" cx="0" cy="-26.5" r="5.6"/>
      <ellipse class="pb-a-visor" cx="2" cy="-26.5" rx="3.1" ry="2.7"/>
    </g>`;

  function placeAstronaut(group, x, y, scaleX, scaleY, p) {
    group.setAttribute("transform", `translate(${x} ${y}) scale(${scaleX} ${scaleY})`);
    const body = group.querySelector(".pb-a-body");
    // Walking: side view, flipped to face the way it walks. Waving: turned towards the viewer.
    body.setAttribute("transform", `rotate(${p.fall}) translate(0 ${-p.bob - p.jump}) scale(${p.waving ? 1 : p.facing} 1)`);
    const legs = p.waving ? [0, 0] : [-p.swing, p.swing];
    group.querySelector(".pb-a-leg-back").setAttribute("transform", `translate(-1.2 -9) rotate(${legs[0]})`);
    group.querySelector(".pb-a-leg-front").setAttribute("transform", `translate(1.2 -9) rotate(${legs[1]})`);
    group.querySelector(".pb-a-arm-back").setAttribute("transform", p.waving ? "translate(-5.5 -20) rotate(18)" : `translate(-2.5 -20) rotate(${p.swing * 0.8})`);
    group.querySelector(".pb-a-arm-front").setAttribute("transform", p.waving ? `translate(5.5 -20) rotate(${-150 + p.wave})` : `translate(2.5 -20) rotate(${-p.swing * 0.8})`);
    group.querySelector(".pb-a-pack").style.display = p.waving ? "none" : "";
    const visor = group.querySelector(".pb-a-visor");
    visor.setAttribute("cx", p.waving ? 0 : 2);
    visor.setAttribute("rx", p.waving ? 3.9 : 3.1);
    visor.style.fill = p.dark ? "#3a3226" : "";
  }

  // The same figure on a canvas, for the video.
  function drawAstronaut(ctx, x, y, size, p) {
    const part = (dx, dy, angle, draw) => {
      ctx.save();
      ctx.translate(dx, dy);
      ctx.rotate(angle * Math.PI / 180);
      draw();
      ctx.restore();
    };
    const round = (rx, ry, w, h, r, fill, stroke) => {
      ctx.beginPath();
      ctx.roundRect(rx, ry, w, h, r);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.6; ctx.stroke(); }
    };
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 32, size / 32);
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(p.fall * Math.PI / 180);
    ctx.translate(0, -p.bob - p.jump);
    ctx.scale(p.waving ? 1 : p.facing, 1);
    const suit = "#f1f4f6", edge = "#7d8790";
    const leg = () => () => { round(-1.8, 0, 3.6, 9, 1.6, suit, edge); round(-2.2, 7.6, 4.8, 2.4, 1, "#596169"); };
    part(-1.2, -9, p.waving ? 0 : -p.swing, leg());
    part(p.waving ? -5.5 : -2.5, -20, p.waving ? 18 : p.swing * 0.8, () => round(-1.5, 0, 3, 8, 1.4, suit, edge));
    if (!p.waving) round(-8.5, -22, 4.5, 11, 1.5, "#c3c9cf", edge);
    part(1.2, -9, p.waving ? 0 : p.swing, leg());
    round(-5, -22, 10, 13.5, 3, suit, edge);
    round(-1.5, -19, 3, 2.2, 0.6, "#d4f394");
    part(p.waving ? 5.5 : 2.5, -20, p.waving ? -150 + p.wave : -p.swing * 0.8, () => {
      round(-1.5, 0, 3, 8, 1.4, suit, edge);
      ctx.beginPath();
      ctx.arc(0, 8.3, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = "#596169";
      ctx.fill();
    });
    ctx.beginPath();
    ctx.arc(0, -26.5, 5.6, 0, Math.PI * 2);
    ctx.fillStyle = suit;
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(p.waving ? 0 : 2, -26.5, p.waving ? 3.9 : 3.1, 2.7, 0, 0, Math.PI * 2);
    ctx.fillStyle = p.dark ? "#3a3226" : "#e3a72f";
    ctx.fill();
    ctx.restore();
  }

  // A falling tone for running out of oxygen.
  function alarm() {
    try {
      audio ||= new AudioContext();
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(520, audio.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, audio.currentTime + 1.2);
      gain.gain.setValueAtTime(0.1, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 1.3);
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + 1.3);
    } catch {}
  }

  // ---------------------------------------------------------------- playback on the mission map
  const toWorld = (x, y) => [(x + 0.5) / grid.width * 1000, (y + 0.5) / grid.height * 700];

  function stopPlayback() {
    if (!live) return;
    cancelAnimationFrame(live.raf);
    live.layer.remove();
    live.hud.remove();
    live.banner.remove();
    clearEnd();
    document.getElementById("routeLine").style.opacity = "";
    document.getElementById("terrain").setAttribute("viewBox", live.viewBox);
    document.getElementById("pins").style.display = "";
    try { speechSynthesis.cancel(); } catch {}
    live = null;
  }

  // Shows the route's surroundings for the playback, leaving room below it for the display bar.
  function focusOnRoute(track) {
    const svg = document.getElementById("terrain");
    const original = svg.getAttribute("viewBox");
    const frameHeight = svg.viewBox.baseVal.height;
    const xs = track.samples.map(s => (s.x + 0.5) / grid.width * 1000);
    const ys = track.samples.map(s => (s.y + 0.5) / grid.height * frameHeight);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = Math.max(12, 0.2 * Math.max(x1 - x0, y1 - y0));
    x0 -= pad; x1 += pad; y0 -= pad; y1 += pad + 0.7 * (y1 - y0 + 2 * pad);
    if (typeof setZoom === "function") setZoom(1);
    svg.setAttribute("viewBox", `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    return original;
  }

  function startPlayback() {
    stopPlayback();
    const track = buildTrack();
    if (!track) {
      notify("Calculate the route first: the playback follows the calculated route.");
      return;
    }
    const line = timeline(track);
    const map = document.getElementById("map");
    const world = document.getElementById("mapWorld");
    const ns = world.namespaceURI;
    const layer = document.createElementNS(ns, "g");
    layer.id = "playbackLayer";
    const allPoints = track.samples.map(s => toWorld(s.x, s.y).join(",")).join(" ");
    layer.innerHTML = `<polyline class="pb-remaining" points="${allPoints}"/><polyline class="pb-done" points=""/>
      <g class="pb-stops"></g><g class="pb-marker"><circle class="pb-pulse"/></g><g class="pb-astronaut">${ASTRONAUT_SVG}</g>`;
    world.append(layer);
    document.getElementById("routeLine").style.opacity = "0";
    document.getElementById("pins").style.display = "none";
    const hud = document.createElement("div");
    hud.className = "playback-hud";
    hud.innerHTML = `<div class="pb-top"><b>${escape(track.code)} · EVA playback (simulation)</b><span class="pb-status"></span>
        <div class="pb-controls"><button type="button" class="pb-play">Pause</button><button type="button" class="pb-speed">1×</button>
        <button type="button" class="pb-sound" aria-pressed="false">Sound off</button><button type="button" class="pb-close">Close</button></div></div>
      <div class="pb-values pb-live-values"></div>
      <input type="range" class="pb-scrub" min="0" max="1000" value="0" aria-label="Playback position">
      <small>Position, elevation and slope come from the loaded data along the calculated route. Time and oxygen are estimates from the EVA assumptions.</small>`;
    map.append(hud);
    const banner = document.createElement("div");
    banner.className = "playback-banner";
    banner.hidden = true;
    hud.append(banner);  // Sits just above the display bar, below the route.
    document.getElementById("targetCard").hidden = true;
    live = {track, line, layer, hud, banner, t: 0, speed: 1, playing: true, sound: false, last: performance.now(), announced: 0,
      viewBox: focusOnRoute(track), out: oxygenOutTime(track, line), collapseStart: null, alarmed: false};
    live.stopAt = live.out ?? line.duration;
    // Map units per screen pixel after zooming, so markers keep the same size on screen.
    const svg = document.getElementById("terrain");
    live.unit = Math.max(svg.viewBox.baseVal.width / svg.clientWidth, svg.viewBox.baseVal.height / svg.clientHeight);
    // The map stretches its 1000 × 700 drawing vertically to the grid's proportions; undo that for round markers.
    live.squash = 700 / (1000 * grid.height / grid.width);
    layer.querySelector(".pb-stops").innerHTML = [0, ...track.stops.slice(0, -1).map(stop => stop.sample)].map((sample, i) => {
      const [x, y] = toWorld(track.samples[sample].x, track.samples[sample].y);
      return `<g transform="translate(${x} ${y}) scale(1 ${live.squash})"><circle r="${10 * live.unit}" class="${i ? "pb-stop" : "pb-camp"}"/>
        <text font-size="${10 * live.unit}" dy="${3.5 * live.unit}" text-anchor="middle">${i ? String(i).padStart(2, "0") : "⌂"}</text></g>`;
    }).join("");

    hud.querySelector(".pb-play").onclick = () => {
      if (live.t >= live.stopAt) { live.t = 0; live.announced = 0; live.alarmed = false; live.collapseStart = null; clearEnd(); }
      live.playing = !live.playing;
      live.last = performance.now();
      draw();
    };
    hud.querySelector(".pb-speed").onclick = event => {
      live.speed = live.speed === 1 ? 2 : live.speed === 2 ? 4 : 1;
      event.currentTarget.textContent = `${live.speed}×`;
    };
    hud.querySelector(".pb-sound").onclick = event => {
      live.sound = !live.sound;
      event.currentTarget.textContent = live.sound ? "Sound on" : "Sound off";
      event.currentTarget.setAttribute("aria-pressed", String(live.sound));
    };
    hud.querySelector(".pb-close").onclick = stopPlayback;
    hud.querySelector(".pb-scrub").oninput = event => {
      live.t = Math.min(live.stopAt, event.target.valueAsNumber / 1000 * line.duration);
      live.announced = frameAt(track, line, live.t).arrived;
      live.alarmed = live.t >= live.stopAt;
      if (live.t < live.stopAt) live.collapseStart = null;
      clearEnd();
      draw();
    };
    if (live.sound) say("Playback started.");
    const tick = now => {
      if (!live) return;
      if (live.playing && live.t < live.stopAt) live.t = Math.min(live.stopAt, live.t + (now - live.last) / 1000 * live.speed);
      live.last = now;
      draw();
      if (live) live.raf = requestAnimationFrame(tick);
    };
    draw();
    live.raf = requestAnimationFrame(tick);
  }

  function draw() {
    const {track, line, layer, hud, banner} = live;
    // Stop if the plan or route changed underneath the playback.
    if (typeof missionDemSummary === "undefined" || !missionDemSummary) return stopPlayback();
    const frame = frameAt(track, line, live.t);
    const [mx, my] = toWorld(frame.x, frame.y);
    const done = track.samples.slice(0, frame.index + 1).map(s => toWorld(s.x, s.y).join(","));
    done.push(`${mx},${my}`);
    layer.querySelector(".pb-done").setAttribute("points", done.join(" "));
    const marker = layer.querySelector(".pb-marker");
    marker.setAttribute("transform", `translate(${mx} ${my}) scale(1 ${live.squash})`);
    marker.querySelector(".pb-pulse").setAttribute("r", (9 + 2 * Math.sin(performance.now() / 220)) * live.unit);
    const outOfOxygen = live.out !== null && live.t >= live.out;
    if (outOfOxygen) live.collapseStart ??= performance.now();
    const fall = outOfOxygen ? Math.max(0.001, Math.min(1, (performance.now() - live.collapseStart) / 1600)) : 0;
    const figure = 38 / 32 * live.unit;  // About 38 pixels tall on screen.
    placeAstronaut(layer.querySelector(".pb-astronaut"), mx, my, figure, figure * live.squash, pose(track, frame, live.t, fall));
    hud.querySelector(".pb-status").textContent = outOfOxygen ? "Out of oxygen (estimate)" : statusText(track, frame);
    hud.querySelector(".pb-live-values").innerHTML = values(track, frame).map(([label, value, alarmed]) =>
      `<div${alarmed ? ' class="pb-alarm"' : ""}><span>${label}</span><b>${escape(value)}</b></div>`).join("");
    hud.querySelector(".pb-scrub").value = String(Math.round(live.t / line.duration * 1000));
    hud.querySelector(".pb-play").textContent = live.t >= live.stopAt ? "Replay" : live.playing ? "Pause" : "Play";
    if (outOfOxygen) {
      banner.hidden = false;
      banner.classList.add("pb-banner-alarm");
      banner.textContent = `Out of oxygen · ${(frame.distance / 1000).toFixed(2)} km along the route`;
      if (!live.alarmed) {
        live.alarmed = true;
        if (live.sound) { alarm(); say("Oxygen depleted."); }
      }
      if (fall >= 1 && !live.end) showEnd(track, frame);
      return;
    }
    banner.classList.remove("pb-banner-alarm");
    if (frame.pause) {
      banner.hidden = false;
      banner.textContent = `${frame.pause.label} · ${frame.pause.name}`;
    } else banner.hidden = true;
    if (frame.arrived > live.announced) {
      live.announced = frame.arrived;
      const stop = track.stops[frame.arrived - 1];
      const final = frame.arrived === track.stops.length;
      if (live.sound) { beep(final); say(final ? "Back at camp. Playback complete." : `${stop.name}.`); }
    }
    if (frame.done && !live.end) showEnd(track);
  }

  // The end card takes the place of the live values in the display bar, so the map stays visible.
  function showEndCard(end) {
    const row = live.hud.querySelector(".pb-live-values");
    row.hidden = true;
    row.after(end);
    live.end = end;
  }

  function clearEnd() {
    if (!live) return;
    live.end?.remove();
    live.end = null;
    live.hud.querySelector(".pb-live-values").hidden = false;
  }

  function showEnd(track, outFrame) {
    const end = document.createElement("div");
    end.className = "playback-end";
    const last = track.samples[track.samples.length - 1];
    if (outFrame) {
      const a = track.model.assumptions;
      end.classList.add("pb-end-alarm");
      end.innerHTML = `<div class="eyebrow">${escape(track.code)} · OUT OF OXYGEN (ESTIMATE)</div>
        <div class="pb-values">${[["Ran out at", `${(outFrame.distance / 1000).toFixed(2)} of ${(track.total / 1000).toFixed(2)} km`],
          ["EVA time", hoursText(outFrame.hours)], ["Stops reached", String(Math.min(outFrame.arrived, track.stops.length - 1))],
          ["Oxygen supply", `${a.oxygenSupplyKg} kg at ${a.oxygenUseKgH} kg/h`]]
          .map(([label, value]) => `<div><span>${label}</span><b>${escape(value)}</b></div>`).join("")}</div>
        <small>With these EVA assumptions the suit runs out of oxygen before the crew is back at camp. Increase the oxygen supply,
        shorten the route or remove stops (EVA estimate, Assumptions). This is a planning estimate, not a measurement.</small>`;
      showEndCard(end);
      live.end = end;
      return;
    }
    end.innerHTML = `<div class="eyebrow">${escape(track.code)} · PLAYBACK COMPLETE</div>
      <div class="pb-values">${[["Distance", `${(track.summary.distanceM / 1000).toFixed(2)} km`], ["Total ascent", `${track.summary.ascentM} m`],
        ["Steepest step", `${track.summary.maxSlopeDeg.toFixed(1)}°`], ["Stops visited", String(track.stops.length - 1)],
        ["EVA time (estimate)", track.model ? hoursText(last.hours) : "Not estimated"]]
        .map(([label, value]) => `<div><span>${label}</span><b>${escape(value)}</b></div>`).join("")}</div>
      <small>A playback of the plan, not a record of a traverse. Time excludes the contingency in the EVA estimate.</small>`;
    showEndCard(end);
    live.end = end;
  }

  // ---------------------------------------------------------------- video file
  function videoWindow(track) {
    const xs = track.samples.map(s => s.x), ys = track.samples.map(s => s.y);
    let x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1;
    const pad = Math.max(25, 0.15 * Math.max(x1 - x0, y1 - y0));
    x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
    const wanted = VIDEO.width / VIDEO.map * grid.dy / grid.dx;
    if ((x1 - x0) / (y1 - y0) < wanted) { const g = ((y1 - y0) * wanted - (x1 - x0)) / 2; x0 -= g; x1 += g; }
    else { const g = ((x1 - x0) / wanted - (y1 - y0)) / 2; y0 -= g; y1 += g; }
    const clamp = (lo, hi, size) => { const span = Math.min(size, hi - lo); lo = Math.max(0, Math.min(size - span, lo)); return [lo, lo + span]; };
    [x0, x1] = clamp(x0, x1, grid.width);
    [y0, y1] = clamp(y0, y1, grid.height);
    return {x0, y0, w: x1 - x0, h: y1 - y0};
  }

  const loadImage = url => new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });

  async function exportPlaybackVideo() {
    const track = buildTrack();
    if (!track) return notify("Calculate the route first: the video follows the calculated route.");
    if (typeof MediaRecorder === "undefined") return notify("This browser cannot record video.");
    const button = document.getElementById("export");
    const label = button.innerHTML;
    button.disabled = true;
    try {
      const line = timeline(track);
      const view = videoWindow(track);
      const W = VIDEO.width, M = VIDEO.map;
      const scaleX = W / view.w, scaleY = M / view.h;
      const toVideo = (x, y) => [(x + 0.5 - view.x0) * scaleX, (y + 0.5 - view.y0) * scaleY];
      // The map background is drawn once: base map and visible layers, as on the mission map.
      const background = document.createElement("canvas");
      background.width = W;
      background.height = M;
      const bg = background.getContext("2d");
      bg.fillStyle = "#191e1b";
      bg.fillRect(0, 0, W, M);
      bg.filter = grid.baseLayer === "elevation" && !state.layers.includes("elevation") ? "grayscale(1)" : "none";
      bg.drawImage(base, view.x0, view.y0, view.w, view.h, 0, 0, W, M);
      bg.filter = "none";
      for (const layer of window.sheetLayers?.() || []) {
        const image = await loadImage(layer.url || buildUrl(layer.image));
        if (!image) continue;
        bg.globalAlpha = layer.derived ? 1 : overlayOpacity;
        bg.drawImage(image, view.x0, view.y0, view.w, view.h, 0, 0, W, M);
      }
      bg.globalAlpha = 1;
      const pathPoints = track.samples.map(s => toVideo(s.x, s.y));
      const stopPoints = [0, ...track.stops.map(stop => stop.sample)].map(i => toVideo(track.samples[i].x, track.samples[i].y));

      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = VIDEO.height;
      const ctx = canvas.getContext("2d");
      const endCard = 2.5;
      const out = oxygenOutTime(track, line);       // When the estimated oxygen runs out, if it does.
      const stopAt = out ?? line.duration;
      const drawFrame = t => {
        const frame = frameAt(track, line, Math.min(t, stopAt));
        const outOfOxygen = out !== null && t >= out;
        const fall = outOfOxygen ? Math.max(0.001, Math.min(1, (t - out) / 1.6)) : 0;
        ctx.drawImage(background, 0, 0);
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.setLineDash([8, 7]);
        ctx.strokeStyle = "rgba(56, 189, 248, 0.9)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        pathPoints.forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](x, y));
        ctx.stroke();
        ctx.setLineDash([]);
        const [mx, my] = toVideo(frame.x, frame.y);
        ctx.strokeStyle = "#0b100d";
        ctx.lineWidth = 7;
        ctx.beginPath();
        pathPoints.slice(0, frame.index + 1).forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](x, y));
        ctx.lineTo(mx, my);
        ctx.stroke();
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 4;
        ctx.stroke();
        stopPoints.forEach(([x, y], i) => {
          if (i === stopPoints.length - 1) return;
          ctx.beginPath();
          ctx.arc(x, y, 11, 0, Math.PI * 2);
          ctx.fillStyle = i ? "#121714" : "#d4f394";
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#d4f394";
          ctx.stroke();
          ctx.fillStyle = i ? "#d4f394" : "#111513";
          ctx.font = "bold 11px monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(i ? String(i).padStart(2, "0") : "⌂", x, y + 1);
        });
        ctx.beginPath();
        ctx.ellipse(mx, my, 11 + 2 * Math.sin(t * 6), 4.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(34, 197, 94, 0.35)";
        ctx.fill();
        drawAstronaut(ctx, mx, my, 44, pose(track, frame, t, fall));
        if ((frame.pause && !frame.done) || outOfOxygen) {
          const text = outOfOxygen ? `Out of oxygen · ${(frame.distance / 1000).toFixed(2)} km along the route` : `${frame.pause.label} · ${frame.pause.name}`;
          ctx.font = "bold 18px system-ui, sans-serif";
          const width = ctx.measureText(text).width + 36;
          ctx.fillStyle = "rgba(11, 15, 13, 0.92)";
          ctx.fillRect(W / 2 - width / 2, 18, width, 40);
          ctx.strokeStyle = outOfOxygen ? "#ff6b5e" : "#d4f394";
          ctx.strokeRect(W / 2 - width / 2, 18, width, 40);
          ctx.fillStyle = outOfOxygen ? "#ffb4a8" : "#d4f394";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(text, W / 2, 39);
        }
        // HUD band under the map.
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "#0c0f0d";
        ctx.fillRect(0, M, W, VIDEO.height - M);
        ctx.fillStyle = "#d4f394";
        ctx.font = "bold 15px monospace";
        ctx.fillText(`${track.code.toUpperCase()} · EVA PLAYBACK (SIMULATION)`, 24, M + 30);
        ctx.textAlign = "right";
        ctx.fillStyle = "#f4f7ee";
        ctx.font = "15px system-ui, sans-serif";
        ctx.fillStyle = outOfOxygen ? "#ffb4a8" : "#f4f7ee";
        ctx.fillText(outOfOxygen ? "Out of oxygen (estimate)" : t >= line.duration ? "Playback complete" : statusText(track, frame), W - 24, M + 30);
        ctx.textAlign = "left";
        const cells = values(track, frame);
        const columnW = (W - 48) / cells.length;
        cells.forEach(([labelText, value, alarmed], i) => {
          const x = 24 + i * columnW;
          ctx.fillStyle = "#8b9689";
          ctx.font = "bold 10px monospace";
          ctx.fillText(labelText.toUpperCase(), x, M + 62);
          ctx.fillStyle = alarmed ? "#ff8a7d" : "#ffffff";
          ctx.font = `bold ${i === 0 ? 13 : 16}px system-ui, sans-serif`;
          ctx.fillText(value, x, M + 86);
        });
        ctx.fillStyle = "#2a332d";
        ctx.fillRect(24, M + 104, W - 48, 6);
        ctx.fillStyle = "#22c55e";
        ctx.fillStyle = outOfOxygen ? "#ff6b5e" : "#22c55e";
        ctx.fillRect(24, M + 104, (W - 48) * Math.min(1, Math.min(t, stopAt) / line.duration), 6);
        ctx.fillStyle = "#8b9689";
        ctx.font = "11px system-ui, sans-serif";
        ctx.fillText("Position, elevation and slope from the loaded data along the calculated route. Time and oxygen are estimates from the EVA assumptions, not measurements.", 24, M + 136);
        if (outOfOxygen && fall >= 1) {
          // Closing card: where the plan runs out of oxygen.
          ctx.fillStyle = "rgba(11, 15, 13, 0.94)";
          ctx.fillRect(W / 2 - 300, M / 2 - 80, 600, 160);
          ctx.strokeStyle = "#ff6b5e";
          ctx.lineWidth = 2;
          ctx.strokeRect(W / 2 - 300, M / 2 - 80, 600, 160);
          ctx.textAlign = "center";
          ctx.fillStyle = "#ffb4a8";
          ctx.font = "bold 22px system-ui, sans-serif";
          ctx.fillText("OUT OF OXYGEN (ESTIMATE)", W / 2, M / 2 - 34);
          ctx.fillStyle = "#f4f7ee";
          ctx.font = "16px system-ui, sans-serif";
          ctx.fillText(`Ran out ${(frame.distance / 1000).toFixed(2)} of ${(track.total / 1000).toFixed(2)} km into the EVA, after ${hoursText(frame.hours)}.`, W / 2, M / 2 + 4);
          ctx.fillStyle = "#9aa698";
          ctx.font = "13px system-ui, sans-serif";
          ctx.fillText("Increase the oxygen supply, shorten the route or remove stops.", W / 2, M / 2 + 34);
          ctx.textAlign = "left";
        }
      };
      const stream = canvas.captureStream(VIDEO.fps);
      const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(t => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, type ? {mimeType: type, videoBitsPerSecond: 6_000_000} : undefined);
      const chunks = [];
      recorder.ondataavailable = event => event.data.size && chunks.push(event.data);
      const finished = new Promise(resolve => recorder.onstop = resolve);
      const total = (out !== null ? out + 1.6 + 1.5 : line.duration) + endCard;
      drawFrame(0);
      recorder.start();
      const started = performance.now();
      await new Promise(resolve => {
        const step = () => {
          const t = (performance.now() - started) / 1000;
          drawFrame(t);
          button.textContent = `Recording video… ${Math.min(100, Math.round(100 * t / total))}%`;
          if (t >= total) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      recorder.stop();
      await finished;
      const url = URL.createObjectURL(new Blob(chunks, {type: type || "video/webm"}));
      const link = document.createElement("a");
      link.href = url;
      link.download = `ares-${track.code.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-playback.webm`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      notify("Playback video exported");
    } catch (error) {
      console.error(error);
      notify(`Could not record the video: ${error.message}`);
    } finally {
      button.innerHTML = label;
      button.disabled = false;
    }
  }

  window.startPlayback = startPlayback;
  window.stopPlayback = stopPlayback;
  window.exportPlaybackVideo = exportPlaybackVideo;
  window.playbackVideoSupported = () => typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function";
})();
