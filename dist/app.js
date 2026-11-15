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
function render(){const points=state.ids.map(id=>catalog.find(p=>p.id===id));$('#waypoints').innerHTML=points.map((p,i)=>`<div class="waypoint-row"><div class="waypoint ${state.selected===p.id?'active':''}" role="button" tabindex="0" data-id="${p.id}" aria-label="Inspect ${escapeWaypointText(p.name)}"><span class="number">${i===0?'⌂':String(i).padStart(2,'0')}</span><div><strong>${escapeWaypointText(p.name)}</strong><p>${escapeWaypointText(p.type)}</p></div><span class="duration">${i===0?'BASE':p.time+' min'}</span></div>${i ? `<button type="button" class="waypoint-delete" data-delete-waypoint="${p.id}" aria-label="Delete ${escapeWaypointText(p.name)}" title="Delete waypoint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg></button>` : ""}</div>`).join('');$('#stopCount').textContent=String(points.length).padStart(2,'0')+' STOPS';$('#pins').replaceChildren();points.forEach((p,i)=>{const g=svg('g',{class:'pin',role:'button',tabindex:0,'aria-label':p.name,'data-id':p.id,transform:`translate(${p.x} ${p.y})`});g.append(svg('circle',{r:24,fill:'#d4f394','fill-opacity':'.08'}));g.append(svg('circle',{r:13,fill:state.selected===p.id?'#d4f394':'#263322',stroke:'#d4f394','stroke-width':1.5}));const t=svg('text',{'text-anchor':'middle',y:4,fill:state.selected===p.id?'#24321b':'#d4f394','font-size':11,'font-family':'monospace'});t.textContent=i===0?'⌂':String(i).padStart(2,'0');g.append(t);const symbol=svg('g',{transform:`scale(1 ${700 / $("#terrain").viewBox.baseVal.height})`});symbol.append(...g.children);g.append(symbol);$('#pins').append(g)});const p=catalog.find(p=>p.id===state.selected)||points[0];$('#targetCard').innerHTML=`<button type="button" class="target-close" aria-label="Close waypoint details">&times;</button><div class="eyebrow">${p.id==='hab'?'MISSION BASE':'PLANNED STOP '+String(points.indexOf(p)).padStart(2,'0')}</div><h3>${escapeWaypointText(p.name)}</h3><p>${escapeWaypointText(p.detail)}</p><div><span class="dot"></span> ${escapeWaypointText(p.type)} <span>+ ${p.time} min planned</span></div>`;$$('[data-mode]').forEach(b=>b.classList.toggle('selected',b.dataset.mode===state.mode));$$('[data-layer]').forEach(b=>{const id=b.dataset.layer,available=availableLayers.has(id),active=available&&state.layers.includes(id);b.disabled=!available;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);const layer=document.getElementById(id);if(layer){layer.style.display=active?'':'none';layer.removeAttribute('hidden')}});$$('[data-id]').forEach(b=>{const select=()=>{state.selected=b.dataset.id;render();waypointCard.hidden=false;fitWaypointCard();save()};b.onclick=select;b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select()}}});save();if(typeof refreshMissionRouteDisplay==="function")refreshMissionRouteDisplay()}
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
$('#export').onclick=()=>{const loaded=typeof grid!=="undefined"&&grid?grid:null,plan={project:'ARES / Field Atlas',mission:'004',dataStatus:'Calculated only from the loaded data files — not validated for operational navigation',dataSource:loaded?.source??null,dataInventory:loaded?{files:loaded.files,layers:loaded.layers,elevation:loaded.elevation,routing:loaded.routing}:null,strategy:state.mode,waypoints:state.ids.map(id=>catalog.find(p=>p.id===id)),demRoute:typeof missionDemSummary==="undefined"?null:missionDemSummary,notCalculated:NOT_CALCULATED,layers:state.layers.filter(id=>availableLayers.has(id)),exportedAt:new Date().toISOString()};const url=URL.createObjectURL(new Blob([JSON.stringify(plan,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ares-mission-004.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Mission plan exported')};
// ================= NASA-GRADE EVA ASTRONAUT TRAVERSE, LEG DISTANCE, VOICE & DEM TELEMETRY =================
let playbackAnimId = null;
let audioCtx = null;
let soundEnabled = true;

function speakMissionVoice(text) {
  if (!soundEnabled || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.02;
    utter.pitch = 0.96;
    utter.volume = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => /en-(US|GB)/i.test(v.lang) && /(Google|Microsoft|Samantha|Daniel|Alex)/i.test(v.name))
      || voices.find(v => /^en/i.test(v.lang));
    if (preferred) utter.voice = preferred;
    window.speechSynthesis.speak(utter);
  } catch (e) {}
}

function playMissionAudioEvent(type, stepIndex = 0, wpName = '') {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    const playNote = (freq, startOffset, duration, wave = 'sine', vol = 0.11) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(vol, now + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.02);
    };

    if (type === 'start') {
      playNote(440, 0.00, 0.12, 'triangle', 0.09);
      playNote(660, 0.10, 0.18, 'sine', 0.11);
      speakMissionVoice('Mission started.');
    } else if (type === 'waypoint') {
      const baseFreq = 523.25 + stepIndex * 50;
      playNote(baseFreq, 0.00, 0.12, 'sine', 0.10);
      playNote(baseFreq * 1.25, 0.10, 0.20, 'triangle', 0.11);
      speakMissionVoice(`${wpName}, complete.`);
    } else if (type === 'success') {
      playNote(523.25, 0.00, 0.18, 'triangle', 0.12);
      playNote(659.25, 0.14, 0.18, 'triangle', 0.12);
      playNote(783.99, 0.28, 0.20, 'triangle', 0.13);
      playNote(1046.50, 0.42, 0.55, 'sine', 0.15);
      speakMissionVoice('Mission success.');
    }
  } catch (e) {}
}

function showWaypointBanner(mapEl, code, wpName) {
  $('#evaWpToast')?.remove();
  const banner = document.createElement('div');
  banner.id = 'evaWpToast';
  banner.style.cssText = `
    position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
    z-index: 28; background: rgba(11, 15, 13, 0.95);
    border: 1px solid #d4f394; border-left: 4px solid #d4f394;
    border-radius: 8px; padding: 10px 18px; color: #f4f7f2;
    font-family: system-ui, -apple-system, sans-serif;
    box-shadow: 0 10px 28px rgba(0,0,0,0.65);
    display: flex; align-items: center; gap: 12px;
    transition: opacity 0.35s ease, transform 0.35s ease;
  `;
  banner.innerHTML = `
    <span style="background:#d4f394; color:#111513; font-family:monospace; font-weight:800; font-size:11px; padding:3px 7px; border-radius:4px;">EVA-${escapeWaypointText(code)}</span>
    <div>
      <div style="font-size:10px; font-family:monospace; color:#d4f394; letter-spacing:0.08em;">STATION OBJECTIVE COMPLETE</div>
      <div style="font-size:14px; font-weight:700;">${escapeWaypointText(wpName)}</div>
    </div>
  `;
  mapEl.append(banner);
  setTimeout(() => {
    banner.style.opacity = '0';
    banner.style.transform = 'translate(-50%, -8px)';
    setTimeout(() => banner.remove(), 380);
  }, 2400);
}

function showMissionCompleteModal(mapEl, statsData, onReplay) {
  $('#missionCompleteCard')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'missionCompleteCard';
  overlay.style.cssText = `
    position: absolute; inset: 0; z-index: 35;
    background: rgba(8, 11, 9, 0.80); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center; padding: 20px;
  `;

  overlay.innerHTML = `
    <div style="
      width: 100%; max-width: 450px;
      background: linear-gradient(165deg, #141c18 0%, #0b0f0d 100%);
      border: 1.5px solid #d4f394; border-radius: 14px;
      padding: 26px; color: #f4f7f2; text-align: center;
      box-shadow: 0 24px 60px rgba(0,0,0,0.88), 0 0 36px rgba(212,243,148,0.18);
      font-family: system-ui, -apple-system, sans-serif;
    ">
      <div style="display:inline-flex; align-items:center; gap:6px; background:rgba(212,243,148,0.14); border:1px solid rgba(212,243,148,0.42); color:#d4f394; padding:4px 12px; border-radius:999px; font-family:monospace; font-size:11px; font-weight:700; letter-spacing:0.1em; margin-bottom:12px;">
        ★ ARES / EVA-004 SURFACE TRAVERSE COMPLETE
      </div>
      <h2 style="margin:0 0 6px; font-size:28px; font-weight:800; letter-spacing:0.03em; color:#ffffff; text-transform:uppercase;">
        MISSION COMPLETE
      </h2>
      <p style="margin:0 0 18px; font-size:13px; color:#a8b5a5;">
        Crew EVA objectives verified. Astronaut safely returned to <strong style="color:#d4f394;">${escapeWaypointText(statsData.baseName)}</strong>.
      </p>

      <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px; text-align:left; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:14px; margin-bottom:20px;">
        <div>
          <div style="font-size:10px; font-family:monospace; color:#8b9689;">TOTAL EVA DISTANCE</div>
          <div style="font-size:17px; font-weight:700; font-family:monospace; color:#ffffff;">${statsData.distanceKm} km</div>
        </div>
        <div>
          <div style="font-size:10px; font-family:monospace; color:#8b9689;">CUMULATIVE ASCENT</div>
          <div style="font-size:17px; font-weight:700; font-family:monospace; color:#9ee8c0;">${statsData.ascentM} m</div>
        </div>
        <div>
          <div style="font-size:10px; font-family:monospace; color:#8b9689;">PEAK TERRAIN GRADE</div>
          <div style="font-size:17px; font-weight:700; font-family:monospace; color:#f0b85b;">${statsData.maxSlopeDeg}°</div>
        </div>
        <div>
          <div style="font-size:10px; font-family:monospace; color:#8b9689;">STATIONS SURVEYED</div>
          <div style="font-size:17px; font-weight:700; font-family:monospace; color:#d4f394;">${statsData.stopsCleared} / ${statsData.stopsCleared}</div>
        </div>
      </div>

      <div style="display:flex; gap:10px; justify-content:center;">
        <button type="button" id="mcReplayBtn" style="flex:1; background:#d4f394; color:#111513; border:none; border-radius:8px; padding:10px 14px; font-weight:700; font-size:13px; cursor:pointer;">
          ↻ Replay EVA
        </button>
        <button type="button" id="mcCloseBtn" style="flex:1; background:#1c2420; color:#e6ebe3; border:1px solid #38423b; border-radius:8px; padding:10px 14px; font-weight:600; font-size:13px; cursor:pointer;">
          ✓ Close & Return
        </button>
      </div>
    </div>
  `;

  mapEl.append(overlay);
  $('#mcReplayBtn').onclick = () => {
    overlay.remove();
    onReplay();
  };
  $('#mcCloseBtn').onclick = () => {
    stopEvaPlayback();
  };
}

$('#start').onclick = () => {
  const routeLine = $('#routeLine');
  const getLivePoints = () => state.ids.map(id => catalog.find(p => p.id === id)).filter(Boolean);
  const points = getLivePoints();
  if (points.length < 2) {
    notify('Add at least 2 waypoints to start EVA traverse simulation');
    return;
  }

  // Sequential closed EVA loop: BASE (0) -> 01 -> 02 -> 03 -> BASE (⌂)
  const loopStops = [...points, points[0]];
  let pathD = routeLine.getAttribute('d');
  if (!pathD || pathD.trim() === '') {
    pathD = loopStops.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
    routeLine.setAttribute('d', pathD);
  }

  stopEvaPlayback();

  const mapEl = $('#map');
  const mapWorld = $('#mapWorld');
  const totalLen = routeLine.getTotalLength();
  if (!totalLen) return;

  routeLine.style.opacity = '0';

  const stopMilestones = [];
  let searchStart = 0;
  loopStops.forEach((pt, idx) => {
    if (idx === 0) {
      stopMilestones.push({ index: 0, id: pt.id, code: 'BASE', dist: 0, triggered: true });
      return;
    }
    if (idx === loopStops.length - 1) {
      stopMilestones.push({ index: idx, id: pt.id, code: '⌂', isReturn: true, dist: totalLen, triggered: false });
      return;
    }
    let bestDist = searchStart;
    let minD = Infinity;
    const step = Math.max(1, totalLen / 700);
    for (let d = searchStart; d <= totalLen; d += step) {
      const pOnLine = routeLine.getPointAtLength(d);
      const distToPin = Math.hypot(pOnLine.x - pt.x, pOnLine.y - pt.y);
      if (distToPin < minD) {
        minD = distToPin;
        bestDist = d;
      }
    }
    searchStart = bestDist;
    stopMilestones.push({
      index: idx,
      id: pt.id,
      code: String(idx).padStart(2, '0'),
      dist: bestDist,
      triggered: false
    });
  });

  const getStopName = (milestone) => {
    const livePt = catalog.find(p => p.id === milestone.id);
    const baseName = livePt ? livePt.name : 'Waypoint';
    return milestone.isReturn ? `${baseName} (Airlock Return)` : baseName;
  };

  // 1A. REMAINING EVA ROUTE (Upcoming path in Cyan-Blue Dashed Line)
  const remainingTrack = svg('path', {
    id: 'evaRemainingTrack',
    d: pathD,
    fill: 'none',
    stroke: '#38bdf8',
    'stroke-opacity': '0.88',
    'stroke-width': '3',
    'stroke-dasharray': '7 6',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round'
  });

  // 1B. COMPLETED EVA ROUTE (Traversed path in Vibrant Emerald Green Solid Line)
  const routeCasing = svg('path', {
    id: 'evaRouteCasing',
    d: pathD,
    fill: 'none',
    stroke: '#09120c',
    'stroke-width': '7.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'stroke-dasharray': totalLen,
    'stroke-dashoffset': totalLen
  });

  const completedTrack = svg('path', {
    id: 'evaCompletedTrack',
    d: pathD,
    fill: 'none',
    stroke: '#22c55e',
    'stroke-width': '4.2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'stroke-dasharray': totalLen,
    'stroke-dashoffset': totalLen
  });

  routeLine.after(remainingTrack, routeCasing, completedTrack);

  // 2. NASA 3D ISOMETRIC EVA ASTRONAUT SYMBOL
  const astroGroup = svg('g', { id: 'evaAstronautMarker' });

  const bioRingOuter = svg('circle', {
    id: 'evaBioPulse',
    r: '26',
    fill: '#d4f394',
    'fill-opacity': '0.14',
    stroke: '#d4f394',
    'stroke-opacity': '0.6',
    'stroke-width': '1.2'
  });
  const groundShadow = svg('ellipse', {
    cx: '4',
    cy: '7',
    rx: '11',
    ry: '13',
    fill: '#000000',
    'fill-opacity': '0.55'
  });
  const headlampCone = svg('polygon', {
    points: '0,-12 -14,-44 14,-44',
    fill: '#d4f394',
    'fill-opacity': '0.26'
  });
  const leftBoot = svg('rect', {
    id: 'evaLeftBoot',
    x: '-7',
    y: '4',
    width: '5',
    height: '8',
    rx: '2.2',
    fill: '#9aa698',
    stroke: '#111513',
    'stroke-width': '1.2'
  });
  const rightBoot = svg('rect', {
    id: 'evaRightBoot',
    x: '2',
    y: '4',
    width: '5',
    height: '8',
    rx: '2.2',
    fill: '#9aa698',
    stroke: '#111513',
    'stroke-width': '1.2'
  });
  const leftArm = svg('rect', {
    id: 'evaLeftArm',
    x: '-12.5',
    y: '-5',
    width: '4.5',
    height: '10',
    rx: '2.2',
    fill: '#e6ebe3',
    stroke: '#111513',
    'stroke-width': '1.2'
  });
  const rightArm = svg('rect', {
    id: 'evaRightArm',
    x: '8',
    y: '-5',
    width: '4.5',
    height: '10',
    rx: '2.2',
    fill: '#e6ebe3',
    stroke: '#111513',
    'stroke-width': '1.2'
  });
  const plssPack = svg('rect', {
    x: '-7.5',
    y: '1',
    width: '15',
    height: '8',
    rx: '2',
    fill: '#cbd5cb',
    stroke: '#111513',
    'stroke-width': '1.3'
  });
  const plssStatusLed = svg('circle', {
    cx: '0',
    cy: '5',
    r: '1.8',
    fill: '#38bdf8'
  });
  const commsAntenna = svg('line', {
    x1: '5.5',
    y1: '4',
    x2: '9',
    y2: '12',
    stroke: '#d4f394',
    'stroke-width': '1.4',
    'stroke-linecap': 'round'
  });
  const suitTorso = svg('rect', {
    x: '-9',
    y: '-7',
    width: '18',
    height: '11',
    rx: '5',
    fill: '#ffffff',
    stroke: '#111513',
    'stroke-width': '1.4'
  });
  const chestDcm = svg('rect', {
    x: '-4',
    y: '-6.5',
    width: '8',
    height: '3.5',
    rx: '1',
    fill: '#263322',
    stroke: '#d4f394',
    'stroke-width': '0.8'
  });
  const helmetShell = svg('circle', {
    cx: '0',
    cy: '-6',
    r: '7.2',
    fill: '#ffffff',
    stroke: '#111513',
    'stroke-width': '1.4'
  });
  const goldVisor = svg('path', {
    d: 'M -5.4 -7.5 A 5.8 5.8 0 0 1 5.4 -7.5 L 4.2 -10.8 A 5.2 5.2 0 0 0 -4.2 -10.8 Z',
    fill: '#f59e0b',
    stroke: '#78350f',
    'stroke-width': '0.8'
  });
  const visorGlint = svg('line', {
    x1: '-2.5',
    y1: '-10.2',
    x2: '1.5',
    y2: '-10.6',
    stroke: '#fef3c7',
    'stroke-width': '1.1',
    'stroke-linecap': 'round'
  });

  astroGroup.append(
    bioRingOuter,
    groundShadow,
    headlampCone,
    leftBoot,
    rightBoot,
    leftArm,
    rightArm,
    commsAntenna,
    plssPack,
    plssStatusLed,
    suitTorso,
    chestDcm,
    helmetShell,
    goldVisor,
    visorGlint
  );
  mapWorld.append(astroGroup);

  // 3. NASA EVA CREW TELEMETRY HUD
  const hud = document.createElement('div');
  hud.id = 'evaTelemetryHud';
  hud.style.cssText = `
    position: absolute; bottom: 14px; left: 14px; right: 14px; z-index: 25;
    background: rgba(11, 15, 13, 0.96); border: 1px solid rgba(212, 243, 148, 0.45);
    border-radius: 10px; padding: 12px 16px; color: #f2f5f0;
    font-family: system-ui, -apple-system, sans-serif; box-shadow: 0 12px 32px rgba(0,0,0,0.75);
    backdrop-filter: blur(10px); display: flex; flex-direction: column; gap: 10px;
  `;

  hud.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <span style="width:8px; height:8px; border-radius:50%; background:#22c55e; display:inline-block;"></span>
        <strong style="font-size:12px; letter-spacing:0.06em; color:#d4f394; font-family:monospace;">EVA-01 CREW TELEMETRY</strong>
        <span id="hudLegBadge" style="background:rgba(212,243,148,0.14); border:1px solid rgba(212,243,148,0.35); color:#d4f394; padding:2px 8px; border-radius:4px; font-size:11px; font-family:monospace;">BASE → 01</span>
        <span id="hudStatusText" style="font-size:12px; color:#c8d1c5;">Exiting Habitat Airlock...</span>
      </div>
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <div style="display:flex; align-items:center; gap:8px; font-size:10px; font-family:monospace; color:#9aa698; margin-right:4px;">
          <span><i style="display:inline-block;width:12px;height:3.5px;background:#22c55e;vertical-align:middle;margin-right:4px;"></i>COMPLETED</span>
          <span><i style="display:inline-block;width:12px;height:2px;border-top:2px dashed #38bdf8;vertical-align:middle;margin-right:4px;"></i>REMAINING</span>
        </div>
        <button type="button" id="hudAudio" title="Toggle Voice & Audio" style="background:#1e2621; color:#d4f394; border:1px solid #38423b; border-radius:5px; padding:4px 8px; font-size:11px; cursor:pointer;">🔊 Voice</button>
        <button type="button" id="hudPlayPause" style="background:#d4f394; color:#111513; border:none; border-radius:5px; padding:4px 10px; font-weight:700; font-size:11px; cursor:pointer;">⏸ Pause</button>
        <button type="button" id="hudSpeed" style="background:#1e2621; color:#e6ebe3; border:1px solid #38423b; border-radius:5px; padding:4px 8px; font-family:monospace; font-size:11px; cursor:pointer;">1x</button>
        <button type="button" id="hudStop" style="background:#2b1b1b; color:#f2a2a2; border:1px solid #592e2e; border-radius:5px; padding:4px 10px; font-weight:600; font-size:11px; cursor:pointer;">✕ End</button>
      </div>
    </div>

    <div style="display:grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap:8px; background:rgba(255,255,255,0.03); padding:8px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.07);">
      <div>
        <div style="font-size:9px; color:#8b9689; font-family:monospace;">AREOCENTRIC POS</div>
        <strong id="hudCoords" style="font-size:12px; font-family:monospace;">18.470°N, 77.400°E</strong>
      </div>
      <div>
        <div style="font-size:9px; color:#8b9689; font-family:monospace;">DEM ELEVATION</div>
        <strong id="hudElev" style="font-size:12px; font-family:monospace;">-2540 m</strong>
      </div>
      <div>
        <div style="font-size:9px; color:#8b9689; font-family:monospace;">TERRAIN SLOPE</div>
        <strong id="hudSlope" style="font-size:12px; font-family:monospace;">0.0°</strong>
      </div>
      <div>
        <div style="font-size:9px; color:#8b9689; font-family:monospace;">CUMULATIVE ASCENT</div>
        <strong id="hudAscent" style="font-size:12px; font-family:monospace; color:#9ee8c0;">0 m</strong>
      </div>
      <div>
        <div id="hudDistLabel" style="font-size:9px; color:#8b9689; font-family:monospace;">LEG DIST (BASE → 01)</div>
        <strong id="hudDist" style="font-size:12px; font-family:monospace; color:#38bdf8;">0.00 / 0.80 km</strong>
      </div>
    </div>

    <div style="display:flex; align-items:center; gap:10px;">
      <input type="range" id="hudScrubber" min="0" max="1000" value="0" style="flex:1; accent-color:#22c55e; cursor:pointer; height:4px;">
      <span id="hudPercent" style="font-size:11px; font-family:monospace; color:#d4f394; min-width:36px; text-align:right;">0%</span>
    </div>
  `;
  mapEl.append(hud);

  // 4. TRUE DEM ELEVATION & EXACT SLOPE ENGINE
  const hasDemGrid = typeof grid !== 'undefined' && grid && grid.width && grid.height;
  const demArray = hasDemGrid ? (grid.values || grid.heights || grid.data || grid.elevationData || null) : null;
  const frameH = $("#terrain")?.viewBox?.baseVal?.height || 700;
  const minElev = hasDemGrid && grid.minimum != null ? grid.minimum : -2580;
  const maxElev = hasDemGrid && grid.maximum != null ? grid.maximum : -2410;
  const cellMeters = hasDemGrid && grid.cellSizeMeters ? grid.cellSizeMeters : 20;

  let fallbackPixelData = null;
  if (!demArray && typeof base !== 'undefined' && base?.complete && base.naturalWidth) {
    const sc = document.createElement('canvas');
    sc.width = hasDemGrid ? grid.width : 250;
    sc.height = hasDemGrid ? grid.height : 175;
    const sctx = sc.getContext('2d');
    sctx.drawImage(base, 0, 0, sc.width, sc.height);
    fallbackPixelData = { data: sctx.getImageData(0, 0, sc.width, sc.height).data, w: sc.width, h: sc.height };
  }

  function getTrueDemElevation(svgX, svgY) {
    if (hasDemGrid && demArray && demArray.length >= grid.width * grid.height) {
      const gx = Math.max(0, Math.min(grid.width - 1.001, (svgX / 1000) * grid.width));
      const gy = Math.max(0, Math.min(grid.height - 1.001, (svgY / frameH) * grid.height));
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const x1 = Math.min(grid.width - 1, x0 + 1), y1 = Math.min(grid.height - 1, y0 + 1);
      const tx = gx - x0, ty = gy - y0;

      const valAt = (cx, cy) => {
        const v = demArray[cy * grid.width + cx];
        return Number.isFinite(v) ? v : minElev;
      };

      const z00 = valAt(x0, y0), z10 = valAt(x1, y0);
      const z01 = valAt(x0, y1), z11 = valAt(x1, y1);
      return (z00 * (1 - tx) + z10 * tx) * (1 - ty) + (z01 * (1 - tx) + z11 * tx) * ty;
    }

    if (fallbackPixelData) {
      const { data, w, h } = fallbackPixelData;
      const fx = Math.max(0, Math.min(w - 1.001, (svgX / 1000) * w));
      const fy = Math.max(0, Math.min(h - 1.001, (svgY / frameH) * h));
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const lumAt = (px, py) => {
        const idx = (py * w + px) * 4;
        return (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
      };
      const lum = (lumAt(x0, y0) * (1 - tx) + lumAt(x1, y0) * tx) * (1 - ty) + (lumAt(x0, y1) * (1 - tx) + lumAt(x1, y1) * tx) * ty;
      return minElev + lum * (maxElev - minElev);
    }

    return -2520 + Math.sin(svgX * 0.02) * 35;
  }

  function getAccurateSlopeDeg(svgX, svgY, distAlong) {
    const gw = hasDemGrid ? grid.width : 250;
    const gh = hasDemGrid ? grid.height : 175;
    const stepSvgX = 1000 / gw;
    const stepSvgY = frameH / gh;

    const zL = getTrueDemElevation(svgX - stepSvgX, svgY);
    const zR = getTrueDemElevation(svgX + stepSvgX, svgY);
    const zU = getTrueDemElevation(svgX, svgY - stepSvgY);
    const zD = getTrueDemElevation(svgX, svgY + stepSvgY);

    const dzdx = (zR - zL) / (2 * cellMeters);
    const dzdy = (zD - zU) / (2 * cellMeters);
    const surfaceSlopeDeg = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);

    const pPrev = routeLine.getPointAtLength(Math.max(0, distAlong - stepSvgX));
    const pNext = routeLine.getPointAtLength(Math.min(totalLen, distAlong + stepSvgX));
    const dxMeters = ((pNext.x - pPrev.x) / 1000) * (gw * cellMeters);
    const dyMeters = ((pNext.y - pPrev.y) / frameH) * (gh * cellMeters);
    const horizDist = Math.hypot(dxMeters, dyMeters);
    let pathSlopeDeg = 0;
    if (horizDist > 0.5) {
      const dzPath = Math.abs(getTrueDemElevation(pNext.x, pNext.y) - getTrueDemElevation(pPrev.x, pPrev.y));
      pathSlopeDeg = Math.atan(dzPath / horizDist) * (180 / Math.PI);
    }

    const finalSlope = Math.max(surfaceSlopeDeg, pathSlopeDeg);
    return Number.isFinite(finalSlope) ? Math.min(45, finalSlope) : 0;
  }

  // 5. Playback State & Astronaut Gait Animation Loop
  const hasDem = typeof missionDemSummary !== 'undefined' && missionDemSummary;
  const totalKm = hasDem ? missionDemSummary.distanceM / 1000 : 2.40;
  const totalAscentM = hasDem ? missionDemSummary.ascentM : 85;
  const maxRouteSlope = hasDem ? missionDemSummary.maxSlopeDeg : 12.0;

  let progress = 0;
  let isPaused = false;
  let speedMult = 1;
  let lastTime = performance.now();
  let successPlayed = false;
  let observedMaxSlope = 0;

  const playPauseBtn = $('#hudPlayPause');
  const speedBtn = $('#hudSpeed');
  const stopBtn = $('#hudStop');
  const audioBtn = $('#hudAudio');
  const scrubber = $('#hudScrubber');

  audioBtn.onclick = () => {
    soundEnabled = !soundEnabled;
    if (!soundEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    audioBtn.textContent = soundEnabled ? '🔊 Voice' : '🔇 Muted';
    audioBtn.style.color = soundEnabled ? '#d4f394' : '#8b9689';
  };

  function restartMissionPlayback() {
    $('#missionCompleteCard')?.remove();
    progress = 0;
    successPlayed = false;
    observedMaxSlope = 0;
    stopMilestones.forEach((m, i) => { m.triggered = (i === 0); });
    isPaused = false;
    playPauseBtn.textContent = '⏸ Pause';
    playMissionAudioEvent('start');
    updateAstronautFrame(0, false, performance.now());
  }

  playPauseBtn.onclick = () => {
    if (progress >= 1) {
      restartMissionPlayback();
      return;
    }
    isPaused = !isPaused;
    playPauseBtn.textContent = isPaused ? '▶ Play' : '⏸ Pause';
  };

  speedBtn.onclick = () => {
    speedMult = speedMult === 1 ? 2 : speedMult === 2 ? 5 : 1;
    speedBtn.textContent = `${speedMult}x`;
  };

  stopBtn.onclick = stopEvaPlayback;

  scrubber.oninput = () => {
    $('#missionCompleteCard')?.remove();
    progress = Number(scrubber.value) / 1000;
    successPlayed = progress >= 1;
    updateAstronautFrame(progress, false, performance.now());
  };

  function updateAstronautFrame(t, allowAudio = true, nowMs = performance.now()) {
    const distAlong = t * totalLen;
    const pt = routeLine.getPointAtLength(distAlong);
    const ptAhead = routeLine.getPointAtLength(Math.min(totalLen, distAlong + 3));
    const angle = Math.atan2(ptAhead.y - pt.y, ptAhead.x - pt.x) * (180 / Math.PI) + 90;

    // Astronaut Gait Stride & Bio-Telemetry Pulse
    const stride = (!isPaused && t < 0.998) ? Math.sin(distAlong * 0.42) : 0;
    const bobOffset = Math.abs(stride) * 0.8;
    leftBoot.setAttribute('y', (4 + stride * 3.5).toFixed(1));
    rightBoot.setAttribute('y', (4 - stride * 3.5).toFixed(1));
    leftArm.setAttribute('y', (-5 - stride * 2.5).toFixed(1));
    rightArm.setAttribute('y', (-5 + stride * 2.5).toFixed(1));

    const pulseRadius = 24 + Math.sin(nowMs * 0.005) * 4;
    bioRingOuter.setAttribute('r', pulseRadius.toFixed(1));

    astroGroup.setAttribute(
      'transform',
      `translate(${pt.x.toFixed(1)} ${(pt.y - bobOffset).toFixed(1)}) rotate(${angle.toFixed(1)})`
    );

    const dashOffset = (totalLen * (1 - t)).toFixed(1);
    routeCasing.setAttribute('stroke-dashoffset', dashOffset);
    completedTrack.setAttribute('stroke-dashoffset', dashOffset);

    const lat = (18.42 + (1 - pt.y / frameH) * 0.10).toFixed(3);
    const lon = (77.34 + (pt.x / 1000) * 0.12).toFixed(3);
    const curElev = getTrueDemElevation(pt.x, pt.y);
    const slopeDeg = getAccurateSlopeDeg(pt.x, pt.y, distAlong);
    if (slopeDeg > observedMaxSlope) observedMaxSlope = slopeDeg;

    const curAscent = Math.round(t * totalAscentM);

    $('#hudCoords').textContent = `${lat}°N, ${lon}°E`;
    $('#hudElev').textContent = `${Math.round(curElev)} m`;

    const slopeEl = $('#hudSlope');
    slopeEl.textContent = `${slopeDeg.toFixed(1)}°`;
    slopeEl.style.color = slopeDeg > 15 ? '#f27979' : slopeDeg > 9 ? '#f0b85b' : '#f2f5f0';

    $('#hudAscent').textContent = `${curAscent} / ${Math.round(totalAscentM)} m`;
    $('#hudPercent').textContent = `${Math.round(t * 100)}%`;
    scrubber.value = Math.round(t * 1000);

    let activeLegIdx = 0;
    for (let i = 0; i < stopMilestones.length - 1; i++) {
      if (distAlong >= stopMilestones[i].dist) {
        activeLegIdx = i;
      }
      if (allowAudio && i > 0 && !stopMilestones[i].triggered && distAlong >= stopMilestones[i].dist) {
        stopMilestones[i].triggered = true;
        const currentWpName = getStopName(stopMilestones[i]);
        playMissionAudioEvent('waypoint', i, currentWpName);
        showWaypointBanner(mapEl, stopMilestones[i].code, currentWpName);
        state.selected = stopMilestones[i].id || state.selected;
        $$('#waypoints .waypoint').forEach(el => el.classList.toggle('active', el.dataset.id === state.selected));
      }
    }

    const fromStop = stopMilestones[activeLegIdx];
    const toStop = stopMilestones[Math.min(stopMilestones.length - 1, activeLegIdx + 1)];
    const targetName = getStopName(toStop);

    // Calculate current segment (leg) distance between fromStop and toStop
    const legSvgSpan = Math.max(0.001, toStop.dist - fromStop.dist);
    const legTraveledSvg = Math.max(0, Math.min(legSvgSpan, distAlong - fromStop.dist));
    const legTotalKm = (legSvgSpan / totalLen) * totalKm;
    const legTraveledKm = (legTraveledSvg / totalLen) * totalKm;

    $('#hudDistLabel').textContent = `LEG DIST (${fromStop.code} → ${toStop.code})`;
    $('#hudDist').textContent = `${legTraveledKm.toFixed(2)} / ${legTotalKm.toFixed(2)} km`;

    if (t >= 0.998) {
      const baseName = getStopName(stopMilestones[0]);
      $('#hudLegBadge').textContent = 'COMPLETE (BASE → ⌂)';
      $('#hudLegBadge').style.background = 'rgba(34, 197, 94, 0.25)';
      $('#hudDistLabel').textContent = 'TOTAL TRAVERSE';
      $('#hudDist').textContent = `${totalKm.toFixed(2)} / ${totalKm.toFixed(2)} km`;
      $('#hudStatusText').innerHTML = `<strong style="color:#d4f394;">✓ MISSION SUCCESS</strong> • Airlock ingress at ${escapeWaypointText(baseName)}.`;
      if (allowAudio && !successPlayed) {
        successPlayed = true;
        playMissionAudioEvent('success');
        showMissionCompleteModal(mapEl, {
          baseName,
          distanceKm: totalKm.toFixed(2),
          ascentM: Math.round(totalAscentM),
          maxSlopeDeg: (hasDem ? maxRouteSlope : observedMaxSlope).toFixed(1),
          stopsCleared: points.length - 1
        }, restartMissionPlayback);
      }
    } else {
      $('#hudLegBadge').textContent = `${fromStop.code} → ${toStop.code}`;
      $('#hudStatusText').textContent = `EVA Traverse to ${targetName}`;
    }
  }

  function animate(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    if (!isPaused && progress < 1) {
      progress = Math.min(1, progress + (dt / 22) * speedMult);
      updateAstronautFrame(progress, true, now);

      if (progress >= 1) {
        isPaused = true;
        playPauseBtn.textContent = '↻ Replay';
      }
    } else if (isPaused && progress < 1) {
      const pulseRadius = 24 + Math.sin(now * 0.005) * 4;
      bioRingOuter.setAttribute('r', pulseRadius.toFixed(1));
    }
    playbackAnimId = requestAnimationFrame(animate);
  }

  playMissionAudioEvent('start');
  updateAstronautFrame(0, false, performance.now());
  playbackAnimId = requestAnimationFrame(animate);
};

function stopEvaPlayback() {
  if (playbackAnimId) {
    cancelAnimationFrame(playbackAnimId);
    playbackAnimId = null;
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  const routeLine = $('#routeLine');
  if (routeLine) routeLine.style.opacity = '1';
  $('#evaAstronautMarker')?.remove();
  $('#evaRemainingTrack')?.remove();
  $('#evaRouteCasing')?.remove();
  $('#evaCompletedTrack')?.remove();
  $('#evaTelemetryHud')?.remove();
  $('#evaWpToast')?.remove();
  $('#missionCompleteCard')?.remove();
}
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
