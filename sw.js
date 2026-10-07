/* Service worker de SAGC'TOUT.
   Réseau d'abord : dès qu'il y a du réseau, on sert toujours la dernière version publiée (vérification
   rapide, rien n'est retéléchargé si le fichier n'a pas changé). Le cache ne sert qu'en cas d'échec réseau,
   sauf pour les vidéos de media/ (voir plus bas).
   Chaque adresse a sa propre entrée de cache : l'appli et chaque deck ne se mélangent jamais. */
const CACHE = 'sagctout-v4';
const BAD_CACHES = ['sagctout-v3'];

function cacheKey(url){
  const u = new URL(url);
  let path = u.pathname;
  if (path.endsWith('/')) path += 'index.html';
  return u.origin + path;
}

function sameVersion(a, b){
  const etag = b.headers.get('etag'), lm = b.headers.get('last-modified');
  if (etag) return a.headers.get('etag') === etag;
  return !!lm && a.headers.get('last-modified') === lm;
}

/* Vidéos chiffrées à part (media/<empreinte>.bin) : le nom change dès que le contenu change, une copie
   gardée est donc toujours la bonne. Cache d'abord : une vidéo déjà vue se relit sans réseau et sans
   attendre de vérification. */
const MEDIA = /\/media\/[0-9a-f]{32}\.bin$/;

function mediaFirst(e, req, key){
  let stored;
  e.waitUntil(new Promise(r => { stored = r; }));
  e.respondWith((async () => {
    const cache = await caches.open(CACHE).catch(() => null);
    const hit = cache && await cache.match(key).catch(() => null);
    if (hit){ stored(); return hit; }
    let res;
    try { res = await fetch(req); } catch(err){ stored(); throw err; }
    if (res.ok && cache) cache.put(key, res.clone()).catch(() => {}).finally(stored);
    else stored();
    return res;
  })());
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const hadBadCache = keys.some(k => BAD_CACHES.includes(k));
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    /* l'ancien cache mélangeait l'appli et les decks : on recharge une fois les pages ouvertes
       pour qu'elles repartent de la bonne version, sans attendre une deuxième relance */
    if (hadBadCache){
      const wins = await self.clients.matchAll({ type: 'window' });
      wins.forEach(c => c.navigate(c.url).catch(() => {}));
    }
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;
  const key = cacheKey(req.url);
  if (MEDIA.test(new URL(req.url).pathname)) return mediaFirst(e, req, key);

  let stored;
  e.waitUntil(new Promise(r => { stored = r; }));
  const cacheP = caches.open(CACHE);

  const network = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res && res.ok){
      const copy = res.clone();
      (async () => {
        const cache = await cacheP;
        const old = await cache.match(key);
        if (old && sameVersion(old, copy)){ if (copy.body) copy.body.cancel(); return; }
        await cache.put(key, copy);
      })().catch(() => {}).finally(stored);
    } else stored();
    return res;
  }, err => { stored(); throw err; });

  e.respondWith(network.catch(async () => {
    const cached = await cacheP.then(c => c.match(key)).catch(() => null);
    return cached || Response.error();
  }));
});
