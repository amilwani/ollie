#!/usr/bin/env node
/* Vercel build: copies public/ into dist/ for the CDN.
 * privacy.html and terms.html are left out on purpose: the server fills in your site name and contact
 * details, so vercel.json routes them to the function instead.
 *   npm run build:vercel
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const src = path.join(root, "public"), out = path.join(root, "dist");
const SERVER_RENDERED = new Set(["privacy.html", "terms.html"]);

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true, filter: f => !SERVER_RENDERED.has(path.relative(src, f)) });
// a new service-worker cache name on every deploy, so returning visitors get the new version
const sw = path.join(out, "sw.js");
const id = (process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(36)).slice(0, 12);
fs.writeFileSync(sw, fs.readFileSync(sw, "utf8").replace(/const CACHE = "ollie-v1";/, `const CACHE = "ollie-${id}";`));
console.log("Built dist/ for Vercel (" + fs.readdirSync(out).length + " entries)");
