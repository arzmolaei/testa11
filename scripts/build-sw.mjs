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
const hash = createHash("sha256");
for (const f of files) hash.update(await readFile(`dist${f}`));
const version = hash.digest("hex").slice(0, 14);
await writeFile(
  "dist/sw.js",
  `const CACHE='rooyesh-${version}';const ASSETS=${JSON.stringify(files)};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('rooyesh-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/'))return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/index.html',{ignoreVary:true})));return;}e.respondWith(caches.match(e.request,{ignoreVary:true}).then(c=>c||fetch(e.request)));});`,
);
