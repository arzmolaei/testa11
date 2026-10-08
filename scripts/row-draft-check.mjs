import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";

const port = Number(process.env.ROW_DRAFT_QA_PORT || 5210);
const harness = `<!doctype html><html lang="fa" dir="rtl"><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';
import {KeywordWorkspace} from '/src/components/KeywordWorkspace.tsx';
import {PageWorkspace,ContentWorkspace} from '/src/components/PageWorkspaces.tsx';
import * as bulkDraft from '/src/bulk-draft.ts';
import * as assistantDraft from '/src/assistant-draft.ts';
import '/src/styles.css';import '/src/dark-theme.css';
const fixture={id:'draft-project',name:'آزمون پیش‌نویس',domain:'example.test',market:'',language:'فارسی',projectType:'Ecommerce',goal:'',startDate:'',lastReview:'',keywords:[{id:'k1',keyword:'دوربین مداربسته',group:'',notes:''}],pages:[{id:'p1',pageId:'P-001',target:'صفحه اصلی',notes:''}],content:[],results:[]};
function Harness(){const[project,setProject]=React.useState(fixture),[view,setView]=React.useState('keywords'),[mounted,setMounted]=React.useState(true),[scope,setScope]=React.useState('owner'),[readOnly,setReadOnly]=React.useState(false),[notice,setNotice]=React.useState('');
window.qa={project,setProject,setView,setMounted,setScope,setReadOnly,bulkDraft,assistantDraft,notice};
const component=view==='pages'?PageWorkspace:view==='content'?ContentWorkspace:KeywordWorkspace;
return React.createElement('main',{style:{maxWidth:1300,margin:'auto',padding:20}},React.createElement('output',null,notice),mounted?React.createElement(component,{key:JSON.stringify([view,scope]),project,settings:{titleMin:30,titleMax:60,metaMin:120,metaMax:160},draftScope:scope,readOnly,notify:setNotice,onRowsChange:(collection,rows)=>{setProject(p=>({...p,[collection]:rows}));return true;}}):null)};
createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`;
const server = await createServer({cacheDir:"/tmp/seo-row-audit-cache",server:{host:"127.0.0.1",port,strictPort:true,hmr:false},plugins:[{name:"row-draft-audit",configureServer(instance){instance.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith("/__row_draft__"))return next();res.setHeader("Content-Type","text/html;charset=utf-8");res.end(await instance.transformIndexHtml(req.url,harness));});}}]});
await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
const checks=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));page.on("dialog",d=>d.accept());
const check=name=>{checks.push(name);console.log("PASS",name)};
async function until(fn){const deadline=Date.now()+15000;while(Date.now()<deadline){if(await fn())return;await new Promise(r=>setTimeout(r,60));}throw Error("Expected draft state did not settle");}
async function remount(){await page.evaluate(()=>window.qa.setMounted(false));await until(()=>page.locator(".kw-workspace,.page-workspace").count().then(n=>n===0));await page.evaluate(()=>window.qa.setMounted(true));await page.locator(".kw-workspace,.page-workspace").waitFor();}
async function stored(collection,scope="owner"){return page.evaluate(({collection,scope})=>new Promise((resolve,reject)=>{const r=indexedDB.open("seo-assistant-drafts-v1",1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const read=db.transaction("drafts").objectStore("drafts").get(JSON.stringify([JSON.stringify(["drawer",scope,collection]),"draft-project"]));read.onsuccess=()=>{resolve(read.result??null);db.close()};read.onerror=()=>reject(read.error)}}),{collection,scope});}
let failure;
try{
await page.goto('http://127.0.0.1:'+port+'/__row_draft__');
await page.getByRole("button",{name:"کلمه جدید",exact:true}).waitFor();
await until(()=>page.getByRole("button",{name:"کلمه جدید",exact:true}).isEnabled());
await page.getByRole("button",{name:"ویرایش دوربین مداربسته",exact:true}).click();
await page.locator("#kw-group").fill("پیش‌نویس گروه من");
await remount();await page.getByRole("button",{name:"بازیابی پیش‌نویس فرم",exact:true}).waitFor();
assert.equal(await page.evaluate(()=>window.qa.project.keywords[0].group),"");
await page.getByRole("button",{name:"بازیابی پیش‌نویس فرم",exact:true}).click();
assert.equal(await page.locator("#kw-group").inputValue(),"پیش‌نویس گروه من");
assert.equal(await page.locator(".kw-drawer").getAttribute("data-dirty"),"true");
check("Unmounting a dirty keyword form preserves its draft without silently changing the project");
await page.locator(".kw-drawer").getByRole("button",{name:"ذخیره تغییرات",exact:true}).click();
await until(()=>stored("keywords").then(v=>v===null));
assert.equal(await page.evaluate(()=>window.qa.project.keywords[0].group),"پیش‌نویس گروه من");
check("Committing a recovered keyword removes only its temporary form draft");

await page.evaluate(()=>window.qa.setView("pages"));
await until(()=>page.getByRole("button",{name:"صفحه جدید",exact:true}).isEnabled());
await page.getByRole("button",{name:"ویرایش صفحه اصلی",exact:true}).click();
await page.getByLabel(/^صفحه \/ هدف/).fill("عنوان پیش‌نویس");
await page.evaluate(()=>window.qa.setProject(p=>({...p,pages:p.pages.map(row=>({...row,target:"تغییر همکار"}))})));
await remount();await page.getByRole("button",{name:"بازیابی پیش‌نویس فرم",exact:true}).click();
await page.locator(".workspace-drawer").getByRole("button",{name:/^ذخیره (صفحه|محتوا)$/}).click();
assert.equal(await page.evaluate(()=>window.qa.project.pages[0].target),"تغییر همکار");
assert.match(await page.locator(".workspace-drawer").innerText(),/هم‌زمان تغییر کرده/);
assert.equal(await page.getByLabel(/^صفحه \/ هدف/).inputValue(),"عنوان پیش‌نویس");
check("Recovery retains the original baseline and cannot overwrite a newer page from another device");
await page.locator(".workspace-drawer").getByRole("button",{name:"بستن پنل",exact:true}).click();
await until(()=>stored("pages").then(v=>v===null));

await page.evaluate(()=>window.qa.setView("content"));
await until(()=>page.getByRole("button",{name:"محتوای جدید",exact:true}).first().isEnabled());
await page.getByRole("button",{name:"محتوای جدید",exact:true}).first().click();
await page.getByLabel(/^عنوان \/ موضوع/).fill("محتوای ثبت‌نشده");
await page.evaluate(()=>window.qa.setReadOnly(true));
await remount();await until(()=>stored("content").then(v=>v?.row.topic==="محتوای ثبت‌نشده"));
assert.equal(await page.locator(".row-draft-recovery").count(),0);
await page.evaluate(()=>window.qa.setReadOnly(false));
await page.getByRole("button",{name:"بازیابی پیش‌نویس فرم",exact:true}).click();
assert.equal(await page.getByLabel(/^عنوان \/ موضوع/).inputValue(),"محتوای ثبت‌نشده");
assert.equal(await page.evaluate(()=>window.qa.project.content.length),0);
check("A form survives an immediate access change; read-only visits do not expose or erase recovery controls");
await page.locator(".workspace-drawer").getByRole("button",{name:/^ذخیره (صفحه|محتوا)$/}).click();
await until(()=>stored("content").then(v=>v===null));
assert.equal(await page.evaluate(()=>window.qa.project.content[0].topic),"محتوای ثبت‌نشده");
check("New content recovers with its original defaults and is added only on explicit save");

await page.evaluate(()=>window.qa.setView("keywords"));
await page.getByRole("button",{name:"ویرایش دوربین مداربسته",exact:true}).click();
await page.locator("#kw-group").fill("متن شخصی مالک");
await page.evaluate(()=>window.qa.setScope("member"));
await until(()=>stored("keywords").then(v=>v?.row.group==="متن شخصی مالک"));
await until(()=>page.getByRole("button",{name:"کلمه جدید",exact:true}).isEnabled());
assert.equal(await page.locator(".row-draft-recovery").count(),0);
assert.equal(await stored("keywords","member"),null);
await page.evaluate(()=>window.qa.setScope("owner"));
await page.getByRole("button",{name:"بازیابی پیش‌نویس فرم",exact:true}).waitFor();
const download=page.waitForEvent("download");await page.getByRole("button",{name:"دانلود پیش‌نویس فرم",exact:true}).click();
assert.match((await download).suggestedFilename(),/\.json$/);
check("Form drafts remain separated by account and can be downloaded as an actual JSON file");
await page.getByRole("button",{name:"کنارگذاشتن پیش‌نویس فرم",exact:true}).click();
await until(()=>stored("keywords").then(v=>v===null));
assert.equal(await page.evaluate(()=>window.qa.project.keywords[0].group),"پیش‌نویس گروه من");
check("Explicit draft discard leaves saved project data unchanged");

const malformed={version:99,projectId:"draft-project",scope:JSON.stringify(["drawer","owner","keywords"]),savedAt:new Date().toISOString(),row:{id:"preserve",keyword:"نسخه آسیب‌دیده"}};
await page.evaluate(()=>window.qa.setMounted(false));await page.locator(".kw-workspace").waitFor({state:"detached"});
await page.evaluate(()=>window.qa.assistantDraft.loadAssistantDraft("draft-project",JSON.stringify(["drawer","owner","keywords"])));
await page.evaluate(value=>new Promise((resolve,reject)=>{const r=indexedDB.open("seo-assistant-drafts-v1",1);r.onsuccess=()=>{const db=r.result,tx=db.transaction("drafts","readwrite");tx.objectStore("drafts").put(value,JSON.stringify([value.scope,value.projectId]));tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}}),malformed);
await page.evaluate(()=>window.qa.setMounted(true));await page.getByRole("alert").filter({hasText:"نسخهٔ قبلی حفظ شده"}).waitFor();
await page.waitForTimeout(350);
assert.deepEqual(await stored("keywords"),malformed);
check("An unreadable draft is preserved with a visible warning instead of being erased by an idle autosave");

const legacy=await page.evaluate(async()=>{
const m=window.qa.bulkDraft;
const draft={version:1,projectId:"legacy",collection:"keywords",savedAt:new Date().toISOString(),patches:[["k1",{group:"پیش‌نویس قدیمی"}]],additions:[],deleted:[],baselines:[["k1",{id:"k1",keyword:"دوربین",group:""}]],editing:null};
const write=m.saveBulkDraft("legacy","keywords",draft);draft.patches[0][1].group="تغییر پس از فراخوانی";await write;
const other=await m.loadBulkDraft("legacy","keywords","member",false);
const owner=await m.loadBulkDraft("legacy","keywords","owner",true);
const old=await m.loadBulkDraft("legacy","keywords");
const member=await m.loadBulkDraft("legacy","keywords","member",false);
return {other,owner,old,member};
});
assert.equal(legacy.other,null);assert.equal(legacy.member,null);assert.equal(legacy.old,null);
assert.equal(legacy.owner.scope,"owner");assert.equal(legacy.owner.patches[0][1].group,"پیش‌نویس قدیمی");
check("Legacy bulk drafts migrate atomically for the owner, preserve their call-time snapshot and stay private to that account");
assert.deepEqual(errors,[]);
}catch(error){failure=error.message;throw error;}
finally{await mkdir("artifacts",{recursive:true});await writeFile("artifacts/row-draft-checks.json",JSON.stringify({checks,errors,passed:!failure,...(failure?{failure}:{})},null,2));await browser.close();await server.close();}
