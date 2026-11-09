import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The whole site is static: the page, the datasets and the trained models (public/data) are files, and predictions
// run in the browser. `npm run dev` serves it on :5173; `npm run build` writes dist/.
// GitHub Pages serves it under /<repository>/: the workflow (.github/workflows/pages.yml) builds with --base.
export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  server: { port: 5173 },
});
