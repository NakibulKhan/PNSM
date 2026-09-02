import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tailwind v4 is wired in as a first-class Vite plugin (the Rust "Oxide"
// engine), not via a postcss.config.js + tailwind.config.js pair. There is
// deliberately no tailwind.config.js in this project — v4 is CSS-first and
// the design tokens live in src/styles/index.css under @theme.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // webDir in capacitor.config.json points at this output dir.
  build: { outDir: "dist", sourcemap: false },
  server: { port: 5173, host: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./__tests__/setup.js"],
  },
});
