import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import obfuscatorPlugin from "vite-plugin-javascript-obfuscator";

// Tailwind v4 is wired in as a first-class Vite plugin (the Rust "Oxide"
// engine), not via a postcss.config.js + tailwind.config.js pair. There is
// deliberately no tailwind.config.js in this project — v4 is CSS-first and
// the design tokens live in src/styles/index.css under @theme.
//
// Item 5 (Flawless/Ultra blueprint) — M7: Insufficient Binary Protections.
// Additive, not the default: only the `build:obfuscated` script sets
// OBFUSCATE=1 (via cross-env, so it works the same on Windows/macOS/Linux).
// `npm run build`/`npm run dev` are completely untouched, matching the same
// "additive, not replacing" pattern already used for the TLS/PQC proxy.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(process.env.OBFUSCATE === "1"
      ? [
          obfuscatorPlugin({
            options: {
              compact: true,
              controlFlowFlattening: true,
              deadCodeInjection: true,
              stringArray: true,
              stringArrayEncoding: ["base64"],
              // debugProtection intentionally left off: it actively hostile-loops
              // a real DevTools session, which would make this project's own
              // "live-verify in the Browser pane" discipline impossible against
              // the obfuscated build.
            },
          }),
        ]
      : []),
  ],
  // webDir in capacitor.config.json points at this output dir.
  build: { outDir: "dist", sourcemap: false },
  server: { port: 5173, host: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./__tests__/setup.js"],
  },
});
