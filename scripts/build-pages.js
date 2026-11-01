#!/usr/bin/env node
/* Builds the static GitHub Pages copy of the coach into _site/.
 *
 *   npm run build:pages            (uses app-source/cisa-coach.html)
 *
 * The result needs no server: progress is kept in the visitor's browser, it installs as an app
 * (PWA) and works offline. The workflow in .github/workflows/pages.yml runs this on every push.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = process.argv[2] || path.join(root, "app-source", "cisa-coach.html");
const out = path.join(root, "_site");
let body = fs.readFileSync(src, "utf8");
if (/^\s*<!doctype/i.test(body)) { console.error("Expected the fragment version of cisa-coach.html."); process.exit(1); }

const headBits = [];
let m;
while ((m = body.match(/^\s*(<title>[\s\S]*?<\/title>|<meta[^>]*>|<link[^>]*>)/i))) { headBits.push(m[1]); body = body.slice(m[0].length); }
const title = headBits.find(h => /^<title/i.test(h)) || "<title>Ollie CISA Coach</title>";
const links = headBits.filter(h => !/^<title/i.test(h) && !/claude:viewport-fit-sides/.test(h)).join("\n");

const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
${title}
<meta name="description" content="A friendly CISA exam study coach: lessons, quizzes, mocks, flashcards and animated explainers. Free, works offline, progress stays on your device.">
<meta name="theme-color" content="#3451d1">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Ollie">
${links}
<style>:root{color-scheme:light}html{padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
<script src="static-shim.js"></script>
</head>
<body>
${body}
</body>
</html>
`;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "icons"), { recursive: true });
fs.writeFileSync(path.join(out, "index.html"), doc);
const pages = path.join(root, "pages"), pub = path.join(root, "public");
for (const f of ["static-shim.js", "privacy.html"]) fs.copyFileSync(path.join(pages, f), path.join(out, f));
fs.copyFileSync(path.join(pub, "manifest.webmanifest"), path.join(out, "manifest.webmanifest"));
for (const f of fs.readdirSync(path.join(pub, "icons"))) fs.copyFileSync(path.join(pub, "icons", f), path.join(out, "icons", f));
const build = require("crypto").createHash("sha256").update(doc).digest("hex").slice(0, 10);
fs.writeFileSync(path.join(out, "sw.js"), fs.readFileSync(path.join(pub, "sw.js"), "utf8").replace('"ollie-v1"', `"ollie-${build}"`));
fs.writeFileSync(path.join(out, ".nojekyll"), "");
console.log(`Built ${out} (index ${(doc.length / 1024).toFixed(0)} KB, build ${build}).`);
