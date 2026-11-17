// Data files tab: choose GeoTIFFs, preview how they line up, and load them together.
(() => {
  const rows = document.getElementById("fileRows");
  const alignment = document.getElementById("alignment");
  const loadButton = document.getElementById("loadFiles");
  const buildStatus = document.getElementById("buildStatus");
  const fileStatus = document.getElementById("fileStatus");
  const loadedFiles = document.getElementById("loadedFiles");
  const upload = document.getElementById("fileUpload");
  const COLOURS = ["#d4f394", "#65b4ff", "#ff9b40", "#c58bff", "#6ee7c8", "#ff6f91"];
  let files = [];
  let selected = [];
  let loadedIds = new Set();
  let alignmentRequest;
  let showHidden = false;
  const toggleHidden = document.getElementById("toggleHidden");

  const escape = escapeWaypointText;

  function formatSize(bytes) {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  }

  function pixelText(file) {
    if (file.pixelSizeM) return `${+file.pixelSizeM[0].toFixed(2)} m`;
    if (file.nativePixelSize && file.crs && !file.projected) return `${+file.nativePixelSize[0].toPrecision(3)}° (not metres)`;
    if (file.nativePixelSize) return `${+file.nativePixelSize[0].toPrecision(3)} (not metres)`;
    return "—";
  }

  function contentsHtml(file) {
    if (!file.bands) return "—";
    const chips = file.bands.slice(0, 6).map(band =>
      `<span class="kind-chip kind-${band.kind}" title="Band ${band.band}: identified by ${escape(band.identifiedBy)}">${KIND_ICONS[band.kind]} ${KIND_LABELS[band.kind]}</span>`);
    if (file.bands.length > 6) chips.push(`<span class="kind-chip">+${file.bands.length - 6} more bands</span>`);
    return chips.join(" ");
  }

  function sameSelection(a, b) {
    return a.length === b.size && a.every(id => b.has(id));
  }

  function hideButton(file) {
    if (file.hidden) return `<br><button type="button" class="link-button" data-hide="${escape(file.id)}" data-hidden="false">Show in list</button>`;
    if (loadedIds.has(file.id)) return "";
    return `<br><button type="button" class="link-button" data-hide="${escape(file.id)}" data-hidden="true" title="Hide from this list. The file is not deleted.">Hide</button>`;
  }

  function renderRows() {
    const hiddenCount = files.filter(file => file.hidden).length;
    toggleHidden.hidden = !hiddenCount;
    toggleHidden.textContent = showHidden ? "Hide hidden files" : `Show hidden files (${hiddenCount})`;
    const visible = files.filter(file => showHidden || !file.hidden);
    if (!visible.length) {
      rows.innerHTML = `<tr><td colspan="6">${files.length ? "All files are hidden. Use Show hidden files." : "No .tif or .tiff files found in the project folder or data/. Use Browse computer… to add one."}</td></tr>`;
      return;
    }
    rows.innerHTML = visible.map(file => {
      const usable = file.readable && !file.error && !file.hidden;
      const status = file.hidden ? '<span class="muted">Hidden</span>'
        : !(file.readable && !file.error) ? `<span class="file-error">${escape(file.error || "Cannot be read")}</span>`
        : loadedIds.has(file.id) ? '<span class="file-loaded">Loaded</span>' : "Ready";
      return `<tr class="${usable ? "" : "unusable"}">
        <td><input type="checkbox" data-file="${escape(file.id)}" aria-label="Select ${escape(file.name)}"${selected.includes(file.id) ? " checked" : ""}${usable ? "" : " disabled"}></td>
        <td><b>${escape(file.name)}</b>${file.included ? ' <span class="included-badge" title="This file comes with the repository; no download needed.">Included with the repository</span>' : ""}<br><small>${escape(file.folder === "." ? "project folder" : file.folder)} · ${formatSize(file.sizeBytes)}</small></td>
        <td>${contentsHtml(file)}</td>
        <td>${file.width ? `${file.width} × ${file.height}` : "—"}</td>
        <td>${pixelText(file)}</td>
        <td>${status}${hideButton(file)}</td></tr>`;
    }).join("");
  }

  function footprintSvg(plan) {
    const shapes = plan.files.filter(file => file.footprint);
    const all = shapes.map(file => file.footprint).concat([plan.grid.bounds]);
    const left = Math.min(...all.map(b => b[0])), right = Math.max(...all.map(b => b[2]));
    const bottom = Math.min(...all.map(b => b[1])), top = Math.max(...all.map(b => b[3]));
    const pad = Math.max(right - left, top - bottom) * 0.04;
    const rect = ([x0, y0, x1, y1], attributes) =>
      `<rect x="${x0}" y="${-y1}" width="${x1 - x0}" height="${y1 - y0}" vector-effect="non-scaling-stroke" ${attributes}/>`;
    const fills = shapes.map(file => {
      const colour = COLOURS[plan.files.indexOf(file) % COLOURS.length];
      return rect(file.footprint, `fill="${colour}" fill-opacity="${file.role === "excluded" ? 0.05 : 0.14}" stroke="${colour}" stroke-width="2"${file.role === "excluded" ? ' stroke-dasharray="4 4"' : ""}`);
    }).join("");
    return `<svg class="footprints" viewBox="${left - pad} ${-top - pad} ${right - left + 2 * pad} ${top - bottom + 2 * pad}" role="img" aria-label="Footprints of the selected files on the reference grid">
      ${fills}${rect(plan.grid.bounds, 'fill="none" stroke="#f4f7ee" stroke-width="1.5" stroke-dasharray="6 4"')}</svg>`;
  }

  function alignmentHtml(plan) {
    const byId = Object.fromEntries(files.map(file => [file.id, file]));
    const included = plan.files.filter(file => file.role !== "excluded");
    const hasElevation = included.some(file => byId[file.id]?.bands?.some(band => band.kind === "elevation"));
    const reference = byId[plan.grid.reference];
    const table = plan.files.map((file, index) => {
      const role = {reference: "Reference grid", aligned: "Reprojected onto reference", excluded: "Not loaded"}[file.role];
      const coverage = file.coversPercent === undefined ? "—"
        : `outline covers ${file.coversPercent}% of the grid · ${file.insidePercent}% of the file is inside it`;
      return `<tr><td><i class="swatch" style="background:${COLOURS[index % COLOURS.length]}"></i></td><td><b>${escape(file.name)}</b></td>
        <td><span class="role role-${file.role}">${role}</span></td>
        <td>${file.nativePixelSizeM ? `${+file.nativePixelSizeM[0].toFixed(2)} m → ${+plan.grid.pixelSizeM[0].toFixed(2)} m` : "—"}</td>
        <td>${coverage}${file.reason ? `<br><span class="file-error">${escape(file.reason)}</span>` : ""}</td></tr>`;
    }).join("");
    const notes = [
      `Reference grid: <b>${escape(reference.name)}</b> (${reference.width} × ${reference.height} px${plan.grid.pixelSizeM ? `, ${+plan.grid.pixelSizeM[0].toFixed(2)} m pixels` : ""}). Other files are resampled onto this grid using their coordinates.`,
      hasElevation
        ? "Only elevation is used in route calculations. Every other layer is shown for reference only."
        : '<span class="file-error">No elevation in this selection: routes cannot be generated (not enough data). Layers can still be viewed.</span>'
    ];
    return `<div class="alignment-layout">${footprintSvg(plan)}<div>
      <p class="muted">Dashed white outline: reference grid. Coloured boxes: each file's footprint.</p>
      <table class="file-table compact"><thead><tr><th></th><th>File</th><th>Role</th><th>Pixel size</th><th>Overlap</th></tr></thead><tbody>${table}</tbody></table>
      ${notes.map(note => `<p>${note}</p>`).join("")}</div></div>`;
  }

  async function updateAlignment() {
    alignmentRequest?.abort();
    const alreadyLoaded = sameSelection(selected, loadedIds);
    loadButton.disabled = !selected.length || alreadyLoaded;
    buildStatus.textContent = alreadyLoaded ? "This selection is already loaded." : "";
    if (!selected.length) {
      alignment.innerHTML = '<p class="muted">Select files to preview how they line up.</p>';
      return;
    }
    const controller = new AbortController();
    alignmentRequest = controller;
    alignment.innerHTML = '<p class="muted">Checking alignment…</p>';
    try {
      const plan = await request("/api/alignment", {method: "POST", signal: controller.signal,
        headers: {"Content-Type": "application/json"}, body: JSON.stringify({files: selected})});
      alignment.innerHTML = alignmentHtml(plan);
    } catch (error) {
      if (!controller.signal.aborted) alignment.innerHTML = `<p class="file-error">${escape(error.message)}</p>`;
    }
  }

  function renderLoaded(meta) {
    if (!meta) {
      loadedFiles.innerHTML = '<p class="muted">Nothing loaded yet.</p>';
      return;
    }
    loadedFiles.innerHTML = `<ul class="loaded-list">${meta.files.map(file => {
      const uses = [];
      if (meta.elevation.fileId === file.id) {
        uses.push(meta.routing.available ? '<span class="use-routing">Elevation · used for route calculations</span>'
          : '<span class="file-error">Elevation · routing requirements not met</span>');
      }
      for (const layer of meta.layers.filter(entry => entry.fileId === file.id)) {
        uses.push(`<span class="use-shown">${KIND_LABELS[layer.kind]} · shown only, not used in route calculations</span>`);
      }
      return `<li><b>${escape(file.name)}</b> — ${escape(fileRoleText(file))}${uses.length ? "<br>" + uses.join("<br>") : ""}</li>`;
    }).join("")}</ul>`;
  }

  async function loadFileList() {
    fileStatus.textContent = "Reading files…";
    try {
      ({files} = await request("/api/files"));
      const known = new Set(files.filter(file => file.readable && !file.error && !file.hidden).map(file => file.id));
      selected = selected.filter(id => known.has(id));
      fileStatus.textContent = `${files.length} file${files.length === 1 ? "" : "s"} found`;
    } catch (error) {
      fileStatus.textContent = error.message;
    }
    renderRows();
    updateAlignment();
  }

  async function pollBuild() {
    const {build} = await request("/api/dataset");
    if (build.state === "building") {
      loadButton.disabled = true;
      buildStatus.textContent = `Step ${build.step} of ${build.total}: ${build.message}…`;
      setTimeout(() => pollBuild().catch(error => buildStatus.textContent = error.message), 700);
    } else if (build.state === "done") {
      buildStatus.textContent = "Files loaded. Reloading the map…";
      location.reload();
    } else if (build.state === "error") {
      buildStatus.textContent = `Loading failed: ${build.message}`;
      loadButton.disabled = false;
    }
  }

  rows.addEventListener("change", event => {
    const box = event.target.closest("[data-file]");
    if (!box) return;
    const id = box.dataset.file;
    selected = box.checked ? [...selected.filter(x => x !== id), id] : selected.filter(x => x !== id);
    updateAlignment();
  });

  loadButton.onclick = async () => {
    loadButton.disabled = true;
    buildStatus.textContent = "Starting…";
    try {
      await request("/api/dataset", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({files: selected})});
      await pollBuild();
    } catch (error) {
      buildStatus.textContent = error.message;
      loadButton.disabled = false;
    }
  };

  document.getElementById("refreshFiles").onclick = loadFileList;

  // Hiding only removes a file from this list; the file itself is never deleted.
  rows.addEventListener("click", async event => {
    const button = event.target.closest("[data-hide]");
    if (!button) return;
    const hide = button.dataset.hidden === "true";
    button.disabled = true;
    try {
      await request("/api/files/hide", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({file: button.dataset.hide, hidden: hide})});
      if (hide) selected = selected.filter(id => id !== button.dataset.hide);
      await loadFileList();
      fileStatus.textContent = hide ? `Hidden from the list (not deleted): ${button.dataset.hide}` : `Shown again: ${button.dataset.hide}`;
    } catch (error) {
      fileStatus.textContent = error.message;
      button.disabled = false;
    }
  });
  toggleHidden.onclick = () => {
    showHidden = !showHidden;
    renderRows();
  };

  function sendFile(file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/files/upload");
      xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) fileStatus.textContent = `Adding ${file.name}: ${Math.floor(100 * event.loaded / event.total)}%`;
      };
      xhr.onload = () => {
        const payload = JSON.parse(xhr.responseText || "{}");
        if (xhr.status === 201) resolve(payload);
        else reject(new Error(payload.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Upload failed: the server could not be reached."));
      xhr.send(file);
    });
  }

  upload.addEventListener("change", async () => {
    const chosen = [...upload.files];
    upload.value = "";
    const problems = [];
    for (const file of chosen) {
      try {
        const info = await sendFile(file);
        selected = [...selected, info.id];
      } catch (error) {
        problems.push(`${file.name}: ${error.message}`);
      }
    }
    await loadFileList();
    if (problems.length) fileStatus.textContent = problems.join(" · ");
    else if (chosen.length) fileStatus.textContent = `Added ${chosen.length} file${chosen.length === 1 ? "" : "s"} to data/. Review the alignment, then load.`;
  });

  request("/api/dataset").then(({meta, build}) => {
    if (meta) {
      loadedIds = new Set(meta.files.filter(file => file.role !== "excluded").map(file => file.id));
      selected = [...loadedIds];
    }
    renderLoaded(meta);
    if (build.state === "building") pollBuild();
  }).catch(error => loadedFiles.textContent = error.message).finally(loadFileList);
})();
