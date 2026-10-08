import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";

const port=Number(process.env.STORAGE_AUDIT_PORT||5212);
const harness='<html><head><link rel="icon" href="data:,"></head><body><script type="module">import * as storage from "/src/storage.ts";window.storage=storage;window.ready=true;</script></body></html>';
const server=await createServer({cacheDir:"/tmp/seo-storage-audit-cache",server:{host:"127.0.0.1",port,strictPort:true},plugins:[{name:"storage-audit",configureServer(instance){instance.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith("/__storage_audit__"))return next();res.setHeader("Content-Type","text/html;charset=utf-8");res.end(await instance.transformIndexHtml(req.url,harness));});}}]});
await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});
const page=await browser.newPage(),checks=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));
const state={version:1,activeProjectId:"p1",settings:{titleMin:30,titleMax:60,metaMin:120,metaMax:160},projects:[{id:"p1",name:"آزمون ذخیره",domain:"",market:"",language:"",projectType:"Ecommerce",goal:"",startDate:"",lastReview:"",keywords:[{id:"k1",keyword:"دوربین",notes:"حفظ"}],pages:[],content:[],results:[],tasks:[{id:"t1",title:"کار مهم"}],links:[{id:"l1",fromPageId:"a",toPageId:"b"}],searchConsole:{current:{id:"current",rows:[{query:"دوربین",clicks:2}]},previous:{id:"previous",rows:[{query:"دوربین",clicks:1}]}}},{id:"empty-project",name:"پروژه خالی",domain:"",market:"",language:"",projectType:"Ecommerce",goal:"",startDate:"",lastReview:"",keywords:[],pages:[],content:[],results:[]}]};
async function check(name,run){await run();checks.push(name);console.log("PASS",name);}
async function reset(){await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase("rooyesh-seo-v1");r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error("Database still open"));}));}
async function warm(){await reset();return page.evaluate(async state=>{await window.storage.saveLocal(state,0);const next=structuredClone(state);next.projects[0].goal="مقدار جدید";return window.storage.saveLocal(next,1);},state);}
let failure;
try{
await page.goto("http://127.0.0.1:"+port+"/__storage_audit__");await page.waitForFunction(()=>window.ready);
await check("Replacing a row at the same total count preserves the previous record in a local backup",async()=>{
await warm();const result=await page.evaluate(async()=>{const current=await window.storage.loadLocal();const next=structuredClone(current.state);next.projects[0].keywords=[{id:"replacement",keyword:"دوربین جدید"}];await window.storage.saveLocal(next,current.revision);return window.storage.listBackups();});
assert.equal(result[0].revision,2);assert.equal(result[0].state.projects[0].keywords[0].id,"k1");
});
await check("Deleting an empty project creates a backup even when the record count does not fall",async()=>{
await warm();const result=await page.evaluate(async()=>{const current=await window.storage.loadLocal();const next=structuredClone(current.state);next.projects=next.projects.filter(p=>p.id!=="empty-project");await window.storage.saveLocal(next,current.revision);return window.storage.listBackups();});
assert.equal(result[0].revision,2);assert.ok(result[0].state.projects.some(p=>p.id==="empty-project"));
});
for(const field of ["tasks","links","searchConsole"]){
await check("Removing "+field+" preserves its data in the previous workspace snapshot",async()=>{
await warm();const result=await page.evaluate(async field=>{const current=await window.storage.loadLocal();const next=structuredClone(current.state);next.projects[0][field]=field==="searchConsole"?undefined:[];await window.storage.saveLocal(next,current.revision);return window.storage.listBackups();},field);
assert.equal(result[0].revision,2);assert.deepEqual(result[0].state.projects[0][field],state.projects[0][field]);
});
}
await check("Replacing a Search Console period preserves the original dataset even with the same row count",async()=>{
await warm();const result=await page.evaluate(async()=>{const current=await window.storage.loadLocal();const next=structuredClone(current.state);next.projects[0].searchConsole.current.id="new-period";await window.storage.saveLocal(next,current.revision);return window.storage.listBackups();});
assert.equal(result[0].revision,2);assert.equal(result[0].state.projects[0].searchConsole.current.id,"current");
});
await check("Same-millisecond commits keep eight distinct backups in revision order when the clock moves backward",async()=>{
await reset();const result=await page.evaluate(async state=>{const originalNow=Date.now;let clock=Date.parse("2026-10-08T10:00:00.000Z");Date.now=()=>clock;try{let record=await window.storage.saveLocal(state,0);for(let i=0;i<10;i++){if(i===4)clock-=3600000;const next=structuredClone(record.state);next.projects[0].goal=String(i);record=await window.storage.saveLocal(next,record.revision,true);}return {record,backups:await window.storage.listBackups()};}finally{Date.now=originalNow;}},state);
assert.deepEqual(result.backups.map(b=>b.revision),[10,9,8,7,6,5,4,3]);assert.equal(new Set(result.backups.map(b=>b.savedAt)).size,8);
assert.ok(result.record.savedAt>result.backups[0].savedAt);assert.equal(result.record.revision,11);
});
await check("Concurrent stale-revision writes cannot overwrite the winning transaction or partially commit",async()=>{
await reset();const result=await page.evaluate(async state=>{await window.storage.saveLocal(state,0);const left=structuredClone(state),right=structuredClone(state);left.projects[0].goal="چپ";right.projects[0].goal="راست";const outcomes=await Promise.allSettled([window.storage.saveLocal(left,1,true),window.storage.saveLocal(right,1,true)]);return {statuses:outcomes.map(o=>o.status),current:await window.storage.loadLocal(),backups:await window.storage.listBackups()};},state);
assert.deepEqual(result.statuses.sort(),["fulfilled","rejected"]);assert.equal(result.current.revision,2);assert.ok(["چپ","راست"].includes(result.current.state.projects[0].goal));
assert.equal(result.backups.length,1);assert.equal(result.backups[0].revision,1);
});
await check("Unsafe local revisions are rejected without touching existing workspace data",async()=>{
const result=await page.evaluate(async()=>{const before=await window.storage.loadLocal();const outcomes=await Promise.allSettled([-1,NaN,Number.MAX_SAFE_INTEGER,1.5].map(revision=>window.storage.saveLocal(before.state,revision,true)));return {before,after:await window.storage.loadLocal(),statuses:outcomes.map(o=>o.status)};});
assert.ok(result.statuses.every(status=>status==="rejected"));assert.deepEqual(result.before,result.after);
});
assert.deepEqual(errors,[]);
}catch(error){failure=error.message;throw error;}
finally{await mkdir("artifacts",{recursive:true});await writeFile("artifacts/storage-audit-checks.json",JSON.stringify({checks,errors,passed:!failure,...(failure?{failure}:{})},null,2));await browser.close();await server.close();}
