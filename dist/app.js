const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const catalog=[{id:'hab',name:'Habitat Ares',type:'Start / life support',time:0,x:240,y:520,detail:'Your home away from Earth. Suit checks and life-support resupply.'},{id:'ridge',name:'Lookout ridge',type:'Terrain survey',time:15,x:340,y:410,detail:'Survey the delta approach and document exposed rock layers.'},{id:'delta',name:'Delta outcrop',type:'Sediment sampling',time:25,x:475,y:320,detail:'Ancient sediments. New possibilities.'},{id:'basalt',name:'Basalt garden',type:'Rock composition',time:20,x:590,y:390,detail:'Compare volcanic rocks with nearby sedimentary deposits.'},{id:'clay',name:'Clay-bearing basin',type:'Mineral spectroscopy',time:30,x:420,y:190,detail:'Search for mineral signatures associated with ancient water.'},{id:'rim',name:'Crater overlook',type:'Panoramic imaging',time:20,x:700,y:470,detail:'Capture a panoramic record of the crater floor.'}];
let state={ids:['hab','ridge','delta','basalt'],mode:'balanced',selected:'delta',layers:['contours','hazards']};
try{const saved=JSON.parse(localStorage.getItem('ares-plan'));if(Array.isArray(saved?.custom)) catalog.push(...saved.custom.filter(p=>/^custom-[a-f0-9-]+$/.test(p.id)));if(saved&&Array.isArray(saved.ids)&&saved.ids.every(id=>catalog.some(p=>p.id===id))&&saved.ids[0]==='hab'&&['balanced','safe','science'].includes(saved.mode)&&Array.isArray(saved.layers))state={...state,...saved}}catch{}
let zoom=1;const ns='http://www.w3.org/2000/svg';
function svg(tag,attrs){const el=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));return el}
// Map layers present in the loaded data file; terrain.js fills this from the data inventory.
const availableLayers=new Set();
// Outputs a mission planner might show but that no layer of a raster file can supply.
const NOT_CALCULATED=[
  {output:'Traverse duration',requires:'a traverse speed model'},
  {output:'Oxygen reserve',requires:'an oxygen consumption model'},
  {output:'Surface conditions (temperature, wind, radiation, daylight)',requires:'time-stamped environmental measurements'},
  {output:'Science value',requires:'science scoring data'}
];
function routeSummaryText(){const s=typeof missionDemSummary!=="undefined"?missionDemSummary:null;return s?`Calculated route: ${(s.distanceM/1000).toFixed(2)} km, ${s.ascentM} m ascent, ${s.maxSlopeDeg}° maximum slope. Duration and oxygen use are not calculated because that data is not available.`:'Route not calculated. Click Calculate route to compute distance, ascent and slope from the elevation data.'}
function save(){try{localStorage.setItem('ares-plan',JSON.stringify(state))}catch{ $('.planner-foot').textContent='Storage unavailable • export to keep your plan'}}
function render(){const points=state.ids.map(id=>catalog.find(p=>p.id===id));$('#waypoints').innerHTML=points.map((p,i)=>`<div class="waypoint-row"><div class="waypoint ${state.selected===p.id?'active':''}" role="button" tabindex="0" data-id="${p.id}" aria-label="Inspect ${escapeWaypointText(p.name)}"><span class="number">${i===0?'⌂':String(i).padStart(2,'0')}</span><div><strong>${escapeWaypointText(p.name)}</strong><p>${escapeWaypointText(p.type)}</p></div><span class="duration">${i===0?'BASE':p.time+' min'}</span></div>${i ? `<button type="button" class="waypoint-delete" data-delete-waypoint="${p.id}" aria-label="Delete ${escapeWaypointText(p.name)}" title="Delete waypoint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg></button>` : ""}</div>`).join('');$('#stopCount').textContent=String(points.length).padStart(2,'0')+' STOPS';$('#pins').replaceChildren();points.forEach((p,i)=>{const g=svg('g',{class:'pin',role:'button',tabindex:0,'aria-label':p.name,'data-id':p.id,transform:`translate(${p.x} ${p.y})`});g.append(svg('circle',{r:24,fill:'#d4f394','fill-opacity':'.08'}));g.append(svg('circle',{r:13,fill:state.selected===p.id?'#d4f394':'#263322',stroke:'#d4f394','stroke-width':1.5}));const t=svg('text',{'text-anchor':'middle',y:4,fill:state.selected===p.id?'#24321b':'#d4f394','font-size':11,'font-family':'monospace'});t.textContent=i===0?'⌂':String(i).padStart(2,'0');g.append(t);const symbol=svg('g',{transform:`scale(1 ${700 / $("#terrain").viewBox.baseVal.height})`});symbol.append(...g.children);g.append(symbol);$('#pins').append(g)});const p=catalog.find(p=>p.id===state.selected)||points[0];$('#targetCard').innerHTML=`<button type="button" class="target-close" aria-label="Close waypoint details">&times;</button><div class="eyebrow">${p.id==='hab'?'MISSION BASE':'PLANNED STOP '+String(points.indexOf(p)).padStart(2,'0')}</div><h3>${escapeWaypointText(p.name)}</h3><p>${escapeWaypointText(p.detail)}</p><div><span class="dot"></span> ${escapeWaypointText(p.type)} <span>+ ${p.time} min planned</span></div>`;$$('[data-mode]').forEach(b=>b.classList.toggle('selected',b.dataset.mode===state.mode));$$('[data-layer]').forEach(b=>{const id=b.dataset.layer,available=availableLayers.has(id),active=available&&state.layers.includes(id);b.disabled=!available;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);const layer=document.getElementById(id);if(layer){layer.style.display=active?'':'none';layer.removeAttribute('hidden')}});if(typeof updateMissionLegend==='function')updateMissionLegend();$$('[data-id]').forEach(b=>{const select=()=>{state.selected=b.dataset.id;render();waypointCard.hidden=false;fitWaypointCard();save()};b.onclick=select;b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select()}}});save();if(typeof refreshMissionRouteDisplay==="function")refreshMissionRouteDisplay()}
// Layer buttons are created once the loaded files are known, so listen on their container.
$('#missionLayers').addEventListener('click',e=>{const b=e.target.closest('[data-layer]');if(!b||b.disabled)return;const id=b.dataset.layer;state.layers=state.layers.includes(id)?state.layers.filter(x=>x!==id):[...state.layers,id];render()});$$('[data-mode]').forEach(b=>b.onclick=()=>{state.mode=b.dataset.mode;render()});
function notify(message){$('#toast').textContent=message;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),3000)}
function modal(html){$('#modalContent').innerHTML=html;$('#modal').showModal()}$('.close').onclick=()=>$('#modal').close();$('#modal').onclick=e=>{if(e.target===$('#modal'))$('#modal').close()};
function briefing(){modal('<div class="eyebrow">ARES / MISSION 004</div><h2>Follow the water.<br>Find the story.</h2><p>Explore an ancient delta in Jezero Crater. Your crew will survey the terrain, sample sedimentary rocks, and compare mineral signatures that could reveal the history of water on Mars.</p><ol><li>Place and arrange your planned stops on the map.</li><li>Toggle the map layers the loaded data file contains.</li><li>Calculate a slope-limited route over the elevation data.</li><li>Preview your traverse and export your mission plan.</li></ol><p>Calculations use only the data in the loaded file. Anything the file does not contain, such as traverse speed, oxygen use or weather, is shown as not available rather than estimated. Routes are not validated navigation or astronaut-safety data.</p>')}
$('#briefing').onclick=briefing;$('#logNav').onclick=briefing;$('#about').onclick=briefing;
function add(){const available=catalog.filter(p=>!state.ids.includes(p.id));modal('<div class="eyebrow">EXPAND YOUR HORIZON</div><h2>Choose a science target</h2><p>Add a planned stop to your traverse. Recalculate the route afterwards to see its effect on distance, ascent and slope.</p>'+available.map(p=>`<button class="choice" data-add="${p.id}">${escapeWaypointText(p.name)} <span style="float:right">+${p.time} min →</span><br><small>${escapeWaypointText(p.type)}</small></button>`).join('')+(available.length?'':'<p>All science targets are in your plan.</p>')+'<button class="choice" id="resetRoute">Reset to the four-stop mission</button>');$$('[data-add]').forEach(b=>b.onclick=()=>{state.ids.push(b.dataset.add);state.selected=b.dataset.add;render();$('#modal').close();notify('Science target added to your traverse')});$('#resetRoute').onclick=()=>{state.ids=['hab','ridge','delta','basalt'];state.selected='delta';render();$('#modal').close()}}
$('#add').onclick=add;$('#scienceNav').onclick=add;
let panX = 0;
let panY = 0;

function updateMapTransform() {
  const map = $("#map");
  const frameHeight = $("#terrain").viewBox.baseVal.height;
  const fit = Math.min(map.clientWidth / 1000, map.clientHeight / frameHeight);
  const boundX = Math.max(0, (1000 * fit * zoom - map.clientWidth) / 2);
  const boundY = Math.max(0, (frameHeight * fit * zoom - map.clientHeight) / 2);
  panX = Math.max(-boundX, Math.min(panX, boundX));
  panY = Math.max(-boundY, Math.min(panY, boundY));
  $("#mapWorld").style.transform = `translate(${fit ? panX / fit : 0}px, ${fit ? panY / fit * 700 / frameHeight : 0}px) scale(${zoom})`;
  map.classList.toggle("map-zoomed", zoom > 1);
}

function setZoom(value) {
  zoom = Math.min(3, Math.max(1, value));
  updateMapTransform();
}

$("#zoomIn").onclick = () => setZoom(zoom + .2);
$("#zoomOut").onclick = () => setZoom(zoom - .2);
$("#resetMap").onclick = () => {
  panX = panY = 0;
  setZoom(1);
};
$('#sources').onclick=()=>modal('<div class="eyebrow">DATA TRANSPARENCY</div><h2>What the loaded file contains</h2><div class="data-inventory">'+$('#missionInventory').innerHTML+'</div><p>Explore primary mission resources:</p><ul><li><a href="https://mars.nasa.gov/mars2020/" target="_blank" rel="noopener">NASA Mars 2020 / Perseverance</a></li><li><a href="https://trek.nasa.gov/mars/" target="_blank" rel="noopener">NASA Mars Trek</a></li><li><a href="https://pds.nasa.gov/" target="_blank" rel="noopener">NASA Planetary Data System</a></li></ul>');
$('#export').onclick=()=>typeof openExportChooser==='function'?openExportChooser():exportMissionJson();
function exportMissionJson(){const loaded=typeof grid!=="undefined"&&grid?grid:null,plan={project:'ARES / Field Atlas',mission:'004',dataStatus:'Calculated only from the loaded data files — not validated for operational navigation',dataSource:loaded?.source??null,dataInventory:loaded?{files:loaded.files,layers:loaded.layers,elevation:loaded.elevation,routing:loaded.routing}:null,strategy:state.mode,waypoints:state.ids.map(id=>catalog.find(p=>p.id===id)),demRoute:typeof missionDemSummary==="undefined"?null:missionDemSummary,notCalculated:NOT_CALCULATED,layers:state.layers.filter(id=>availableLayers.has(id)),exportedAt:new Date().toISOString()};const url=URL.createObjectURL(new Blob([JSON.stringify(plan,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ares-mission-004.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Mission plan exported')};
$('#start').onclick=()=>{let step=0;const stops=[...state.ids,'hab'];function show(){const p=catalog.find(p=>p.id===stops[step]);state.selected=p.id;render();$('#modalContent').innerHTML=`<div class="eyebrow">MISSION PREVIEW • ${step+1} / ${stops.length}</div><h2>${step===stops.length-1?'Welcome home.':p.name}</h2><p>${step===stops.length-1?'Traverse complete. Samples secured and crew returned to Habitat Ares.':p.detail}</p><div class="preview-progress"><div style="width:${(step+1)/stops.length*100}%"></div></div><p>${step===stops.length-1?routeSummaryText():escapeWaypointText(p.type)+' • '+p.time+' minute planned activity.'}</p><button class="primary" id="next">${step===stops.length-1?'Finish preview':'Next waypoint →'}</button>`;$('#next').onclick=()=>{if(step===stops.length-1){$('#modal').close();notify('Mission preview complete')}else{step++;show()}}}$('#modal').showModal();show()};
const waypointCard = document.getElementById("targetCard");
const waypointMap = document.getElementById("map");
function escapeWaypointText(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function applyWaypointEdits() {
  for (const point of catalog) Object.assign(point, state.edits?.[point.id]);
}

function deleteWaypoint(id) {
  const index = state.ids.indexOf(id);
  if (index < 1) return;
  state.ids.splice(index, 1);
  if (id.startsWith("custom-")) {
    state.custom = (state.custom || []).filter(point => point.id !== id);
    const catalogIndex = catalog.findIndex(point => point.id === id);
    if (catalogIndex !== -1) catalog.splice(catalogIndex, 1);
    if (state.edits) delete state.edits[id];
  }
  state.selected = state.ids[Math.min(index, state.ids.length - 1)];
  render();
  notify("Waypoint removed");
}

function editWaypoint(id) {
  if (!id && (typeof grid === "undefined" || !grid)) {
    notify("Wait for the Jezero terrain to load before adding a custom stop.");
    return;
  }
  const point = catalog.find(entry => entry.id === id);
  const index = state.ids.indexOf(id);
  modal(`<h2>${point ? "Edit waypoint" : "Add custom waypoint"}</h2>
    <form class="waypoint-editor">
      <label>Name <input name="name" maxlength="60" required></label>
      <label>Activity <input name="activity" maxlength="60" required></label>
      <label>Minutes <input name="minutes" type="number" min="0" max="1440" required></label>
      <p>Drag its marker on the map to change its location.</p>
      <button class="primary">Save waypoint</button>
      ${index > 1 ? '<button type="button" class="quiet" data-step="-1">Move earlier</button>' : ''}
      ${index > 0 && index < state.ids.length - 1 ? '<button type="button" class="quiet" data-step="1">Move later</button>' : ''}
      ${index > 0 ? '<button type="button" class="quiet" id="removeWaypoint">Remove stop</button>' : ''}
    </form>`);
  const editor = $(".waypoint-editor");
  editor.elements.name.value = point?.name || "";
  editor.elements.activity.value = point?.type || "Science survey";
  editor.elements.minutes.value = point?.time ?? 15;
  editor.onsubmit = event => {
    event.preventDefault();
    const name = editor.elements.name.value.trim();
    const type = editor.elements.activity.value.trim();
    if (!name || !type) return;
    const edits = {name, type, time: editor.elements.minutes.valueAsNumber};
    if (point) {
      state.edits ||= {};
      state.edits[id] = {...state.edits[id], ...edits};
      Object.assign(point, edits);
    } else {
      const anchor = catalog.find(entry => entry.id === state.selected) || catalog[0];
      const custom = {id: "custom-" + crypto.randomUUID(), ...edits, detail: "Custom mission stop.",
        x: Math.min(999, anchor.x + 25), y: anchor.y};
      catalog.push(custom);
      (state.custom ||= []).push(custom);
      state.edits ||= {}; state.edits[custom.id] = {x: custom.x, y: custom.y};
      state.ids.push(custom.id);
      state.selected = custom.id;
    }
    $("#modal").close();
    render();
    waypointCard.hidden = false;
  };
  editor.querySelectorAll("[data-step]").forEach(button => {
    button.onclick = () => {
      const other = index + Number(button.dataset.step);
      [state.ids[index], state.ids[other]] = [state.ids[other], state.ids[index]];
      $("#modal").close();
      render();
    };
  });
  const remove = $("#removeWaypoint");
  if (remove) remove.onclick = () => {
    $("#modal").close();
    deleteWaypoint(id);
  };
}

$("#editWaypoint").onclick = () => editWaypoint(state.selected);
$("#waypoints").addEventListener("click", event => {
  const button = event.target.closest("[data-delete-waypoint]");
  if (!button) return;
  deleteWaypoint(button.dataset.deleteWaypoint);
  document.querySelector("#waypoints .waypoint.active")?.focus({preventScroll: true});
});
$("#customWaypoint").onclick = () => editWaypoint();

let pinDrag;
waypointMap.addEventListener("pointerdown", event => {
  const pin = event.target.closest(".pin");
  if (!pin || event.button !== 0 || pinDrag || typeof grid === "undefined" || !grid) return;
  pinDrag = {pin, pointer: event.pointerId, x: event.clientX, y: event.clientY};
  pin.setPointerCapture(event.pointerId);
});
waypointMap.addEventListener("pointermove", event => {
  if (pinDrag?.pointer !== event.pointerId) return;
  if (!pinDrag.position && Math.hypot(event.clientX - pinDrag.x, event.clientY - pinDrag.y) < 4) return;
  const inverse = $("#mapWorld").getScreenCTM()?.inverse();
  if (!inverse) return;
  const {x, y} = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
  pinDrag.position = {x: Math.max(0, Math.min(999.99, x)), y: Math.max(0, Math.min(699.99, y))};
  pinDrag.pin.classList.add("pin-dragging");
  pinDrag.pin.setAttribute("transform", `translate(${pinDrag.position.x} ${pinDrag.position.y})`);
});
function finishPinDrag(event) {
  if (pinDrag?.pointer !== event.pointerId) return;
  const {pin, position} = pinDrag;
  pinDrag = undefined;
  pin.classList.remove("pin-dragging");
  if (!position) return;
  const id = pin.dataset.id;
  const point = catalog.find(entry => entry.id === id);
  if (event.type === "pointerup") {
    state.edits ||= {};
    state.edits[id] = {...state.edits[id], ...position};
    Object.assign(point, position);
    state.selected = id;
    waypointCard.hidden = false;
  }
  render();
}
waypointMap.addEventListener("pointerup", finishPinDrag);
waypointMap.addEventListener("pointercancel", finishPinDrag);
waypointMap.addEventListener("lostpointercapture", finishPinDrag);
let waypointDrag;

function fitWaypointCard(left = waypointCard.offsetLeft, top = waypointCard.offsetTop) {
  if (!waypointCard.offsetWidth) return;
  waypointCard.style.left = Math.max(0, Math.min(left, waypointMap.clientWidth - waypointCard.offsetWidth)) + "px";
  waypointCard.style.top = Math.max(0, Math.min(top, waypointMap.clientHeight - waypointCard.offsetHeight)) + "px";
}

waypointCard.addEventListener("click", event => {
  if (!event.target.closest(".target-close")) return;
  waypointCard.hidden = true;
  document.querySelector(`.waypoint[data-id="${state.selected}"]`)?.focus({preventScroll: true});
});

waypointCard.addEventListener("pointerdown", event => {
  if (waypointDrag || event.button !== 0 || event.target.closest("button")) return;
  waypointDrag = {
    id: event.pointerId,
    x: event.clientX - waypointCard.offsetLeft,
    y: event.clientY - waypointCard.offsetTop
  };
  waypointCard.setPointerCapture(event.pointerId);
});
waypointCard.addEventListener("pointermove", event => {
  if (waypointDrag?.id === event.pointerId) {
    fitWaypointCard(event.clientX - waypointDrag.x, event.clientY - waypointDrag.y);
  }
});
waypointCard.addEventListener("lostpointercapture", () => { waypointDrag = undefined; });
new ResizeObserver(() => fitWaypointCard()).observe(waypointMap);

const mapPointers = new Map();
let lastTap;

function mapGesture() {
  const [first, second] = mapPointers.values();
  if (!second) return first;
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    span: Math.hypot(first.x - second.x, first.y - second.y)
  };
}

waypointMap.addEventListener("pointerdown", event => {
  if (event.button !== 0 || event.target.closest("button, .pin, .target-card")) return;
  mapPointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
  waypointMap.setPointerCapture(event.pointerId);
  if (event.pointerType !== "touch") return;
  if (mapPointers.size > 1) {
    lastTap = undefined;
    return;
  }
  if (lastTap && event.timeStamp - lastTap.time < 320 &&
      Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 28) {
    setZoom(zoom + .5);
    lastTap = undefined;
  } else {
    lastTap = {time: event.timeStamp, x: event.clientX, y: event.clientY};
  }
});

waypointMap.addEventListener("pointermove", event => {
  if (!mapPointers.has(event.pointerId)) return;
  const before = mapGesture();
  mapPointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
  const after = mapGesture();
  if (lastTap && Math.hypot(after.x - lastTap.x, after.y - lastTap.y) > 12) lastTap = undefined;
  if (before.span && after.span) zoom = Math.min(3, Math.max(1, zoom * after.span / before.span));
  if (zoom > 1) {
    panX += after.x - before.x;
    panY += after.y - before.y;
  }
  updateMapTransform();
});

waypointMap.addEventListener("lostpointercapture", event => mapPointers.delete(event.pointerId));
new ResizeObserver(updateMapTransform).observe(waypointMap);

const fullscreenButton = $("#fullscreenMap");
const missionFullscreenTools = document.createElement("div");
missionFullscreenTools.className = "dem-fullscreen-tools mission-fullscreen-tools";
missionFullscreenTools.hidden = true;
waypointMap.append(missionFullscreenTools);
const missionControls = [
  waypointMap.nextElementSibling,
  $("#calculateMission"),
  $("#stopMission").parentElement,
  $("#advisoryText").closest(".advisory")
];
const missionControlLocations = missionControls.map(control => {
  const placeholder = document.createComment("Mission control location");
  control.before(placeholder);
  return placeholder;
});

function syncMapFullscreen() {
  const expanded = document.fullscreenElement === waypointMap || waypointMap.classList.contains("map-expanded");
  fullscreenButton.setAttribute("aria-pressed", String(expanded));
  fullscreenButton.setAttribute("aria-label", expanded ? "Exit fullscreen map" : "Fullscreen map");
  fullscreenButton.title = expanded ? "Exit fullscreen (Esc)" : "Fullscreen map";
  if (expanded === !missionFullscreenTools.hidden) return;
  missionFullscreenTools.hidden = !expanded;
  missionControls.forEach((control, index) => {
    if (expanded) missionFullscreenTools.append(control);
    else missionControlLocations[index].after(control);
  });
}

fullscreenButton.onclick = async () => {
  if (document.fullscreenElement === waypointMap) {
    await document.exitFullscreen();
  } else if (waypointMap.classList.contains("map-expanded")) {
    waypointMap.classList.remove("map-expanded");
  } else {
    try {
      await waypointMap.requestFullscreen();
    } catch {
      waypointMap.classList.add("map-expanded");
    }
  }
  syncMapFullscreen();
};
document.addEventListener("fullscreenchange", syncMapFullscreen);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && waypointMap.classList.contains("map-expanded")) {
    waypointMap.classList.remove("map-expanded");
    syncMapFullscreen();
    fullscreenButton.focus({preventScroll: true});
  }
});
render();
