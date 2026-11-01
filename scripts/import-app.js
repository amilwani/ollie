#!/usr/bin/env node
/* Turns the coach's page file (cisa-coach.html) into public/index.html for self-hosting.
 *
 *   npm run import-app -- path/to/cisa-coach.html
 *
 * Run it again whenever you receive a new version of the app: that is the whole content update path.
 * The page file is a fragment (no <html>/<head>); this wraps it in a normal document and loads the
 * self-hosting shim first, so the app can find its "database", "user" and "downloads" services.
 */
const fs = require("fs");
const path = require("path");

const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error("Usage: npm run import-app -- path/to/cisa-coach.html"); process.exit(1); }
let body = fs.readFileSync(src, "utf8");
if (/^\s*<!doctype/i.test(body) || /^\s*<html[\s>]/i.test(body)) { console.error("This file already looks like a full document. Expected the fragment version (cisa-coach.html)."); process.exit(1); }

// Move <title> and <meta>/<link>/<style> that start the fragment into the head so the document is well-formed.
const headBits = [];
let m;
while ((m = body.match(/^\s*(<title>[\s\S]*?<\/title>|<meta[^>]*>|<link[^>]*>)/i))) { headBits.push(m[1]); body = body.slice(m[0].length); }
const title = (headBits.find(h => /^<title/i.test(h)) || "<title>Ollie CISA Coach</title>");
const links = headBits.filter(h => !/^<title/i.test(h) && !/claude:viewport-fit-sides/.test(h)).join("\n");

const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
${title}
<meta name="description" content="A friendly CISA exam study coach: lessons, quizzes, mocks, flashcards and animated explainers.">
${links}
<style>:root{color-scheme:light}html{padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
<meta name="theme-color" content="#3451d1">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Ollie">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Ccircle cx=%2716%27 cy=%2716%27 r=%2714%27 fill=%27%233451d1%27/%3E%3Ccircle cx=%2711%27 cy=%2713%27 r=%272.5%27 fill=%27white%27/%3E%3Ccircle cx=%2721%27 cy=%2713%27 r=%272.5%27 fill=%27white%27/%3E%3C/svg%3E">
<script src="/claude-shim.js"></script>
</head>
<body>
${body}
</body>
</html>
`;
const out = path.join(__dirname, "..", "public", "index.html");
fs.writeFileSync(out, doc);
console.log(`Wrote ${out} (${(doc.length / 1024).toFixed(0)} KB). Restart is not needed; the file is served with no-cache.`);
