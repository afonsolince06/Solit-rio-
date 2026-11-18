// Junta tudo num único ficheiro HTML.  Correr com:  node build.js
//  - dist/solitario-da-avo.html  → versão para o Artifact do Claude
//  - docs/index.html (+ manifest, sw.js, ícones) → versão instalável (PWA) para GitHub Pages
'use strict';
const fs = require('fs');
const path = require('path');
const r = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const css = r('src/style.css');
const engine = r('src/engine.js');
const app = r('src/app.js');
const shell = r('src/shell.html');
const version = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

const body = `${shell}
<script>
${engine}
</script>
<script>
${app}
</script>`;

// 1) Artifact: o servidor acrescenta <!doctype>, <head> e <body>.
const artifact = `<title>Solitário da Avó</title>
<style>
${css}
</style>
${body}
`;
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/solitario-da-avo.html'), artifact);

// 2) PWA independente.
const pwa = `<!doctype html>
<html lang="pt-PT" class="standalone">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<title>Solitário da Avó</title>
<meta name="description" content="Paciência Klondike simples e confortável, com letras grandes.">
<meta name="theme-color" content="#0f4424">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Solitário">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<style>
${css}
</style>
</head>
<body>
${body}
<script>
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}
</script>
</body>
</html>
`;
const docs = path.join(__dirname, 'docs');
fs.mkdirSync(docs, { recursive: true });
fs.writeFileSync(path.join(docs, 'index.html'), pwa);
fs.writeFileSync(path.join(docs, 'manifest.webmanifest'), JSON.stringify({
  name: 'Solitário da Avó', short_name: 'Solitário', lang: 'pt-PT',
  start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
  background_color: '#0f4424', theme_color: '#0f4424',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}, null, 2));
fs.writeFileSync(path.join(docs, 'sw.js'), `// Guarda o jogo para funcionar sem Internet.
const CACHE = 'solitario-da-avo-${version}';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request).then((m) => m || caches.match('./index.html'))));
});
`);
fs.writeFileSync(path.join(docs, '.nojekyll'), '');
console.log('Feito: dist/solitario-da-avo.html (' + artifact.length + ' bytes) e docs/ (PWA).');
