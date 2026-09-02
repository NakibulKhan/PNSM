// Stands in for `vite build`: emits the same shape of output -- an index.html
// plus a fingerprinted asset under /assets -- so the Dockerfile's COPY, its
// pre-compression step and nginx's cache rules are all exercised for real.
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("dist/assets", { recursive: true });

const js = `console.log("pnsm smoke build");\n`.repeat(200);
writeFileSync("dist/assets/index.a1b2c3d4.js", js);
writeFileSync(
  "dist/index.html",
  `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>PNSM</title><script type="module" src="/assets/index.a1b2c3d4.js"></script>` +
    `</head><body><div id="root"></div></body></html>\n`,
);
console.log("smoke build complete");
