import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const files = [];
async function walk(path) {
  for (const f of await readdir(path, { withFileTypes: true })) {
    const p = `${path}/${f.name}`;
    if (f.isDirectory()) await walk(p);
    else if (!["sw.js"].includes(f.name)) files.push(p.replace(/^dist/, ""));
  }
}
await walk("dist");
files.sort();
const hash = createHash("sha256");
for (const f of files) {
  hash.update(f).update('\0');
  hash.update(await readFile(`dist${f}`));
}
const version = hash.digest("hex").slice(0, 14);
await writeFile(
  "dist/sw.js",
  `const CACHE='rooyesh-${version}';
const ASSETS=${JSON.stringify(files)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>{
  // Keep the previous asset set for another tab that still has the older UI open.
  const old=keys.filter(k=>k.startsWith('rooyesh-')&&k!==CACHE);
  return Promise.all(old.slice(0,-1).map(k=>caches.delete(k)));
}).then(()=>self.clients.claim())));
async function offlineShell(){
  const cached=await (await caches.open(CACHE)).match('/index.html',{ignoreVary:true});
  if(!cached)return Response.error();
  // Cloudflare redirects /index.html to /. A navigation response cannot retain
  // that redirect history. Rebuild the decoded body, retaining its CSP headers.
  const headers=new Headers(cached.headers);
  headers.delete('content-encoding');headers.delete('content-length');
  return new Response(await cached.arrayBuffer(),{status:cached.status,statusText:cached.statusText,headers});
}
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/'))return;
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).then(r=>r.status>=500?offlineShell():r).catch(offlineShell));return;
  }
  // Fixed-path icons and the manifest must come from the active release first.
  // Older caches remain a fallback for a tab that still requests an old chunk.
  e.respondWith(caches.open(CACHE).then(c=>c.match(e.request,{ignoreVary:true}))
    .then(c=>c||caches.match(e.request,{ignoreVary:true}))
    .then(c=>c||fetch(e.request)));
});`,
);
