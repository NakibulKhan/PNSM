import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import obfuscatorPlugin from "vite-plugin-javascript-obfuscator";

// Tailwind v4 is wired in as a first-class Vite plugin (the Rust "Oxide"
// engine), not via a postcss.config.js + tailwind.config.js pair. There is
// deliberately no tailwind.config.js in this project — v4 is CSS-first and
// the design tokens live in src/styles/theme.css under @theme (imported by
// index.css, alongside bento.css).
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
            // No exclusion list existed before the master audit — it obfuscated
            // every file indiscriminately, including compression.js's
            // `new Worker(new URL("./compression.worker.js", import.meta.url))`.
            // That is the same class of bug Person2 already hit and fixed for
            // its route-level React.lazy() calls: the obfuscator's string-array
            // transform pulls the literal specifier into an encoded array
            // before Vite's import-analysis plugin can rewrite it to the real
            // built worker-chunk URL, so the Worker construction fails at
            // runtime ("Failed to resolve module specifier"). Confirmed by
            // building dist-obfuscated/ and loading it in a browser, not
            // assumed — mockLocation.js's own `await
            // import("capacitor-mock-location-checker")` looked like the same
            // risk at first read, but this app has no other code-split point,
            // so Rollup statically inlines that resolvable npm package straight
            // into the main chunk at build time; there is no runtime specifier
            // left for the obfuscator to corrupt, so it needs no exclusion.
            //
            // compression.worker.js itself is excluded for a different reason:
            // it is a tight, timing-sensitive canvas re-encode loop (up to 8
            // passes per check-in selfie) run inside a Worker specifically so
            // it never blocks the UI thread, and controlFlowFlattening's
            // per-iteration overhead works directly against that goal.
            exclude: ['src/lib/compression.js', 'src/lib/compression.worker.js'],
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
