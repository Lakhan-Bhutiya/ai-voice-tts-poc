// Light-default theme with persisted dark toggle. Sets data-bs-theme on
// <html> so Bootstrap's own dark-mode variables flip alongside ours.

const STORAGE_KEY = "aivoice.theme";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-bs-theme", theme);
  const btn = document.getElementById("themeToggle");
  if (btn) {
    const icon = btn.querySelector("i");
    if (icon) icon.className = theme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
    btn.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }
  // Canvas pixels don't repaint themselves when CSS variables change, so
  // anything drawing to a <canvas> off our tokens needs to know to redraw.
  window.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
}

export function initTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  const theme = stored || "light";
  applyTheme(theme);

  const btn = document.getElementById("themeToggle");
  if (btn) {
    btn.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-bs-theme") === "dark" ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
    });
  }
}
