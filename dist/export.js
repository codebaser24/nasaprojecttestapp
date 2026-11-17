// Mission map sheets: a 2D traverse map and a 3D relief view, exported as PNG.
// The sheet layout (title band, map, statistics panel, waypoint call-outs, 3D relief with a
// route profile) follows Hirushi192's export on the Nethsara branch. Everything drawn here comes
// from the loaded files, the calculated route or the user's own plan; values that the data does
// not provide are labelled as not calculated.
(() => {
  const W = 1920, H = 1280, MARGIN = 40, HEADER = 74, FOOTER = 170, SIDE = 440;
  const MAP = {x: MARGIN, y: MARGIN + HEADER, w: W - 2 * MARGIN - SIDE - 24, h: H - 2 * MARGIN - HEADER - FOOTER};
  const LIME = "#d4f394", TEXT = "#f4f7f2", MUTED = "#9aa698", PANEL = "#131815", LINE = "#38423b";
  const ISO_X = Math.cos(Math.PI / 6), ISO_Y = Math.sin(Math.PI / 6);

  const loadImage = url => new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });

  const points = () => state.ids.map(id => catalog.find(point => point.id === id)).filter(Boolean);
  const cellOf = point => [Math.floor(point.x / 1000 * grid.width), Math.floor(point.y / 700 * grid.height)];
  const legs = () => missionDemSummary?.legs?.length ? missionDemSummary.legs : null;
  // Matches the mission map: grey base map when elevation colours are switched off.
  const baseFilter = () => grid.baseLayer === "elevation" && !state.layers.includes("elevation") ? "grayscale(1)" : "none";
  const profileName = () => ({balanced: "Balanced · 18° cap", "low-exposure": "Lower slope · 10° cap", shortest: "Shortest · 22° cap"})[missionDemSummary?.profile] || "";

  // Visible mission layers in the order the map draws them: file layers, then contours, then hazards.
  function visibleLayers() {
    const active = new Set(state.layers.filter(id => availableLayers.has(id)));
    return [...grid.layers.map(layer => layer.id), "contours", "viewshed", "walkback", "hazards"].filter(id => active.has(id))
      .map(id => {
        const layer = mapLayers().find(entry => entry.id === id);
        // Camp analyses use the overlay image currently shown on the mission map.
        const url = layer?.analysis ? document.querySelector(`#${id} image`)?.getAttribute("href") : null;
        return layer && (url || layer.image) ? {...layer, url} : null;
      }).filter(Boolean);
  }

  function fitText(ctx, text, width) {
    if (ctx.measureText(text).width <= width) return text;
    while (text.length > 1 && ctx.measureText(text + "…").width > width) text = text.slice(0, -1);
    return text + "…";
  }

  // One line per loaded layer: what the calculated route crosses in it.
  function alongSummary() {
    return (missionDemSummary?.alongRoute || []).map(entry => {
      const label = KIND_LABELS[entry.kind] || entry.kind;
      if (entry.type === "classes") {
        const total = entry.classes.reduce((sum, item) => sum + item.distanceM, 0) + entry.noDataM;
        const top = entry.classes.filter(item => !item.hidden).slice(0, 3)
          .map(item => `${item.name.split(" · ")[0]} ${distanceText(item.distanceM)} (${Math.round(100 * item.distanceM / total)}%)`);
        return `${label}: ${top.length ? top.join(", ") : "none detected"}`;
      }
      if (entry.minimum === null) return `${label}: no data`;
      if (entry.kind === "walkback") return `${label}: farthest point ${distanceText(entry.maximum)} on foot (average ${distanceText(entry.mean)})`;
      return `${label}: ${formatValue(entry.minimum)} to ${formatValue(entry.maximum)}, average ${formatValue(entry.mean)}${entry.units ? ` ${entry.units}` : ""}`;
    });
  }

  // Draws text over as many lines as it needs; returns the y of the line after it.
  function wrapText(ctx, text, x, y, width, lineHeight) {
    let line = "";
    for (const word of text.split(" ")) {
      if (line && ctx.measureText(`${line} ${word}`).width > width) {
        ctx.fillText(line, x, y);
        y += lineHeight;
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) ctx.fillText(line, x, y);
    return y + lineHeight;
  }

  function coordinate(value, positive, negative) {
    return `${Math.abs(value).toFixed(3)}° ${value < 0 ? negative : positive}`;
  }

  // Grid window around the waypoints and route, padded and shaped to the drawing area.
  function sheetWindow(aspect) {
    const cells = points().map(cellOf);
    for (const leg of legs() || []) cells.push(...leg.path);
    let x0 = Math.min(...cells.map(c => c[0])), x1 = Math.max(...cells.map(c => c[0])) + 1;
    let y0 = Math.min(...cells.map(c => c[1])), y1 = Math.max(...cells.map(c => c[1])) + 1;
    const pad = Math.max(25, 0.18 * Math.max(x1 - x0, y1 - y0));
    x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
    const wanted = aspect * grid.dy / grid.dx;  // width/height in cells for this ground aspect ratio
    if ((x1 - x0) / (y1 - y0) < wanted) {
      const grow = ((y1 - y0) * wanted - (x1 - x0)) / 2;
      x0 -= grow; x1 += grow;
    } else {
      const grow = ((x1 - x0) / wanted - (y1 - y0)) / 2;
      y0 -= grow; y1 += grow;
    }
    const clamp = (low, high, size) => {
      const span = Math.min(size, high - low);
      low = Math.max(0, Math.min(size - span, low));
      return [Math.round(low), Math.round(low + span)];
    };
    [x0, x1] = clamp(x0, x1, grid.width);
    [y0, y1] = clamp(y0, y1, grid.height);
    return {x0, y0, x1, y1, w: x1 - x0, h: y1 - y0};
  }

  async function regionInfo(win, size) {
    return request(`/api/region?x0=${win.x0}&y0=${win.y0}&x1=${win.x1}&y1=${win.y1}&size=${size}`);
  }

  function niceLength(metres) {
    const power = 10 ** Math.floor(Math.log10(metres));
    return [1, 2, 5, 10].map(n => n * power).filter(n => n <= metres).pop() || power;
  }

  function drawFrame(ctx, mode) {
    ctx.fillStyle = "#0c0f0d";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 18, W - 36, H - 36);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = LIME;
    ctx.font = "bold 12px monospace";
    ctx.fillText(fitText(ctx, `ARES FIELD ATLAS  //  ${mode === "3D" ? "3D ELEVATION RELIEF" : "2D TRAVERSE MAP"}  //  ${grid.source}`, W - 2 * MARGIN - 560), MARGIN, MARGIN + 16);
    ctx.fillStyle = TEXT;
    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.fillText(`${missionLabel().toUpperCase()} — ${mode === "3D" ? "3D RELIEF AND ROUTE PROFILE" : "SURFACE TRAVERSE MAP"}`, MARGIN, MARGIN + 52);
    ctx.textAlign = "right";
    ctx.fillStyle = MUTED;
    ctx.font = "bold 12px monospace";
    ctx.fillText(`GRID: ${grid.crs || "unknown"}  |  ${grid.horizontalUnits ? `${+grid.dx.toFixed(2)} M/PIXEL` : "PIXEL SIZE UNKNOWN"}`, W - MARGIN, MARGIN + 22);
    ctx.fillStyle = LIME;
    ctx.fillText(legs() ? `ROUTE: ${profileName().toUpperCase()}` : "ROUTE NOT CALCULATED", W - MARGIN, MARGIN + 46);
    ctx.textAlign = "left";
  }

  // Waypoint call-out labels that avoid each other and the map edge (placement after Hirushi192).
  function drawCallouts(ctx, items, bounds) {
    const placed = [];
    ctx.font = "bold 11px monospace";
    for (const {x, y, anchorY, text, home} of items) {
      const width = ctx.measureText(text).width + 18, height = 24, top = anchorY ?? y;
      const candidates = [[24, -24], [24, 12], [-width - 24, -24], [-width - 24, 12]];
      let choice = candidates[0];
      for (const [dx, dy] of candidates) {
        const bx = x + dx, by = top + dy;
        if (bx < bounds.x + 10 || bx + width > bounds.x + bounds.w - 10 || by < bounds.y + 10 || by + height > bounds.y + bounds.h - 10) continue;
        if (!placed.some(b => !(bx + width + 6 < b.x || bx > b.x + b.w + 6 || by + height + 6 < b.y || by > b.y + b.h + 6))) {
          choice = [dx, dy];
          break;
        }
      }
      const bx = Math.max(bounds.x + 10, Math.min(bounds.x + bounds.w - width - 10, x + choice[0]));
      const by = Math.max(bounds.y + 10, Math.min(bounds.y + bounds.h - height - 10, top + choice[1]));
      placed.push({x: bx, y: by, w: width, h: height});
      ctx.strokeStyle = LIME;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(bx + (bx > x ? 0 : width), by + height / 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(13, 16, 14, 0.92)";
      ctx.fillRect(bx, by, width, height);
      ctx.strokeStyle = home ? LIME : "rgba(217, 248, 151, 0.55)";
      ctx.strokeRect(bx, by, width, height);
      ctx.fillStyle = TEXT;
      ctx.textBaseline = "middle";
      ctx.fillText(text, bx + 9, by + height / 2 + 1);
      ctx.textBaseline = "alphabetic";
    }
  }

  function drawPin(ctx, x, y, index) {
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fillStyle = index ? "#121714" : LIME;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = LIME;
    ctx.stroke();
    ctx.fillStyle = index ? LIME : "#111513";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(index ? String(index).padStart(2, "0") : "⌂", x, y + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  function waypointLabel(point, index) {
    const elevation = legs()?.[index]?.elevationsM?.[0];
    return `${index ? `WP-${String(index).padStart(2, "0")}` : "BASE"} // ${point.name.toUpperCase()}${elevation != null ? ` (${Math.round(elevation)} m)` : ""}`;
  }

  // Legend entries drawn on the canvas, from the same data as the on-screen legends.
  function drawLegend(ctx, ids, x, y, width, bottom) {
    for (const entry of ids.map(legendEntry).filter(Boolean)) {
      if (y > bottom - 40) break;
      ctx.fillStyle = TEXT;
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.fillText(fitText(ctx, entry.title, width), x, y);
      y += 16;
      const legend = entry.legend;
      ctx.font = "11px system-ui, sans-serif";
      if (legend.type === "ramp") {
        const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
        legend.colours.forEach((colour, i) => gradient.addColorStop(i / (legend.colours.length - 1), colour));
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, width, 9);
        ctx.fillStyle = MUTED;
        const units = legend.units ? ` ${legend.units}` : " (units not stated)";
        const [low, high] = legend.labels || [`${formatValue(legend.low)}${legend.units ? units : ""}`, `${formatValue(legend.high)}${units}`];
        ctx.fillText(low, x, y + 22);
        ctx.textAlign = "right";
        ctx.fillText(high, x + width, y + 22);
        ctx.textAlign = "left";
        y += 48;
        continue;
      }
      const items = legend.items.filter(item => !item.hidden);
      for (const item of items.slice(0, 7)) {
        if (legend.type === "lines") {
          ctx.strokeStyle = item.colour;
          ctx.lineWidth = item.width;
          ctx.beginPath();
          ctx.moveTo(x, y - 4);
          ctx.lineTo(x + 14, y - 4);
          ctx.stroke();
        } else if (item.colour) {
          ctx.fillStyle = item.colour;
          ctx.fillRect(x, y - 10, 11, 11);
        } else {
          ctx.strokeStyle = MUTED;
          ctx.setLineDash([2, 2]);
          ctx.strokeRect(x + 0.5, y - 9.5, 10, 10);
          ctx.setLineDash([]);
        }
        ctx.fillStyle = "#cfd8c8";
        ctx.fillText(fitText(ctx, item.name, width - 22), x + 20, y);
        y += 16;
      }
      if (items.length > 7) {
        ctx.fillStyle = MUTED;
        ctx.fillText(`+ ${items.length - 7} more classes (see the atlas legend)`, x + 20, y);
        y += 16;
      }
      y += 8;
    }
    return y;
  }

  function drawSidePanel(ctx) {
    const x = MAP.x + MAP.w + 24, y0 = MAP.y, px = x + 22, width = SIDE - 44, bottom = MAP.y + MAP.h - 14;
    ctx.fillStyle = PANEL;
    ctx.fillRect(x, y0, SIDE, MAP.h);
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y0, SIDE, MAP.h);
    let y = y0 + 30;
    const heading = text => {
      ctx.fillStyle = LIME;
      ctx.font = "bold 12px monospace";
      ctx.fillText(text, px, y);
      y += 24;
    };
    heading("01 // TRAVERSE (FROM ELEVATION)");
    const summary = missionDemSummary;
    if (legs()) {
      const rows = [["DISTANCE", `${(summary.distanceM / 1000).toFixed(2)} km`, "TOTAL ASCENT", `${summary.ascentM} m`],
        ["MAX. SLOPE", `${summary.maxSlopeDeg.toFixed(1)}°`, "LEGS", `${summary.legs.length} incl. return`]];
      for (const [k1, v1, k2, v2] of rows) {
        ctx.fillStyle = MUTED;
        ctx.font = "bold 10px monospace";
        ctx.fillText(k1, px, y);
        ctx.fillText(k2, px + width / 2 + 6, y);
        y += 21;
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 19px system-ui, sans-serif";
        ctx.fillText(v1, px, y);
        ctx.fillText(v2, px + width / 2 + 6, y);
        y += 28;
      }
      const eva = summary.eva;
      if (eva) {
        const hours = value => {
          const minutes = Math.round(value * 60);
          return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
        };
        ctx.fillStyle = MUTED;
        ctx.font = "bold 10px monospace";
        ctx.fillText("EVA ESTIMATE (FROM EDITABLE ASSUMPTIONS, NOT MEASURED)", px, y);
        y += 16;
        ctx.fillStyle = "#cfd8c8";
        ctx.font = "11.5px system-ui, sans-serif";
        const lines = [`Total ${hours(eva.totalHours)}: ${eva.assumptions.rover ? "driving" : "walking"} ${hours(eva.travelHours)}, at stops ${hours(eva.stopHours)}, contingency ${hours(eva.contingencyHours)}.`,
          `Suit oxygen left ${Math.max(0, eva.oxygenLeftPercent).toFixed(0)}%; ${eva.limitMarginHours < 0 ? "over" : "within"} the ${eva.assumptions.evaLimitH} h limit by ${hours(Math.abs(eva.limitMarginHours))}.`,
          ...eva.warnings.map(text => `Warning: ${text}`)];
        for (const line of lines) y = wrapText(ctx, line, px, y, width, 15);
        y += 6;
      }
      const along = alongSummary();
      if (along.length) {
        ctx.fillStyle = MUTED;
        ctx.font = "bold 10px monospace";
        ctx.fillText("ALONG THE ROUTE (SHOWN ONLY, NOT USED FOR ROUTING)", px, y);
        y += 16;
        ctx.fillStyle = "#cfd8c8";
        ctx.font = "11.5px system-ui, sans-serif";
        for (const line of along) y = wrapText(ctx, line, px, y, width, 15);
        y += 6;
      }
    } else {
      ctx.fillStyle = "#ffb4a8";
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText("Route not calculated. Use Calculate route in the", px, y);
      ctx.fillText("planner to add distance, ascent and slope.", px, y + 18);
      y += 44;
    }
    ctx.fillStyle = MUTED;
    ctx.font = "11px system-ui, sans-serif";
    y = wrapText(ctx, `Not calculated, because the data is not available: ${NOT_CALCULATED.map(item => item.output.split(" (")[0].toLowerCase()).join(", ")}.`, px, y, width, 15) + 12;
    ctx.strokeStyle = "#2a332d";
    ctx.beginPath();
    ctx.moveTo(px, y - 8);
    ctx.lineTo(px + width, y - 8);
    ctx.stroke();
    y += 10;
    heading(`02 // WAYPOINTS (${String(points().length).padStart(2, "0")} STOPS)`);
    points().forEach((point, index) => {
      if (y > y0 + MAP.h * 0.74) return;
      const elevation = legs()?.[index]?.elevationsM?.[0];
      ctx.fillStyle = index ? "#19201c" : "rgba(212, 243, 148, 0.12)";
      ctx.fillRect(px, y - 15, width, 42);
      ctx.fillStyle = LIME;
      ctx.font = "bold 11px monospace";
      ctx.fillText(index ? `[WP-${String(index).padStart(2, "0")}]` : "[BASE]", px + 10, y + 2);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.fillText(fitText(ctx, point.name, width - 90), px + 80, y + 2);
      ctx.fillStyle = MUTED;
      ctx.font = "11px system-ui, sans-serif";
      const details = [point.type, index ? `${point.time} min planned` : "Start / return", elevation != null ? `elevation ${Math.round(elevation)} m` : ""].filter(Boolean);
      ctx.fillText(fitText(ctx, details.join("  •  "), width - 20), px + 10, y + 20);
      y += 50;
    });
    y += 6;
    heading("03 // LAYERS ON THIS SHEET");
    drawLegend(ctx, [...baseLegendIds(state.layers), ...visibleLayers().map(layer => layer.id)], px, y, width, bottom);
  }

  function drawFooter(ctx) {
    const y = MAP.y + MAP.h + 22, height = FOOTER - 30, width = W - 2 * MARGIN;
    ctx.fillStyle = PANEL;
    ctx.fillRect(MAP.x, y, width, height);
    ctx.strokeStyle = LINE;
    ctx.strokeRect(MAP.x, y, width, height);
    ctx.fillStyle = LIME;
    ctx.font = "bold 11px monospace";
    ctx.fillText("04 // DATA SOURCES", MAP.x + 20, y + 24);
    ctx.font = "12px system-ui, sans-serif";
    let line = y + 46;
    for (const file of includedFiles().slice(0, 5)) {
      const layer = grid.layers.find(entry => entry.fileId === file.id);
      const use = grid.elevation.fileId === file.id ? "elevation used for route calculations" : "shown only, not used in route calculations";
      const source = sourceText(file.source || layer?.source);
      ctx.fillStyle = "#cfd8c8";
      ctx.fillText(fitText(ctx, `${file.name} — ${use}${source ? ` · ${source}` : ""}`, width - SIDE - 60), MAP.x + 20, line);
      line += 18;
    }
    const stampX = W - MARGIN - SIDE + 20;
    ctx.fillStyle = LIME;
    ctx.font = "bold 12px monospace";
    ctx.fillText("ARES FIELD ATLAS", stampX, y + 26);
    ctx.fillStyle = MUTED;
    ctx.font = "11px monospace";
    ctx.fillText(`GENERATED ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`, stampX, y + 50);
    ctx.fillText("CALCULATED ONLY FROM THE LOADED DATA FILES.", stampX, y + 72);
    ctx.fillText("NOT VALIDATED FOR OPERATIONAL NAVIGATION.", stampX, y + 92);
  }

  // ------------------------------------------------------------------ 2D sheet
  async function draw2D(ctx) {
    const win = sheetWindow(MAP.w / MAP.h);
    const info = await regionInfo(win, 8);
    const scale = Math.min(MAP.w / (win.w * grid.dx), MAP.h / (win.h * grid.dy));  // sheet pixels per metre
    const drawW = win.w * grid.dx * scale, drawH = win.h * grid.dy * scale;
    const ox = MAP.x + (MAP.w - drawW) / 2, oy = MAP.y + (MAP.h - drawH) / 2;
    const toSheet = (gx, gy) => [ox + (gx - win.x0) / win.w * drawW, oy + (gy - win.y0) / win.h * drawH];
    ctx.fillStyle = "#191e1b";
    ctx.fillRect(MAP.x, MAP.y, MAP.w, MAP.h);
    ctx.imageSmoothingQuality = "high";
    ctx.filter = baseFilter();
    ctx.drawImage(base, win.x0, win.y0, win.w, win.h, ox, oy, drawW, drawH);
    ctx.filter = "none";
    for (const layer of visibleLayers()) {
      const image = await loadImage(layer.url || buildUrl(layer.image));
      if (!image) continue;
      ctx.globalAlpha = layer.derived ? 1 : overlayOpacity;
      ctx.drawImage(image, win.x0, win.y0, win.w, win.h, ox, oy, drawW, drawH);
    }
    ctx.globalAlpha = 1;

    const stops = points();
    ctx.lineCap = ctx.lineJoin = "round";
    const trace = () => {
      ctx.beginPath();
      if (legs()) {
        for (const leg of legs()) leg.path.forEach(([gx, gy], i) => ctx[i ? "lineTo" : "moveTo"](...toSheet(gx + 0.5, gy + 0.5)));
      } else {
        [...stops, stops[0]].forEach((point, i) => ctx[i ? "lineTo" : "moveTo"](...toSheet(...cellOf(point).map(v => v + 0.5))));
      }
    };
    ctx.strokeStyle = "rgba(13, 16, 14, 0.85)";
    ctx.lineWidth = 8;
    trace();
    ctx.stroke();
    ctx.strokeStyle = "#d9f897";
    ctx.lineWidth = 3.5;
    if (!legs()) ctx.setLineDash([10, 8]);
    trace();
    ctx.stroke();
    ctx.setLineDash([]);
    const markers = stops.map((point, index) => {
      const [x, y] = toSheet(...cellOf(point).map(v => v + 0.5));
      return {x, y, index, text: waypointLabel(point, index), home: index === 0};
    });
    markers.forEach(marker => drawPin(ctx, marker.x, marker.y, marker.index));
    drawCallouts(ctx, markers, MAP);

    // Scale bar computed from the grid's pixel size.
    if (grid.horizontalUnits) {
      const length = niceLength(220 / scale);
      const barW = length * scale, sx = MAP.x + 24, sy = MAP.y + MAP.h - 30;
      ctx.fillStyle = "rgba(13, 16, 14, 0.88)";
      ctx.fillRect(sx - 10, sy - 24, barW + 90, 46);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? LINE : "#d9f897";
        ctx.fillRect(sx + i * barW / 4, sy, barW / 4, 6);
      }
      ctx.fillStyle = "#e6ebe3";
      ctx.font = "bold 10px monospace";
      ctx.fillText("SCALE", sx, sy - 9);
      ctx.fillStyle = MUTED;
      ctx.fillText("0", sx, sy + 17);
      ctx.fillText(length >= 1000 ? `${length / 1000} km` : `${length} m`, sx + barW - 10, sy + 17);
    }
    // Grid north is up; corner coordinates come from the reference file's georeferencing.
    const cx = MAP.x + MAP.w - 56, cy = MAP.y + 62;
    ctx.strokeStyle = "rgba(244, 247, 242, 0.75)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#d9f897";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 32);
    ctx.lineTo(cx - 6, cy - 8);
    ctx.lineTo(cx + 6, cy - 8);
    ctx.closePath();
    ctx.fill();
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.fillText("N", cx, cy - 38);
    ctx.textAlign = "left";
    if (info.corners) {
      const {northWest: [west, north], southEast: [east, south]} = info.corners;
      ctx.font = "bold 11px monospace";
      ctx.fillStyle = "rgba(13, 16, 14, 0.85)";
      ctx.fillRect(ox + 6, oy + 6, 250, 20);
      ctx.fillRect(ox + drawW - 256, oy + drawH - 26, 250, 20);
      ctx.fillStyle = "#e6ebe3";
      ctx.fillText(`${coordinate(north, "N", "S")}, ${coordinate(west, "E", "W")}`, ox + 14, oy + 20);
      ctx.textAlign = "right";
      ctx.fillText(`${coordinate(south, "N", "S")}, ${coordinate(east, "E", "W")}`, ox + drawW - 14, oy + drawH - 12);
      ctx.textAlign = "left";
    }
    if (!legs()) {
      ctx.font = "bold 12px monospace";
      ctx.fillStyle = "rgba(13, 16, 14, 0.88)";
      ctx.fillRect(MAP.x + MAP.w / 2 - 260, MAP.y + 14, 520, 26);
      ctx.fillStyle = "#ffb4a8";
      ctx.textAlign = "center";
      ctx.fillText("DASHED LINES SHOW WAYPOINT ORDER ONLY — ROUTE NOT CALCULATED", MAP.x + MAP.w / 2, MAP.y + 31);
      ctx.textAlign = "left";
    }
  }

  // ------------------------------------------------------------------ 3D sheet
  async function draw3D(ctx) {
    const chartH = 150;
    const area = {x: MAP.x, y: MAP.y, w: MAP.w, h: MAP.h - chartH - 24};
    const win = sheetWindow(1.25);
    const info = await regionInfo(win, 170);
    if (!info.heightsM) throw new Error("The loaded files have no elevation that meets the routing requirements.");
    const {columns, rows, cellsPerSample: step} = info;
    const heights = info.heightsM;

    // Colour each sample from the base map and the visible layers, exactly as the 2D map shows them.
    const sampler = document.createElement("canvas");
    sampler.width = columns;
    sampler.height = rows;
    const sctx = sampler.getContext("2d", {willReadFrequently: true});
    sctx.imageSmoothingQuality = "high";
    sctx.filter = baseFilter();
    sctx.drawImage(base, win.x0, win.y0, win.w, win.h, 0, 0, win.w / step, win.h / step);
    sctx.filter = "none";
    for (const layer of visibleLayers()) {
      const image = await loadImage(layer.url || buildUrl(layer.image));
      if (!image) continue;
      sctx.globalAlpha = layer.derived ? 1 : overlayOpacity;
      sctx.drawImage(image, win.x0, win.y0, win.w, win.h, 0, 0, win.w / step, win.h / step);
    }
    const colours = sctx.getImageData(0, 0, columns, rows).data;

    const minZ = info.minimumM, relief = Math.max(1, info.maximumM - info.minimumM);
    const groundW = columns * step * grid.dx, groundH = rows * step * grid.dy;
    // Vertical exaggeration chosen so the relief is visible; it is printed on the sheet.
    const target = 0.3 * (groundW + groundH) * ISO_Y / relief;
    const exaggeration = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50].filter(n => n <= Math.max(1, target)).pop();
    const project = (X, Y, Z) => [(X - Y) * ISO_X, (X + Y) * ISO_Y - Z * exaggeration];
    const vertex = (r, c) => {
      const z = heights[r * columns + c];
      return z == null ? null : project((c + 0.5) * step * grid.dx, (r + 0.5) * step * grid.dy, z - minZ);
    };
    const floor = -0.08 * relief;
    const corners = [project(0, 0, 0), project(groundW, 0, 0), project(0, groundH, 0), project(groundW, groundH, 0),
      project(0, 0, relief), project(groundW, groundH, floor), project(0, groundH, floor), project(groundW, 0, relief)];
    const left = Math.min(...corners.map(p => p[0])), right = Math.max(...corners.map(p => p[0]));
    const top = Math.min(...corners.map(p => p[1])), bottom = Math.max(...corners.map(p => p[1]));
    const k = Math.min((area.w - 80) / (right - left), (area.h - 70) / (bottom - top));
    const ox = area.x + (area.w - (right - left) * k) / 2 - left * k, oy = area.y + 50 + (area.h - 70 - (bottom - top) * k) / 2 - top * k;
    const screen = ([u, v]) => [ox + u * k, oy + v * k];

    const background = ctx.createRadialGradient(MAP.x + MAP.w / 2, MAP.y + MAP.h * 0.4, 80, MAP.x + MAP.w / 2, MAP.y + MAP.h / 2, MAP.w * 0.8);
    background.addColorStop(0, "#161e1a");
    background.addColorStop(1, "#080b09");
    ctx.fillStyle = background;
    ctx.fillRect(MAP.x, MAP.y, MAP.w, MAP.h);

    // Draw from the back (north-west) to the front so nearer cells cover farther ones.
    for (let s = 0; s <= rows + columns - 4; s++) {
      for (let r = Math.max(0, s - columns + 2); r <= Math.min(rows - 2, s); r++) {
        const c = s - r;
        const quad = [vertex(r, c), vertex(r, c + 1), vertex(r + 1, c + 1), vertex(r + 1, c)];
        if (quad.some(p => !p)) continue;
        const i = (r * columns + c) * 4;
        if (!colours[i + 3]) continue;
        ctx.fillStyle = ctx.strokeStyle = `rgb(${colours[i]},${colours[i + 1]},${colours[i + 2]})`;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        quad.map(screen).forEach(([x, y], n) => ctx[n ? "lineTo" : "moveTo"](x, y));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    // Side walls along the two front edges give the block depth.
    const wall = (cells, shade) => {
      const surface = cells.map(([r, c]) => vertex(r, c)).filter(Boolean);
      if (surface.length < 2) return;
      const first = cells.find(([r, c]) => vertex(r, c)), last = [...cells].reverse().find(([r, c]) => vertex(r, c));
      const ground = ([r, c]) => project((c + 0.5) * step * grid.dx, (r + 0.5) * step * grid.dy, floor);
      ctx.fillStyle = shade;
      ctx.beginPath();
      surface.map(screen).forEach(([x, y], n) => ctx[n ? "lineTo" : "moveTo"](x, y));
      ctx.lineTo(...screen(ground(last)));
      ctx.lineTo(...screen(ground(first)));
      ctx.closePath();
      ctx.fill();
    };
    wall(Array.from({length: columns}, (_, c) => [rows - 1, c]), "#151a17");
    wall(Array.from({length: rows}, (_, r) => [r, columns - 1]), "#1d2420");

    const toScreen3D = (gx, gy, z) => screen(project((gx - win.x0) * grid.dx, (gy - win.y0) * grid.dy, z - minZ));
    const nearest = (gx, gy) => {
      const c = Math.max(0, Math.min(columns - 1, Math.floor((gx - win.x0) / step)));
      const r = Math.max(0, Math.min(rows - 1, Math.floor((gy - win.y0) / step)));
      return heights[r * columns + c];
    };
    ctx.lineCap = ctx.lineJoin = "round";
    if (legs()) {
      for (const [width, colour] of [[7, "rgba(10, 13, 11, 0.9)"], [3, "#ffffff"]]) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (const leg of legs()) {
          leg.path.forEach(([gx, gy], i) => {
            const [x, y] = toScreen3D(gx + 0.5, gy + 0.5, leg.elevationsM[i]);
            ctx[i ? "lineTo" : "moveTo"](x, y - 2);
          });
        }
        ctx.stroke();
      }
    }
    const markers = points().map((point, index) => {
      const [gx, gy] = cellOf(point);
      const exact = legs()?.[index]?.elevationsM?.[0];
      const z = exact ?? nearest(gx, gy) ?? minZ;
      const [x, y] = toScreen3D(gx + 0.5, gy + 0.5, z);
      ctx.strokeStyle = LIME;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x, y, 12, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 42);
      ctx.stroke();
      return {x, y: y - 42, index, home: index === 0,
        text: `${index ? `WP-${String(index).padStart(2, "0")}` : "BASE"} // ${point.name.toUpperCase()} (${exact != null ? "" : "≈ "}${Math.round(z)} m)`};
    });
    markers.forEach(marker => drawPin(ctx, marker.x, marker.y, marker.index));
    drawCallouts(ctx, markers, area);

    // Key: what the colours and heights mean.
    ctx.fillStyle = "rgba(12, 15, 13, 0.9)";
    ctx.fillRect(area.x + 16, area.y + 16, 420, 78);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.strokeRect(area.x + 16, area.y + 16, 420, 78);
    ctx.fillStyle = LIME;
    ctx.font = "bold 10px monospace";
    ctx.fillText("RELIEF KEY", area.x + 30, area.y + 34);
    ctx.fillStyle = "#e6ebe3";
    ctx.font = "11.5px system-ui, sans-serif";
    ctx.fillText(`Heights: elevation data, ${Math.round(info.minimumM)} to ${Math.round(info.maximumM)} m in this view`, area.x + 30, area.y + 52);
    ctx.fillText(`Vertical exaggeration ×${exaggeration} · ${step > 1 ? `each sample averages ${step} × ${step} cells` : "one sample per elevation cell"}`, area.x + 30, area.y + 68);
    ctx.fillText("Colours: the base map and visible layers (see 03)", area.x + 30, area.y + 84);
    // North arrow: grid north points to the upper right in this view.
    const nx = area.x + area.w - 70, ny = area.y + 50;
    ctx.strokeStyle = "#d9f897";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(nx - 18 * ISO_X, ny + 18 * ISO_Y);
    ctx.lineTo(nx + 18 * ISO_X, ny - 18 * ISO_Y);
    ctx.stroke();
    ctx.fillStyle = "#d9f897";
    const tipX = nx + 18 * ISO_X, tipY = ny - 18 * ISO_Y;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - 11 * ISO_X - 4 * ISO_Y, tipY + 11 * ISO_Y - 4 * ISO_X);
    ctx.lineTo(tipX - 11 * ISO_X + 4 * ISO_Y, tipY + 11 * ISO_Y + 4 * ISO_X);
    ctx.closePath();
    ctx.fill();
    ctx.font = "bold 11px monospace";
    ctx.fillText("N", nx + 22 * ISO_X, ny - 22 * ISO_Y);

    drawProfile(ctx, {x: MAP.x + 16, y: MAP.y + MAP.h - chartH - 14, w: MAP.w - 32, h: chartH});
  }

  // Elevation along the calculated route, with distance from the start on the horizontal axis.
  function drawProfile(ctx, box) {
    ctx.fillStyle = "rgba(12, 15, 13, 0.94)";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = "rgba(212, 243, 148, 0.32)";
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = LIME;
    ctx.font = "bold 10px monospace";
    ctx.fillText("ELEVATION ALONG THE CALCULATED ROUTE", box.x + 14, box.y + 18);
    if (!legs()) {
      ctx.fillStyle = "#ffb4a8";
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText("Route not calculated. Calculate the route in the planner to draw its elevation profile.", box.x + 14, box.y + 52);
      return;
    }
    const samples = [], marks = [];
    let distance = 0;
    legs().forEach((leg, index) => {
      marks.push({at: distance, label: index ? `WP-${String(index).padStart(2, "0")}` : "BASE"});
      leg.path.forEach(([gx, gy], i) => {
        if (i) {
          const [px, py] = leg.path[i - 1];
          distance += Math.hypot((gx - px) * grid.dx, (gy - py) * grid.dy);
        } else if (samples.length) return;
        samples.push([distance, leg.elevationsM[i]]);
      });
    });
    marks.push({at: distance, label: "BASE"});
    const low = Math.min(...samples.map(s => s[1])), high = Math.max(...samples.map(s => s[1]));
    const span = Math.max(1, high - low);
    const left = box.x + 70, right = box.x + box.w - 24, top = box.y + 30, bottom = box.y + box.h - 28;
    const X = d => left + d / Math.max(1, distance) * (right - left);
    const Y = z => bottom - (z - low) / span * (bottom - top);
    ctx.fillStyle = MUTED;
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(high)} m`, left - 8, top + 4);
    ctx.fillText(`${Math.round(low)} m`, left - 8, bottom);
    ctx.textAlign = "left";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(right, top);
    ctx.moveTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();
    const fill = ctx.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, "rgba(212, 243, 148, 0.35)");
    fill.addColorStop(1, "rgba(34, 122, 156, 0.08)");
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    samples.forEach(([d, z]) => ctx.lineTo(X(d), Y(z)));
    ctx.lineTo(X(distance), bottom);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = LIME;
    ctx.lineWidth = 2;
    ctx.beginPath();
    samples.forEach(([d, z], i) => ctx[i ? "lineTo" : "moveTo"](X(d), Y(z)));
    ctx.stroke();
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    for (const mark of marks) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(X(mark.at), top);
      ctx.lineTo(X(mark.at), bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#e6ebe3";
      ctx.fillText(mark.label, X(mark.at), bottom + 13);
    }
    ctx.fillStyle = MUTED;
    ctx.fillText(`${(distance / 1000).toFixed(2)} km`, right, bottom + 24);
    ctx.textAlign = "left";
  }

  async function exportSheet(mode) {
    const button = document.getElementById("export");
    const label = button.innerHTML;
    button.disabled = true;
    button.textContent = `Drawing ${mode} map…`;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      drawFrame(ctx, mode);
      ctx.save();
      ctx.beginPath();
      ctx.rect(MAP.x, MAP.y, MAP.w, MAP.h);
      ctx.clip();
      await (mode === "3D" ? draw3D(ctx) : draw2D(ctx));
      ctx.restore();
      ctx.strokeStyle = "#6c7a6e";
      ctx.lineWidth = 2;
      ctx.strokeRect(MAP.x, MAP.y, MAP.w, MAP.h);
      drawSidePanel(ctx);
      drawFooter(ctx);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ares-${missionLabel().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${mode.toLowerCase()}-map.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      notify(`${mode} mission map exported`);
    } catch (error) {
      console.error(error);
      notify(`Could not export the ${mode} map: ${error.message}`);
    } finally {
      button.innerHTML = label;
      button.disabled = false;
    }
  }

  // The visible map layers, also used by the playback video (playback.js).
  window.sheetLayers = visibleLayers;

  // Called by the Export mission button in app.js.
  window.openExportChooser = () => {
    const loaded = typeof grid !== "undefined" && grid && typeof base !== "undefined" && base;
    const has3D = loaded && grid.routing.available;
    const routeNote = missionDemSummary?.legs?.length ? "Includes the calculated route." : "The route is not calculated yet, so waypoints are joined in order and marked as such.";
    const hasVideo = Boolean(missionDemSummary?.legs?.length && window.playbackVideoSupported?.());
    const videoSeconds = Math.round(22 + 1.4 * (missionDemSummary?.legs?.length || 0) + 2.5);
    modal(`<div class="eyebrow">${escapeText(missionLabel()).toUpperCase()} EXPORT</div><h2>Export the mission plan</h2>
      <p>Every value on the map sheets comes from the loaded files, the calculated route or your plan. ${escapeText(routeNote)}</p>
      <button class="choice" id="export2D"${loaded ? "" : " disabled"}><strong>2D traverse map (PNG)</strong><br>
        <small>Base map and visible layers, waypoints, route, scale bar, corner coordinates, legends and data sources.</small></button>
      <button class="choice" id="export3D"${has3D ? "" : " disabled"}><strong>3D relief and route profile (PNG)</strong><br>
        <small>${has3D ? "Elevation shown in 3D with the visible layers draped on it, and the elevation profile along the route." : "Needs elevation that meets the routing requirements."}</small></button>
      <button class="choice" id="exportVideo"${hasVideo ? "" : " disabled"}><strong>Playback video (WebM)</strong><br>
        <small>${!window.playbackVideoSupported?.() ? "This browser cannot record video." : hasVideo
          ? `The animated EVA playback along the calculated route, recorded in real time (about ${videoSeconds} s). Keep this tab open while it records.`
          : "Calculate the route first: the video follows the calculated route."}</small></button>
      <button class="choice" id="exportJson"><strong>Mission data (JSON)</strong><br>
        <small>Waypoints, route, and which data was and was not used.</small></button>`);
    document.getElementById("exportVideo").onclick = () => { document.getElementById("modal").close(); window.exportPlaybackVideo(); };
    document.getElementById("export2D").onclick = () => { document.getElementById("modal").close(); exportSheet("2D"); };
    document.getElementById("export3D").onclick = () => { document.getElementById("modal").close(); exportSheet("3D"); };
    document.getElementById("exportJson").onclick = () => { document.getElementById("modal").close(); exportMissionJson(); };
  };
})();
