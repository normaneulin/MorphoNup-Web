import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the page runs on :5173 and forwards /api to the FastAPI server on :8000.
// `npm run build` writes dist/, which the FastAPI server also serves at :8000 (one server in production).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8000" } },
});
