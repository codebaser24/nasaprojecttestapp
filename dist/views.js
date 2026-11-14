const views = [
  {tab: document.getElementById("mission-view"), panel: document.getElementById("mission-panel")},
  {tab: document.getElementById("dem-view"), panel: document.getElementById("dem-panel")},
  {tab: document.getElementById("files-view"), panel: document.getElementById("files-panel")}
];

function showView(panelId) {
  const active = views.find(view => view.panel.id === panelId) || views[0];
  for (const view of views) {
    const selected = view === active;
    view.panel.hidden = !selected;
    view.tab.setAttribute("aria-selected", String(selected));
    view.tab.tabIndex = selected ? 0 : -1;
  }
  document.getElementById("export").hidden = active.panel.id !== "mission-panel";
  if (location.hash.slice(1) !== active.panel.id) history.replaceState(null, "", "#" + active.panel.id);
  return active;
}

views.forEach(view => view.tab.onclick = () => showView(view.panel.id));
views[0].tab.parentElement.addEventListener("keydown", event => {
  const index = views.findIndex(view => view.tab === event.target);
  const next = {ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: views.length - 1}[event.key];
  if (next === undefined || index === -1) return;
  event.preventDefault();
  const target = views[(next + views.length) % views.length];
  showView(target.panel.id);
  target.tab.focus();
});
document.querySelector(".rail-button.active").onclick = () => showView("mission-panel");
document.getElementById("filesNav").onclick = () => showView("files-panel");
showView(location.hash.slice(1));
