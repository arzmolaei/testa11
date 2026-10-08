import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// Replaces synthetic data and injects a local CAS collision. Never use a live
// workspace: run against a disposable local Wrangler/D1 instance.
const origin=process.env.WORKSPACE_AUDIT_URL||"http://127.0.0.1:8950";
if(!["127.0.0.1","localhost"].includes(new URL(origin).hostname))throw Error("Workspace audit requires a disposable local Worker");
const variables=await readFile(process.env.WORKSPACE_AUDIT_VARS||"/tmp/seo-audit-worker/.dev.vars","utf8");
const raw=/^APP_PASSWORD=(.+)$/m.exec(variables)?.[1]?.trim();
if(!raw)throw Error("Disposable secret is missing");
const password=raw.startsWith('"')?JSON.parse(raw):raw;
const runId=Date.now().toString(36),id="workspace-audit-"+runId;
const recipe={id:"audit-recipe",label:"روال شخصی",audience:"مخاطب پروژه",conversionGoal:"تماس",briefTemplate:"مقدمه و پاسخ",groupingRules:"حفظ مدل",projectType:"Ecommerce"};
const project={id,name:"آزمون فضای کار",domain:"https://example.test",market:"ایران",language:"فارسی",projectType:"Ecommerce",goal:"هدف محفوظ",startDate:"2026-09-01",lastReview:"",playbook:recipe,keywords:[{id:"k1",keyword:"دوربین",decision:"Keep",group:"دوربین",targetPage:"p1"}],pages:[{id:"p1",target:"دسته دوربین",url:"https://example.test/cameras/",pkw:"دوربین"}],content:[{id:"c1",topic:"راهنمای دوربین",targetPage:"p1"}],results:[{id:"r1",pageId:"p1",clicks:10}],tasks:[{id:"t1",title:"کار پروژه",status:"open",priority:"P2",pageId:"p1"}],links:[{id:"l1",fromPageId:"p1",toPageId:"p1",status:"planned",anchor:"دوربین"}],searchConsole:{current:{id:"gsc1",periodStart:"2026-09-01",periodEnd:"2026-09-28",importedAt:"2026-10-08T01:00:00.000Z",label:"دوره آزمایش",dimension:"page",sourceRows:1,rows:[{id:"g1",page:"https://example.test/cameras/",clicks:10,impressions:100,position:7}]}}};
const seed={version:1,activeProjectId:id,settings:{titleMin:30,titleMax:60,metaMin:120,metaMax:160},projects:[project]};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});
const contexts=[],checks=[],errors=[],external=[];
let failure;
async function until(fn){const deadline=Date.now()+20000;while(Date.now()<deadline){if(await fn())return;await new Promise(r=>setTimeout(r,80));}throw Error("Expected workspace state did not settle");}
function observe(page){page.on("pageerror",e=>errors.push(e.message));page.on("request",r=>{const u=new URL(r.url());if(u.origin!==origin&&!["blob:","data:"].includes(u.protocol))external.push(r.url());});}
function check(name){checks.push(name);console.log("PASS",name);}
async function api(context,path,method="GET",body){const r=await context.request.fetch(origin+path,{method,headers:body===undefined?{}:{"Content-Type":"application/json",Origin:origin},...(body===undefined?{}:{data:JSON.stringify(body)})});return {status:r.status(),body:await r.json()};}
async function local(page){return page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open("rooyesh-seo-v1",1);r.onsuccess=()=>{const db=r.result,q=db.transaction("workspace").objectStore("workspace").get("state");q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=()=>reject(q.error)};r.onerror=()=>reject(r.error)}));}
const current=s=>s.projects.find(p=>p.id===id);
async function nav(page,label){await page.locator(".sidebar .nav-item").filter({hasText:label}).click();}
async function settings(page,tab){await nav(page,"تنظیمات و راهنما");await page.getByRole("button",{name:tab,exact:true}).click();}
async function device(username,pass){const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}});contexts.push(context);const page=await context.newPage();observe(page);await page.goto(origin);await page.locator("#auth-username").fill(username);await page.locator("#auth-password").fill(pass);await page.locator(".auth-remember input").check();await page.getByRole("button",{name:"ورود به استودیو",exact:true}).click();await page.locator(".hero-card").waitFor();await until(async()=>current((await local(page)).state));return {context,page};}
try{
await mkdir("artifacts",{recursive:true});
const seeder=await browser.newContext();contexts.push(seeder);
assert.equal((await api(seeder,"/api/login","POST",{username:"alireza",password})).status,200);
const initial=await api(seeder,"/api/state");
const seeded=await api(seeder,"/api/state","PUT",{revision:initial.body.revision,state:seed});
assert.equal(seeded.status,200,JSON.stringify(seeded.body));
const owner=await device("alireza",password);
await settings(owner.page,"پشتیبان و فضای ابری");
await owner.page.getByText("همگام‌سازی خودکار فعال",{exact:true}).waitFor();
for(const [button,suffix] of [["دریافت نسخه ابری","دریافت"],["ارسال نسخه این دستگاه","ارسال"]]){
owner.page.once("dialog",d=>d.dismiss());
await owner.page.getByRole("button",{name:button,exact:true}).click();
await until(()=>owner.page.getByRole("button",{name:button,exact:true}).isEnabled());
await owner.page.getByText("همگام‌سازی خودکار فعال",{exact:true}).waitFor();
await owner.page.getByRole("button",{name:"پروژه و تنظیمات",exact:true}).click();
const name="ذخیره پس از لغو "+suffix;await owner.page.getByLabel("نام پروژه",{exact:true}).fill(name);
await until(async()=>current((await api(seeder,"/api/state")).body.state).name===name);
await owner.page.getByRole("button",{name:"پشتیبان و فضای ابری",exact:true}).click();
check("Canceling "+suffix+" preserves active automatic sync and the next edit reaches real D1");
}

await owner.page.getByRole("button",{name:"پروژه و تنظیمات",exact:true}).click();
const before=(await api(seeder,"/api/state")).body.state;
owner.page.once("dialog",d=>d.accept());
const download=owner.page.waitForEvent("download");
await owner.page.getByRole("button",{name:"پاک‌سازی داده‌های این پروژه",exact:true}).click();
const file=await download;const backup=JSON.parse(await readFile(await file.path(),"utf8"));
assert.deepEqual(current(backup).tasks,current(before).tasks);
assert.deepEqual(current(backup).links,current(before).links);
assert.deepEqual(current(backup).searchConsole,current(before).searchConsole);
await until(async()=>{const p=current((await api(seeder,"/api/state")).body.state);return ["keywords","pages","content","results","tasks","links"].every(key=>p[key]?.length===0)&&!p.searchConsole;});
const cleared=current((await api(seeder,"/api/state")).body.state);
assert.deepEqual(cleared.playbook,recipe);assert.equal(cleared.id,id);assert.equal(cleared.goal,"هدف محفوظ");
check("Project cleanup removes all seven data areas, downloads their complete backup and preserves the project identity and playbook");

await owner.page.getByRole("button",{name:"پشتیبان و فضای ابری",exact:true}).click();
owner.page.once("dialog",d=>d.accept());
await owner.page.locator('input[type="file"]').setInputFiles({name:"valid-backup.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(backup))});
await until(async()=>current((await local(owner.page)).state).keywords.length===1);
await until(async()=>current((await api(seeder,"/api/state")).body.state).tasks.length===1);
await owner.page.reload();await owner.page.locator(".hero-card").waitFor();
const restored=current((await local(owner.page)).state);
assert.equal(restored.content.length,1);assert.equal(restored.links.length,1);assert.equal(restored.searchConsole.current.id,"gsc1");
check("A confirmed JSON restore commits durable local data, syncs it to real D1 and survives a full reload");

const viewerName="viewer-"+runId,viewerPassword="workspace-audit-viewer-password-123";
assert.equal((await api(seeder,"/api/users","POST",{username:viewerName,displayName:"مشاهده‌گر بررسی",role:"viewer",password:viewerPassword})).status,201);
const viewer=await device(viewerName,viewerPassword);
await settings(viewer.page,"پروژه و تنظیمات");
assert.equal(await viewer.page.getByLabel("حداقل طول عنوان",{exact:true}).isDisabled(),true);
assert.equal(await viewer.page.getByLabel("نام پروژه",{exact:true}).isDisabled(),true);

assert.ok(await viewer.page.locator(".settings-card input").count());
assert.equal(await viewer.page.locator(".settings-card input:enabled").count(),0);
await viewer.page.getByRole("button",{name:"پشتیبان و فضای ابری",exact:true}).click();
assert.equal(await viewer.page.locator('input[type="file"]').isDisabled(),true);
assert.equal(await viewer.page.getByRole("button",{name:"بازیابی پشتیبان",exact:true}).isDisabled(),true);
const viewerDownload=viewer.page.waitForEvent("download");await viewer.page.getByRole("button",{name:"دانلود پشتیبان کامل",exact:true}).click();
assert.match((await viewerDownload).suggestedFilename(),/\.json$/);
check("Viewer settings are visibly read-only; backup download remains available and restore controls are disabled");

await settings(owner.page,"پشتیبان و فضای ابری");
const candidate=structuredClone(backup);candidate.projects[0].name="نباید ذخیره شود";
await owner.page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open("rooyesh-seo-v1",1);r.onsuccess=()=>{const db=r.result,tx=db.transaction("workspace","readwrite"),s=tx.objectStore("workspace"),q=s.get("state");q.onsuccess=()=>{const foreign=q.result;foreign.revision+=50;foreign.state.projects[0].name="نسخه جدیدتر دستگاه";s.put(foreign,"state")};tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}}));
owner.page.once("dialog",d=>d.accept());
await owner.page.locator('input[type="file"]').setInputFiles({name:"collision-backup.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(candidate))});
await owner.page.getByText(/فایل بازیابی نشد: نسخه جدیدتری/).waitFor();
assert.equal(current((await local(owner.page)).state).name,"نسخه جدیدتر دستگاه");
assert.equal(await owner.page.getByText("پشتیبان بازیابی شد.",{exact:true}).count(),0);
check("A restore CAS collision preserves the newer local version and reports failure without a success toast");

const rawDownload=owner.page.waitForEvent("download");
await owner.page.getByRole("button",{name:"دانلود پشتیبان کامل",exact:true}).click();
const preserved=JSON.parse(await readFile(await (await rawDownload).path(),"utf8"));
assert.equal(current(preserved).name,"نسخه جدیدتر دستگاه");
check("After a local write collision, backup downloads the actual newer stored data instead of the outdated screen");

owner.page.once("dialog",d=>d.accept());
await owner.page.locator('input[type="file"]').setInputFiles({name:"explicit-recovery.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(candidate))});
await until(async()=>current((await local(owner.page)).state).name==="نباید ذخیره شود");
assert.equal(await owner.page.locator(".warning-banner").count(),0);
const retained=await owner.page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open("rooyesh-seo-v1",1);r.onsuccess=()=>{const db=r.result,q=db.transaction("workspace").objectStore("workspace").get("recovery");q.onsuccess=()=>{resolve(q.result);db.close()}}}));
assert.equal(current(retained.state).name,"نسخه جدیدتر دستگاه");
assert.equal(current((await api(seeder,"/api/state")).body.state).name,restored.name);
check("Explicit recovery re-enables editing, retains the replaced local record and pauses cloud sync for review");

let malformedWrites=0;
owner.page.on("request",request=>{if(["/api/state","/api/changes"].includes(new URL(request.url()).pathname)&&request.method()!=="GET")malformedWrites++;});
await owner.page.route("**/api/state",route=>route.request().method()==="GET"?route.fulfill({json:{revision:123}}):route.continue());
await owner.page.reload();await owner.page.locator(".hero-card").waitFor();
await owner.page.getByText(/پاسخ ذخیرهٔ ابری معتبر نیست/).waitFor();
await owner.page.waitForTimeout(550);
assert.equal(current((await local(owner.page)).state).name,"نباید ذخیره شود");
assert.equal(malformedWrites,0);
check("A malformed state read preserves local data and cannot be mistaken for an empty cloud workspace or enable automatic writes");

assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
}catch(error){failure=error.message;throw error;}
finally{await writeFile("artifacts/workspace-audit-checks.json",JSON.stringify({checks,errors,external,passed:!failure,...(failure?{failure}:{})},null,2));for(const context of contexts)await context.close();await browser.close();}
