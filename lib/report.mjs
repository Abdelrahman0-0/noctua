import fs from "node:fs";
import path from "node:path";
import { traffic } from "./traffic.mjs";

// The report is one self-contained HTML file: open it anywhere, send it to anyone. It is dark like the app and prints in light.
const CSS = `
:root{color-scheme:dark;--bg:#000;--card:#070707;--tx:#ece8dc;--mut:#8d897d;--bd:#1f1f1f;--bd2:#333;--ac:#ffb000;--pass:#5fd4a0;--warn:#ff8a3d;--fail:#ff4b4b;--skip:#6b675d;--moon:#f4efe0}
*{box-sizing:border-box}html{background:#000}
body{margin:0;color:var(--tx);font:15px/1.6 "Segoe UI",Tahoma,system-ui,sans-serif;background:radial-gradient(520px circle at 85% 0,rgba(255,176,0,.07),transparent 70%),#000}
.wrap{max-width:1060px;margin:0 auto;padding:26px 20px 90px}
.hero{display:flex;gap:26px;align-items:center;padding:8px 0 26px;border-bottom:1px solid var(--bd)}
#eye{width:116px;height:116px;flex:none;filter:drop-shadow(0 0 22px rgba(255,176,0,.3))}
body.bad #eye{filter:drop-shadow(0 0 22px rgba(255,75,75,.45))}
.brand{font:400 13px/1 "Palatino Linotype",Georgia,serif;letter-spacing:.34em;color:var(--mut)}
h1{margin:8px 0 4px;font:400 34px/1.2 "Palatino Linotype",Sylfaen,Georgia,serif;color:var(--moon)}
.site{color:var(--mut);direction:ltr;text-align:start;word-break:break-all}
.nums{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0 4px}
.num{min-width:112px;padding:12px 18px;border:1px solid var(--bd2);background:var(--card)}
.num b{display:block;font-size:30px;line-height:1.1;font-variant-numeric:tabular-nums}.num span{color:var(--mut);font-size:12px}
.num.pass b{color:var(--pass)}.num.warn b{color:var(--warn)}.num.fail b{color:var(--fail)}.num.skip b{color:var(--skip)}
h2{font:400 21px/1.3 "Palatino Linotype",Sylfaen,Georgia,serif;margin:34px 0 12px;color:var(--moon)}
.fix{border:1px solid #5a2020;background:rgba(255,75,75,.07);padding:4px 16px}
.fix .it{padding:10px 0;border-top:1px solid #2a1414}.fix .it:first-child{border-top:0}.fix b{color:var(--moon)}.fix .g{color:var(--mut);font-size:12px}.fix .d{color:#e9b4ae;font-size:13px;word-break:break-word}
.bar{position:sticky;top:0;z-index:5;background:rgba(0,0,0,.92);backdrop-filter:blur(6px);padding:12px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--bd)}
button,input{font:inherit;color:var(--tx);background:transparent;border:1px solid var(--bd2);border-radius:0;padding:6px 14px;cursor:pointer}
button:hover{border-color:var(--ac);color:var(--ac)}button.on{border-color:var(--ac);color:#000;background:var(--ac);font-weight:700}
input[type=search]{cursor:text;min-width:200px;flex:1;background:#0b0b0b}input:focus{outline:0;border-color:var(--ac)}
details.g{border-top:1px solid var(--bd)}details.g>summary{list-style:none;cursor:pointer;padding:13px 4px;display:flex;gap:14px;align-items:center}
details.g>summary::-webkit-details-marker{display:none}
details.g>summary::before{content:"\\25B8";color:var(--mut)}details.g[open]>summary::before{content:"\\25BE"}
.gn{font-weight:700;color:var(--moon);flex:1}.mini{display:flex;width:120px;height:6px;background:#161616}.mini i{display:block;height:100%}
.row{display:flex;gap:12px;padding:8px 6px 8px 4px;border-top:1px solid #131313;align-items:flex-start}
.row.hide,.tr.hide,.trd.hide{display:none}
.b{flex:none;min-width:56px;text-align:center;font-weight:700;font-size:11px;padding:2px 6px;margin-top:3px;color:#000}
.PASS .b{background:var(--pass)}.WARN .b{background:var(--warn)}.FAIL .b{background:var(--fail)}.SKIP .b{background:var(--skip);color:#fff}
.rc{flex:1;min-width:0}.nm{font-weight:600}.dt{color:var(--mut);font-size:13px;word-break:break-word}
.shot{flex:none}.shot img{width:96px;height:60px;object-fit:cover;object-position:top;border:1px solid var(--bd2);display:block}
.tstat{display:flex;gap:22px;flex-wrap:wrap;color:var(--mut);margin:0 0 10px}.tstat b{color:var(--tx);font-variant-numeric:tabular-nums}
.tw{overflow-x:auto;border:1px solid var(--bd)}table{border-collapse:collapse;width:100%;font-size:13px}
th{text-align:start;color:var(--mut);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--bd2);white-space:nowrap}
td{padding:6px 10px;border-top:1px solid #131313;vertical-align:middle}.tr{cursor:pointer}.tr:hover{background:#0d0d0d}
.u{direction:ltr;text-align:start;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.u i{color:var(--mut);font-style:normal}
.src{font-size:11px;font-weight:700;padding:1px 7px;border:1px solid currentColor}.src.api{color:var(--ac)}.src.site{color:#8fb7ff}.src.browser{color:#c9a7ff}
.st{font-weight:700;font-variant-numeric:tabular-nums}.st.s2{color:var(--pass)}.st.s3{color:#8fb7ff}.st.s4{color:var(--warn)}.st.s5,.st.s0{color:var(--fail)}
.lat{display:flex;align-items:center;gap:8px;min-width:130px;direction:ltr}.lat i{display:block;height:5px;background:var(--ac);min-width:1px}
.trd td{background:#050505;padding:12px 16px;border-top:0}.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.trd h4{margin:0 0 6px;color:var(--mut);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
pre{margin:0 0 10px;padding:9px 11px;background:#0b0b0b;border:1px solid var(--bd);font:12px/1.5 Consolas,monospace;white-space:pre-wrap;word-break:break-all;direction:ltr;text-align:left;max-height:230px;overflow:auto}
.foot{margin-top:50px;color:var(--mut);font-size:12px;text-align:center}
[hidden]{display:none!important}
@media(max-width:700px){.hero{flex-direction:column;align-items:flex-start}.cols{grid-template-columns:1fr}}
@media print{:root{--bg:#fff;--card:#fff;--tx:#111;--mut:#555;--bd:#ddd;--bd2:#bbb;--moon:#000;--ac:#a86500;--pass:#1a7f37;--warn:#9a6700;--fail:#cf222e;--skip:#6e7781}
html,body{background:#fff}.bar,#eye{display:none}details.g:not([open])>*:not(summary){display:block}.num,.fix{background:#fff}.mini{background:#eee}.trd td,pre{background:#f6f6f6}}
`;

const T = {
  ar: { ok: "كل حاجة سليمة", warn: "في ملاحظات", bad: "محتاج تدخّل", pass: "نجح", warnN: "تحذير", fail: "فشل", skip: "اتخطّى", fix: "صلّح دول الأول", all: "الكل", search: "ابحث في النتائج…", open: "فتح الكل", close: "قفل الكل",
    traffic: "كل طلب ورد حصل", req: "طلب", failedReq: "فشل", avg: "متوسط الرد", slow: "أبطأ طلب", total: "الحجم", src: "المصدر", method: "النوع", status: "الحالة", url: "العنوان", size: "الحجم", time: "الزمن", reqH: "الطلب", resH: "الرد", body: "المحتوى", errors: "الأخطاء فقط", shots: "لقطات الشاشة", dur: "المدة", more: "طلبات لم تُعرض لتجاوز الحد", none: "ما اتسجلش أي طلب" },
  en: { ok: "Everything looks healthy", warn: "A few things to look at", bad: "Needs attention", pass: "Passed", warnN: "Warnings", fail: "Failed", skip: "Skipped", fix: "Fix these first", all: "All", search: "Search the results…", open: "Open all", close: "Close all",
    traffic: "Every request and answer", req: "requests", failedReq: "failed", avg: "avg response", slow: "slowest", total: "transferred", src: "Source", method: "Method", status: "Status", url: "Address", size: "Size", time: "Time", reqH: "Request", resH: "Response", body: "Body", errors: "Errors only", shots: "Screenshots", dur: "Duration", more: "more requests were not shown (limit)", none: "No requests were recorded" },
};

// Client script: plain strings only (no backticks), so it can live inside this file.
const JS = String.raw`
(function(){
var D=JSON.parse(document.getElementById("data").textContent),L=localStorage.getItem("mm_lang")||"ar";if(!D.T[L])L="ar";var T=D.T[L];
document.documentElement.lang=L;document.documentElement.dir=L==="ar"?"rtl":"ltr";
function $(i){return document.getElementById(i)}
function E(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
var s=D.summary,bad=s.fail>0,verdict=bad?T.bad:s.warn?T.warn:T.ok;document.body.className=bad?"bad":"";
document.title="Noctua - "+verdict;
$("verdict").textContent=verdict;
$("nums").innerHTML=[["pass",s.pass,T.pass],["warn",s.warn,T.warnN],["fail",s.fail,T.fail],["skip",s.skip,T.skip],["",D.rows.length?s.seconds+" s":"",T.dur]].filter(function(x){return x[1]!==""}).map(function(x){return '<div class="num '+x[0]+'"><b dir="ltr">'+x[1]+'</b><span>'+x[2]+'</span></div>'}).join("");
var fails=D.rows.filter(function(r){return r.level==="FAIL"});
$("fix").innerHTML=fails.length?'<h2>'+T.fix+'</h2><div class="fix">'+fails.map(function(r){return '<div class="it"><span class="g">'+E(r.group)+'</span><br><b>'+E(r.name)+'</b><div class="d">'+E(r.detail)+'</div></div>'}).join("")+'</div>':"";
var f="ALL",q="";
var groups=[];D.rows.forEach(function(r){if(groups.indexOf(r.group)<0)groups.push(r.group)});
function counts(g){var c={PASS:0,WARN:0,FAIL:0,SKIP:0};D.rows.forEach(function(r){if(r.group===g)c[r.level]++});return c}
$("groups").innerHTML=groups.map(function(g,i){var c=counts(g),t=c.PASS+c.WARN+c.FAIL+c.SKIP||1;
 var rows=D.rows.filter(function(r){return r.group===g}).map(function(r){return '<div class="row '+r.level+'" data-l="'+r.level+'" data-t="'+E((r.name+" "+r.detail).toLowerCase())+'"><span class="b">'+r.level+'</span><div class="rc"><div class="nm">'+E(r.name)+'</div><div class="dt">'+E(r.detail)+'</div></div>'+(r.shot?'<a class="shot" href="'+E(r.shot)+'" target="_blank"><img loading="lazy" src="'+E(r.shot)+'" alt=""></a>':"")+'</div>'}).join("");
 return '<details class="g"'+(c.FAIL||c.WARN?" open":"")+'><summary><span class="gn">'+E(g||"-")+'</span><span class="mini"><i style="width:'+c.PASS/t*100+'%;background:var(--pass)"></i><i style="width:'+c.WARN/t*100+'%;background:var(--warn)"></i><i style="width:'+c.FAIL/t*100+'%;background:var(--fail)"></i><i style="width:'+c.SKIP/t*100+'%;background:var(--skip)"></i></span><span class="dt">'+t+'</span></summary>'+rows+'</details>'}).join("");
function apply(){document.querySelectorAll("#groups .row").forEach(function(r){var ok=(f==="ALL"||r.dataset.l===f)&&(!q||r.dataset.t.indexOf(q)>=0);r.classList.toggle("hide",!ok)});
 document.querySelectorAll("#groups details.g").forEach(function(d){var any=d.querySelector(".row:not(.hide)");d.hidden=!any;if((q||f!=="ALL")&&any)d.open=true})}
var chips=[["ALL",T.all+" "+D.rows.length],["FAIL",T.fail+" "+s.fail],["WARN",T.warnN+" "+s.warn],["PASS",T.pass+" "+s.pass],["SKIP",T.skip+" "+s.skip]];
$("chips").innerHTML=chips.map(function(c){return '<button data-f="'+c[0]+'" class="'+(c[0]===f?"on":"")+'">'+c[1]+'</button>'}).join("")+'<input type="search" id="q" placeholder="'+T.search+'"><button id="oa">'+T.open+'</button><button id="ca">'+T.close+'</button>';
$("chips").onclick=function(e){var b=e.target.closest("button");if(!b)return;if(b.dataset.f){f=b.dataset.f;document.querySelectorAll("#chips [data-f]").forEach(function(x){x.classList.toggle("on",x===b)});apply()}else if(b.id==="oa")document.querySelectorAll("#groups details").forEach(function(d){d.open=true});else if(b.id==="ca")document.querySelectorAll("#groups details").forEach(function(d){d.open=false})};
$("q").oninput=function(){q=this.value.trim().toLowerCase();apply()};
// traffic
var X=D.traffic;
if(X.length){var ms=X.map(function(x){return x.ms}),mx=Math.max.apply(null,ms.concat([1])),fl=X.filter(function(x){return !x.status||x.status>=400}).length,tot=X.reduce(function(a,x){return a+(x.size||0)},0),sl=X.reduce(function(a,x){return x.ms>a.ms?x:a},X[0]);
 $("traffic").hidden=false;$("tt").textContent=T.traffic;
 $("tstat").innerHTML='<span><b>'+X.length+'</b> '+T.req+'</span><span><b style="color:'+(fl?"var(--fail)":"var(--pass)")+'">'+fl+'</b> '+T.failedReq+'</span><span><b>'+Math.round(ms.reduce(function(a,b){return a+b},0)/X.length)+' ms</b> '+T.avg+'</span><span><b>'+sl.ms+' ms</b> '+T.slow+'</span><span><b>'+(tot/1024).toFixed(0)+' KB</b> '+T.total+'</span>'+(D.dropped?'<span>+'+D.dropped+' '+T.more+'</span>':"");
 var srcs=["ALL"].concat(X.map(function(x){return x.src}).filter(function(v,i,a){return a.indexOf(v)===i}));var sf="ALL",ef=false;
 $("tfilter").innerHTML=srcs.map(function(x){return '<button data-s="'+x+'" class="'+(x==="ALL"?"on":"")+'">'+(x==="ALL"?T.all:x)+'</button>'}).join("")+'<button id="eo">'+T.errors+'</button>';
 function hd(o){var k=Object.keys(o||{});return k.length?k.map(function(h){return h+": "+o[h]}).join("\n"):"-"}
 function path(u){try{var a=new URL(u);return '<i>'+E(a.origin)+'</i>'+E(a.pathname+a.search)}catch(e){return E(u)}}
 $("thead").innerHTML="<tr>"+["#",T.time,T.src,T.method,T.status,T.url,"type",T.size,"ms"].map(function(h){return "<th>"+h+"</th>"}).join("")+"</tr>";
 $("tbody").innerHTML=X.map(function(x,i){var sc=x.status?"s"+String(x.status)[0]:"s0";
  return '<tr class="tr" data-i="'+i+'" data-s="'+x.src+'" data-e="'+(!x.status||x.status>=400?1:0)+'"><td>'+x.n+'</td><td>'+(x.at/1000).toFixed(1)+'s</td><td><span class="src '+x.src+'">'+x.src+'</span></td><td>'+E(x.method)+'</td><td class="st '+sc+'">'+(x.status||"ERR")+'</td><td class="u" title="'+E(x.url)+'">'+path(x.url)+'</td><td>'+E(x.type||"")+'</td><td dir="ltr">'+(x.size?(x.size<1024?x.size+" B":(x.size/1024).toFixed(1)+" KB"):"-")+'</td><td><div class="lat"><i style="width:'+Math.max(1,Math.round(x.ms/mx*90))+'px"></i>'+x.ms+' ms</div></td></tr><tr class="trd hide" data-d="'+i+'" data-s="'+x.src+'" data-e="'+(!x.status||x.status>=400?1:0)+'"><td colspan="9"><div class="cols"><div><h4>'+T.reqH+'</h4><pre>'+E(x.method+" "+x.url+"\n"+hd(x.reqHeaders))+'</pre>'+(x.reqBody?'<h4>'+T.body+'</h4><pre>'+E(x.reqBody)+'</pre>':"")+'</div><div><h4>'+T.resH+'</h4><pre>'+E((x.status?x.status+" "+(x.statusText||""):"ERROR "+x.error)+"\n"+hd(x.resHeaders))+'</pre>'+(x.resBody?'<h4>'+T.body+'</h4><pre>'+E(x.resBody)+'</pre>':"")+'</div></div></td></tr>'}).join("");
 function tapply(){document.querySelectorAll("#tbody tr").forEach(function(r){var ok=(sf==="ALL"||r.dataset.s===sf)&&(!ef||r.dataset.e==="1");if(r.classList.contains("trd")){r.dataset.ok=ok?"1":"0";if(!ok)r.classList.add("hide")}else{r.classList.toggle("hide",!ok);if(!ok){var d=document.querySelector('[data-d="'+r.dataset.i+'"]');if(d)d.classList.add("hide")}}})}
 $("tfilter").onclick=function(e){var b=e.target.closest("button");if(!b)return;if(b.id==="eo"){ef=!ef;b.classList.toggle("on",ef)}else{sf=b.dataset.s;document.querySelectorAll("#tfilter [data-s]").forEach(function(x){x.classList.toggle("on",x===b)})}tapply()};
 $("tbody").onclick=function(e){var r=e.target.closest("tr.tr");if(!r)return;var d=document.querySelector('[data-d="'+r.dataset.i+'"]');d.classList.toggle("hide")}}
})();
`;

export function writeReport(outDir, site, R) {
  fs.mkdirSync(outDir, { recursive: true });
  const summary = { site, finishedAt: new Date().toISOString(), seconds: Math.round((Date.now() - R.started) / 1000), pass: R.n("PASS"), warn: R.n("WARN"), fail: R.n("FAIL"), skip: R.n("SKIP") };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ summary, rows: R.rows }, null, 2));
  const entries = traffic.entries.slice();
  if (entries.length) fs.writeFileSync(path.join(outDir, "traffic.json"), JSON.stringify({ site, entries, dropped: traffic.dropped }, null, 2));
  const data = JSON.stringify({ summary, rows: R.rows, traffic: entries, dropped: traffic.dropped, T }).replace(/</g, "\\u003c");
  const worst = summary.fail ? "FAIL" : summary.warn ? "WARN" : "PASS";
  const eye = `<svg id="eye" viewBox="0 0 120 120" aria-hidden="true"><defs><radialGradient id="g" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="${worst === "FAIL" ? "#ffb3a8" : "#ffe7a3"}"/><stop offset=".55" stop-color="${worst === "FAIL" ? "#ff4b4b" : "#ffb000"}"/><stop offset="1" stop-color="${worst === "FAIL" ? "#7a1b1b" : "#8a5a00"}"/></radialGradient><clipPath id="c"><circle cx="60" cy="60" r="50"/></clipPath></defs><circle cx="60" cy="60" r="55" fill="#050505" stroke="#3a3a3a" stroke-width="2"/><circle cx="60" cy="60" r="50" fill="#0d0d0d"/><g clip-path="url(#c)"><circle cx="60" cy="60" r="34" fill="url(#g)"/><ellipse cx="60" cy="60" rx="${worst === "FAIL" ? 9 : 14}" ry="22" fill="#05040d"/><circle cx="52" cy="50" r="5" fill="#fff" opacity=".85"/>${worst === "FAIL" ? '<rect x="0" y="0" width="120" height="46" fill="#000"/>' : ""}</g></svg>`;
  const icon = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#000"/><circle cx="32" cy="32" r="18" fill="${worst === "FAIL" ? "#ff4b4b" : "#ffb000"}"/><ellipse cx="32" cy="32" rx="6" ry="12" fill="#000"/></svg>`);
  fs.writeFileSync(path.join(outDir, "report.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Noctua</title><link rel="icon" href="${icon}"><style>${CSS}</style></head><body>
<div class="wrap"><div class="hero">${eye}<div><div class="brand">NOCTUA</div><h1 id="verdict"></h1><div class="site">${String(site).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))} &middot; ${summary.finishedAt.replace("T", " ").slice(0, 16)} UTC</div></div></div>
<div class="nums" id="nums"></div><div id="fix"></div>
<div class="bar" id="chips"></div><div id="groups"></div>
<section id="traffic" hidden><h2 id="tt"></h2><div class="tstat" id="tstat"></div><div class="bar" id="tfilter" style="position:static;border:0;padding:0 0 10px"></div>
<div class="tw"><table><thead id="thead"></thead><tbody id="tbody"></tbody></table></div></section>
<div class="foot">Noctua &middot; the owl that sees in the dark</div></div>
<script id="data" type="application/json">${data}</script><script>${JS}</script></body></html>`);
  return summary;
}
