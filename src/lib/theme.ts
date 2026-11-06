export type ThemePref = "system" | "light" | "dark";
const KEY = "styleai-theme";
let current: ThemePref = "system";

export function applyTheme(pref: ThemePref) {
  current = pref;
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* storage unavailable – theme still applies for this page view */
  }
}

export function initialTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

/** Follow OS changes while the preference is "system". */
export function watchSystemTheme() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const fn = () => current === "system" && applyTheme("system");
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
}
