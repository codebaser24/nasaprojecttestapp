const missionView = document.getElementById("mission-view");
const demView = document.getElementById("dem-view");
const missionPanel = document.getElementById("mission-panel");
const demPanel = document.getElementById("dem-panel");

function showView(useDem) {
  missionPanel.hidden = useDem;
  demPanel.hidden = !useDem;
  document.getElementById("export").hidden = useDem;
  missionView.setAttribute("aria-selected", String(!useDem));
  demView.setAttribute("aria-selected", String(useDem));
  missionView.tabIndex = useDem ? -1 : 0;
  demView.tabIndex = useDem ? 0 : -1;
}

missionView.onclick = () => showView(false);
demView.onclick = () => showView(true);
missionView.parentElement.addEventListener("keydown", event => {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const useDem = event.key === "End" || (event.key !== "Home" && event.target === missionView);
  showView(useDem);
  (useDem ? demView : missionView).focus();
});
document.querySelector(".rail-button.active").onclick = () => showView(false);
showView(location.hash === "#dem-panel");
