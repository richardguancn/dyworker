import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = mkdtempSync(join(tmpdir(), "data-complete-view-"));
const errors = [], writes = [];
const browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
try {
  for (const surface of ["dashboard", "report"]) {
    const project = join(root, surface);
    cpSync(join(pluginRoot, "templates/data-app/base"), project, {recursive:true,
      filter:path=>!path.includes("/node_modules") && !path.includes("/dist")});
    const snapshot = JSON.parse(readFileSync(join(project,"src/data.json")));
    snapshot.surface=surface;
    snapshot.id=`${surface}:complete-view-qa`;
    snapshot.filters=[{id:"cut",label:"Category",field:"category",defaultValue:"all",shareInUrl:false,visible:true}];
    snapshot.queries={q:{rows:[{category:"A",day:"2026-09-01",value:10},{category:"B",day:"2026-09-01",value:30}],source:{label:"Synthetic reviewed QA rows",kind:"synthetic"}}};
    writeFileSync(join(project,"src/data.json"),JSON.stringify(snapshot));
    writeFileSync(join(project,`src/content/${surface}/${surface === "report" ? "Report" : "Dashboard"}Content.jsx`),`
import React from "react";
import { Filters, useDataApp, useSectionFilters, useDashboardTabs, EvidenceChart } from "../../data-app-public.jsx";
const tabs=[{id:"dashboard",label:"Overview",filterIds:["cut"],focusFields:["category"]},{id:"detail",label:"Detail",filterIds:["cut"],defaultFilters:{cut:"B"},focusFields:["category"]}];
const sectionDefinitions=[{id:"cut",label:"Section category",field:"category",defaultValue:"all"}];
export function ${surface === "report" ? "Report" : "Dashboard"}Content(){
  const shell=useDataApp();
  ${surface === "dashboard" ? "useDashboardTabs(tabs);" : ""}
  const left=useSectionFilters(sectionDefinitions,{}, {id:"left",label:"Left cuts"});
  const right=useSectionFilters(sectionDefinitions,{}, {id:"right",label:"Right cuts"});
  return <section><Filters filters={shell.snapshot.filters} queries={shell.queries} values={shell.filters} onChange={shell.setFilter}/>
    <Filters {...left.filterProps}/><Filters {...right.filterProps}/>
    <button onClick={()=>shell.setAssumptions({activationLift:12,retentionLift:3})}>Set scenario</button>
    <button onClick={()=>shell.updateChartState("qa-chart",{zoomRange:{start:"2026-09-01",end:"2026-09-01"},inlineFilters:{category:"A"}})}>Choose chart view</button>
    <button onClick={()=>shell.setDashboardFocus({category:"B"})}>Focus category</button>
    <button onClick={()=>shell.setAssumptions(Object.fromEntries(Array.from({length:2049},(_,i)=>["input"+i,1])))}>Oversized scenario</button>
    <output data-view-proof>{JSON.stringify({filters:shell.filters,left:left.reviewedRows("q"),right:right.reviewedRows("q"),assumptions:shell.assumptions,charts:shell.chartStates,focus:shell.viewFocus,tab:shell.activeTabId})}</output>
    <EvidenceChart id="qa-chart" queryId="q" title="Reviewed category values" spec={{type:"bar",x:"day",y:"value",series:"category"}} rows={shell.reviewedRows("q")} sourceRows={shell.reviewedRows("q")}/>
  </section>;
}`);
    const build=runDataAppFixtureBuild(project,{pluginRoot});
    assert.equal(build.status,0,build.stdout+build.stderr);
    const html=readFileSync(join(project,"dist/index.html"),"utf8");
    const origin=`https://complete-view-${surface}.chatgpt.site`;
    async function open(url) {
      const context=await browser.newContext();
      await context.addInitScript(() => Object.defineProperty(navigator, "clipboard", {
        configurable: true, value: { writeText: async text => { window.__copiedViewLink = text; } },
      }));
      const page=await context.newPage();
      page.on("pageerror",e=>errors.push(e.message));
      await page.route(`${origin}/**`,route=>{
        const req=route.request(), path=new URL(req.url()).pathname;
        if (!["GET","HEAD"].includes(req.method())) writes.push(req.method()+" "+path);
        const payload=path==="/api/snapshot"?snapshot:path==="/api/presentation"?{canEdit:false,presentation:{},revision:0}:null;
        return route.fulfill(payload?{contentType:"application/json",body:JSON.stringify(payload)}:{contentType:"text/html",body:html});
      });
      await page.goto(url);
      await page.locator("[data-view-proof]").waitFor();
      return page;
    }
    const proof=async page=>JSON.parse(await page.locator("[data-view-proof]").innerText());
    const sender=await open(origin+"/?view=1");
    await sender.getByRole("button",{name:"Set scenario",exact:true}).click();
    const legend=sender.locator('[data-component-id="qa-chart"]').getByRole("button",{name:"Toggle B",exact:true});
    assert.equal(await legend.getAttribute("aria-pressed"),"true");
    await legend.click();
    assert.equal(await legend.getAttribute("aria-pressed"),"false");
    await sender.getByRole("button",{name:"Choose chart view",exact:true}).click();
    if(surface==="dashboard") await sender.getByRole("button",{name:"Focus category",exact:true}).click();
    await sender.locator('[aria-label="Left cuts"]').getByRole("button",{name:"Section category",exact:true}).click();
    await sender.getByRole("menuitemradio",{name:"A",exact:true}).click();
    await sender.waitForURL(url=>url.searchParams.has("s") && url.searchParams.has("a") && url.searchParams.has("c"));
    const selected=await proof(sender);
    assert.equal(selected.left.length,1);
    assert.equal(selected.right.length,2,"Sections with identical filter IDs must stay independent.");
    await sender.getByRole("button", { name: "More", exact: true }).click();
    await sender.getByRole("menuitem", { name: "Copy link", exact: true }).click();
    const shared=await sender.evaluate(() => window.__copiedViewLink);
    assert.equal(shared, sender.url(), "Copy link must preserve every selected view parameter.");
    await sender.getByRole("button", { name: "Ask ChatGPT", exact: true }).click();
    const summaryHref = new URL(await sender.getByRole("link", { name: "Share key insights" }).getAttribute("href"));
    const summaryPrompt = summaryHref.searchParams.get("q") ?? summaryHref.searchParams.get("prompt");
    const summaryViewUrl = /\]\(<(https?:\/\/[^>]+)>\)/u.exec(summaryPrompt)?.[1];
    assert.equal(summaryViewUrl, shared, "The summary workflow must receive the complete selected view for its outgoing link.");
    await sender.keyboard.press("Escape");
    const recipient=await open(summaryViewUrl);
    assert.deepEqual(await proof(recipient),selected,"Fresh recipients must reproduce all declared view controls.");
    assert.equal(await recipient.locator('[data-component-id="qa-chart"]').getByRole("button",{name:"Toggle B",exact:true}).getAttribute("aria-pressed"),"false",
      "The restored chart legend must reflect the sender's actual UI selection.");
    await recipient.reload();
    assert.deepEqual(await proof(recipient),selected);
    if(surface==="dashboard") {
      await sender.getByRole("tab",{name:"Detail",exact:true}).click();
      assert.equal((await proof(sender)).filters.cut,"B");
      const detail=sender.url();
      const reader=await open(detail);
      await reader.getByRole("tab",{name:"Overview",exact:true}).click();
      assert.deepEqual(await proof(reader),selected,"Returning to an inactive tab preserves its sender-selected cuts/focus.");
      await reader.goBack();
      assert.equal((await proof(reader)).filters.cut,"B");
      await reader.context().close();
    }
    await recipient.goto(origin+"/?view=1");
    const reset=await proof(recipient);
    assert.deepEqual(reset.assumptions,{activationLift:0,retentionLift:0});
    assert.deepEqual(reset.charts,{});
    assert.equal(reset.left.length,2);
    assert.equal(reset.filters.cut,"all");
    if(surface==="dashboard") {
      await recipient.getByRole("button",{name:"Oversized scenario",exact:true}).click();
      await recipient.getByText("This view has too many selections to fit in a shareable link. Reduce the selections before sharing",{exact:true}).waitFor();
      await recipient.getByRole("tab",{name:"Detail",exact:true}).click();
      assert.equal((await proof(recipient)).tab,"dashboard","Unrepresentable views must not navigate with partial state.");
    }
    await sender.context().close();await recipient.context().close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  process.stdout.write("Complete-view dashboard/report roundtrips, independent sections, scenarios, chart state, tab history and zero shared writes passed.\n");
} finally { await browser.close();rmSync(root,{recursive:true,force:true}); }
