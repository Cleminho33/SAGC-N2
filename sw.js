/* Service worker de SAGC'TOUT.
   Le site se déchiffre entièrement dans le navigateur (voir verrou.html) : la page servie contient
   déjà tout (texte, photos, vidéos) en un seul fichier, aucune requête séparée n'a lieu ensuite.
   Stratégie « cache d'abord » : une fois la page chargée une première fois en ligne, elle se relance
   instantanément depuis le cache (utile en stage ou en déplacement, réseau incertain), et se met à
   jour en tâche de fond dès qu'une connexion est disponible. La clé de déchiffrement doit déjà être
   en localStorage (case "Rester connecté" cochée une première fois en ligne). */
const CACHE = 'sagctout-v2';

function navKey(){ return new Request(self.registration.scope); }

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const isNav = e.request.mode === 'navigate';
  const key = isNav ? navKey() : e.request;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key);
    const refresh = fetch(e.request).then(res => {
      if (res && res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => null);

    if (cached){
      e.waitUntil(refresh); // sert le cache tout de suite, actualise en fond
      return cached;
    }
    const fresh = await refresh;
    return fresh || cached || Response.error();
  })());
});
