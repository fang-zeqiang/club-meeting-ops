export const THEME_STORAGE_KEY = "club-meeting-ops.theme";

const THEMES = new Set(["blue", "spring", "dark"]);

function supportedTheme(value) {
  return THEMES.has(value) ? value : "blue";
}

export function loadTheme(storage = localStorage) {
  try {
    return supportedTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "blue";
  }
}

export function applyTheme(theme, { root = document.documentElement, storage = localStorage } = {}) {
  const value = supportedTheme(theme);
  root.dataset.theme = value;
  try {
    storage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // The visual choice still works when browser storage is unavailable.
  }
  return value;
}

export function initTheme({ root = document.documentElement, storage = localStorage } = {}) {
  const value = loadTheme(storage);
  root.dataset.theme = value;
  return value;
}

export function renderThemeSwitcher(theme = document.documentElement.dataset.theme || "blue") {
  const current = supportedTheme(theme);
  return `<div class="theme-switcher" role="group" aria-label="Interface theme">
    <button type="button" data-theme-value="blue" aria-label="Classic blue theme" aria-pressed="${current === "blue"}"></button>
    <button type="button" data-theme-value="spring" aria-label="Spring green theme" aria-pressed="${current === "spring"}"></button>
    <button type="button" data-theme-value="dark" aria-label="Dark theme" aria-pressed="${current === "dark"}"></button>
  </div>`;
}

export function bindThemeSwitcher(container = document, options = {}) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-theme-value]");
    if (!button) return;
    const value = applyTheme(button.dataset.themeValue, options);
    container.querySelectorAll("[data-theme-value]").forEach((candidate) => {
      candidate.setAttribute("aria-pressed", String(candidate.dataset.themeValue === value));
    });
  });
}
