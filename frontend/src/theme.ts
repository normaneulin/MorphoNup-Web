// Light and dark theme. The page follows the device until the visitor flips it; the choice is kept in localStorage.
// The theme lives on <html data-theme>, set before the first paint by the inline script in index.html.
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "morphonup-theme"; // also read by the script in index.html
const root = document.documentElement;
const device = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

const deviceTheme = (): Theme => (device.matches ? "dark" : "light");
const currentTheme = () => root.dataset.theme as Theme;

function savedTheme(): Theme | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null; // storage blocked: the site just follows the device
  }
}

function save(theme: Theme | null) {
  try {
    if (theme) localStorage.setItem(STORAGE_KEY, theme);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked: the flip lasts until the page is closed
  }
}

function apply(theme: Theme) {
  root.dataset.theme = theme;
  // Both theme-color tags take the page colour, so the mobile toolbar matches a flipped page whatever the device's mode.
  const page = getComputedStyle(root).getPropertyValue("--slide").trim();
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((tag) => { tag.content = page; });
  listeners.forEach((listener) => listener());
}

const follow = () => apply(savedTheme() ?? deviceTheme());
device.addEventListener("change", follow); // the device changed mode
window.addEventListener("storage", follow); // the theme was flipped in another tab
follow();

export function flipTheme() {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  // Flipping back to the device's own mode forgets the choice, so the site follows the device again.
  save(next === deviceTheme() ? null : next);
  apply(next);
}

export function useTheme(): Theme {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, currentTheme);
}
