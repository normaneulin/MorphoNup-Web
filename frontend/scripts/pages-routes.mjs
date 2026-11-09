// After `vite build`: copies of index.html so GitHub Pages answers every page of the site.
//   dist/<route>/index.html  for the routes in src/main.tsx (a reload or a shared link to /predict gets 200)
//   dist/404.html            any other path still opens the page, which shows "Page not found"
import { copyFileSync, mkdirSync } from "node:fs";

const ROUTES = ["predict", "datasets", "about"];
for (const route of ROUTES) {
  mkdirSync(`dist/${route}`, { recursive: true });
  copyFileSync("dist/index.html", `dist/${route}/index.html`);
}
copyFileSync("dist/index.html", "dist/404.html");
console.log(`pages: index.html copied to ${ROUTES.map((r) => `${r}/`).join(", ")} and 404.html`);
