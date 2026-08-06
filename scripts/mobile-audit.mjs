import { spawn } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
const PORT=9340, BASE=process.argv[2] ?? "http://127.0.0.1:4399/", PROF="/tmp/ma-prof";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function cdp(ws,id,m,p={}){return new Promise((res,rej)=>{const f=e=>{const x=JSON.parse(e.data);if(x.id!==id)return;ws.removeEventListener("message",f);x.error?rej(new Error(x.error.message)):res(x.result)};ws.addEventListener("message",f);ws.send(JSON.stringify({id,method:m,params:p}))})}
const WIDTHS=[[360,780],[390,844],[430,932]];
for (const [w,h] of WIDTHS){
  await rm(PROF,{recursive:true,force:true,maxRetries:3}).catch(()=>{});
  const c=spawn("chromium",["--headless","--disable-gpu","--no-sandbox","--hide-scrollbars",`--remote-debugging-port=${PORT}`,`--user-data-dir=${PROF}`,`--window-size=${w},${h}`,"about:blank"],{stdio:"ignore"});
  let t;for(let i=0;i<60;i++){try{t=await(await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`,{method:"PUT"})).json();break}catch{await sleep(200)}}
  const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener("open",r,{once:true}));
  let id=0;
  await cdp(ws,++id,"Page.enable");
  await cdp(ws,++id,"Emulation.setDeviceMetricsOverride",{width:w,height:h,deviceScaleFactor:2,mobile:true});
  await cdp(ws,++id,"Emulation.setTouchEmulationEnabled",{enabled:true});
  await cdp(ws,++id,"Page.navigate",{url:BASE});await sleep(2200);
  const r=await cdp(ws,++id,"Runtime.evaluate",{returnByValue:true,expression:`JSON.stringify((()=>{
    const vw=innerWidth, out={vw, pageH:document.documentElement.scrollHeight};
    out.hOverflow = document.documentElement.scrollWidth - vw;
    const wide=[];
    document.querySelectorAll('*').forEach(el=>{
      const r=el.getBoundingClientRect();
      if(r.width>vw+1 && r.height>0) wide.push({tag:el.tagName.toLowerCase(),cls:(el.className&&el.className.baseVal!==undefined?el.className.baseVal:el.className||'').toString().split(' ').filter(Boolean).slice(0,2).join('.'),w:Math.round(r.width)});
    });
    out.tooWide = wide.slice(0,10);
    const small=[];
    document.querySelectorAll('p,li,dd,summary,a,button,input,code').forEach(el=>{
      const t=(el.textContent||'').trim(); if(t.length<8) return;
      const fs=parseFloat(getComputedStyle(el).fontSize);
      if(fs<12) small.push({tag:el.tagName.toLowerCase(),fs,txt:t.slice(0,32)});
    });
    out.tinyText=small.slice(0,10);
    const taps=[];
    document.querySelectorAll('a,button,summary,input').forEach(el=>{
      const r=el.getBoundingClientRect();
      if(r.height>0 && r.height<40) taps.push({tag:el.tagName.toLowerCase(),h:Math.round(r.height),txt:(el.textContent||el.getAttribute('placeholder')||'').trim().slice(0,24)});
    });
    out.smallTaps=taps.slice(0,12);
    out.h1fs=parseFloat(getComputedStyle(document.querySelector('h1')).fontSize);
    return out;})())`});
  console.log(`\n=== ${w}x${h} ===`);
  const d=JSON.parse(r.result.value);
  console.log("  page height:",d.pageH,"| h-overflow:",d.hOverflow,"| h1 font:",d.h1fs);
  if(d.tooWide.length) console.log("  WIDER THAN VIEWPORT:",JSON.stringify(d.tooWide));
  if(d.tinyText.length) console.log("  TINY TEXT (<12px):",JSON.stringify(d.tinyText));
  if(d.smallTaps.length) console.log("  SMALL TAP TARGETS (<40px):",JSON.stringify(d.smallTaps));
  const secs=["#what","#alive","#plugins","#architecture","#waitlist"];
  for(const s of secs){
    await cdp(ws,++id,"Runtime.evaluate",{awaitPromise:true,expression:`(async()=>{const e=document.querySelector('${s}');if(e)e.scrollIntoView({block:'start',behavior:'instant'});await new Promise(r=>setTimeout(r,900));})()`});
    const shot=await cdp(ws,++id,"Page.captureScreenshot",{format:"png"});
    await writeFile(`.qa/m${w}${s.replace('#','-')}.png`,Buffer.from(shot.data,"base64"));
  }
  ws.close();c.kill();await sleep(300);
}
await rm(PROF,{recursive:true,force:true,maxRetries:3}).catch(()=>{});
console.log("\nshots in .qa/");
