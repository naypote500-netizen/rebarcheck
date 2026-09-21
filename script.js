"use strict";
/* ============================================================================
   RebarCheck — ตรวจเหล็กเสริมก่อนเทคอนกรีต (single file, vanilla JS)
   ลำดับการใช้งาน:  โครงการ → ชั้น → ชิ้นส่วน → เช็คลิสต์ก่อนเท
   ประเภทชิ้นส่วน:  เสา / คาน / พื้น RC / บันได / ผนัง Shear wall / ฐานราก / พื้น Post-tension
   ---------------------------------------------------------------------------
   โครงสร้างโค้ด
     1) ตัวช่วยทั่วไป
     2) นิยามประเภทชิ้นส่วน + สคีมาฟิลด์ (ใช้สร้างฟอร์มและตารางสเปกอัตโนมัติ)
     3) เช็คลิสต์แยกตามประเภท
     4) ชั้นเก็บข้อมูล (localStorage) + ข้อมูลตัวอย่าง
     5) การวาดรูปหน้าตัดด้วย SVG (คำนวณจากข้อมูลจริง)
     6) การเรนเดอร์แต่ละหน้าจอ
     7) ฟอร์ม / Dialog / เหตุการณ์ / เริ่มระบบ
   ========================================================================== */

/* ---------------------------------------------------------------------------
   1) ตัวช่วยทั่วไป
   ------------------------------------------------------------------------ */
var STORE_KEY = "rebarcheck.v2";
var OLD_KEY   = "rebarcheck.v1";
var CLEAR_MIN = 25;                       // ระยะช่องว่างระหว่างเหล็กขั้นต่ำ (มม.)
var DIA_LIST  = [6,9,12,16,20,25,28,32];  // ขนาดเหล็กข้ออ้อย
var RB_LIST   = [6,9,12];                 // ขนาดเหล็กปลอก
var STIR_LIST = [6,9,10,12,16];           // ขนาดเหล็กปลอกคาน (รองรับ DB16/DB10 ตามตารางคาน)
var PRESET_COLORS = ["#f59e0b","#f97316","#ef4444","#e11d48","#ec4899","#d946ef","#a855f7","#8b5cf6","#6366f1","#3b82f6","#0ea5e9","#06b6d4","#14b8a6","#10b981","#22c55e","#84cc16","#eab308","#d97706","#92400e","#78716c","#6b7280","#475569","#111827","#ffffff"];  // จานสี 24 สี (3 แถว)
/* สถานีตามความยาวคาน — เหล็กเสริมเปลี่ยนตามตำแหน่ง (ตามตารางรายละเอียดคาน) */
var BEAM_STATIONS = [
  { k:"ext",  l:"หัวเสาริม (Exterior)",  short:"ริม" },
  { k:"mid",  l:"กลางช่วง (Mid span)",   short:"กลาง" },
  { k:"intr", l:"หัวเสากลาง (Interior)", short:"กลางเสา" },
  { k:"can",  l:"คานยื่น (Cantilever)",  short:"ยื่น" }
];

function $(s,r){ return (r||document).querySelector(s); }
function $$(s,r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }
function esc(s){
  return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function uid(p){ return (p||"id")+"_"+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function num(v,d){ var n=parseFloat(v); return isFinite(n)?n:(d||0); }
function fmtTime(ts){
  try{
    return new Date(ts).toLocaleString("th-TH",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
  }catch(e){ return new Date(ts).toISOString(); }
}
var toastTimer=null;
function toast(msg,isErr){
  var el=$("#toast"); el.textContent=msg; el.className="show"+(isErr?" err":"");
  clearTimeout(toastTimer); toastTimer=setTimeout(function(){ el.className=""; },2600);
}
/** แถบสถานะกลางจอ — kind: "busy" (สปินเนอร์) | "error" (ค้างไว้ มีปุ่มปิด) | null (ซ่อน) */
function setPlanStatus(msg, kind){
  var el=document.getElementById("planBusy");
  if(!el){
    el=document.createElement("div"); el.id="planBusy";
    el.innerHTML='<span class="spin"></span><span class="bt"></span>'
      +'<button class="cl" title="ปิด">✕</button>';
    el.querySelector(".cl").addEventListener("click",function(){ el.classList.remove("show"); });
    document.body.appendChild(el);
  }
  if(!msg){ el.classList.remove("show"); return; }
  el.querySelector(".bt").textContent=msg;
  var isErr = (kind==="error");
  el.classList.toggle("err", isErr);
  el.querySelector(".spin").style.display = isErr ? "none" : "";
  el.querySelector(".cl").style.display   = isErr ? "" : "none";
  el.classList.add("show");
}
function setPlanBusy(msg){ setPlanStatus(msg, msg?"busy":null); }   // เข้ากันได้กับโค้ดเดิม

/** log — ปิดแผงดำบนจอแล้ว เหลือแค่ console (เปิดกลับด้วย window.__planLogUI=true ถ้าต้องดีบัก) */
function planLog(msg, isErr){
  try{ (isErr?console.warn:console.log)("[plan] "+msg); }catch(e){}
  if(!window.__planLogUI) return;
  try{
    var el=document.getElementById("planLog");
    if(!el){
      el=document.createElement("div"); el.id="planLog";
      el.innerHTML='<div class="lh">บันทึกการนำเข้า <button class="lx">ปิด</button></div><div class="lb"></div>';
      el.querySelector(".lx").addEventListener("click",function(){ el.classList.remove("show"); });
      document.body.appendChild(el);
    }
    var body=el.querySelector(".lb");
    var line=document.createElement("div");
    line.className="ll"+(isErr?" e":"");
    line.textContent=new Date().toLocaleTimeString("th-TH")+"  "+msg;
    body.appendChild(line);
    while(body.childNodes.length>10) body.removeChild(body.firstChild);
    body.scrollTop=body.scrollHeight;
    el.classList.add("show");
  }catch(e){}
}
/** ป้ายสถานะเล็ก มุมล่างซ้ายของกรอบแปลน — ใช้บอกผลเรนเดอร์ความคม (auto-hide) */
function planTip(msg, err){
  try{
    var el=document.getElementById("planTip");
    if(!el){ el=document.createElement("div"); el.id="planTip"; document.body.appendChild(el); }
    el.textContent=msg; el.className=err?"err show":"show";
    clearTimeout(el._t); el._t=setTimeout(function(){ el.classList.remove("show"); }, 3500);
  }catch(e){}
}
/** ระยะจากผิวคอนกรีตถึงศูนย์กลางเหล็กหลัก (มี cover + เหล็กปลอกคั่น) */
function barInset(cover, stirDia, mainDia){ return cover + stirDia + mainDia/2; }
/** จำนวนเหล็กในแถบกว้าง width ที่ระยะเรียง sp (นับปลายทั้งสองข้าง) */
function barsInStrip(width, sp){ return Math.max(2, Math.floor(width/Math.max(sp,10)) + 1); }

/* ---------------------------------------------------------------------------
   2) นิยามประเภทชิ้นส่วน + สคีมาฟิลด์
   ------------------------------------------------------------------------ */
var TYPES = {
  column : { label:"เสา",               ab:"C",  css:"column",  hint:"เสารับน้ำหนัก" },
  beam   : { label:"คาน",               ab:"B",  css:"beam",    hint:"คานรับพื้น / คานซอย" },
  slab   : { label:"พื้น RC",           ab:"S",  css:"slab",    hint:"พื้นคอนกรีตเสริมเหล็ก" },
  stair  : { label:"บันได",             ab:"ST", css:"stair",   hint:"บันได ค.ส.ล." },
  wall   : { label:"ผนัง Shear wall",   ab:"W",  css:"wall",    hint:"ผนังรับแรงเฉือน" },
  footing: { label:"ฐานราก",            ab:"F",  css:"footing", hint:"ฐานรากแผ่ / ฐานรากเสาเข็ม" },
  pt     : { label:"พื้น Post-tension", ab:"PT", css:"pt",      hint:"พื้นอัดแรงภายหลัง" }
};
var TYPE_ORDER = ["footing","column","wall","beam","slab","stair","pt"];
var TYPE_EN = { footing:"Footing", column:"Column", wall:"Wall", beam:"Beam", slab:"Slab", stair:"Stair", pt:"Post-tension" };

/* ตัวช่วยประกาศฟิลด์: n=ตัวเลข(มม.), m=ตัวเลข(เมตร แต่เก็บภายในเป็นมม.), dia=เลือก DB, rb=เลือก RB, txt=ข้อความ */
var F = {
  n  :function(k,l,d,step,unit){ return {k:k,l:l,t:"num",def:d,step:step||1,unit:unit||"มม."}; },
  m  :function(k,l,dMm,stepM){ return {k:k,l:l,t:"m",def:dMm,step:stepM||0.05,unit:"ม."}; },
  dia:function(k,l,d){ return {k:k,l:l,t:"dia",def:d}; },
  rb :function(k,l,d){ return {k:k,l:l,t:"rb", def:d}; },
  stir:function(k,l,d){ return {k:k,l:l,t:"stir",def:d}; },   // ปลอก DB (รองรับ DB10/12/16)
  txt:function(k,l,d){ return {k:k,l:l,t:"text",def:d||""}; },
  sel:function(k,l,d,opts){ return {k:k,l:l,t:"sel",def:d,opts:opts}; },   // dropdown: opts=[{v,t}]
  bool:function(k,l,d){ return {k:k,l:l,t:"bool",def:d?1:0}; }             // checkbox → 0/1
};

var EDGE_OPTS=[{v:"beam",t:"RC.BEAM (คาน)"},{v:"wall",t:"RC.WALL (ผนัง)"},{v:"free",t:"ปลายยื่น/อิสระ"}];
/* สคีมาฟิลด์แยกตามประเภท — ใช้สร้างฟอร์มและอ่านค่ากลับอัตโนมัติ */
var FIELDS = {
  column: [
    { g:"ขนาดหน้าตัด", f:[ F.m("b","ความกว้าง b",400,0.05), F.m("h","ความลึก h",400,0.05),
                          F.m("cover","ระยะหุ้ม covering",30,0.005), F.m("height","ความสูงเสา (ต่อชั้น)",3000,0.1) ] },
    { g:"เหล็กยืน (เมน)", f:[ F.n("nx","nx (แนวกว้าง b / บน-ล่าง)",3,1,"เส้น"), F.n("ny","ny (แนวลึก h / ซ้าย-ขวา)",13,1,"เส้น"),
                          F.dia("mainDia","ขนาดเหล็กยืน",20) ] },
    { g:"เหล็กปลอก (Tie)", f:[ F.stir("stirDia","ปลอกนอก ขนาด",12), F.stir("tieInnerDia","ปลอกใน ขนาด",10),
                          F.n("stirFirst","S1 · ปลอกตัวแรกจากขอบคาน/พื้น",50,5), F.n("stirEnd","So · ระยะปลอกในช่วง Lo (อัดแน่น)",150,25),
                          F.n("stirMid","ระยะปลอกช่วงกลางเสา",200,25), F.m("l0","ระยะ Lo (อัดแน่นปลายเสา)",600,0.05) ] }
    /* ปลอกรัดใน (หลายวง — กด + เพิ่มได้) จัดการใน viewMemberForm (#cieBox) · เหล็กเสริมพิเศษ (2 ทิศทาง) ใน #spRebarBox */
  ],
  beam: [
    { g:"ขนาดหน้าตัด", f:[ F.m("b","ความกว้าง b",200,0.05), F.m("h","ความลึก h",400,0.05), F.m("cover","ระยะหุ้ม covering",25,0.005),
                          F.m("span","ช่วงพาด (span)",4000,0.5) ] }
    /* เหล็กเสริมของคาน กรอกแบบ "รายสถานี" (ext/mid/intr/can) ใน viewMemberForm */
  ],
  slab: [
    { g:"ขนาด & ช่วง", f:[ F.m("h","ความหนาพื้น",150,0.01), F.m("cover","ระยะหุ้ม covering",20,0.005),
                        F.m("spanS","ช่วง (span)",4000,0.1),
                        F.sel("endL","ขอบรับ ปลายซ้าย",'beam',EDGE_OPTS), F.sel("endR","ขอบรับ ปลายขวา",'beam',EDGE_OPTS) ] },
    { g:"เหล็กตามยาว — วาดเป็นเส้นยาว (บน/ล่าง)", f:[ F.dia("topMainDia","บน ขนาด",12), F.n("topMainSp","บน ระยะเรียง @",200,25),
                        F.dia("botMainDia","ล่าง ขนาด",12), F.n("botMainSp","ล่าง ระยะเรียง @",200,25) ] },
    { g:"เหล็กตามขวาง — วาดเป็นจุด (บน/ล่าง)", f:[ F.dia("topDistDia","บน ขนาด",12), F.n("topDistSp","บน ระยะเรียง @",200,25),
                        F.dia("botDistDia","ล่าง ขนาด",12), F.n("botDistSp","ล่าง ระยะเรียง @",200,25) ] },
    { g:"เหล็กบนเสริมที่หัวรับ (ยื่น, 0 = ไม่มี)", f:[ F.m("topExtL","ยื่นจากปลายซ้าย",0,0.05), F.m("topExtR","ยื่นจากปลายขวา",0,0.05) ] }
  ],
  stair: [
    { g:"รูปทรงบันได", f:[ F.m("riser","ลูกตั้ง (สูงขั้น)",175,0.005), F.m("tread","ลูกนอน (กว้างขั้น)",250,0.005),
                          F.n("steps","จำนวนขั้น",10,1,"ขั้น") ] },
    { g:"แผ่นพื้นบันได", f:[ F.m("waist","ความหนาท้องบันได",150,0.01), F.m("cover","ระยะหุ้ม covering",20,0.005) ] },
    { g:"เหล็กเสริม", f:[ F.dia("mainDia","เหล็กหลัก (ตามความชัน) ขนาด",12), F.n("mainSp","เหล็กหลัก ระยะเรียง @",150,25),
                        F.dia("distDia","เหล็กแจกจ่าย ขนาด",9), F.n("distSp","เหล็กแจกจ่าย ระยะเรียง @",200,25) ] }
  ],
  wall: [
    { g:"ขนาดผนัง", f:[ F.m("t","ความหนาผนัง",200,0.01), F.m("Lw","ความยาวผนัง",3000,0.05),
                       F.m("cover","ระยะหุ้ม covering",25,0.005), F.n("layers","จำนวนตะแกรง (1 หรือ 2)",2,1,"ชั้น") ] },
    { g:"เหล็กตั้ง", f:[ F.dia("vertDia","ขนาด",12), F.n("vertSp","ระยะเรียง @",200,25) ] },
    { g:"เหล็กนอน",  f:[ F.dia("horizDia","ขนาด",12), F.n("horizSp","ระยะเรียง @",200,25) ] }
  ],
  footing: [
    { g:"ขนาดฐานราก", f:[ F.m("B","ความกว้าง B",1500,0.05), F.m("L","ความยาว L",1500,0.05),
                         F.m("H","ความหนา H",400,0.05), F.m("cover","ระยะหุ้มก้นฐาน",50,0.005) ] },
    { g:"เหล็กล่าง",  f:[ F.dia("botDiaB","ทางกว้าง B ขนาด",16), F.n("botSpB","ทางกว้าง B ระยะเรียง @",150,25),
                         F.dia("botDiaL","ทางยาว L ขนาด",16),  F.n("botSpL","ทางยาว L ระยะเรียง @",150,25) ] },
    { g:"อื่น ๆ",     f:[ F.dia("topDia","เหล็กบน ขนาด (0 = ไม่มี)",0), F.n("topSp","เหล็กบน ระยะเรียง @",200,25),
                         F.n("pileCount","จำนวนเสาเข็ม (0 = ฐานแผ่)",0,1,"ต้น") ] }
  ],
  pt: [
    { g:"ขนาดแผ่นพื้น", f:[ F.m("h","ความหนาพื้น",200,0.01), F.m("span","ช่วงพาด (span)",8000,0.1), F.m("cover","ระยะหุ้ม covering",25,0.005) ] },
    { g:"เส้นเอ็น (Tendon)", f:[ F.txt("tendonType","ชนิดเอ็น","4-strand flat 12.7 มม."),
                         F.n("tendonQty","จำนวนเอ็นในแถบ",6,1,"เส้น"), F.n("tendonSp","ระยะห่างเอ็น @",1000,50) ] },
    { g:"ระดับเอ็นจากท้องพื้น (CGS)", f:[ F.m("cgsEnd","ที่หัวเสา",150,0.005), F.m("cgsMid","ที่กลางช่วง",40,0.005) ] },
    { g:"เหล็กเสริมธรรมดา", f:[ F.dia("rebarDia","เหล็กล่าง ขนาด",12), F.n("rebarSp","เหล็กล่าง ระยะเรียง @",200,25) ] }
  ]
};

/* ---------------------------------------------------------------------------
   3) เช็คลิสต์ก่อนเทคอนกรีต แยกตามประเภท
      crit:true = ข้อวิกฤต (แถบน้ำเงิน + ป้าย "สำคัญ")
   ------------------------------------------------------------------------ */
/** ข้อที่ทุกประเภทต้องตรวจเหมือนกัน — ตำแหน่งและรหัส คือต้นเหตุของการอ่านแบบผิด */
function headItems(word, hint){
  return [
    {id:"pos",  crit:true, t:"ตำแหน่งติดตั้งตรงกับแบบ — ถูกชั้น และถูกแนวเสา (grid)",
                hint: hint || "ยืนที่จุดจริง อ่านชั้นและแนวเสาในแบบซ้ำอีกรอบก่อนติ๊ก"},
    {id:"code", crit:true, t:"รหัส"+word+" (Mark) ตรงกับแบบ ไม่สลับกับตัวข้างเคียง",
                hint:"รหัสที่ต่างกันแค่ตัวอักษรเดียว เช่น B3 กับ B3A หน้าตัดมักต่างกัน"}
  ];
}
var TAIL_CLEAN = {id:"clean", crit:false, t:"แบบหล่อสะอาด แน่นหนา ค้ำยันมั่นคง ไม่มีเศษวัสดุตกค้าง"};
var TAIL_COVER = {id:"cover", crit:true,  t:"ระยะหุ้มคอนกรีต (covering) ครบทุกด้าน มีลูกปูนหนุน"};

var CHECKLIST = {
  beam: headItems("คาน").concat([
    {id:"size", t:"ขนาดหน้าตัด b × h ตรงกับแบบ (วัดจริงด้วยตลับเมตร)"},
    {id:"topn", crit:true, t:"จำนวนเหล็กบน ครบตามแบบ (นับจริงทีละเส้น)"},
    {id:"botn", crit:true, t:"จำนวนเหล็กล่าง ครบตามแบบ (นับจริงทีละเส้น)"},
    {id:"dia",  crit:true, t:"ขนาดเหล็ก (DB) ถูกต้อง ไม่สลับขนาด",
                hint:"DB16 กับ DB20 ดูด้วยตาแยกยาก ให้วัดหรือดูป้ายมัดเหล็ก"},
    {id:"swap", crit:true, t:"เหล็กบน–ล่าง ไม่สลับด้าน",
                hint:"เทียบกับรูปหน้าตัดด้านบน จำนวนและขนาดด้านบนต้องตรงกับที่แสดง"},
    {id:"stir", t:"ระยะเรียงเหล็กปลอกถูกต้อง ทั้งช่วงปลายและช่วงกลาง"},
    {id:"hook", t:"ขอเหล็กปลอกงอ 135° และสลับตำแหน่งขอ ไม่กองด้านเดียว"},
    TAIL_COVER,
    {id:"lap",  t:"ตำแหน่งต่อทาบเหล็ก ถูกตำแหน่งและความยาวตามแบบ"},
    TAIL_CLEAN
  ]),

  column: headItems("เสา","เช็คระยะจากแนว grid ทั้งสองแกน ไม่ใช่แค่แกนเดียว").concat([
    {id:"orient", crit:true, t:"ทิศทางหน้าตัดถูกต้อง (ด้านยาวหันตามแบบ ไม่วางกลับด้าน)",
                  hint:"เสาหน้าตัดสี่เหลี่ยมผืนผ้าเป็นจุดพลาดบ่อยที่สุด"},
    {id:"size",  t:"ขนาดหน้าตัด b × h ตรงกับแบบ"},
    {id:"mainn", crit:true, t:"จำนวนเหล็กยืน ครบตามแบบ และกระจายตรงตำแหน่งในรูปหน้าตัด"},
    {id:"dia",   crit:true, t:"ขนาดเหล็กยืน (DB) ถูกต้อง ไม่สลับขนาด"},
    {id:"stir",  t:"ระยะเรียงเหล็กปลอกถูกต้อง ทั้งช่วงหัว-ท้ายเสาและช่วงกลาง"},
    {id:"hook",  t:"ขอเหล็กปลอกงอ 135° และมีเหล็กปลอกรัดเสริม (tie) ตามแบบ"},
    TAIL_COVER,
    {id:"lap",   t:"ตำแหน่งต่อทาบเหล็กยืน อยู่ในช่วงที่แบบกำหนด"},
    {id:"plumb", t:"เสาได้ดิ่ง ค้ำยันแบบหล่อมั่นคง"},
    TAIL_CLEAN
  ]),

  slab: headItems("พื้น","เช็คว่าอยู่ในช่วงเสาที่ถูกต้อง พื้นแต่ละช่วงเหล็กไม่เหมือนกัน").concat([
    {id:"thick", crit:true, t:"ความหนาพื้นตรงกับแบบ (วัดจริงหลายจุด)"},
    {id:"botr",  crit:true, t:"เหล็กล่าง ทางสั้น–ทางยาว ขนาดและระยะเรียงถูกต้อง"},
    {id:"topr",  crit:true, t:"เหล็กบนบริเวณหัวเสา / ขอบต่อเนื่อง ครบตามแบบ"},
    {id:"layer", crit:true, t:"เหล็กบน–ล่าง ไม่สลับชั้น และเหล็กทางสั้นอยู่ชั้นนอก",
                 hint:"ทางสั้นต้องอยู่นอกสุด เพื่อให้ได้ความลึกประสิทธิผลสูงสุด"},
    {id:"open",  t:"เหล็กเสริมพิเศษรอบช่องเปิด ครบตามแบบ"},
    {id:"chair", crit:true, t:"เก้าอี้เหล็ก (bar chair) และลูกปูนหนุนครบ เหล็กบนไม่ยุบ"},
    {id:"pipe",  t:"ท่อร้อยสายไฟ / ท่อสุขาภิบาล ไม่ตัดผ่านตำแหน่งเหล็กหลัก"},
    {id:"lap",   t:"ระยะทาบเหล็ก ถูกตำแหน่งและความยาว"},
    TAIL_CLEAN
  ]),

  stair: headItems("บันได").concat([
    {id:"step",  crit:true, t:"ลูกตั้ง–ลูกนอน ตรงกับแบบทุกขั้น (วัดจริง)",
                 hint:"ขั้นแรกและขั้นสุดท้ายมักคลาดเคลื่อนจากระดับพื้นจริง"},
    {id:"waist", t:"ความหนาท้องบันได (waist) ตรงกับแบบ"},
    {id:"mainr", crit:true, t:"เหล็กหลักตามความชัน จำนวน / ขนาด / ระยะเรียง ถูกต้อง"},
    {id:"side",  crit:true, t:"เหล็กหลักอยู่ด้านท้องบันได ไม่กลับด้านขึ้นบน"},
    {id:"corner",crit:true, t:"เหล็กเสริมบนบริเวณหักมุม (ชานพัก / โคนบันได) ครบตามแบบ",
                 hint:"จุดหักมุม ถ้าดัดเหล็กผิดทิศ เหล็กจะดันคอนกรีตแตก"},
    {id:"embed", t:"ระยะฝังเหล็กเข้าคาน / ชานพัก ครบตามแบบ"},
    {id:"dist",  t:"เหล็กแจกจ่าย ระยะเรียงถูกต้อง"},
    TAIL_COVER,
    TAIL_CLEAN
  ]),

  wall: headItems("ผนัง","ผนัง Shear wall ต้องตรงแนว grid ทั้งตำแหน่งและทิศทางความยาว").concat([
    {id:"size",   crit:true, t:"ความหนาผนังและความยาวผนัง ตรงกับแบบ"},
    {id:"layers", crit:true, t:"จำนวนตะแกรง (1 หรือ 2 ชั้น) ถูกต้อง"},
    {id:"vert",   crit:true, t:"เหล็กตั้ง ขนาด / ระยะเรียง ถูกต้อง"},
    {id:"horiz",  crit:true, t:"เหล็กนอน ขนาด / ระยะเรียง ถูกต้อง"},
    {id:"bound",  crit:true, t:"เหล็กเสริมปลายผนัง (boundary element) ครบตามแบบ"},
    {id:"tie",    t:"เหล็กยึดระหว่างตะแกรง (cross tie) ครบและผูกแน่น"},
    {id:"open",   t:"เหล็กเสริมรอบช่องเปิด ครบตามแบบ"},
    {id:"dowel",  crit:true, t:"เหล็กหนวดกุ้งต่อจากชั้นล่าง ตรงตำแหน่งและระยะทาบครบ"},
    TAIL_COVER,
    {id:"plumb",  t:"ผนังได้ดิ่ง แบบหล่อค้ำยันมั่นคง"}
  ]),

  footing: headItems("ฐานราก","ฐานรากต้องเช็คระยะจากแนว grid ทั้งสองแกน วัดจากหมุดจริง").concat([
    {id:"level", crit:true, t:"ระดับก้นหลุมและระดับหลังฐานราก ตรงกับแบบ"},
    {id:"size",  crit:true, t:"ขนาดฐานราก B × L × ความหนา ตรงกับแบบ"},
    {id:"pile",  crit:true, t:"จำนวนและตำแหน่งเสาเข็มตรงกับแบบ สกัดหัวเข็มได้ระดับ"},
    {id:"botr",  crit:true, t:"เหล็กล่างทั้ง 2 ทาง ขนาด / ระยะเรียง ถูกต้อง"},
    {id:"hook",  t:"เหล็กล่างงอปลาย (hook) ตามแบบ"},
    {id:"dowel", crit:true, t:"เหล็กหนวดกุ้ง / เหล็กยืนตอม่อ ตรงตำแหน่งเสา และได้ดิ่ง",
                 hint:"ผิดตำแหน่งตรงนี้ เสาชั้นบนจะเยื้องศูนย์ทั้งต้น"},
    {id:"cover", crit:true, t:"ระยะหุ้มก้นฐานราก มีลูกปูนหนุน ไม่วางเหล็กติดดิน"},
    {id:"lean",  t:"ทรายรอง / คอนกรีตหยาบ ได้ระดับและแน่น"},
    {id:"clean", t:"หลุมสะอาด ไม่มีน้ำขังหรือดินร่วงทับเหล็ก"}
  ]),

  pt: headItems("แผงพื้น / แนวเอ็น").concat([
    {id:"qty",   crit:true, t:"จำนวนเส้นเอ็นและระยะห่าง ตรงกับแบบ"},
    {id:"cgsE",  crit:true, t:"ระดับเอ็น (CGS) ที่หัวเสา ตรงกับแบบ — วัดจากท้องพื้น",
                 hint:"เทียบกับรูปโปรไฟล์ด้านบน คลาดเคลื่อนเกิน 5 มม. ให้แก้ก่อนเท"},
    {id:"cgsM",  crit:true, t:"ระดับเอ็น (CGS) ที่กลางช่วง ตรงกับแบบ — วัดจากท้องพื้น"},
    {id:"curve", crit:true, t:"รูปโค้งเอ็นต่อเนื่อง ไม่หักมุม ไม่มีจุดยุบระหว่างเก้าอี้"},
    {id:"chair", crit:true, t:"เก้าอี้รองเอ็น (support bar) ระยะไม่เกินที่กำหนด และผูกแน่น"},
    {id:"anch",  crit:true, t:"หัวยึด (anchorage) ได้ฉาก ตั้งตรง และเสริมเหล็กหลังหัวยึดครบ"},
    {id:"duct",  t:"ปลอกหุ้มเอ็นไม่ฉีกขาด ไม่มีน้ำเข้า ปลายปิดเรียบร้อย"},
    {id:"rebar", t:"เหล็กเสริมธรรมดา (กันร้าว / bonded) ครบตามแบบ"},
    {id:"open",  crit:true, t:"ช่องเปิดและท่องานระบบ ไม่ตัดผ่านแนวเอ็น"},
    TAIL_COVER
  ])
};

/* ---------------------------------------------------------------------------
   4) ชั้นเก็บข้อมูล (localStorage) — ครอบ try/catch ทุกจุด
      โครงสร้าง: projects[] → floors[] (อ้าง projectId) → members[] (อ้าง floorId)
   ------------------------------------------------------------------------ */
var DB = { projects:[], floors:[], members:[], inspections:[], zones:[], inspector:"" };

function loadDB(){
  try{
    var raw = localStorage.getItem(STORE_KEY);
    if(raw){
      var p = JSON.parse(raw);
      DB = {
        projects:    Array.isArray(p.projects)    ? p.projects    : [],
        floors:      Array.isArray(p.floors)      ? p.floors      : [],
        members:     Array.isArray(p.members)     ? p.members     : [],
        inspections: Array.isArray(p.inspections) ? p.inspections : [],
        inspector:   typeof p.inspector === "string" ? p.inspector : ""
      };
      return;
    }
    DB = migrateV1() || seedData();   // มีข้อมูลเวอร์ชันเก่า → ย้ายเข้าโครงการเดียว
    saveDB();
  }catch(err){
    console.warn("โหลดข้อมูลไม่สำเร็จ ใช้ข้อมูลตัวอย่างแทน:", err);
    DB = seedData();
  }
}
function saveDB(){
  var lsOk=true;
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(DB)); }catch(err){ lsOk=false; console.warn("localStorage บันทึกไม่สำเร็จ:", err); }
  if(CLOUD && _fbUser && _fbLoaded){ scheduleCloudSync(); return true; }   // คลาวด์เป็นตัวจริง (localStorage เป็นแค่แคช)
  if(!lsOk) toast("บันทึกไม่สำเร็จ — พื้นที่เก็บอาจเต็ม ลองลบรูปถ่ายเก่าออก", true);
  return lsOk;
}
/** ย้ายข้อมูลเวอร์ชัน 1 (ยังไม่มีระบบโครงการ) เข้ามาเป็นโครงการเดียว */
function migrateV1(){
  var raw;
  try{ raw = localStorage.getItem(OLD_KEY); }catch(e){ return null; }
  if(!raw) return null;
  try{
    var old = JSON.parse(raw);
    if(!Array.isArray(old.members) || old.members.length === 0) return null;
    var proj = { id:uid("p"), name:"โครงการ (ข้อมูลเดิม)", location:"", createdAt:Date.now() };
    var floors = [], map = {};
    old.members.forEach(function(m){
      var fname = m.floor || "ไม่ระบุชั้น";
      if(!map[fname]){
        map[fname] = { id:uid("f"), projectId:proj.id, name:fname, level:"", createdAt:Date.now() };
        floors.push(map[fname]);
      }
      m.projectId = proj.id;
      m.floorId   = map[fname].id;
      m.name      = m.name || "";
    });
    return { projects:[proj], floors:floors, members:old.members,
             inspections: Array.isArray(old.inspections) ? old.inspections : [],
             inspector: typeof old.inspector === "string" ? old.inspector : "" };
  }catch(e){ return null; }
}

/* ---- ตัวช่วยค้นข้อมูล ---- */
function getProject(id){ return DB.projects.filter(function(x){ return x.id===id; })[0] || null; }
function getFloor(id){   return DB.floors.filter(function(x){ return x.id===id; })[0] || null; }
function getMember(id){  return DB.members.filter(function(x){ return x.id===id; })[0] || null; }
function floorsOf(pid){
  return DB.floors.filter(function(f){ return f.projectId===pid; })
    .sort(function(a,b){
      var la=parseFloat(a.level), lb=parseFloat(b.level);
      // เรียงจากล่างขึ้นบน ตามลำดับการก่อสร้างจริง
      if(isFinite(la) && isFinite(lb) && la!==lb) return la-lb;
      return (a.createdAt||0)-(b.createdAt||0);
    });
}
function membersOfFloor(fid){   return DB.members.filter(function(m){ return m.floorId===fid; }); }
function membersOfProject(pid){ return DB.members.filter(function(m){ return m.projectId===pid; }); }
function getZone(id){    return DB.zones.filter(function(z){ return z.id===id; })[0] || null; }
function zonesOfFloor(fid){ return (DB.zones||[]).filter(function(z){ return z.floorId===fid; }); }
function zonesOfPlan(fid, planId){ return (DB.zones||[]).filter(function(z){ return z.floorId===fid && z.planId===planId; }); }
/* ---- สถานะโซนเท (กำหนดเองได้ แยกตามแต่ละแปลน/ชั้น) ---- */
var DEFAULT_ZONE_STATUSES=[
  {id:"done",    label:"เทแล้ว", color:"#22c55e"},
  {id:"progress",label:"กำลังเท",color:"#eab308"},
  {id:"pending", label:"รอเท",   color:"#94a3b8"}
];
/** รายการสถานะของแปลนนั้น (สร้างค่าเริ่มต้นถ้ายังไม่มี) */
function zoneStatuses(fid, planId){
  var f=getFloor(fid);
  if(!f) return DEFAULT_ZONE_STATUSES.map(function(s){ return Object.assign({},s); });
  if(!f.zoneStatusMap) f.zoneStatusMap={};
  if(!f.zoneStatusMap[planId] || !f.zoneStatusMap[planId].length)
    f.zoneStatusMap[planId]=DEFAULT_ZONE_STATUSES.map(function(s){ return Object.assign({},s); });
  return f.zoneStatusMap[planId];
}
/** หาสถานะตาม id (ถ้าไม่พบใช้ตัวแรก/เทา) */
function getZoneStatus(fid, planId, id){
  var list=zoneStatuses(fid,planId);
  return list.filter(function(s){ return s.id===id; })[0] || list[0] || {id:id,label:id||"—",color:"#94a3b8"};
}
/** ผลตรวจล่าสุดของชิ้นส่วน (ใช้แสดงจุดสถานะในรายการ) */
function lastInspection(memberId){
  var found=null;
  DB.inspections.forEach(function(r){
    if(r.memberId===memberId && (!found || r.ts>found.ts)) found=r;
  });
  return found;
}
/** สรุปสถานะของกลุ่มชิ้นส่วน → {total, pass, fail, todo} */
function summarize(members){
  var s={total:members.length, pass:0, fail:0, todo:0};
  members.forEach(function(m){
    var ins=lastInspection(m.id);
    if(!ins) s.todo++; else if(ins.status==="pass") s.pass++; else s.fail++;
  });
  return s;
}
/** ค่าเริ่มต้นของฟิลด์ตามสคีมา ใช้ตอนสร้างข้อมูลตัวอย่างและตอนเปิดฟอร์ม */
function defaultsFor(type){
  var o={};
  (FIELDS[type]||[]).forEach(function(g){ g.f.forEach(function(fd){ o[fd.k]=fd.def; }); });
  if(type==="beam"){ o.stations=defaultBeamStations(); syncBeamLegacy(o); }
  return o;
}
/** สร้างอ็อบเจ็กต์ชิ้นส่วนจากค่าเริ่มต้น + ค่าที่กำหนดเพิ่ม */
function mkMember(pid, fid, type, code, name, grid, over, note){
  var m = defaultsFor(type);
  m.id=uid("m"); m.projectId=pid; m.floorId=fid; m.type=type;
  m.code=code; m.name=name||""; m.grid=grid||""; m.fc=""; m.note=note||"";
  if(over) Object.keys(over).forEach(function(k){ m[k]=over[k]; });
  if(type==="beam" && over && over.topCount!=null && !over.stations){
    m.stations=null; ensureBeamStations(m); syncBeamLegacy(m);   // ให้สถานีตรงกับสเปกแบน
  }
  return m;
}

/* ---------------------------------------------------------------------------
   ข้อมูลตัวอย่าง — 1 โครงการ 4 ชั้น ครบทั้ง 7 ประเภทชิ้นส่วน
   ------------------------------------------------------------------------ */
function seedData(){
  var p  = { id:uid("p"), name:"อาคารสำนักงาน 4 ชั้น (ตัวอย่าง)", location:"ไซต์ A ถ.พระราม 9", createdAt:Date.now() };
  var mkF = function(name, level){ return { id:uid("f"), projectId:p.id, name:name, level:level, createdAt:Date.now()+Math.random() }; };
  var f0 = mkF("ฐานราก", "-1.50"), f1 = mkF("ชั้น 1", "0.00"),
      f2 = mkF("ชั้น 2", "3.20"),  f3 = mkF("ชั้น 3", "6.40");

  var ms = [
    mkMember(p.id, f0.id, "footing", "F1", "ฐานรากเสามุม", "A / 1",
      { B:1500, L:1500, H:400, cover:50, botDiaB:16, botSpB:150, botDiaL:16, botSpL:150, pileCount:4 },
      "ฐานรากเสาเข็ม 4 ต้น — เช็คระยะเยื้องศูนย์หัวเข็มก่อนผูกเหล็ก"),

    mkMember(p.id, f1.id, "column", "C1", "เสามุมอาคาร", "A / 1",
      { b:400, h:400, cover:30, mainCount:12, mainDia:20, stirDia:9, stirEnd:100, stirMid:150,
        plan:{kind:"point", x:0.20, y:0.24} },
      "เสาต้นมุม รับแรงลมสูง — ปลอกช่วงหัว-ท้ายห้ามเกิน @100"),

    mkMember(p.id, f1.id, "column", "C2", "เสากลางอาคาร", "B / 2",
      { b:300, h:500, cover:30, mainCount:8, mainDia:16, stirDia:9, stirEnd:100, stirMid:150,
        plan:{kind:"point", x:0.55, y:0.55} },
      "หน้าตัดผืนผ้า — ด้านยาว 500 ต้องขนานแนว 2 ห้ามวางกลับด้าน"),

    mkMember(p.id, f1.id, "wall", "W1", "ผนังปล่องลิฟต์", "C / 1-2",
      { t:200, Lw:3000, cover:25, layers:2, vertDia:12, vertSp:200, horizDia:12, horizSp:200,
        plan:{kind:"line", x1:0.70, y1:0.22, x2:0.70, y2:0.62} },
      "ตะแกรง 2 ชั้น — ต้องมี cross tie ยึดระหว่างตะแกรง"),

    mkMember(p.id, f2.id, "beam", "B1", "คานหลักรับพื้น", "A / 1-2",
      { b:200, h:400, cover:25, topCount:2, topDia:16, botCount:3, botDia:16, stirDia:9, stirEnd:100, stirMid:200, span:4000,
        plan:{kind:"line", x1:0.16, y1:0.30, x2:0.68, y2:0.30} },
      "คานหลักรับพื้น S1 — เหล็กบนต่อทาบเหนือเสาห้ามเกิน L/4"),

    mkMember(p.id, f2.id, "beam", "B2", "คานขอบระเบียง", "B / 2-3",
      { b:250, h:500, cover:25, topCount:3, topDia:20, botCount:5, botDia:20, stirDia:9, stirEnd:100, stirMid:200, span:5000,
        plan:{kind:"line", x1:0.30, y1:0.58, x2:0.82, y2:0.58} },
      "เหล็กล่าง 5 เส้นวางไม่พอในชั้นเดียว ต้องเรียง 2 ชั้น (ดูรูปหน้าตัด)"),

    mkMember(p.id, f2.id, "slab", "S1", "พื้นห้องประชุม", "A-B / 1-2",
      { h:150, cover:20, spanS:4000, spanL:5000, twoWay:1, endL:"beam", endR:"beam",
        botMainDia:12, botMainSp:200, botDistDia:9, botDistSp:200,
        topMainDia:12, topMainSp:200, topExtL:1200, topExtR:1200, sxDia:0, sxSp:200, sxExt:1500,
        topDistDia:12, topDistSp:200, topExtL2:1200, topExtR2:1200, lxDia:0, lxSp:200, lxExt:1500,
        plan:{kind:"rect", x1:0.18, y1:0.32, x2:0.66, y2:0.56} },
      "พื้นสองทาง — เหล็กบนบริเวณหัวเสาต้องครบทุกด้าน"),

    mkMember(p.id, f2.id, "stair", "ST1", "บันไดหลัก", "D / 1-2",
      { riser:175, tread:250, steps:10, waist:150, cover:20, mainDia:12, mainSp:150, distDia:9, distSp:200,
        plan:{kind:"line", x1:0.80, y1:0.30, x2:0.80, y2:0.55} },
      "จุดหักมุมโคนบันไดต้องดัดเหล็กเข้าด้านใน ห้ามดัดออกนอก"),

    mkMember(p.id, f3.id, "beam", "B3", "คานถ่ายน้ำหนัก", "C / 1-2",
      { b:300, h:600, cover:25, topCount:4, topDia:20, botCount:4, botDia:25, stirDia:12, stirEnd:100, stirMid:150, span:6000,
        plan:{kind:"line", x1:0.20, y1:0.40, x2:0.76, y2:0.40} },
      "คานถ่ายน้ำหนัก เหล็กล่าง DB25 ห้ามสลับกับ DB20 ของคานข้างเคียง"),

    mkMember(p.id, f3.id, "pt", "PT1", "พื้น Post-tension โซน A", "A-C / 1-3",
      { h:200, span:8000, cover:25, tendonType:"4-strand flat 12.7 มม.", tendonQty:6, tendonSp:1000,
        cgsEnd:150, cgsMid:40, rebarDia:12, rebarSp:200,
        plan:{kind:"rect", x1:0.16, y1:0.30, x2:0.78, y2:0.62} },
      "ระดับเอ็นคลาดเคลื่อนเกิน 5 มม. ให้แก้ก่อนเท ห้ามเทแล้วค่อยดึง")
  ];

  return { projects:[p], floors:[f0,f1,f2,f3], members:ms, inspections:[], inspector:"" };
}

/* ---------------------------------------------------------------------------
   5) การวาดรูปหน้าตัดด้วย SVG
      ทุกรูปคำนวณตำแหน่งจากข้อมูลจริง ไม่ใช่รูปประกอบ
      พิกัดภายในคิดเป็น "มม." แล้วแปลงเป็นพิกัด SVG ตอนวาด
   ------------------------------------------------------------------------ */
function svgDefs(){
  return '<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" '
       + 'orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="currentColor" opacity=".6"/></marker></defs>';
}
function wrapSvg(W,H,label,body){
  return '<svg class="section" viewBox="0 0 '+W.toFixed(1)+' '+H.toFixed(1)+'" role="img" '
       + 'aria-label="'+esc(label)+'">'+svgDefs()+body+'</svg>';
}
/** เส้นบอกขนาดแนวนอน (พิกัด SVG) */
function dimH(x1,x2,y,label){
  var t=6;
  return '<line class="dim" x1="'+x1+'" y1="'+y+'" x2="'+x2+'" y2="'+y+'" marker-start="url(#ar)" marker-end="url(#ar)"/>'
       + '<line class="dim" x1="'+x1+'" y1="'+(y-t)+'" x2="'+x1+'" y2="'+(y+t)+'"/>'
       + '<line class="dim" x1="'+x2+'" y1="'+(y-t)+'" x2="'+x2+'" y2="'+(y+t)+'"/>'
       + '<text x="'+((x1+x2)/2)+'" y="'+(y+18)+'" text-anchor="middle">'+esc(label)+'</text>';
}
/** เส้นบอกขนาดแนวตั้ง (พิกัด SVG) */
function dimV(y1,y2,x,label){
  var t=6, my=(y1+y2)/2;
  return '<line class="dim" x1="'+x+'" y1="'+y1+'" x2="'+x+'" y2="'+y2+'" marker-start="url(#ar)" marker-end="url(#ar)"/>'
       + '<line class="dim" x1="'+(x-t)+'" y1="'+y1+'" x2="'+(x+t)+'" y2="'+y1+'"/>'
       + '<line class="dim" x1="'+(x-t)+'" y1="'+y2+'" x2="'+(x+t)+'" y2="'+y2+'"/>'
       + '<text x="'+(x-8)+'" y="'+my+'" text-anchor="middle" transform="rotate(-90 '+(x-8)+' '+my+')">'+esc(label)+'</text>';
}
function circleAt(cls,x,y,r){ return '<circle class="'+cls+'" cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+r.toFixed(1)+'"/>'; }
function barR(dia,s){ return Math.max(3.2, dia/2*s); }
/** แปลง มม. → สตริงเมตร เช่น 300→"0.30", 1200→"1.20", 25→"0.025" */
function mM(mm){
  var m=mm/1000;
  var s=(mm%1000===0 ? m.toFixed(2) : m.toFixed(3));
  return s.replace(/(\.\d*?)0+$/,"$1").replace(/\.$/,"");
}
/** ตำแหน่งเหล็กเรียงเท่ากันระหว่าง a..b จำนวน n จุด (ถ้า n=1 อยู่กึ่งกลาง) */
function spreadPts(a,b,n){
  var out=[];
  if(n<=1){ out.push((a+b)/2); return out; }
  var step=(b-a)/(n-1);
  for(var i=0;i<n;i++) out.push(a+step*i);
  return out;
}

/* ---- คาน: รองรับเหล็กหลายชั้นอัตโนมัติ ---- */
function layoutBeamBars(count, dia, xL, xR, yFirst, growDir){
  var bars=[];
  if(count<=0) return {bars:bars, layers:0, perLayer:0};
  var span=xR-xL;
  var pitch=dia+Math.max(CLEAR_MIN,dia);            // ระยะห่างศูนย์กลางขั้นต่ำ
  var perLayer=Math.max(2, Math.floor(span/pitch)+1);
  if(count<=perLayer) perLayer=count;
  var layers=Math.ceil(count/perLayer), remain=count, vPitch=dia+CLEAR_MIN;
  for(var L=0;L<layers;L++){
    var n=Math.min(perLayer,remain); remain-=n;
    var y=yFirst+growDir*L*vPitch;
    spreadPts(xL,xR,n).forEach(function(x){ bars.push({x:x,y:y}); });
  }
  return {bars:bars, layers:layers, perLayer:perLayer};
}

/* ---------------------------------------------------------------------------
   คาน: โครงสร้างข้อมูล "สถานี" (ext / mid / intr / can)
   แต่ละสถานีเก็บ เหล็กบนหลายชั้น / เหล็กข้าง / ปลอก+ปลอกยึด / เหล็กล่างหลายชั้น
   ------------------------------------------------------------------------ */
/** สร้างสถานีเริ่มต้นสำหรับคานใหม่ */
function defaultBeamStations(){
  var mk=function(on,tn,td,bn,bd){
    return { on:on,
      top:[{n:tn,d:td}], bot:[{n:bn,d:bd}],
      side:{n:0,d:12,rows:0},
      stir:{d:9,sp:200}, tie:{d:10,rows:1,cols:0}, ctie:{n:0,left:0,right:0} };   // cols:0 = ยังไม่มีปลอกใน
  };
  return { ext:mk(true,2,16,2,16), mid:mk(true,2,16,3,16), intr:mk(true,2,16,2,16), can:mk(false,2,16,2,16) };
}
/** ทำให้ m.stations สมบูรณ์เสมอ — ถ้ายังไม่มี ให้สร้างจากฟิลด์แบน (คานเวอร์ชันเก่า) */
function ensureBeamStations(m){
  var s=m.stations;
  if(s && s.mid && s.ext){
    ["ext","mid","intr","can"].forEach(function(k){
      var st=s[k]; if(!st){ s[k]={on:false,top:[{n:0,d:16}],bot:[{n:0,d:16}],side:{n:0,d:12,rows:0},stir:{d:9,sp:200},tie:{d:0}}; return; }
      if(!Array.isArray(st.top)||!st.top.length) st.top=[{n:0,d:16}];
      if(!Array.isArray(st.bot)||!st.bot.length) st.bot=[{n:0,d:16}];
      if(!st.side) st.side={n:0,d:12,rows:0};
      if(!st.stir) st.stir={d:9,sp:200};
      if(!st.tie)  st.tie={d:10,rows:1,cols:0};
      if(st.tie.rows==null) st.tie.rows=1;
      if(st.tie.cols==null) st.tie.cols=0;
      // ย้ายข้อมูลเก่า: ถ้าไม่เคยตั้งขนาดปลอกใน (d<=0) = ยังไม่มีปลอกใน → cols=0 + ตั้งขนาดเริ่มต้น
      if(st.tie.d<=0){ st.tie.d=st.stir.d||10; st.tie.cols=0; }
      if(!st.ctie) st.ctie={n:0,left:0,right:0};
      if(st.ctie.n==null) st.ctie.n=0; if(st.ctie.left==null) st.ctie.left=0; if(st.ctie.right==null) st.ctie.right=0;
    });
    return s;
  }
  var tn=m.topCount||2, td=m.topDia||16, bn=m.botCount||3, bd=m.botDia||16,
      sd=m.stirDia||9, sp=m.stirMid||200;
  var mk=function(on,bnn){ return { on:on, top:[{n:tn,d:td}], bot:[{n:bnn,d:bd}],
        side:{n:0,d:12,rows:0}, stir:{d:sd,sp:sp}, tie:{d:sd,rows:1,cols:0}, ctie:{n:0,left:0,right:0} }; };
  m.stations={ ext:mk(true,bn), mid:mk(true,bn), intr:mk(true,bn), can:mk(false,bn) };
  return m.stations;
}
/** ค่ารวมที่ใช้แทนทั้งคาน (governing) — เหล็กบนมากสุด / เหล็กล่างมากสุด ในสถานีที่เปิด */
function beamGov(m){
  var s=ensureBeamStations(m), on=[];
  ["ext","mid","intr","can"].forEach(function(k){ if(s[k]&&s[k].on) on.push(s[k]); });
  if(!on.length) on=[s.mid||s.ext];
  var topMax={n:0,d:td0(on)}, botMax={n:0,d:td0(on)};
  function td0(a){ return (a[0].top&&a[0].top[0]&&a[0].top[0].d)||16; }
  on.forEach(function(st){
    var t=(st.top&&st.top[0])||{n:0,d:16}; if(t.n>topMax.n) topMax={n:t.n,d:t.d};
    var b=(st.bot&&st.bot[0])||{n:0,d:16}; if(b.n>botMax.n) botMax={n:b.n,d:b.d};
  });
  return { top:topMax, bot:botMax, stir:(on[0].stir||{d:9,sp:200}) };
}
/** ปรับฟิลด์แบน (topCount ฯลฯ) ให้ตรงกับ governing — ยังใช้ใน shortSpec/เช็คลิสต์ */
function syncBeamLegacy(m){
  var g=beamGov(m);
  m.topCount=g.top.n; m.topDia=g.top.d;
  m.botCount=g.bot.n; m.botDia=g.bot.d;
  m.stirDia=g.stir.d; m.stirMid=g.stir.sp; if(m.stirEnd==null) m.stirEnd=g.stir.sp;
}
/** รวมชั้นเหล็กที่ขนาดเท่ากันติดกัน → นับจำนวนรวม (เช่น 2-DB25 + 2-DB25 = 4-DB25) */
function mergeSameDia(arr){
  var out=[];
  (arr||[]).forEach(function(t){ if(!t||t.n<=0) return;
    var last=out[out.length-1];
    if(last && last.d===t.d) last.n+=t.n; else out.push({n:t.n,d:t.d});
  });
  return out;
}
/** บรรทัดสเปกของสถานี (บน→ล่าง) แบบเดียวกับในตารางแบบ */
function beamStationLines(st){
  var L=[];
  mergeSameDia(st.top).forEach(function(t){ L.push({side:"top", t:t.n+"-DB"+t.d+" มม."}); });
  if(st.side && st.side.rows>0 && st.side.n>0)
    L.push({side:"side", t:st.side.rows+"×"+st.side.n+"-DB"+st.side.d+" มม. (เหล็กข้าง)"});
  var stir="ปลอก DB"+st.stir.d+((st.tie&&st.tie.d>0)?" +DB"+st.tie.d:"")+" @"+(st.stir.sp/1000).toFixed(2)+" ม.";
  L.push({side:"stir", t:stir});
  mergeSameDia(st.bot).forEach(function(b){ L.push({side:"bot", t:b.n+"-DB"+b.d+" มม."}); });
  return L;
}
/** สรุปหนึ่งบรรทัดของสถานี ใช้ในตารางสเปก */
function beamStationSummary(st){
  var top=mergeSameDia(st.top).map(function(t){return t.n+"-DB"+t.d;}).join(" + ")||"—";
  var bot=mergeSameDia(st.bot).map(function(b){return b.n+"-DB"+b.d;}).join(" + ")||"—";
  var tieTxt="";
  if(st.tie && (st.tie.rows||1)>0 && (st.tie.cols||0)>0){
    var tr=st.tie.rows||1, tc=st.tie.cols||0, n=tr*tc, tdd=(st.tie.d>0?st.tie.d:st.stir.d);
    tieTxt="+DB"+tdd+(n>1?" (ปลอกใน "+tr+"×"+tc+")":"");
  }
  return { top:top, bot:bot,
    side:(st.side&&st.side.rows>0&&st.side.n>0)?(st.side.rows+"×"+st.side.n+"-DB"+st.side.d):"—",
    stir:"DB"+st.stir.d+tieTxt+" @"+(st.stir.sp/1000).toFixed(2)+" ม." };
}

/** วาดหน้าตัดคานของ "หนึ่งสถานี" (stKey ไม่ระบุ = สถานีแรกที่เปิด) */
function drawBeam(m, stKey){
  var sts=ensureBeamStations(m), order=["ext","mid","intr","can"];
  var key=(stKey && sts[stKey] && sts[stKey].on) ? stKey : null;
  if(!key){ for(var i=0;i<order.length;i++){ if(sts[order[i]].on){ key=order[i]; break; } } }
  if(!key) key="mid";
  var st=sts[key];

  var PADL=76,PADR=210,PADT=42,PADB=64,TARGET=300;
  var s=TARGET/Math.max(m.b,m.h), bw=m.b*s, bh=m.h*s;
  var W=bw+PADL+PADR, H=bh+PADT+PADB;
  var X=function(v){return PADL+v*s;}, Y=function(v){return PADT+v*s;};

  // ตะขอ 135° ที่มุมบนขวาของปลอก: เส้นเฉียงสั้นชี้เข้าเนื้อคอนกรีต (สไตล์ CAD)
  function hook(cornerXmm, cornerYmm, dia, cls){
    var L=Math.max(9, dia*s*2.0), x=X(cornerXmm)-1.5, y=Y(cornerYmm)+1.5;
    return '<line class="'+cls+' hook" x1="'+x+'" y1="'+y+'" x2="'+(x-L*0.72)+'" y2="'+(y+L)+'"/>';
  }

  var g='';
  g+='<rect class="conc" x="'+X(0)+'" y="'+Y(0)+'" width="'+bw+'" height="'+bh+'" rx="'+(3*s)+'"/>';
  // ปลอกรัดรอบ (ปลอกนอก) — ปลอกปิด มุมโค้ง + ตะขอ 135°
  var so=st.stir.d;
  g+='<rect class="stir" x="'+X(m.cover)+'" y="'+Y(m.cover)+'" width="'+((m.b-2*m.cover)*s)
    +'" height="'+((m.h-2*m.cover)*s)+'" rx="'+(Math.max(2,so*0.9)*s)+'"/>';
  g+=hook(m.b-m.cover, m.cover, so, "stir");
  // ปลอกยึด (tie) — กริดปลอกปิด: rows (ซ้อนแนวสูง) × cols (แนวกว้าง) ภายในปลอกรอบนอก
  var trows0=(st.tie&&st.tie.rows!=null)?st.tie.rows:1, tcols0=(st.tie&&st.tie.cols!=null)?st.tie.cols:0;
  var hasTie=!!st.tie && trows0>0 && tcols0>0, tieHooks="";   // จำนวน = ตัวคุมหลัก
  if(hasTie){
    var trows=trows0, tcols=tcols0, td=(st.tie.d>0?st.tie.d:st.stir.d);
    var m0=m.cover + st.stir.d + Math.max(3, td*0.5);     // ถัดจากปลอกนอกเล็กน้อย
    var tgap=Math.max(8, td*1.8);                         // ช่องว่างระหว่างปลอกย่อย
    var iy0=m0, iy1=m.h-m0;
    // แนวนอน: ถ้า "1 วง" และเหล็กแถวบน/ล่างมี ≥4 เส้น → วงกลางแคบ (ล้อมเหล็กแถวใน เว้นเส้นริมสุดซ้าย-ขวา)
    var ncolBar=Math.max(2,(st.top[0]&&st.top[0].n)||2,(st.bot[0]&&st.bot[0].n)||2);
    var ix0=m0, ix1=m.b-m0;
    if(tcols===1 && ncolBar>=4){
      var insXt=barInset(m.cover,st.stir.d,(st.top[0]&&st.top[0].d)||16);
      var barXs=spreadPts(insXt, m.b-insXt, ncolBar), mg=Math.max(4, td*0.8);
      ix0=barXs[1]-mg; ix1=barXs[ncolBar-2]+mg;          // จากเส้นที่ 2 ถึงเส้นรองสุดท้าย
    }
    var cw=(ix1-ix0 - tgap*(tcols-1))/tcols;
    var ch=(iy1-iy0 - tgap*(trows-1))/trows;
    if(cw>16 && ch>16){
      for(var tr=0; tr<trows; tr++){
        for(var tc=0; tc<tcols; tc++){
          var hx=ix0+tc*(cw+tgap), hy=iy0+tr*(ch+tgap);
          g+='<rect class="tie" x="'+X(hx)+'" y="'+Y(hy)+'" width="'+(cw*s)
            +'" height="'+(ch*s)+'" rx="'+(Math.max(2,td*0.9)*s)+'"/>';
          tieHooks+=hook(hx+cw, hy, td, "tie");          // ตะขอปลอกในทุกวง (วาดทับเหล็กทีหลัง)
        }
      }
    }
  }
  // ปลอกรัดรอบกลาง (cross-tie) — คร่อมเหล็กแถวกลาง บน↔ล่าง แล้วขยายซ้าย/ขวาแยกกันได้ (คู่=2 เส้น, คี่=1 เส้น)
  var ct=st.ctie||{n:0,left:0,right:0};
  if(ct.n>0 && st.top && st.top[0] && st.top[0].n>0){
    var td3=(st.tie&&st.tie.d>0)?st.tie.d:st.stir.d;
    var ntc=st.top[0].n, insTc=barInset(m.cover,st.stir.d,st.top[0].d);
    var colXs=spreadPts(insTc, m.b-insTc, ntc);          // ตำแหน่งเหล็กบนแถว 1
    var w=(ntc%2===0)?2:1;                                // คู่ → คร่อม 2 เส้นกลาง, คี่ → คร่อม 1 เส้นกลาง
    var cS=Math.floor((ntc-w)/2), cE=cS+w-1;             // คอลัมน์กลาง (เริ่ม-จบ)
    var L=Math.max(0, cS-(ct.left||0)), R=Math.min(ntc-1, cE+(ct.right||0));   // ขยายซ้าย/ขวาแยกกัน
    var yT=m.cover, yB=m.h-m.cover, mgc=td3*0.9+2;
    var xL=colXs[L]-mgc, xR=colXs[R]+mgc;
    if(xR-xL>8){
      g+='<rect class="tie" x="'+X(xL)+'" y="'+Y(yT)+'" width="'+((xR-xL)*s)+'" height="'+((yB-yT)*s)+'" rx="'+(Math.max(2,td3*0.9)*s)+'"/>';
      tieHooks+=hook(xR, yT, td3, "tie");
    }
  }

  // labels: {y(มม.), t, cls} — วางข้อความให้ตรงระดับเหล็กจริง
  var labels=[];
  // ---- เหล็กบน (หลายชั้น; แต่ละชั้นห่อบรรทัดอัตโนมัติถ้าล้น) ----
  var topBars=[], topY1=null, curY, topLbl=[];
  (st.top||[]).forEach(function(t){
    if(t.n<=0) return;
    var ins=barInset(m.cover,st.stir.d,t.d);
    if(curY==null) curY=ins;
    var last=topLbl[topLbl.length-1];                 // รวมชั้นขนาดเท่ากัน → ป้ายเดียว (เช่น 4-DB25)
    if(last && last.d===t.d) last.n+=t.n; else topLbl.push({y:curY, n:t.n, d:t.d});
    var lay=layoutBeamBars(t.n,t.d,ins,m.b-ins,curY,+1);
    lay.bars.forEach(function(p){ topBars.push({x:p.x,y:p.y,d:t.d}); topY1=Math.max(topY1||0,p.y); });
    curY = curY + lay.layers*(t.d+CLEAR_MIN);
  });
  topLbl.forEach(function(L){ labels.push({y:L.y, t:L.n+"-DB"+L.d+" มม.", cls:"barA"}); });
  // ---- เหล็กล่าง (หลายชั้น) ----
  var botBars=[], botY1=null, curYB, botLabels=[], botLbl=[];
  (st.bot||[]).forEach(function(b){
    if(b.n<=0) return;
    var ins=barInset(m.cover,st.stir.d,b.d);
    if(curYB==null) curYB=m.h-ins;
    var lastb=botLbl[botLbl.length-1];
    if(lastb && lastb.d===b.d) lastb.n+=b.n; else botLbl.push({y:curYB, n:b.n, d:b.d});
    var lay=layoutBeamBars(b.n,b.d,ins,m.b-ins,curYB,-1);
    lay.bars.forEach(function(p){ botBars.push({x:p.x,y:p.y,d:b.d}); botY1=(botY1==null?p.y:Math.min(botY1,p.y)); });
    curYB = curYB - lay.layers*(b.d+CLEAR_MIN);
  });
  botLbl.forEach(function(L){ botLabels.push({y:L.y, t:L.n+"-DB"+L.d+" มม.", cls:"barB"}); });
  // ---- เหล็กข้าง (side/skin) กระจายเท่า ๆ กันตลอดความลึกของ web (ช่องว่างบน-ล่างเท่ากัน) ----
  var sideBars=[];
  if(st.side && st.side.rows>0 && st.side.n>0){
    var ins=barInset(m.cover,st.stir.d,st.side.d);
    var yTop=(topY1!=null?topY1:ins), yBot=(botY1!=null?botY1:m.h-ins);
    var gapS=(yBot-yTop)/(st.side.rows+1);            // แบ่ง web เป็น rows+1 ช่องเท่ากัน
    for(var r=1;r<=st.side.rows;r++){
      var yS=yTop+gapS*r;
      spreadPts(ins, m.b-ins, st.side.n).forEach(function(x){ sideBars.push({x:x,y:yS,d:st.side.d}); });
      labels.push({y:yS, t:st.side.n+"-DB"+st.side.d+" มม.", cls:"barS"});   // ป้ายเหล็กข้าง ทุกชั้น
    }
  }
  // ---- ป้ายเหล็กปลอก: วางระหว่างเหล็กบนกับเหล็กข้าง/ล่าง ----
  var lastTopY=topY1!=null?topY1:barInset(m.cover,st.stir.d,16);
  var firstBelowY=(sideBars.length?sideBars[0].y:(botY1!=null?botY1:m.h-m.cover));
  var tieN=hasTie?((st.tie.rows||1)*(st.tie.cols||1)):0, tieDia=(st.tie&&st.tie.d>0?st.tie.d:st.stir.d);
  var stirTxt="Stir.DB"+st.stir.d+(hasTie?" +DB"+tieDia+(tieN>1?"×"+tieN:""):"")+"@"+(st.stir.sp/1000).toFixed(2)+"m.";
  labels.push({y:(lastTopY+firstBelowY)/2, t:stirTxt, cls:"stir-tx"});
  botLabels.forEach(function(L){ labels.push(L); });

  sideBars.forEach(function(p){ g+=circleAt("barS",X(p.x),Y(p.y),barR(p.d,s)); });
  botBars.forEach(function(p){ g+=circleAt("barB",X(p.x),Y(p.y),barR(p.d,s)); });
  topBars.forEach(function(p){ g+=circleAt("barA",X(p.x),Y(p.y),barR(p.d,s)); });
  g+=tieHooks;   // ตะขอปลอกใน วาดทับเหล็กให้เห็นชัด

  // ---- เส้นบอกขนาด ----
  g+=dimH(X(0),X(m.b),Y(m.h)+30,"b = "+mM(m.b)+" ม.");
  g+=dimV(Y(0),Y(m.h),X(0)-32,"h = "+mM(m.h)+" ม.");
  g+='<line class="dim" x1="'+X(0)+'" y1="'+(Y(0)-14)+'" x2="'+X(m.cover)+'" y2="'+(Y(0)-14)+'" marker-end="url(#ar)"/>';
  g+='<text class="lbl" x="'+X(m.cover)+'" y="'+(Y(0)-20)+'" dx="4">covering '+mM(m.cover)+' ม.</text>';

  // ---- ข้อความสเปก วางตรงระดับเหล็กจริง + เส้นชี้ กันซ้อนกัน ----
  labels.sort(function(a,b){ return a.y-b.y; });
  var lx=X(m.b)+22, MINGAP=17, prevSy=-1e9;
  labels.forEach(function(L){
    var barSy=Y(L.y), sy=Math.max(barSy, prevSy+MINGAP); prevSy=sy;
    g+='<line class="lead" x1="'+(X(m.b)+2)+'" y1="'+barSy+'" x2="'+(lx-4)+'" y2="'+sy+'"/>';
    g+='<text class="lbl '+L.cls+'" x="'+lx+'" y="'+(sy+4)+'">'+esc(L.t)+'</text>';
  });

  // ---- notes ----
  var notes=[];
  var topLayers=(st.top||[]).filter(function(t){return t.n>0;}).length;
  var botLayers=(st.bot||[]).filter(function(b){return b.n>0;}).length;
  if(topLayers>1||botLayers>1)
    notes.push({t:"info", x:"เหล็กเรียงหลายชั้น (บน "+topLayers+" / ล่าง "+botLayers+" ชั้น) — ต้องมีเหล็กคั่นระหว่างชั้น"});
  if(hasTie)
    notes.push({t:"info", x:"มีปลอกยึดเสริม (DB"+st.tie.d+") นอกเหนือจากปลอกหลัก — ผูกให้ครบทุกระยะ"});

  var gov=beamStationSummary(st);
  return {
    svg: wrapSvg(W,H,"รูปหน้าตัดคาน "+m.code+" ("+key+")",g),
    legend: [ {k:"dot",c:"var(--brand)",t:"เหล็กบน "+gov.top},
              {k:"dot",c:"var(--pass)", t:"เหล็กล่าง "+gov.bot},
              (st.side&&st.side.rows>0?{k:"dot",c:"var(--warn)",t:"เหล็กข้าง "+gov.side}:null),
              {k:"ring",c:"var(--fail)",t:"ปลอก "+gov.stir} ].filter(Boolean),
    notes: notes, meta:{stationKey:key}
  };
}

/* ---- เสา: เหล็กยืนกระจายรอบหน้าตัด (มุมก่อน แล้วเฉลี่ยตามด้าน) ---- */
function layoutColumnBars(count,b,h,inset){
  var x0=inset,x1=b-inset,y0=inset,y1=h-inset, bars=[];
  var n=Math.max(4,count|0);
  bars.push({x:x0,y:y0},{x:x1,y:y0},{x:x0,y:y1},{x:x1,y:y1});   // 4 มุมเสมอ
  var rem=n-4;
  var exX=Math.round(rem*b/(b+h)), exY=rem-exX;                  // แบ่งตามสัดส่วนความยาวด้าน
  var top=Math.ceil(exX/2), bottom=exX-top, left=Math.ceil(exY/2), right=exY-left;
  function spread(k,a,b2,horiz,fixed){
    if(k<=0) return;
    var step=(b2-a)/(k+1);
    for(var i=1;i<=k;i++){
      var p=a+step*i;
      bars.push(horiz?{x:p,y:fixed}:{x:fixed,y:p});
    }
  }
  spread(top,x0,x1,true,y0); spread(bottom,x0,x1,true,y1);
  spread(left,y0,y1,false,x0); spread(right,y0,y1,false,x1);
  return { bars:bars, faces:{top:top+2, bottom:bottom+2, left:left+2, right:right+2} };
}
/** เรียงเหล็กยืนแบบ nx (แนวกว้าง b / บน-ล่าง) × ny (แนวลึก h / ซ้าย-ขวา) รอบรูป (มุมใช้ร่วม) */
function layoutColumnGrid(nx,ny,b,h,inset){
  nx=Math.max(2,nx|0); ny=Math.max(2,ny|0);
  var x0=inset,x1=b-inset,y0=inset,y1=h-inset, bars=[];
  var xs=spreadPts(x0,x1,nx), ys=spreadPts(y0,y1,ny);
  xs.forEach(function(x){ bars.push({x:x,y:y0},{x:x,y:y1}); });      // บน + ล่าง (nx ต่อแถว)
  for(var i=1;i<ny-1;i++){ bars.push({x:x0,y:ys[i]},{x:x1,y:ys[i]}); } // ซ้าย + ขวา (ไม่นับมุมซ้ำ)
  return { bars:bars, total:2*nx+2*(ny-2) };
}
/** จำนวนเหล็กยืนรวมของเสา (จาก nx/ny; ของเก่าใช้ mainCount) */
function colMainTotal(m){
  var nx=num(m.nx,0), ny=num(m.ny,0);
  if(nx>0&&ny>0) return 2*nx+2*(ny-2);
  return num(m.mainCount,0);
}
/** ปลอกรัดใน (หลายวง) — แต่ละวง {top,bot} = เลขแถวเหล็ก (นับจากบนสุด=1 ถึงล่างสุด=ny) ที่ปลอกคร่อม */
function cieRowMid(ny){   // แถวกลางเริ่มต้นของวงใหม่ (1-based) — คู่=2 แถวกลาง / คี่=1 แถวกลาง
  ny=Math.max(2,num(ny,0));
  var w=(ny%2===0)?2:1, rS=Math.floor((ny-w)/2)+1;
  return { top:rS, bot:rS+w-1 };
}
function normalizeCieRaw(m){   // คืน array ดิบ — รองรับข้อมูลเก่า (v62 cieN/cieUp/cieDown → 1 วง)
  if(Array.isArray(m.cieList)) return m.cieList;
  if(num(m.cieN,0)>0 && num(m.ny,0)>=2){
    var ny=num(m.ny,0), w=(ny%2===0)?2:1, rS=Math.floor((ny-w)/2), rE=rS+w-1;
    return [{ top:Math.max(0,rS-num(m.cieUp,0))+1, bot:Math.min(ny-1,rE+num(m.cieDown,0))+1 }];
  }
  return [];
}
function cieListOf(m){   // คืนลิสต์ที่ normalize แล้ว (top<=bot, อยู่ในช่วง 1..ny)
  var ny=Math.max(2,num(m.ny,0));
  return normalizeCieRaw(m).map(function(c){
    var t=Math.min(Math.max(1,Math.round(num(c.top,1))),ny);
    var b=Math.min(Math.max(1,Math.round(num(c.bot,t))),ny);
    if(b<t){ var x=t; t=b; b=x; }
    return { top:t, bot:b, span:(b-t+1) };
  });
}
/* ---- ปลอกรัดในอีกทิศ (cix) — คร่อม "สดมภ์" ซ้าย→ขวา (แนว nx) วาดเป็นแถบตั้ง ---- */
function cixColMid(nx){ nx=Math.max(2,num(nx,0)); var w=(nx%2===0)?2:1, cS=Math.floor((nx-w)/2)+1; return { left:cS, right:cS+w-1 }; }
function cixListOf(m){    // normalize {left,right} ในช่วง 1..nx
  var nx=Math.max(2,num(m.nx,0));
  var raw=Array.isArray(m.cixList)?m.cixList:[];
  return raw.map(function(c){
    var l=Math.min(Math.max(1,Math.round(num(c.left,1))),nx);
    var r=Math.min(Math.max(1,Math.round(num(c.right,l))),nx);
    if(r<l){ var x=l; l=r; r=x; }
    return { left:l, right:r, span:(r-l+1) };
  });
}

function drawColumn(m){
  var PADL=76,PADR=46,PADT=42,PADB=64,TARGET=300;
  var s=TARGET/Math.max(m.b,m.h), bw=m.b*s, bh=m.h*s;
  var W=bw+PADL+PADR, H=bh+PADT+PADB;
  var X=function(v){return PADL+v*s;}, Y=function(v){return PADT+v*s;};
  var nx=Math.max(2,num(m.nx,3)), ny=Math.max(2,num(m.ny,13)), m1d=num(m.mainDia,20);
  var tid=num(m.tieInnerDia,m.stirDia||10);
  var inset=barInset(m.cover,m.stirDia,m1d);
  var lay=(num(m.nx,0)>0&&num(m.ny,0)>0) ? layoutColumnGrid(nx,ny,m.b,m.h,inset) : layoutColumnBars(num(m.mainCount,12),m.b,m.h,inset);
  var r1=barR(m1d,s);
  var cov=num(m.cover,30), tW=(m.b-2*cov), tH=(m.h-2*cov);

  // ตะขอ 135° ที่มุมของปลอก (ขีดเฉียงเล็ก ชี้เข้าเนื้อคอนกรีต) — cls = stir/tie
  function hook(cxmm, cymm, dia, cls, dir){
    var L=Math.max(9, dia*s*1.9), x=X(cxmm), y=Y(cymm), sx=(dir&&dir.sx)||-1, sy=(dir&&dir.sy)||1;
    return '<line class="'+cls+' hook" x1="'+(x-sx*1.5)+'" y1="'+(y-sy*1.5)+'" x2="'+(x-sx*L*0.72)+'" y2="'+(y+sy*L)+'"/>';
  }
  var g='';
  g+='<rect class="conc" x="'+X(0)+'" y="'+Y(0)+'" width="'+bw+'" height="'+bh+'" rx="'+(2*s)+'"/>';
  // ปลอกนอก (วงปิด แดง) + ตะขอ 135° มุมบนขวา
  g+='<rect class="stir" x="'+X(cov)+'" y="'+Y(cov)+'" width="'+(tW*s)+'" height="'+(tH*s)+'" rx="'+(Math.max(2,m.stirDia*0.9)*s)+'"/>';
  g+=hook(m.b-cov, cov, m.stirDia, "stir", {sx:1,sy:1});
  // ปลอกรัดใน (หลายวง — แต่ละวงคร่อมเหล็กแถวบน→แถวล่าง) เหมือน "ปลอกรัดรอบกลาง" ของคาน แต่หมุนเป็นแนวตั้ง
  var cieList=cieListOf(m);   // [{top,bot,span}] เลขแถว 1-based
  if(cieList.length){
    var ysC=spreadPts(inset, m.h-inset, ny);   // ตำแหน่ง y ของเหล็กแต่ละแถว
    var rr=Math.max(1.5,tid*0.6)*s, ep=6;      // เผื่อขอบเล็กน้อยให้คร่อมพ้นเม็ดเหล็ก
    cieList.forEach(function(c){
      var y1=ysC[c.top-1], y2=ysC[c.bot-1];
      g+='<rect class="tie" x="'+X(cov)+'" y="'+(Y(y1)-ep)+'" width="'+(tW*s)+'" height="'+((y2-y1)*s+2*ep)+'" rx="'+rr+'"/>';
      g+=hook(m.b-cov, y1, tid, "tie", {sx:1,sy:1});
    });
  }
  // ปลอกรัดในอีกทิศ (cix) — คร่อมสดมภ์ ซ้าย→ขวา (แนว nx) เป็นแถบตั้งเต็มความสูง
  var cixList=cixListOf(m);
  if(cixList.length){
    var xsC=spreadPts(inset, m.b-inset, nx);   // ตำแหน่ง x ของเหล็กแต่ละสดมภ์
    var rrx=Math.max(1.5,tid*0.6)*s, epx=6;
    cixList.forEach(function(c){
      var x1=xsC[c.left-1], x2=xsC[c.right-1];
      g+='<rect class="tie" x="'+(X(x1)-epx)+'" y="'+Y(cov)+'" width="'+((x2-x1)*s+2*epx)+'" height="'+(tH*s)+'" rx="'+rrx+'"/>';
      g+=hook(x2, cov, tid, "tie", {sx:1,sy:1});
    });
  }
  // เหล็กยืน = วงกลมกลวงเขียว (สไตล์แบบก่อสร้าง)
  lay.bars.forEach(function(p){ g+=circleAt("barV",X(p.x),Y(p.y), r1); });
  g+=dimH(X(0),X(m.b),Y(m.h)+34,mM(m.b));
  g+=dimV(Y(0),Y(m.h),X(0)-34,mM(m.h));
  // เส้นต่อ (extension) ของ dim
  g+='<line class="lead" x1="'+X(0)+'" y1="'+Y(m.h)+'" x2="'+X(0)+'" y2="'+(Y(m.h)+34)+'"/>';
  g+='<line class="lead" x1="'+X(m.b)+'" y1="'+Y(m.h)+'" x2="'+X(m.b)+'" y2="'+(Y(m.h)+34)+'"/>';
  g+='<line class="lead" x1="'+X(0)+'" y1="'+Y(0)+'" x2="'+(X(0)-34)+'" y2="'+Y(0)+'"/>';
  g+='<line class="lead" x1="'+X(0)+'" y1="'+Y(m.h)+'" x2="'+(X(0)-34)+'" y2="'+Y(m.h)+'"/>';

  var tot=colMainTotal(m);
  var mainTxt=tot+"-DB"+m1d+" (nx="+nx+", ny="+ny+")";
  var nCie=cieList.length, nCix=cixList.length;
  var innerTxt=(nCie?" + ปลอกใน "+nCie+" วง":"")+(nCix?" + ปลอกในขวาง "+nCix+" วง":"");
  var tieTxt="DB"+m.stirDia+(innerTxt?innerTxt+"-DB"+tid:"");
  var notes=[ {t:"info", x:"เหล็กยืนรวม "+tot+" เส้น = 2×"+nx+" + 2×("+ny+"−2)"} ];
  notes.push({t:"info", x:"ปลอก "+tieTxt+" · ตัวแรก S1="+num(m.stirFirst,50)+" จากขอบ · So="+num(m.stirEnd,150)+" (Lo) / @"+num(m.stirMid,200)+" (กลาง) มม. · Lo="+mM(num(m.l0,600))+" ม."});
  if(nCie) notes.push({t:"info", x:"ปลอกรัดใน "+nCie+" วง: "+cieList.map(function(c,i){return "วง"+(i+1)+" คร่อมแถว "+c.top+"–"+c.bot;}).join(" · ")});
  if(nCix) notes.push({t:"info", x:"ปลอกรัดในขวาง "+nCix+" วง: "+cixList.map(function(c,i){return "วง"+(i+1)+" คร่อมสดมภ์ "+c.left+"–"+c.right;}).join(" · ")});
  if(spHasAny(m)){ var _sp=spRebarOf(m);
    notes.push({t:"info", x:"เหล็กเสริมพิเศษ — แดง(บน/ล่าง) "+spStr(_sp.red.top)+" / "+spStr(_sp.red.bot)+" · น้ำเงิน(บน/ล่าง) "+spStr(_sp.blue.top)+" / "+spStr(_sp.blue.bot)}); }
  var innerLegTxt=(nCie||nCix)?[(nCie?nCie+" วง(แถว)":""),(nCix?nCix+" วง(สดมภ์)":"")].filter(Boolean).join(" + ")+"-DB"+tid : "—";
  return {
    svg: wrapSvg(W,H,"รูปหน้าตัดเสา "+m.code,g),
    legend: [ {k:"ring",c:"var(--ok,#16a34a)",t:"เหล็กยืน "+mainTxt},
              {k:"ring",c:"var(--fail)",t:"เหล็กปลอกนอก "+("DB"+m.stirDia)},
              {k:"ring",c:"var(--text)",t:"ปลอกใน "+innerLegTxt} ],
    notes: notes
  };
}
/** รูปด้านยาว (elevation) ของเสา — แบบ Special Moment Frame: คาน/พื้นบน-ล่าง, Lo (So ถี่), ช่วงกลาง (Smid), ปลอกตัวแรก S1 จากขอบ */
function drawColumnElev(m){
  var Hcol=num(m.height,3000); if(Hcol<=0) return null;
  var so=Math.max(25,num(m.stirEnd,150)), mid=Math.max(25,num(m.stirMid,200)), s1=Math.max(0,num(m.stirFirst,50));
  var lo=Math.min(Hcol*0.45, num(m.l0,600));
  var PADL=58,PADR=132,PADT=14,PADB=14, colW=58, TH=340, jH=24, jOver=22;
  var s=TH/Hcol, bh=Hcol*s;
  var Xc=PADL, Yt=PADT+jH;                       // ขอบบนเสา (ใต้บล็อกคาน/พื้นบน)
  var W=colW+PADL+PADR, H=bh+PADT+PADB+2*jH;
  var Y=function(z){return Yt+z*s;};             // z: 0=หน้าคานบน → Hcol=หน้าคานล่าง
  var Xr=Xc+colW, g='';
  // บล็อกคาน/พื้น บน-ล่าง (สีเทา)
  g+='<rect x="'+(Xc-jOver)+'" y="'+PADT+'" width="'+(colW+2*jOver)+'" height="'+jH+'" fill="var(--surface-2)" stroke="var(--border)"/>';
  g+='<rect x="'+(Xc-jOver)+'" y="'+(Yt+bh)+'" width="'+(colW+2*jOver)+'" height="'+jH+'" fill="var(--surface-2)" stroke="var(--border)"/>';
  g+='<text class="lbl" x="'+(Xc-jOver+3)+'" y="'+(PADT+jH-8)+'">คาน/พื้น</text>';
  g+='<text class="lbl" x="'+(Xc-jOver+3)+'" y="'+(Yt+bh+jH-8)+'">คาน/พื้น</text>';
  // ตัวเสา
  g+='<rect class="conc" x="'+Xc+'" y="'+Yt+'" width="'+colW+'" height="'+bh+'"/>';
  // โซน Lo (อัดแน่น) บน/ล่าง — แรเงาอ่อน
  g+='<rect x="'+Xc+'" y="'+Yt+'" width="'+colW+'" height="'+(lo*s)+'" fill="var(--fail)" fill-opacity="0.09"/>';
  g+='<rect x="'+Xc+'" y="'+(Yt+bh-lo*s)+'" width="'+colW+'" height="'+(lo*s)+'" fill="var(--fail)" fill-opacity="0.09"/>';
  // ตำแหน่งปลอก: ตัวแรกที่ S1 จากขอบ → ถี่ So ในช่วง Lo → ห่าง Smid ช่วงกลาง → ถี่ So ช่วงล่าง → ตัวสุดท้ายที่ S1 จากขอบล่าง
  var zs=[], z;
  for(z=s1; z<lo-1e-6; z+=so) zs.push(z);            // ช่วง Lo บน (เริ่ม S1)
  for(z=lo;  z<Hcol-lo-1e-6; z+=mid) zs.push(z);     // ช่วงกลาง
  for(z=Hcol-s1; z>Hcol-lo+1e-6; z-=so) zs.push(z);  // ช่วง Lo ล่าง (ไล่จากขอบล่างขึ้น)
  zs.push(lo, Hcol-lo, s1, Hcol-s1);                 // ขอบโซน + ปลอกตัวแรก/สุดท้าย
  var seen={};
  zs.filter(function(v){ return v>=s1-0.5 && v<=Hcol-s1+0.5; })
    .sort(function(a,b){return a-b;})
    .forEach(function(v){ var key=Math.round(v); if(seen[key])return; seen[key]=1;
      g+='<line class="stir" x1="'+Xc+'" y1="'+Y(v).toFixed(1)+'" x2="'+Xr+'" y2="'+Y(v).toFixed(1)+'" style="opacity:.9"/>'; });
  // เหล็กยืน 2 เส้นข้าง (ยาวเข้าไปในคาน/พื้น = ระยะฝัง)
  g+='<line class="lineB" x1="'+(Xc+5)+'" y1="'+PADT+'" x2="'+(Xc+5)+'" y2="'+(Yt+bh+jH)+'" style="opacity:1;stroke-width:3"/>';
  g+='<line class="lineB" x1="'+(Xr-5)+'" y1="'+PADT+'" x2="'+(Xr-5)+'" y2="'+(Yt+bh+jH)+'" style="opacity:1;stroke-width:3"/>';
  // เหล็กทาบรับแรงดึง (lap splice) — เหล็กยืนเส้นเดิม (สีเขียว) ที่ยาวไม่พอ เอาอีกท่อนมาทาบซ้อนต่อขึ้นไป · ทาบกึ่งกลางเสา
  var db=num(m.mainDia,20), lap=lapLen(db);
  var lapMid=Hcol/2, lapTop=Math.max(lo+20, lapMid-lap/2), lapBot=Math.min(Hcol-lo-20, lapMid+lap/2);
  [[Xc+5, Xc+12], [Xr-5, Xr-12]].forEach(function(p){
    var xm=p[0], xl=p[1];   // xm=แนวเหล็กยืนหลัก, xl=ท่อนที่เอามาทาบ (เยื้องเข้าในเล็กน้อย)
    // ท่อนทาบ (เขียวเท่าเหล็กยืน) วางขนานตลอดระยะทาบ
    g+='<line class="lineB" x1="'+xl+'" y1="'+Y(lapTop).toFixed(1)+'" x2="'+xl+'" y2="'+Y(lapBot).toFixed(1)+'" style="opacity:1;stroke-width:3"/>';
    // ปลายล่างงอ offset กลับเข้าแนวเหล็กหลัก (สื่อว่าเป็นท่อนที่ต่อขึ้นมาจากช่วงล่าง)
    g+='<line class="lineB" x1="'+xl+'" y1="'+Y(lapBot).toFixed(1)+'" x2="'+xm+'" y2="'+(Y(lapBot)+9).toFixed(1)+'" style="opacity:1;stroke-width:3"/>';
  });
  // เส้นบอกระยะทาบ (ซ้าย) + ป้าย
  g+=dimV(Y(lapTop), Y(lapBot), Xc-20, "ทาบ "+lap);
  // เส้นบอกระยะ (ขวา): Lo บน/ล่าง + ป้าย @So / @Smid
  var xd=Xr+26, xt=Xr+34;
  g+=dimV(Yt, Yt+lo*s, xd, "Lo="+mM(lo));
  g+=dimV(Yt+bh-lo*s, Yt+bh, xd, "Lo="+mM(lo));
  g+='<text class="lbl" x="'+xt+'" y="'+(Y(lo*0.5)+3).toFixed(1)+'">@So='+so+'</text>';
  g+='<text class="lbl" x="'+xt+'" y="'+(Y(Hcol*0.5)-22).toFixed(1)+'">ช่วงกลาง</text>';
  g+='<text class="lbl" x="'+xt+'" y="'+(Y(Hcol*0.5)-10).toFixed(1)+'">@Smid='+mid+'</text>';
  g+='<text class="lbl" x="'+xt+'" y="'+(Y(Hcol-lo*0.5)+3).toFixed(1)+'">@So='+so+'</text>';
  // ป้าย S1 (ปลอกตัวแรกจากขอบ) — ชี้ที่ปลอกตัวแรกบน/ล่าง
  g+='<line class="lead" x1="'+Xc+'" y1="'+Y(s1).toFixed(1)+'" x2="'+(Xc-16)+'" y2="'+Y(s1).toFixed(1)+'"/>';
  g+='<text class="lbl" x="'+(Xc-18)+'" y="'+(Y(s1)-3).toFixed(1)+'" text-anchor="end">S1='+s1+'</text>';
  g+='<line class="lead" x1="'+Xc+'" y1="'+Y(Hcol-s1).toFixed(1)+'" x2="'+(Xc-16)+'" y2="'+Y(Hcol-s1).toFixed(1)+'"/>';
  g+='<text class="lbl" x="'+(Xc-18)+'" y="'+(Y(Hcol-s1)+11).toFixed(1)+'" text-anchor="end">S1='+s1+'</text>';
  // ป้าย "เหล็กทาบรับแรงดึง" (ขวา ช่วงกลาง-ล่าง) ชี้เข้าเหล็กทาบ
  g+='<text class="lbl" x="'+xt+'" y="'+(Y(Hcol*0.5)+14).toFixed(1)+'" fill="#15803d">ทาบรับแรงดึง</text>';
  // H รวม (ซ้ายสุด)
  g+=dimV(Yt, Yt+bh, PADL-44, "H="+mM(Hcol)+" ม.");
  return { svg: wrapSvg(W,H,"รูปด้านยาวเสา "+m.code,g),
           notes:[{t:"info", x:"ปลอกตัวแรก S1="+s1+" มม. จากขอบ · Lo="+mM(lo)+" ม. ปลอกถี่ @So="+so+" / ช่วงกลาง @Smid="+mid+" มม."},
                  {t:"info", x:"เหล็กทาบรับแรงดึง: เหล็กยืนที่ยาวไม่พอ ต่อทาบซ้อนกันกึ่งกลางเสา (นอกช่วงอัดแน่น Lo) · ระยะทาบ = "+lap+" มม. ("+(db>=25?"SD50·50db":"SD40·40db")+", ≥300มม.)"}] };
}

/* ---- พื้น RC: ตัดแถบกว้าง 1.00 ม. ---- */
function drawSlab(m){
  var STRIP=1000, PADL=74,PADR=46,PADT=48,PADB=64, TW=430;
  var s=TW/STRIP, sw=TW, sh=m.h*s;
  if(sh<60){ /* พื้นบางมาก ให้ขยายแนวตั้งเพื่อให้เห็นชั้นเหล็ก */ }
  var sy=Math.max(s, 70/Math.max(m.h,1));           // สเกลแนวตั้ง (ขยายถ้าพื้นบาง)
  sh=m.h*sy;
  var W=sw+PADL+PADR, H=sh+PADT+PADB;
  var X=function(v){return PADL+v*s;}, Y=function(v){return PADT+v*sy;};

  var g='';
  g+='<rect class="conc" x="'+X(0)+'" y="'+Y(0)+'" width="'+sw+'" height="'+sh+'"/>';

  // เหล็กล่าง: ทางสั้นอยู่ชั้นนอกสุด (ใกล้ผิวล่าง) ทางยาวซ้อนอยู่ด้านใน
  var yBM=m.h-m.cover-m.botMainDia/2;
  var yBD=m.h-m.cover-m.botMainDia-m.botDistDia/2;
  var nBM=barsInStrip(STRIP,m.botMainSp);
  g+='<line class="lineB" x1="'+X(10)+'" y1="'+Y(yBD)+'" x2="'+X(STRIP-10)+'" y2="'+Y(yBD)+'"/>';
  spreadPts(m.botMainSp/2, STRIP-m.botMainSp/2, nBM).forEach(function(x){
    g+=circleAt("barB",X(x),Y(yBM),barR(m.botMainDia,sy));
  });

  // เหล็กบน (ถ้ามี)
  var hasTop=m.topMainDia>0;
  if(hasTop){
    var yTM=m.cover+m.topMainDia/2, yTD=m.cover+m.topMainDia+m.topDistDia/2;
    var nTM=barsInStrip(STRIP,m.topMainSp);
    g+='<line class="lineA" x1="'+X(10)+'" y1="'+Y(yTD)+'" x2="'+X(STRIP-10)+'" y2="'+Y(yTD)+'"/>';
    spreadPts(m.topMainSp/2, STRIP-m.topMainSp/2, nTM).forEach(function(x){
      g+=circleAt("barA",X(x),Y(yTM),barR(m.topMainDia,sy));
    });
  }

  g+=dimH(X(0),X(STRIP),Y(m.h)+30,"แถบกว้าง 1.00 ม.");
  g+=dimV(Y(0),Y(m.h),X(0)-32,"หนา "+mM(m.h)+" ม.");
  g+='<text class="lbl" x="'+X(0)+'" y="'+(Y(0)-16)+'">covering '+mM(m.cover)+' ม. (บน-ล่าง)</text>';

  var legend=[{k:"dot",c:"var(--pass)",t:"เหล็กล่างทางสั้น DB"+m.botMainDia+"@"+m.botMainSp},
              {k:"bar",c:"var(--pass)",t:"เหล็กล่างทางยาว DB"+m.botDistDia+"@"+m.botDistSp}];
  var notes=[{t:"info", x:"ในแถบ 1.00 ม. ต้องมีเหล็กล่างทางสั้น "+barsInStrip(STRIP,m.botMainSp)+" เส้น"
              +(hasTop?" และเหล็กบนทางสั้น "+barsInStrip(STRIP,m.topMainSp)+" เส้น":"")}];
  if(hasTop){
    legend.push({k:"dot",c:"var(--brand)",t:"เหล็กบนทางสั้น DB"+m.topMainDia+"@"+m.topMainSp});
    legend.push({k:"bar",c:"var(--brand)",t:"เหล็กบนทางยาว DB"+m.topDistDia+"@"+m.topDistSp});
  }else{
    notes.push({t:"warn", x:"แบบระบุว่าไม่มีเหล็กบน — ยืนยันกับวิศวกรว่าบริเวณหัวเสา/ขอบต่อเนื่องไม่ต้องเสริมจริงหรือไม่"});
  }
  if(m.h>0 && sy>s) notes.push({t:"info", x:"รูปนี้ขยายมาตราส่วนแนวตั้ง ×"+(sy/s).toFixed(1)+" เพื่อให้เห็นชั้นเหล็กชัด"});
  return { svg: wrapSvg(W,H,"หน้าตัดพื้น "+m.code,g), legend:legend, notes:notes };
}

/* ---- พื้น: รูปตัดตามยาว (span section) แบบ shop drawing ----
   เหล็กล่างต่อเนื่อง + เหล็กบนอยู่ที่หัวรับยื่นเข้าช่วง + EXTRA + ขอบรับ BEAM/WALL ---- */
function drawSlabSpanDir(m, cfg){
  var span=Math.max(300, num(cfg.span,4000));
  var B="var(--brand)", D="var(--text)";                 // B=สีน้ำเงิน(annotation) D=ดำ(โครงสร้าง)
  var ovh=66, TW=740, wB=44, TH=48, beamDrop=126;
  var xBL=122, xBR=xBL+TW, x0=xBL-ovh, x1=xBR+ovh, W=x1+30;
  var ySlabT=196, ySlabB=ySlabT+TH, yBeamB=ySlabT+beamDrop;
  // ตะแกรง 2 ทางซ้อนกัน = 4 ชั้น (บน: ทางสั้น=นอก ทางยาว=ใน · ล่าง: ทางสั้น=นอก ทางยาว=ใน)
  var yTM=ySlabT+9, yTD=ySlabT+14, yBD=ySlabB-14, yBM=ySlabB-9;   // จุด(ตามขวาง) ชิดติดเส้น(ตามยาว)
  var yCL=42, rCL=16, ySpanDim=106, cxC=(x0+x1)/2, H=406;
  var sx=TW/span, pid="slbH"+Math.round(span);
  var eName={beam:"RC. BEAM",wall:"RC. WALL",free:""};
  var g='<defs><pattern id="'+pid+'" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#8a8f98" stroke-width="1"/></pattern></defs>';
  function arw(x1_,y1_,x2_,y2_){ return '<line x1="'+x1_+'" y1="'+y1_+'" x2="'+x2_+'" y2="'+y2_+'" stroke="'+B+'" stroke-width="1" style="color:var(--brand)" marker-end="url(#ar)"/>'; }
  g+='<rect x="'+x0+'" y="'+ySlabT+'" width="'+(x1-x0)+'" height="'+TH+'" fill="var(--surface,#fff)"/>';
  // คานรองรับ (ลายเฉียง) + centerline + CL
  [ [xBL,cfg.endL], [xBR,cfg.endR] ].forEach(function(p){
    var cx=p[0], e=p[1]; if(e==="free") return;
    g+='<line x1="'+cx+'" y1="'+(yCL+rCL)+'" x2="'+cx+'" y2="'+(yBeamB+10)+'" stroke="'+B+'" stroke-width="0.8"/>';
    g+='<rect x="'+(cx-wB/2)+'" y="'+ySlabT+'" width="'+wB+'" height="'+beamDrop+'" fill="url(#'+pid+')" stroke="'+D+'" stroke-width="1.1"/>';
    g+='<circle cx="'+cx+'" cy="'+yCL+'" r="'+rCL+'" fill="var(--surface,#fff)" stroke="'+B+'" stroke-width="1.2"/>';
    g+='<text x="'+cx+'" y="'+(yCL+4)+'" text-anchor="middle" fill="'+B+'" font-size="11">CL.</text>';
  });
  g+='<line x1="'+x0+'" y1="'+ySlabT+'" x2="'+x1+'" y2="'+ySlabT+'" stroke="'+D+'" stroke-width="1.2"/>';
  g+='<line x1="'+x0+'" y1="'+ySlabB+'" x2="'+x1+'" y2="'+ySlabB+'" stroke="'+D+'" stroke-width="1.2"/>';
  // เหล็กเป็นจุด (section) — ทุกแถวเรียงกริดเดียวกัน (เริ่มจาก x0+12) จึงสม่ำเสมอ
  function dotRow(y, sp){ if(sp<=0) return ''; var gap=Math.max(11,Math.min(24, sp*sx)), s='';
    for(var x=x0+12; x<=x1-12+0.5; x+=gap) s+='<circle cx="'+x.toFixed(1)+'" cy="'+y+'" r="1.8" fill="'+D+'"/>'; return s; }
  var mB=cfg.mBot||{d:0,s:200}, dB=cfg.dBot||{d:0,s:200}, mT=cfg.mTop||{d:0,s:200}, dT=cfg.dTop||{d:0,s:200};
  function barLine(y){ return '<line x1="'+(x0+8)+'" y1="'+y+'" x2="'+(x1-8)+'" y2="'+y+'" stroke="'+D+'" stroke-width="2.2"/>'; }
  // ชั้นใน (เหล็กแจกจ่าย ตั้งฉากระนาบตัด) = จุด · ชั้นนอกสุด บน-ล่าง (เหล็กเมนในระนาบ) = เส้นยาวต่อเนื่อง
  if(dB.d>0) g+=dotRow(yBD, dB.s);
  if(dT.d>0) g+=dotRow(yTD, dT.s);
  if(mB.d>0) g+=barLine(yBM);
  if(mT.d>0) g+=barLine(yTM);
  // เหล็กบนเสริมที่หัวรับ (ยื่นเข้าช่วง) — เส้นหนา + ระยะยื่น (ถ้ากรอก)
  var exD=num(cfg.xDia,0)||mT.d, exL=Math.min(span,num(cfg.xExtL,0))*sx, exR=Math.min(span,num(cfg.xExtR,0))*sx;
  if(exD>0 && (num(cfg.xExtL,0)>0 || num(cfg.xExtR,0)>0)){
    var yEx=ySlabT+3.5;
    if(cfg.endL!=="free"&&exL>0){ g+='<line x1="'+(xBL-wB/2)+'" y1="'+yEx+'" x2="'+(xBL+exL).toFixed(1)+'" y2="'+yEx+'" stroke="'+D+'" stroke-width="2.6"/>'; g+=dimBlue(xBL, xBL+exL, ySlabT-16, mM(num(cfg.xExtL,0)), B); }
    if(cfg.endR!=="free"&&exR>0){ g+='<line x1="'+(xBR-exR).toFixed(1)+'" y1="'+yEx+'" x2="'+(xBR+wB/2)+'" y2="'+yEx+'" stroke="'+D+'" stroke-width="2.6"/>'; g+=dimBlue(xBR-exR, xBR, ySlabT-16, mM(num(cfg.xExtR,0)), B); }
  }
  // เส้น break ปลายพื้นสองข้าง
  function brk(x){ return '<polyline points="'+x+','+(ySlabT-2)+' '+(x+7)+','+(ySlabT+TH*0.4).toFixed(1)+' '+(x-5)+','+(ySlabT+TH*0.72).toFixed(1)+' '+(x+2)+','+(ySlabB+2)+'" fill="none" stroke="'+D+'" stroke-width="1.1"/>'; }
  g+=brk(x0)+brk(x1);
  g+=dimBlue(xBL, xBR, ySpanDim, "", B);
  g+='<text x="'+cxC+'" y="'+(ySpanDim-6)+'" text-anchor="middle" fill="'+B+'" font-size="11">'+esc(cfg.spanLabel||"SHORT SPAN (L)")+'</text>';
  // ความหนา (ซ้าย)
  g+='<line x1="'+(x0)+'" y1="'+ySlabT+'" x2="'+(x0-18)+'" y2="'+ySlabT+'" stroke="'+B+'" stroke-width="0.8"/>';
  g+='<line x1="'+(x0)+'" y1="'+ySlabB+'" x2="'+(x0-18)+'" y2="'+ySlabB+'" stroke="'+B+'" stroke-width="0.8"/>';
  g+='<line x1="'+(x0-12)+'" y1="'+ySlabT+'" x2="'+(x0-12)+'" y2="'+ySlabB+'" stroke="'+B+'" stroke-width="1" style="color:var(--brand)" marker-start="url(#ar)" marker-end="url(#ar)"/>';
  g+='<text x="'+(x0-16)+'" y="'+((ySlabT+ySlabB)/2)+'" text-anchor="middle" fill="'+B+'" font-size="10" transform="rotate(-90 '+(x0-16)+' '+((ySlabT+ySlabB)/2)+')">'+(num(m.h,0)/1000).toFixed(3)+'</text>';
  // ลูกศรชี้เหล็ก — แยก 2 ลูกศรต่อด้าน: 1 ชี้จุด(ตามขวาง)+วงกลมล้อม  2 ชี้เส้น(ตามยาว)ไม่มีวงกลม
  function bcall(o){ return "DB"+o.d+"mm.@"+(num(o.s,0)/1000).toFixed(2)+"m.#"; }
  var mLbl=cfg.mLbl||"ตามยาว", dLbl=cfg.dLbl||"ตามขวาง";
  var cxLine=cxC+30;
  // หาตำแหน่งจุดเหล็กจริงที่ใกล้ target (grid เดียวกับ dotRow: เริ่ม x0+12 ระยะ gap)
  function nearestDot(sp, target){
    var gap=Math.max(11,Math.min(24, sp*sx));
    var k=Math.round((target-(x0+12))/gap);
    return +((x0+12)+k*gap).toFixed(1);
  }
  // ลูกศรชี้จุด (ตามขวาง) — วงกลมล้อมจุดเหล็กจริง (ไม่มี inner dot เพราะจุดเหล็กคือจุดอยู่แล้ว)
  function callDot(cx, cyDot, textY, label){
    var end=cyDot+(textY<cyDot?-5:5), s='';
    s+='<line x1="'+cx+'" y1="'+textY+'" x2="'+cx+'" y2="'+end+'" stroke="'+B+'" stroke-width="1" style="color:var(--brand)" marker-end="url(#ar)"/>';
    s+='<circle cx="'+cx+'" cy="'+cyDot+'" r="4.6" fill="none" stroke="'+B+'" stroke-width="1.2"/>';
    s+='<line x1="'+cx+'" y1="'+textY+'" x2="'+(cxC+16)+'" y2="'+textY+'" stroke="'+B+'" stroke-width="1"/>';
    s+='<text x="'+(cxC+20)+'" y="'+(textY+3.5)+'" fill="'+B+'" font-size="11">'+esc(label)+'</text>';
    return s;
  }
  // ลูกศรชี้เส้นยาว (ตามยาว) — ไม่มีวงกลม แค่ลูกศรชี้ตรง
  function callLine(cyLine, textY, label){
    var end=cyLine+(textY<cyLine?-5:5), s='';
    s+='<line x1="'+cxLine+'" y1="'+textY+'" x2="'+cxLine+'" y2="'+end+'" stroke="'+B+'" stroke-width="1" style="color:var(--brand)" marker-end="url(#ar)"/>';
    s+='<line x1="'+cxLine+'" y1="'+textY+'" x2="'+(cxC+16)+'" y2="'+textY+'" stroke="'+B+'" stroke-width="1"/>';
    s+='<text x="'+(cxC+20)+'" y="'+(textY+3.5)+'" fill="'+B+'" font-size="11">'+esc(label)+'</text>';
    return s;
  }
  // บน: ตามยาว(เส้น)=yTM ตามขวาง(จุด)=yTD
  if(mT.d>0) g+=callLine(yTM, 125, bcall(mT)+" (บน-"+mLbl+")");
  if(dT.d>0) g+=callDot(nearestDot(dT.s, cxC-30), yTD, 138, bcall(dT)+" (บน-"+dLbl+")");
  // ล่าง: ตามยาว(เส้น)=yBM ตามขวาง(จุด)=yBD
  if(dB.d>0) g+=callDot(nearestDot(dB.s, cxC-30), yBD, 300, bcall(dB)+" (ล่าง-"+dLbl+")");
  if(mB.d>0) g+=callLine(yBM, 313, bcall(mB)+" (ล่าง-"+mLbl+")");
  // ป้าย RC.BEAM / RC.WALL พร้อมลูกศร
  [ [xBL,cfg.endL,-1], [xBR,cfg.endR,1] ].forEach(function(p){
    var cx=p[0], e=p[1], dir=p[2]; if(e==="free") return;
    var tx=cx+dir*(wB/2+52), ax=cx+dir*(wB/2+6);
    g+=arw(ax, yBeamB-6, cx+dir*(wB/2-4), yBeamB-22);
    g+='<text x="'+tx+'" y="'+(yBeamB-2)+'" text-anchor="'+(dir<0?"end":"start")+'" fill="'+B+'" font-size="10">'+esc(eName[e]||"RC. BEAM")+'</text>';
  });
  // ชื่อ + SCALE
  g+='<text x="'+cxC+'" y="'+(H-22)+'" text-anchor="middle" fill="'+D+'" font-size="13" font-style="italic" font-weight="700">'+esc("SLAB "+(m.code||""))+'</text>';
  g+='<line x1="'+(cxC-52)+'" y1="'+(H-16)+'" x2="'+(cxC+52)+'" y2="'+(H-16)+'" stroke="'+D+'" stroke-width="1"/>';
  g+='<text x="'+cxC+'" y="'+(H-4)+'" text-anchor="middle" fill="'+D+'" font-size="10">SCALE   1 : 25</text>';
  return { svg: wrapSvg(W,H,"รูปตัดพื้น "+cfg.title+" "+m.code, g), title:cfg.title };
}
/** เส้นบอกระยะแนวนอนสีน้ำเงิน (ลูกศรทั้งสองปลาย) */
function dimBlue(x1_,x2_,y,label,B){ B=B||"var(--brand)";
  return '<line x1="'+x1_+'" y1="'+y+'" x2="'+x2_+'" y2="'+y+'" stroke="'+B+'" stroke-width="1" style="color:var(--brand)" marker-start="url(#ar)" marker-end="url(#ar)"/>'
    + '<line x1="'+x1_+'" y1="'+(y-5)+'" x2="'+x1_+'" y2="'+(y+5)+'" stroke="'+B+'" stroke-width="0.8"/>'
    + '<line x1="'+x2_+'" y1="'+(y-5)+'" x2="'+x2_+'" y2="'+(y+5)+'" stroke="'+B+'" stroke-width="0.8"/>'
    + (label?'<text x="'+((x1_+x2_)/2)+'" y="'+(y-5)+'" text-anchor="middle" fill="'+B+'" font-size="10">'+esc(label)+'</text>':'');
}
function drawSlabSpan(m){        // ตามยาว=เส้นนอกสุด(บน/ล่าง) · ตามขวาง=จุดชั้นในชิดเส้น
  return drawSlabSpanDir(m, { title:"รูปตัดพื้น", spanLabel:"SHORT SPAN (L)", span:num(m.spanS,4000),
    endL:m.endL||"beam", endR:m.endR||"beam", mLbl:"ตามยาว", dLbl:"ตามขวาง",
    mBot:{d:num(m.botMainDia,0),s:num(m.botMainSp,200)}, dBot:{d:num(m.botDistDia,0),s:num(m.botDistSp,200)},
    mTop:{d:num(m.topMainDia,0),s:num(m.topMainSp,200)}, dTop:{d:num(m.topDistDia,0),s:num(m.topDistSp,200)},
    xExtL:num(m.topExtL,0), xExtR:num(m.topExtR,0) });
}
function drawSlabSpanLong(m){    // ทางยาว (2 ทาง) — เมน(ยาว)=เส้นนอกสุด, แจกจ่าย(สั้น)=จุดชั้นใน
  return drawSlabSpanDir(m, { title:"ทางยาว (Long span)", spanLabel:"LONG SPAN (L)", span:num(m.spanL,4000),
    endL:"beam", endR:"beam", mLbl:"ทางยาว", dLbl:"ทางสั้น",
    mBot:{d:num(m.botDistDia,0),s:num(m.botDistSp,200)}, dBot:{d:num(m.botMainDia,0),s:num(m.botMainSp,200)},
    mTop:{d:num(m.topDistDia,0),s:num(m.topDistSp,200)}, dTop:{d:num(m.topMainDia,0),s:num(m.topMainSp,200)},
    xDia:num(m.lxDia,0), xSp:num(m.lxSp,0), xExtL:num(m.topExtL2,0), xExtR:num(m.topExtR2,0) });
}

/* ---- บันได: ตัดตามความชัน (เหล็กหลักเห็นเป็นเส้น เหล็กแจกจ่ายเห็นเป็นจุด) ---- */
function drawStair(m){
  var nDraw=Math.max(1, Math.min(4, m.steps|0));
  var t=m.tread, r=m.riser, w=m.waist;
  var Lslope=Math.sqrt(t*t+r*r);
  var nx=-r/Lslope, ny=t/Lslope;                     // เวกเตอร์ตั้งฉาก ชี้ลงสู่ท้องบันได

  // จุดหักของแนวลาด และจุดท้องบันได
  var P=[],U=[],i;
  for(i=0;i<=nDraw;i++){ P.push({x:i*t, y:i*r}); }
  for(i=0;i<=nDraw;i++){ U.push({x:P[i].x+w*nx, y:P[i].y+w*ny}); }

  var minX=Math.min(0,U[0].x), maxX=P[nDraw].x, maxY=U[nDraw].y;
  var PADL=70,PADR=52,PADT=44,PADB=66, TARGET=380;
  var s=TARGET/Math.max(maxX-minX, maxY);
  var W=(maxX-minX)*s+PADL+PADR, H=maxY*s+PADT+PADB;
  var X=function(v){return PADL+(v-minX)*s;}, Y=function(v){return PADT+v*s;};

  // รูปหลายเหลี่ยมของคอนกรีต: ผิวขั้นบันได → ท้องบันได
  var pts=[];
  pts.push([P[0].x,P[0].y]);
  for(i=1;i<=nDraw;i++){ pts.push([P[i].x, P[i-1].y]); pts.push([P[i].x, P[i].y]); }
  for(i=nDraw;i>=0;i--){ pts.push([U[i].x, U[i].y]); }
  var d=pts.map(function(p){ return X(p[0]).toFixed(1)+","+Y(p[1]).toFixed(1); }).join(" ");

  var g='<polygon class="conc" points="'+d+'"/>';

  // เหล็กหลักวิ่งตามความชัน → เห็นเป็นเส้น (อยู่ชิดท้องบันได)
  var off=w-m.cover-m.mainDia/2;
  var A0={x:P[0].x+off*nx, y:P[0].y+off*ny}, A1={x:P[nDraw].x+off*nx, y:P[nDraw].y+off*ny};
  g+='<line class="lineB" x1="'+X(A0.x)+'" y1="'+Y(A0.y)+'" x2="'+X(A1.x)+'" y2="'+Y(A1.y)+'" style="opacity:1;stroke-width:4"/>';

  // เหล็กแจกจ่ายตัดขวาง → เห็นเป็นจุด เรียงตามระยะบนแนวลาด
  var totalSlope=nDraw*Lslope;
  var nDist=Math.max(2, Math.floor(totalSlope/Math.max(m.distSp,10))+1);
  var ux=t/Lslope, uy=r/Lslope, offD=off-m.mainDia/2-m.distDia/2;
  spreadPts(m.distSp/2, totalSlope-m.distSp/2, nDist).forEach(function(L){
    var px=P[0].x+ux*L+offD*nx, py=P[0].y+uy*L+offD*ny;
    g+=circleAt("barA",X(px),Y(py),barR(m.distDia,s));
  });

  // บอกขนาด
  g+=dimH(X(P[0].x),X(P[1].x),Y(P[0].y)-20,"ลูกนอน "+mM(t)+" ม.");
  g+=dimV(Y(P[0].y),Y(P[1].y),X(P[1].x)+34,"ลูกตั้ง "+mM(r)+" ม.");
  g+='<line class="dim" x1="'+X(P[0].x)+'" y1="'+Y(P[0].y)+'" x2="'+X(U[0].x)+'" y2="'+Y(U[0].y)+'" marker-end="url(#ar)"/>';
  g+='<text class="lbl" x="'+X(U[0].x)+'" y="'+(Y(U[0].y)+20)+'" text-anchor="end" dx="-4">waist '+mM(w)+' ม.</text>';

  var nMain=Math.max(2,Math.floor(1000/Math.max(m.mainSp,10))+1);
  return {
    svg: wrapSvg(W,H,"หน้าตัดบันได "+m.code,g),
    legend: [ {k:"bar",c:"var(--pass)",t:"เหล็กหลักตามความชัน DB"+m.mainDia+"@"+m.mainSp},
              {k:"dot",c:"var(--brand)",t:"เหล็กแจกจ่าย DB"+m.distDia+"@"+m.distSp} ],
    notes: [ {t:"info", x:"ตัดตามความชัน — เหล็กหลักเห็นเป็นเส้น เหล็กแจกจ่ายเห็นเป็นจุด (แสดง "
                 +nDraw+" ขั้นแรกจากทั้งหมด "+m.steps+" ขั้น)"},
             {t:"info", x:"ในความกว้างบันได 1.00 ม. ต้องมีเหล็กหลัก "+nMain+" เส้น"} ]
  };
}

/* ---- ผนัง Shear wall: ตัดในแนวราบ (plan) ---- */
function drawWall(m){
  var PADL=74,PADR=46,PADT=46,PADB=64, TW=450;
  var sx=TW/Math.max(m.Lw,1);
  var sy=Math.max(sx, 90/Math.max(m.t,1));          // ขยายแนวความหนาให้เห็นตะแกรงชัด
  var ww=m.Lw*sx, wt=m.t*sy;
  var W=ww+PADL+PADR, H=wt+PADT+PADB;
  var X=function(v){return PADL+v*sx;}, Y=function(v){return PADT+v*sy;};

  var g='<rect class="conc" x="'+X(0)+'" y="'+Y(0)+'" width="'+ww+'" height="'+wt+'"/>';

  var layers=(m.layers>=2)?2:1;
  var vIn=m.cover+m.vertDia/2;                       // เหล็กตั้งอยู่ชั้นนอกสุด
  var hIn=m.cover+m.vertDia+m.horizDia/2;            // เหล็กนอนอยู่ถัดเข้ามา
  var rows = layers===2 ? [vIn, m.t-vIn] : [m.t/2];
  var hRows= layers===2 ? [hIn, m.t-hIn] : [m.t/2];

  // เหล็กนอน วิ่งตามความยาวผนัง → เห็นเป็นเส้น
  hRows.forEach(function(y){
    g+='<line class="lineA" x1="'+X(m.cover)+'" y1="'+Y(y)+'" x2="'+X(m.Lw-m.cover)+'" y2="'+Y(y)+'" style="opacity:1"/>';
  });
  // เหล็กตั้ง ตัดขวาง → เห็นเป็นจุด
  var endIn=m.cover+m.vertDia/2;
  var nV=barsInStrip(m.Lw-2*endIn, m.vertSp);
  var xs=spreadPts(endIn, m.Lw-endIn, nV);
  rows.forEach(function(y){
    xs.forEach(function(x){ g+=circleAt("barB",X(x),Y(y),barR(m.vertDia,sy)); });
  });

  g+=dimH(X(0),X(m.Lw),Y(m.t)+30,"ยาว "+mM(m.Lw)+" ม.");
  g+=dimV(Y(0),Y(m.t),X(0)-32,"หนา "+mM(m.t)+" ม.");
  g+='<text class="lbl" x="'+X(0)+'" y="'+(Y(0)-16)+'">ตัดในแนวราบ (plan) · covering '+mM(m.cover)+' ม.</text>';

  var notes=[{t:"info", x:"ตะแกรง "+layers+" ชั้น — เหล็กตั้งทั้งผนังต้องมี "+(nV*layers)+" เส้น (ชั้นละ "+nV+" เส้น)"}];
  if(layers===1) notes.push({t:"warn", x:"แบบระบุตะแกรงชั้นเดียว — ผนัง Shear wall ส่วนใหญ่ต้อง 2 ชั้น ให้ยืนยันกับวิศวกร"});
  return {
    svg: wrapSvg(W,H,"หน้าตัดผนัง "+m.code,g),
    legend: [ {k:"dot",c:"var(--pass)",t:"เหล็กตั้ง DB"+m.vertDia+"@"+m.vertSp},
              {k:"bar",c:"var(--brand)",t:"เหล็กนอน DB"+m.horizDia+"@"+m.horizSp} ],
    notes: notes
  };
}

/* ---- ฐานราก: ตัดตามด้าน B ---- */
function drawFooting(m){
  var PADL=76,PADR=46,PADT=76,PADB=88, TW=420;
  var sx=TW/Math.max(m.B,1);
  var sy=Math.max(sx, 120/Math.max(m.H,1));
  var fw=m.B*sx, fh=m.H*sy;
  var W=fw+PADL+PADR, H=fh+PADT+PADB;
  var X=function(v){return PADL+v*sx;}, Y=function(v){return PADT+v*sy;};

  var g='';
  // ตอม่อ/เสาด้านบน (เส้นประ) ช่วยยืนยันว่าเหล็กหนวดกุ้งตรงศูนย์ฐานราก
  var stubW=Math.max(m.B*0.26, 200), stubH=60/sy;
  g+='<rect class="conc2" x="'+X(m.B/2-stubW/2)+'" y="'+(Y(0)-60)+'" width="'+(stubW*sx)+'" height="60"/>';
  g+='<text class="lbl" x="'+X(m.B/2)+'" y="'+(Y(0)-66)+'" text-anchor="middle">ตอม่อ / เสา</text>';
  g+='<rect class="conc" x="'+X(0)+'" y="'+Y(0)+'" width="'+fw+'" height="'+fh+'"/>';

  // เหล็กล่าง: ทางกว้าง B อยู่ชั้นนอกสุด, ทางยาว L ซ้อนด้านใน
  var yB=m.H-m.cover-m.botDiaB/2, yL=m.H-m.cover-m.botDiaB-m.botDiaL/2;
  g+='<line class="lineA" x1="'+X(m.cover)+'" y1="'+Y(yL)+'" x2="'+X(m.B-m.cover)+'" y2="'+Y(yL)+'" style="opacity:1"/>';
  var endIn=m.cover+m.botDiaB/2, nB=barsInStrip(m.B-2*endIn, m.botSpB);
  spreadPts(endIn, m.B-endIn, nB).forEach(function(x){ g+=circleAt("barB",X(x),Y(yB),barR(m.botDiaB,sy)); });

  // เหล็กบน (ถ้ามี)
  if(m.topDia>0){
    var yT=m.cover+m.topDia/2, nT=barsInStrip(m.B-2*endIn, m.topSp);
    spreadPts(endIn, m.B-endIn, nT).forEach(function(x){ g+=circleAt("barA",X(x),Y(yT),barR(m.topDia,sy)); });
  }

  g+=dimH(X(0),X(m.B),Y(m.H)+30,"B = "+mM(m.B)+" ม.");
  g+=dimV(Y(0),Y(m.H),X(0)-32,"H = "+mM(m.H)+" ม.");
  g+='<text class="lbl" x="'+X(0)+'" y="'+(Y(m.H)+74)+'">covering ก้นฐาน '+mM(m.cover)+' ม. — ต้องมีลูกปูนหนุน ห้ามวางเหล็กติดดิน</text>';

  var legend=[{k:"dot",c:"var(--pass)",t:"เหล็กล่างทางกว้าง B: DB"+m.botDiaB+"@"+m.botSpB},
              {k:"bar",c:"var(--brand)",t:"เหล็กล่างทางยาว L: DB"+m.botDiaL+"@"+m.botSpL}];
  if(m.topDia>0) legend.push({k:"dot",c:"var(--brand)",t:"เหล็กบน DB"+m.topDia+"@"+m.topSp});
  var nL=barsInStrip(m.L-2*(m.cover+m.botDiaL/2), m.botSpL);
  var notes=[{t:"info", x:"เหล็กล่างทางกว้าง B ต้องมี "+nB+" เส้น · ทางยาว L ต้องมี "+nL+" เส้น"}];
  if(m.pileCount>0) notes.push({t:"info", x:"ฐานรากเสาเข็ม "+m.pileCount+" ต้น — เช็คระยะเยื้องศูนย์หัวเข็มก่อนผูกเหล็ก"});
  else notes.push({t:"info", x:"ฐานรากแผ่ — ตรวจความแน่นและระดับทรายรอง/คอนกรีตหยาบก่อนวางเหล็ก"});
  return { svg: wrapSvg(W,H,"หน้าตัดฐานราก "+m.code,g), legend:legend, notes:notes };
}

/* ---- พื้น Post-tension: รูปโปรไฟล์เอ็นตามความยาวช่วง (จุดพลาดหลักของงาน PT) ---- */
function drawPT(m){
  var PADL=76,PADR=60,PADT=48,PADB=96, TW=470, TH=170;
  var sx=TW/Math.max(m.span,1), sy=TH/Math.max(m.h,1);
  var pw=TW, ph=m.h*sy;
  var W=pw+PADL+PADR, H=ph+PADT+PADB;
  var X=function(v){return PADL+v*sx;}, Y=function(v){return PADT+v*sy;};   // y วัดจากผิวบนพื้น

  var g='';
  g+='<rect class="conc" x="'+X(0)+'" y="'+Y(0)+'" width="'+pw+'" height="'+ph+'"/>';
  // เสารองรับสองข้าง (เส้นประ)
  [0, m.span].forEach(function(x0){
    var cw=400*sx;
    g+='<rect class="conc2" x="'+(X(x0)-cw/2)+'" y="'+Y(m.h)+'" width="'+cw+'" height="44"/>';
  });

  // เส้นเอ็นเป็นพาราโบลา: ที่หัวเสา = cgsEnd, ที่กลางช่วง = cgsMid (วัดจากท้องพื้น)
  var pts=[], N=48;
  for(var i=0;i<=N;i++){
    var x=m.span*i/N;
    var u=1-2*x/m.span;
    var fromBottom=m.cgsMid+(m.cgsEnd-m.cgsMid)*u*u;
    pts.push(X(x).toFixed(1)+","+Y(m.h-fromBottom).toFixed(1));
  }
  g+='<polyline class="tendon" points="'+pts.join(" ")+'"/>';

  // เหล็กเสริมล่างธรรมดา
  var yR=m.h-m.cover-m.rebarDia/2;
  g+='<line class="lineB" x1="'+X(m.span*0.03)+'" y1="'+Y(yR)+'" x2="'+X(m.span*0.97)+'" y2="'+Y(yR)+'" style="opacity:1"/>';

  // บอกระดับเอ็น
  g+=dimV(Y(m.h-m.cgsEnd), Y(m.h), X(0)-30, "CGS ปลาย "+mM(m.cgsEnd)+" ม.");
  var xm=m.span/2;
  g+=dimV(Y(m.h-m.cgsMid), Y(m.h), X(xm), "CGS กลาง "+mM(m.cgsMid)+" ม.");
  g+=dimV(Y(0),Y(m.h),X(m.span)+34,"หนา "+mM(m.h)+" ม.");
  g+=dimH(X(0),X(m.span),Y(m.h)+58,"span = "+(m.span/1000).toFixed(2)+" ม.");
  g+='<text class="lbl" x="'+X(0)+'" y="'+(Y(0)-16)+'">รูปโปรไฟล์เอ็นตามความยาวช่วง (ขยายแนวตั้ง ×'+(sy/sx).toFixed(0)+')</text>';

  var notes=[{t:"info", x:"เอ็น "+m.tendonQty+" เส้น @"+m.tendonSp+" มม. — "+(m.tendonType||"ตามแบบ")}];
  if(m.cgsMid < m.cover) notes.push({t:"warn", x:"ระดับเอ็นที่กลางช่วง ("+m.cgsMid+") ต่ำกว่าระยะหุ้ม ("+m.cover+") — ตรวจสอบแบบอีกครั้ง"});
  if(m.cgsEnd > m.h-m.cover) notes.push({t:"warn", x:"ระดับเอ็นที่หัวเสา ("+m.cgsEnd+") สูงเกินความหนาพื้นหักระยะหุ้ม — ตรวจสอบแบบอีกครั้ง"});
  notes.push({t:"info", x:"ระยะยกจากกลางช่วงถึงหัวเสา (drape) = "+mM(m.cgsEnd-m.cgsMid)+" ม. ใช้ตรวจความสูงเก้าอี้รองเอ็น"});
  return {
    svg: wrapSvg(W,H,"รูปโปรไฟล์เอ็น "+m.code,g),
    legend: [ {k:"bar",c:"var(--t-pt)",t:"เส้นเอ็น (tendon)"},
              {k:"bar",c:"var(--pass)",t:"เหล็กเสริมล่าง DB"+m.rebarDia+"@"+m.rebarSp} ],
    notes: notes
  };
}

/** เลือกฟังก์ชันวาดตามประเภท — คืน null ถ้าวาดไม่ได้ */
function drawSection(m){
  try{
    switch(m.type){
      case "beam":    return drawBeam(m);
      case "column":  return drawColumn(m);
      case "slab":    return drawSlab(m);
      case "stair":   return drawStair(m);
      case "wall":    return drawWall(m);
      case "footing": return drawFooting(m);
      case "pt":      return drawPT(m);
    }
  }catch(err){ console.warn("วาดหน้าตัดไม่สำเร็จ:", err); }
  return null;
}

/* ---------------------------------------------------------------------------
   6) ตารางสเปก + การเรนเดอร์หน้าจอ
   ------------------------------------------------------------------------ */

/** แถวตารางสเปกแยกตามประเภท → [[หัวข้อ, ค่า]] หรือ ["--", "หัวข้อกลุ่ม"] */
function specRows(m){
  var mn = function(v){ return '<span class="mono">'+esc(v)+'</span>'; };
  var sz = function(a,b){ return mn(a+" × "+b+" มม."); };
  var rebar = function(dia,sp){ return dia>0 ? mn("DB"+dia+"@"+sp+" มม.") : '<span class="muted">ไม่มี</span>'; };
  var rows = [];
  switch(m.type){
    case "beam": {
      rows.push(["--","ขนาดหน้าตัด"]);
      rows.push(["หน้าตัด b × h", sz(m.b,m.h)], ["ระยะหุ้ม (covering)", mn(m.cover+" มม.")]);
      if(m.span) rows.push(["ช่วงพาด (span)", mn((m.span/1000).toFixed(2)+" ม.")]);
      var sts=ensureBeamStations(m);
      BEAM_STATIONS.forEach(function(S){
        var st=sts[S.k]; if(!st||!st.on) return;
        var g=beamStationSummary(st);
        rows.push(["--","เหล็กเสริม — "+S.l]);
        rows.push(["เหล็กบน", mn(g.top)], ["เหล็กล่าง", mn(g.bot)]);
        if(g.side!=="—") rows.push(["เหล็กข้าง", mn(g.side)]);
        rows.push(["เหล็กปลอก", mn(g.stir)]);
      });
      break;
    }
    case "column":
      rows.push(["--","ขนาดหน้าตัด"]);
      rows.push(["หน้าตัด b × h", sz(m.b,m.h)], ["ระยะหุ้ม (covering)", mn(m.cover+" มม.")]);
      if(num(m.height,0)) rows.push(["ความสูงเสา", mn((num(m.height,0)/1000).toFixed(2)+" ม.")]);
      rows.push(["--","เหล็กยืน (เมน)"]);
      rows.push(["เหล็กยืน", mn(colMainTotal(m)+"-DB"+m.mainDia+(num(m.nx,0)&&num(m.ny,0)?" (nx"+m.nx+"×ny"+m.ny+")":""))]);
      rows.push(["--","เหล็กปลอก (Tie)"]);
      var _cieL=cieListOf(m), _cixL=cixListOf(m);
      rows.push(["ปลอกนอก / ปลอกใน", mn("DB"+m.stirDia+(_cieL.length?" + ปลอกใน "+_cieL.length+" วง-DB"+num(m.tieInnerDia,10):"")+(_cixL.length?" + ปลอกในขวาง "+_cixL.length+" วง":""))]);
      if(_cixL.length) rows.push(["ปลอกในขวาง (คร่อมสดมภ์)", mn(_cixL.map(function(c,i){return "วง"+(i+1)+" "+c.left+"–"+c.right;}).join(" · "))]);
      rows.push(["ปลอกตัวแรก S1 (จากขอบคาน/พื้น)", mn("@"+num(m.stirFirst,50)+" มม.")]);
      rows.push(["ระยะเรียง So / กลาง", mn("@"+num(m.stirEnd,150)+" (Lo) / @"+num(m.stirMid,200)+" มม.")]);
      if(num(m.l0,0)) rows.push(["ระยะ Lo (อัดแน่นปลาย)", mn((num(m.l0,0)/1000).toFixed(2)+" ม.")]);
      if(spHasAny(m)){
        var _sp=spRebarOf(m);
        rows.push(["--","เหล็กเสริมพิเศษ (Top/Bottom · 2 ทิศทาง)"]);
        if(_sp.red.top.n>0)  rows.push(["แนวแดง Top",  mn(spStr(_sp.red.top))]);
        if(_sp.red.bot.n>0)  rows.push(["แนวแดง Bottom", mn(spStr(_sp.red.bot))]);
        if(_sp.blue.top.n>0) rows.push(["แนวน้ำเงิน Top",  mn(spStr(_sp.blue.top))]);
        if(_sp.blue.bot.n>0) rows.push(["แนวน้ำเงิน Bottom", mn(spStr(_sp.blue.bot))]);
      }
      break;
    case "slab":
      var edN={beam:"RC.BEAM",wall:"RC.WALL",free:"ปลายยื่น"};
      rows.push(["--","ขนาด & ช่วง"]);
      rows.push(["ความหนาพื้น", mn(m.h+" มม.")], ["ระยะหุ้ม (covering)", mn(m.cover+" มม.")]);
      if(num(m.spanS,0)) rows.push(["ช่วง (span)", mn((num(m.spanS,0)/1000).toFixed(2)+" ม.")]);
      rows.push(["ขอบรับ ซ้าย/ขวา", mn((edN[m.endL]||"RC.BEAM")+" / "+(edN[m.endR]||"RC.BEAM"))]);
      rows.push(["--","เหล็กตามยาว (เส้น)"]);
      rows.push(["บน", rebar(m.topMainDia,m.topMainSp)], ["ล่าง", rebar(m.botMainDia,m.botMainSp)]);
      rows.push(["--","เหล็กตามขวาง (จุด)"]);
      rows.push(["บน", rebar(m.topDistDia,m.topDistSp)], ["ล่าง", rebar(m.botDistDia,m.botDistSp)]);
      if(num(m.topExtL,0)>0 || num(m.topExtR,0)>0)
        rows.push(["เหล็กบนเสริมหัวรับ (ยื่น)", mn(mM(num(m.topExtL,0))+" / "+mM(num(m.topExtR,0))+" ม.")]);
      break;
    case "stair":
      rows.push(["--","รูปทรง"]);
      rows.push(["ลูกตั้ง × ลูกนอน", sz(m.riser,m.tread)], ["จำนวนขั้น", mn(m.steps+" ขั้น")]);
      rows.push(["ความหนาท้องบันได", mn(m.waist+" มม.")], ["ระยะหุ้ม (covering)", mn(m.cover+" มม.")]);
      rows.push(["--","เหล็กเสริม"]);
      rows.push(["เหล็กหลัก (ตามความชัน)", rebar(m.mainDia,m.mainSp)], ["เหล็กแจกจ่าย", rebar(m.distDia,m.distSp)]);
      break;
    case "wall":
      rows.push(["--","ขนาดผนัง"]);
      rows.push(["ความหนา × ความยาว", sz(m.t,m.Lw)], ["จำนวนตะแกรง", mn(m.layers+" ชั้น")]);
      rows.push(["ระยะหุ้ม (covering)", mn(m.cover+" มม.")]);
      rows.push(["--","เหล็กเสริม"]);
      rows.push(["เหล็กตั้ง", rebar(m.vertDia,m.vertSp)], ["เหล็กนอน", rebar(m.horizDia,m.horizSp)]);
      break;
    case "footing":
      rows.push(["--","ขนาดฐานราก"]);
      rows.push(["B × L", sz(m.B,m.L)], ["ความหนา H", mn(m.H+" มม.")]);
      rows.push(["ระยะหุ้มก้นฐาน", mn(m.cover+" มม.")]);
      rows.push(["ฐานราก", m.pileCount>0 ? mn("เสาเข็ม "+m.pileCount+" ต้น") : mn("ฐานแผ่")]);
      rows.push(["--","เหล็กเสริม"]);
      rows.push(["เหล็กล่าง ทางกว้าง B", rebar(m.botDiaB,m.botSpB)], ["เหล็กล่าง ทางยาว L", rebar(m.botDiaL,m.botSpL)]);
      rows.push(["เหล็กบน", rebar(m.topDia,m.topSp)]);
      break;
    case "pt":
      rows.push(["--","ขนาดแผ่นพื้น"]);
      rows.push(["ความหนาพื้น", mn(m.h+" มม.")], ["ช่วงพาด (span)", mn((m.span/1000).toFixed(2)+" ม.")]);
      rows.push(["ระยะหุ้ม (covering)", mn(m.cover+" มม.")]);
      rows.push(["--","เส้นเอ็น (Tendon)"]);
      rows.push(["ชนิดเอ็น", mn(m.tendonType||"-")], ["จำนวน / ระยะห่าง", mn(m.tendonQty+" เส้น @"+m.tendonSp+" มม.")]);
      rows.push(["CGS ที่หัวเสา", mn(m.cgsEnd+" มม. จากท้องพื้น")], ["CGS ที่กลางช่วง", mn(m.cgsMid+" มม. จากท้องพื้น")]);
      rows.push(["--","เหล็กเสริมธรรมดา"]);
      rows.push(["เหล็กล่าง", rebar(m.rebarDia,m.rebarSp)]);
      break;
  }
  if(m.fc) rows.push(["กำลังคอนกรีต", mn(m.fc)]);
  return rows;
}
function specTable(m){
  var html='<table class="spec">';
  specRows(m).forEach(function(r){
    if(r[0]==="--") html+='<tr class="sec"><th colspan="2">'+esc(r[1])+'</th></tr>';
    else html+="<tr><th>"+esc(r[0])+"</th><td>"+r[1]+"</td></tr>";
  });
  return html+"</table>";
}

/** สรุปสเปกสั้น ๆ ใช้เป็นบรรทัดที่ 2 ในรายการชิ้นส่วน */
function shortSpec(m){
  switch(m.type){
    case "beam": { var g=beamGov(m); return m.b+"×"+m.h+" · บน "+g.top.n+"-DB"+g.top.d+" · ล่าง "+g.bot.n+"-DB"+g.bot.d; }
    case "column":  return m.b+"×"+m.h+" · ยืน "+colMainTotal(m)+"-DB"+m.mainDia;
    case "slab":    return "หนา "+m.h+" · ล่าง DB"+m.botMainDia+"@"+m.botMainSp;
    case "stair":   return "ลูกตั้ง "+m.riser+" · ลูกนอน "+m.tread+" · หลัก DB"+m.mainDia+"@"+m.mainSp;
    case "wall":    return "หนา "+m.t+" · ยาว "+m.Lw+" · ตั้ง DB"+m.vertDia+"@"+m.vertSp;
    case "footing": return m.B+"×"+m.L+"×"+m.H+" · ล่าง DB"+m.botDiaB+"@"+m.botSpB;
    case "pt":      return "หนา "+m.h+" · span "+(m.span/1000).toFixed(1)+" ม. · เอ็น "+m.tendonQty+" เส้น";
  }
  return "";
}

/* ---- ส่วนประกอบรายการ ---- */
function chipHtml(text, cssType){
  var raw=/^<svg/.test(String(text));      // เป็นไอคอน SVG → ใส่ตรง ๆ ไม่ต้อง escape
  var n=raw?2:String(text).length, cls="chip"+(n>=5?" len5":n===4?" len4":"")+(raw?" chip-ic":"");
  return '<div class="'+cls+'" style="background:var(--t-'+cssType+'-bg);color:var(--t-'+cssType+')">'+(raw?text:esc(text))+"</div>";
}
function dotFor(m){
  var ins=lastInspection(m.id);
  var cls = !ins ? "" : (ins.status==="pass" ? " pass" : " fail");
  var title = !ins ? "ยังไม่ตรวจ" : (ins.status==="pass" ? "ผ่าน พร้อมเท" : "ต้องแก้ไข");
  return '<span class="dot'+cls+'" title="'+title+'"></span>';
}
function statBadges(s){
  var h='<span class="badge">ทั้งหมด '+s.total+'</span>';
  if(s.pass) h+='<span class="badge pass">ผ่าน '+s.pass+'</span>';
  if(s.fail) h+='<span class="badge fail">ต้องแก้ '+s.fail+'</span>';
  if(s.todo) h+='<span class="badge warn">ยังไม่ตรวจ '+s.todo+'</span>';
  return h;
}
/** ข้อความระดับชั้น เติมเครื่องหมาย + เฉพาะค่าบวก */
function lvText(level){
  if(level==="" || level==null) return "";
  var n=parseFloat(level);
  return (isFinite(n) && n>=0 ? "+" : "") + level + " ม.";
}
function emptyBox(icon, title, sub){
  return '<div class="empty"><span class="em">'+icon+'</span><b>'+esc(title)+'</b>'
       + (sub?'<div class="small" style="margin-top:6px">'+esc(sub)+'</div>':'')+'</div>';
}

/* ---- หน้าจอ 1: โครงการ ---- */
/* ---- หน้าแรก: DASHBOARD (sidebar + hero + โครงการล่าสุด + ทางลัด) ---- */
function dMY(ts){ try{ return new Date(ts).toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"numeric"}); }catch(e){ return "-"; } }
function projUpdated(p){ var t=p.createdAt||0; (DB.inspections||[]).forEach(function(ins){ var mm=getMember(ins.memberId); if(mm && mm.projectId===p.id && ins.ts>t) t=ins.ts; }); return t; }
function homeNav(act,on,label,svg){ return '<a class="dh-nav'+(on?' on':'')+'" data-act="'+act+'">'+svg+' <span>'+label+'</span></a>'; }
function viewHome(){
  var IC={
    home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/></svg>',
    folder:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    report:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/></svg>',
    gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8 2 2 0 1 1-2.8 2.8 1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0 1.6 1.6 0 0 0-2.6-1.1 2 2 0 1 1-2.8-2.8A1.6 1.6 0 0 0 3.9 15a2 2 0 0 1 0-4 1.6 1.6 0 0 0 1.1-2.6A2 2 0 1 1 7.8 5.6 1.6 1.6 0 0 0 10 5.3V5a2 2 0 0 1 4 0 1.6 1.6 0 0 0 2.2.3 2 2 0 1 1 2.8 2.8A1.6 1.6 0 0 0 20.7 11a2 2 0 0 1 0 4Z"/></svg>',
    progress:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="m8 12.5 2.5 2.5L16 9"/></svg>'
  };
  var user=(DB.inspector||"ผู้ใช้งาน");
  // ---- sidebar ----
  var side='<aside class="dh-side">'
    +'<div class="dh-brand"><span class="dh-logo"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5M9 11h.01M15 11h.01"/></svg></span>'
    +'<span class="dh-nm">Rebar<b>Check</b><small>Structural Inspection</small></span></div>'
    +'<nav class="dh-navs">'
    + homeNav("goHome",true,"หน้าหลัก",IC.home)
    + homeNav("goProjects",false,"ตรวจสอบชิ้นส่วน",IC.search)
    + homeNav("goProgress",false,"อัพเดทความคืบหน้า",IC.progress)
    + homeNav("goReports",false,"รายงาน",IC.report)
    + homeNav("goData",false,"ตั้งค่า",IC.gear)
    + ((CLOUD && _fbUser) ? homeNav("logout",false,"ออกจากระบบ",'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>') : "")
    +'</nav>'
    +'<div class="dh-foot"><svg viewBox="0 0 80 64" fill="none" stroke="var(--brand)" stroke-width="1.3"><path d="M10 60V26l14-8 14 8v34M24 18V8M18 26h12M18 34h12M18 42h12M18 50h12M44 60V34l12-7 12 7v26M50 34h12M50 42h12M50 50h12"/></svg>'
    +'<div class="bs">Build Safer<br>with Better Data</div><div class="ver">RebarCheck v1.0.0</div></div></aside>';
  // ---- topbar ----
  var top='<div class="dh-top"><div class="sp"></div>'
    +'<button class="dh-bell" data-act="theme" title="สลับโหมด"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg><b></b></button>'
    +'<div class="dh-user"><span class="dh-ava"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></span>'
    +'<span><b>'+esc(user)+'</b><small>Engineer</small></span></div></div>';
  // ---- hero ----
  var hero='<section class="dh-hero"><div class="dh-hero-l">'
    +'<div class="hi">ยินดีต้อนรับสู่</div><h1>Rebar<b>Check</b></h1>'
    +'<p>ระบบตรวจสอบและประเมินผลเหล็กเสริมในงานคอนกรีตเสริมเหล็ก เพื่อความปลอดภัยและมาตรฐานงานก่อสร้าง</p>'
    +'<div class="dh-badge"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg> Structural Inspection</div></div>'
    +'<div class="dh-hero-r"><svg viewBox="0 0 360 232" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="dhsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe0ff"/><stop offset="1" stop-color="#e9f4ff"/></linearGradient></defs><rect width="360" height="232" fill="url(#dhsky)"/><g fill="#cdd8e6"><rect x="150" y="70" width="80" height="162"/><rect x="232" y="100" width="70" height="132"/><rect x="300" y="55" width="60" height="177"/></g><g stroke="#9fb3cc" stroke-width="2"><path d="M160 232V60M180 232V60M200 232V60M220 232V60M150 90h80M150 120h80M150 150h80M150 180h80"/></g><g stroke="#8aa0bd" stroke-width="2.4"><path d="M320 232V40M340 232V40M312 60h36M312 100h36M312 150h36"/></g><g stroke="#f4b73d" stroke-width="3" opacity=".85"><path d="M120 232 132 44M120 44h20M118 70h18M116 96h18"/></g></svg></div></section>';
  // ---- recent projects (real) ----
  var projs=(DB.projects||[]).slice().sort(function(a,b){ return (b.createdAt||0)-(a.createdAt||0); });
  var main='<div class="dh-sec"><h2>'+IC.folder+' โครงการทั้งหมด <span class="dh-count">'+projs.length+'</span></h2></div>';
  if(!projs.length){
    main+='<div class="dh-empty">ยังไม่มีโครงการ — กด “สร้างโครงการใหม่” เพื่อเริ่ม</div>';
  }else{
    projs.forEach(function(p){
      var ms=membersOfProject(p.id), c={}; ms.forEach(function(m){ c[m.type]=(c[m.type]||0)+1; });
      var chips=[["column","เสา"],["beam","คาน"],["slab","พื้น"],["footing","ฐานราก"]].map(function(t){ return '<span class="dh-chip">'+t[1]+' '+(c[t[0]]||0)+' ชิ้น</span>'; }).join("");
      main+='<button class="dh-pcard" data-act="openProject" data-id="'+esc(p.id)+'">'
        +'<span class="dh-thumb"><svg viewBox="0 0 150 104"><rect width="150" height="104" fill="#c7dbf5"/><g fill="#a9c3e8"><rect x="18" y="34" width="46" height="70"/><rect x="70" y="20" width="60" height="84"/></g><g stroke="#8fabd0" stroke-width="1.5"><path d="M82 104V26M100 104V26M118 104V26M70 44h60M70 64h60M70 84h60"/></g></svg></span>'
        +'<span class="dh-pbody"><span class="t1">'+esc(p.name)+'</span>'
        +(p.location?'<span class="dh-meta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg> '+esc(p.location)+'</span>':'')
        +'<span class="dh-meta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> สร้างเมื่อ '+dMY(p.createdAt)+' | อัปเดตล่าสุด '+dMY(projUpdated(p))+'</span>'
        +'<span class="dh-chips">'+chips+'</span></span>'
        +'<span class="dh-chev">›</span></button>';
    });
  }
  // ---- right column ----
  var col='<div class="dh-col">'
    +'<button class="dh-new" data-act="newProject"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> สร้างโครงการใหม่</button>'
    +'<div class="dh-panel"><div class="ph"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg> ทางลัด</div>'
    +'<a class="dh-short" data-act="goProjects"><span class="ic">'+IC.report+'</span><span><b>เข้าสู่การตรวจสอบ</b><small>เริ่มตรวจสอบชิ้นส่วนในโครงการ</small></span><span class="cv">›</span></a>'
    +'<a class="dh-short" data-act="goProgress"><span class="ic">'+IC.progress+'</span><span><b>อัพเดทความคืบหน้า</b><small>เทคอนกรีตถึงโซนไหน + ออก PDF</small></span><span class="cv">›</span></a>'
    +'<a class="dh-short" data-act="goReports"><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/></svg></span><span><b>ดูรายงาน</b><small>สรุปผลการตรวจสอบทั้งหมด</small></span><span class="cv">›</span></a>'
    +'<a class="dh-short" data-act="goData"><span class="ic">'+IC.gear+'</span><span><b>ตั้งค่า / สำรองข้อมูล</b><small>นำเข้า-ส่งออกข้อมูล</small></span><span class="cv">›</span></a></div>'
    +'<div class="dh-tip"><div class="ph"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2Z"/></svg> สาระน่ารู้</div>'
    +'<p>"การตรวจสอบเหล็กเสริมที่ถูกต้อง ช่วยลดความเสี่ยงของโครงสร้าง และเพิ่มความปลอดภัยในระยะยาว"</p></div></div>';
  return '<div class="dh">'+side+'<div class="dh-wrap">'+top+'<div class="dh-content">'+hero+'<div class="dh-main">'+main+'</div>'+col+'</div></div></div>';
}

/* ---- หน้าจอ 2: ชั้นในโครงการ ---- */
function flPct(s){ return s.total ? Math.round((s.total-s.todo)/s.total*100) : 0; }
function flBadge(f){
  if(f.level!==""&&f.level!=null) return String(f.level);
  var n=(f.name||"").trim(); if(!n) return "—";
  var w=n.split(/\s+/);
  return (w.length>=2 ? (w[0][0]+w[1][0]) : n.slice(0,2)).toUpperCase();
}
function viewFloors(){
  var p=getProject(state.projectId);
  if(!p) return emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',"ไม่พบโครงการ","");
  var fs=floorsOf(p.id), s=summarize(membersOfProject(p.id)), pct=flPct(s);
  var R=39, C=Math.round(2*Math.PI*R), off=Math.round(C*(1-pct/100));
  // ---- hero + วงแหวนความคืบหน้า ----
  var h='<div class="fl-hero"><div class="fl-ht">'
    +'<h1 class="fl-title">'+esc(p.name)+'</h1>'
    +'<div class="fl-loc"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg> '
    +(p.location?esc(p.location)+' · ':'')+fs.length+' ชั้น · '+s.total+' ชิ้นส่วน</div>'
    +'<button class="fl-add" data-act="newFloor"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg> เพิ่มชั้น</button></div>'
    +'<div class="fl-ring"><svg width="96" height="96" viewBox="0 0 96 96">'
    +'<circle cx="48" cy="48" r="'+R+'" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="10"/>'
    +'<circle cx="48" cy="48" r="'+R+'" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-dasharray="'+C+'" stroke-dashoffset="'+off+'" transform="rotate(-90 48 48)"/>'
    +'<text x="48" y="45" text-anchor="middle" fill="#fff" font-size="19" font-weight="800">'+pct+'%</text>'
    +'<text x="48" y="61" text-anchor="middle" fill="#fff" font-size="10" opacity=".85">ตรวจแล้ว</text></svg></div></div>';
  // ---- การ์ดชั้น (2 คอลัมน์) ----
  if(fs.length===0){
    h+=emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h6"/></svg>',"ยังไม่มีชั้นในโครงการนี้","กด “เพิ่มชั้น” เช่น ฐานราก, ชั้น 1, ชั้น 2");
  }else{
    h+='<div class="fl-grid">';
    fs.forEach(function(f){
      var ms=membersOfFloor(f.id), fs2=summarize(ms), fp=flPct(fs2);
      var col=fs2.fail>0?'var(--fail)':((fp===100&&ms.length)?'var(--pass)':'var(--warn)');
      var meta=ms.length+' ชิ้นส่วน'+(fs2.pass?' · ผ่าน '+fs2.pass:'')+(fs2.fail?' · ต้องแก้ '+fs2.fail:'')+(fs2.todo?' · ยังไม่ตรวจ '+fs2.todo:'');
      h+='<button class="fl-card" data-act="openFloor" data-id="'+esc(f.id)+'">'
        +'<div class="fl-top"><span class="fl-lvl">'+esc(flBadge(f))+'</span><span class="fl-fn">'+esc(f.name)+'</span></div>'
        +'<div class="fl-meta">'+esc(meta)+'</div>'
        +'<div class="fl-prog"><span class="fl-bar"><i style="width:'+Math.max(4,fp)+'%;background:'+col+'"></i></span><b style="color:'+col+'">'+fp+'%</b></div>'
        +'</button>';
    });
    h+='</div>';
  }
  // ---- ปุ่มการทำงาน ----
  h+='<div class="fl-act">'
    +'<button class="fl-a" data-act="history"><span class="ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/></svg></span><span><b>ประวัติการตรวจ</b><small>ผลตรวจทั้งหมดของโครงการ</small></span></button>'
    +'<button class="fl-a" data-act="editProject" data-id="'+esc(p.id)+'"><span class="ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></span><span><b>แก้ไข / ลบโครงการ</b><small>เปลี่ยนชื่อหรือสถานที่</small></span></button>'
    +'</div>';
  return h;
}

/* ---- หน้าจอ 3: ชิ้นส่วนในชั้น ---- */
function viewMembers(){
  var f=getFloor(state.floorId), p=getProject(state.projectId);
  if(!f||!p) return emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',"ไม่พบชั้น","");
  var all=membersOfFloor(f.id);

  // กรองด้วยคำค้นและชิปประเภท
  var q=state.q.trim().toLowerCase();
  var list=all.filter(function(m){
    if(state.typeFilter!=="all" && m.type!==state.typeFilter) return false;
    if(!q) return true;
    return [m.code,m.name,m.grid,TYPES[m.type].label].join(" ").toLowerCase().indexOf(q)!==-1;
  });

  var h='<div class="screen-title">'+esc(f.name)+'</div>'
      + '<div class="screen-sub">'+esc(p.name)+(lvText(f.level)?" · ระดับ "+esc(lvText(f.level)):"")+'</div>'
      + '<div class="searchbar"><input type="search" id="q" value="'+esc(state.q)
      + '" placeholder="ค้นหา รหัส / ชื่อ / แนวเสา…" autocomplete="off"></div>';

  // ชิปกรองประเภท (แสดงเฉพาะประเภทที่มีอยู่จริงในชั้นนี้)
  var present=TYPE_ORDER.filter(function(t){ return all.some(function(m){ return m.type===t; }); });
  if(present.length>1){
    h+='<div class="chips"><button data-act="filterType" data-type="all" aria-pressed="'+(state.typeFilter==="all")+'">ทั้งหมด</button>';
    present.forEach(function(t){
      h+='<button data-act="filterType" data-type="'+t+'" aria-pressed="'+(state.typeFilter===t)+'">'+esc(TYPES[t].label)+'</button>';
    });
    h+='</div>';
  }

  if(all.length===0){
    h+=emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/></svg>',"ยังไม่มีชิ้นส่วนในชั้นนี้","กด “เพิ่มชิ้นส่วน” แล้วเลือกประเภท เช่น เสา คาน พื้น RC");
  }else if(list.length===0){
    h+=emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',"ไม่พบชิ้นส่วนที่ค้นหา","ลองเปลี่ยนคำค้นหรือเลือกประเภทอื่น");
  }else{
    // จัดกลุ่มตามประเภท เรียงตามลำดับงานก่อสร้าง
    TYPE_ORDER.forEach(function(t){
      var g=list.filter(function(m){ return m.type===t; });
      if(g.length===0) return;
      h+='<div class="group-head">'+esc(TYPES[t].label)+' ('+g.length+')</div>';
      g.forEach(function(m){
        h+='<button class="row-item" data-act="openMember" data-id="'+esc(m.id)+'">'
          +   chipHtml(m.code, TYPES[m.type].css)
          +   '<div class="body"><div class="t1">'+esc(m.name||m.code)+'</div>'
          +     '<div class="t2">'+esc(TYPES[m.type].label)+(m.grid?' · '+esc(m.grid):'')+'</div>'
          +     '<div class="t2 mono">'+esc(shortSpec(m))+'</div></div>'
          +   dotFor(m)+'</button>';
      });
    });
  }
  h+='<button class="add-row" data-act="newMember">+ เพิ่มชิ้นส่วน (สำหรับทีมออฟฟิศ)</button>';
  return h;
}

/* ---- หน้าจอ 4: รายละเอียดชิ้นส่วน + เช็คลิสต์ ---- */
/* ---- ส่วนย่อยที่ใช้ร่วมกันระหว่างหน้า detail และพาเนลขวาของ planEditor ---- */

/** การ์ดรูปหน้าตัด (คำนวณจากข้อมูลจริง) */
function sectionCardHtml(m){
  if(m.type==="slab") return '';   // พื้นใช้ "รูปตัดพื้น" ใน spanCardHtml แทน ไม่ต้องมีรูปหน้าตัดแถบ
  var HEAD='<div class="card"><div class="card-h"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/></svg> ';
  // คาน: รูปด้านคานต่อเนื่อง (ย่อขนาด) + หน้าตัด SECTION 1–4 (drawBeam เดิม ละเอียด) เรียงแถว
  if(m.type==="beam"){
    var sts=ensureBeamStations(m), SN={ext:"1",mid:"2",intr:"3",can:"4"};
    var h=HEAD+'รูปด้านคานต่อเนื่อง + หน้าตัด (ตามข้อมูลจริง)</div><div class="card-b">';
    // กรอบเดียวครอบทั้ง elevation + หน้าตัด (ให้อยู่ในกรอบของคานเดียวกัน)
    h+='<div class="section-box beam-frame">';
    h+='<div style="max-width:820px;margin:0 auto">'+drawBeamContinuous(m).svg+'</div>';
    var cells="", any=false;
    BEAM_STATIONS.forEach(function(S){
      if(!sts[S.k]||!sts[S.k].on) return;
      any=true;
      var d=drawBeam(m,S.k);
      cells+='<div class="bsr-item"><div class="bsr-h">SECTION '+SN[S.k]+' — '+esc(S.l)+'</div>'
        +'<div class="bsr-canvas">'+d.svg+'</div></div>';
    });
    if(any) h+='<div class="beam-stations-row">'+cells+'</div>';
    else h+='<div class="empty small">ยังไม่ได้เปิดสถานีใดเลย — แก้ไขคานเพื่อกรอกเหล็กเสริม</div>';
    h+='</div>';
    return h+'</div></div>';
  }
  var drawn=drawSection(m);
  var h=HEAD+'รูปหน้าตัด (คำนวณจากข้อมูลจริง)</div><div class="card-b">';
  if(drawn){
    h+='<div class="section-box">'+drawn.svg+'</div>';
    if(drawn.legend && drawn.legend.length){
      h+='<div class="legend">'+drawn.legend.map(function(L){
        var st = L.k==="ring" ? 'background:none;border-color:'+L.c+';border-width:2px' : 'background:'+L.c;
        return '<span><i class="'+(L.k==="bar"?"bar":"")+'" style="'+st+'"></i>'+esc(L.t)+'</span>';
      }).join("")+'</div>';
    }
  }else{
    h+='<div class="empty small">วาดรูปหน้าตัดไม่ได้ — ตรวจสอบว่ากรอกขนาดครบถ้วน</div>';
  }
  return h+'</div></div>';
}

/** การ์ดรูปด้านยาว: คาน = span, เสา = elevation (Special Moment Frame) */
function spanCardHtml(m){
  var HEAD='<div class="card"><div class="card-h"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/></svg> ';
  if(m.type==="slab"){   // รูปตัดพื้น: เหล็กตามยาว=เส้น · ตามขวาง=จุด
    return HEAD+'รูปตัดพื้น (เหล็กตามยาว=เส้น · ตามขวาง=จุด)</div><div class="card-b"><div class="section-box">'+drawSlabSpan(m).svg+'</div></div></div>';
  }
  var drawn, title;
  if(m.type==="beam"){ return ""; }   // รูปด้านคานต่อเนื่องรวมอยู่ในการ์ดหน้าตัดแล้ว
  else if(m.type==="column"){ drawn=drawColumnElev(m); title="รูปด้านเสา (elevation) — Lo · So · Smid · S1"; }
  else return "";
  if(!drawn) return "";
  return HEAD+esc(title)+'</div><div class="card-b"><div class="section-box">'+drawn.svg+'</div></div></div>';
}

/** การ์ดตารางสเปก */
function specCardHtml(m){
  return '<div class="card"><div class="card-h"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/></svg> สเปกตามแบบ / BBS</div>'
       + '<div class="card-b" style="padding:0 14px">'+specTable(m)+'</div></div>';
}

/** การ์ดสรุปวิศวกรรม (ปริมาณคอนกรีต/เหล็ก ฯลฯ) — เหมือนที่โชว์ในหน้าฟอร์ม */
function summaryCardHtml(m){
  var s=memberSummaryHtml(m); if(!s) return "";
  return '<div class="card"><div class="card-h"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/></svg> สรุปวิศวกรรม (โดยประมาณ)</div>'
       + '<div class="card-b">'+s+'</div></div>';
}
/** การ์ดแปลนเหล็กเสริมพิเศษ (เฉพาะเสาที่กรอกไว้) */
function spRebarCardHtml(m){
  if(!m || m.type!=="column") return "";
  var d=drawSpRebarPlan(m); if(!d) return "";
  return '<div class="card"><div class="card-h"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg> แปลนเหล็กเสริมพิเศษ (Top/Bottom · 2 ทิศทาง)</div>'
       + '<div class="card-b"><div class="section-box">'+d.svg+'</div></div></div>';
}

/** บล็อกตรวจเหล็ก: แถบสรุป + เช็คลิสต์ + หลักฐาน + ปุ่มยืนยัน
    ใช้ id เดิม (#verdict,#chkCount,#btnConfirm,#photoInput,#insNote,#inspector,.chk)
    เพื่อให้ refreshChecklistUI / confirmInspection / bindInspectionInputs ทำงานได้ */
/** เช็คลิสต์: คาน = สร้างตามข้อมูลจริง แยกรายสถานี (ตำแหน่ง); ประเภทอื่น = ชุดตายตัว */
function checklistFor(m){
  var b=num(m.b,0), hh=num(m.h,0);
  var sizeT=(b&&hh) ? ("ขนาดหน้าตัด b × h = "+mM(b)+" × "+mM(hh)+" ม. (วัดจริงด้วยตลับเมตร)")
                    : "ขนาดหน้าตัดตรงกับแบบ (วัดจริงด้วยตลับเมตร)";
  var items=[
    {id:"pos",  crit:true, t:"ตำแหน่งติดตั้งตรงกับแบบ — ถูกชั้น และถูกแนวเสา (grid)",
                hint:"ยืนที่จุดจริง อ่านชั้นและแนวเสาในแบบซ้ำอีกรอบก่อนติ๊ก"},
    {id:"code", crit:true, t:"รหัส (Mark) "+(m.code||"")+" ตรงกับแบบ ไม่สลับกับตัวข้างเคียง"},
    {id:"size", t:sizeT},
    {id:"cover",crit:true, t:"ระยะหุ้มคอนกรีต (covering) "+(m.cover||"")+" มม. ครบทุกด้าน มีลูกปูนหนุน"}
  ];
  (m.checks||[]).forEach(function(c){ if(c&&c.t) items.push({id:c.id, t:c.t, custom:true}); });   // รายการที่ผู้ใช้เพิ่มเอง
  return items;
}

function inspectionBlockHtml(m){
  var items=checklistFor(m);
  var h='<div id="verdict" style="margin-top:12px"></div>';
  h+='<div class="card"><div class="card-h"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/></svg> ตรวจเหล็กก่อนเทคอนกรีต <span class="tiny muted" id="chkCount"></span></div><div class="card-b">';
  var CK='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';
  var CX='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  var DS='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 12h12"/></svg>';
  var n=0;
  items.forEach(function(it){
    if(it.head){ h+='<div class="chk-head">'+esc(it.t)+'</div>'; return; }
    n++;
    h+='<div class="chk chk3" data-chk="'+esc(it.id)+'" data-n="'+n+'">'
      +  '<span class="c3-dot"><span class="c3-num">'+n+'</span></span>'
      +  '<div class="c3-body"><div class="c3-t">'+esc(it.t)
      +    (it.crit?' <span class="crit-tag">สำคัญ</span>':'')
      +    (it.custom?' <button class="c3-del" data-act="delCheck" data-id="'+esc(it.id)+'" title="ลบรายการนี้"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>':'')+'</div>'
      +    (it.hint?'<div class="chk-hint"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z"/></svg> '+esc(it.hint)+'</div>':'')
      +  '</div>'
      +  '<div class="c3-chips">'
      +    '<button class="c3c pass" data-act="chk" data-v="pass" title="ผ่าน">'+CK+'</button>'
      +    '<button class="c3c fail" data-act="chk" data-v="fail" title="ไม่ผ่าน">'+CX+'</button>'
      +    '<button class="c3c na"   data-act="chk" data-v="na"   title="N/A">'+DS+'</button>'
      +  '</div></div>';
  });
  h+='<button class="c3-add" data-act="addCheck">+ เพิ่มรายการตรวจ</button>';
  h+='</div></div>';
  h+='<div class="card"><div class="card-h"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.2"/></svg> หลักฐานและการยืนยัน</div><div class="card-b">'
    +'<label class="file-label"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.2"/></svg> ถ่ายรูป / เลือกรูปแนบ (ย่อขนาดอัตโนมัติ)'
    +  '<input type="file" id="photoInput" accept="image/*" capture="environment" multiple></label>'
    +'<div class="thumbs" id="thumbs"></div>'
    +'<label class="f" style="margin-top:14px"><span>หมายเหตุ / สิ่งที่ต้องแก้</span>'
    +  '<textarea id="insNote" rows="2" placeholder="เช่น เหล็กบนขาดไป 1 เส้น รอช่างเสริมก่อนเท"></textarea></label>'
    +'<label class="f"><span>ชื่อผู้ตรวจ *</span>'
    +  '<input type="text" id="inspector" placeholder="เช่น สมชาย (โฟร์แมน)" value="'+esc(DB.inspector)+'"></label>'
    +'<button class="btn block" data-act="confirmIns" id="btnConfirm">ยืนยันผลการตรวจ</button>'
    +'</div></div>';
  return h;
}

/** ผูก event ให้อินพุตของบล็อกตรวจเหล็ก + รีเฟรชสถานะ (ใช้ทั้ง detail และ planEditor) */
function bindInspectionInputs(){
  var pi=$("#photoInput"); if(pi) pi.addEventListener("change",onPhotoPick);
  var nt=$("#insNote");    if(nt){ nt.value=state.note; nt.addEventListener("input",function(){ state.note=nt.value; }); }
  var ip=$("#inspector");  if(ip) ip.addEventListener("input",refreshChecklistUI);
  renderThumbs();
  refreshChecklistUI();
}

function viewDetail(){
  var m=getMember(state.memberId);
  if(!m) return emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',"ไม่พบชิ้นส่วน","");
  var f=getFloor(m.floorId);

  var h='<div style="display:flex;align-items:center;gap:11px;margin-bottom:10px">'
      +   chipHtml(m.code, TYPES[m.type].css)
      +   '<div style="min-width:0"><div style="font-size:1.25rem;font-weight:800;line-height:1.25">'+esc(m.name||m.code)+'</div>'
      +     '<div class="small muted">'+esc(TYPES[m.type].label)+' · รหัส '+esc(m.code)+'</div></div></div>';
  h+='<div class="stat-row"><span class="badge"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h6"/></svg> '+esc(f?f.name:"-")+'</span>'
    + (m.grid?'<span class="badge"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg> แนว '+esc(m.grid)+'</span>':'')+'</div>';
  if(m.note) h+='<div class="note-warn" style="margin-top:0;margin-bottom:12px"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg> '+esc(m.note)+'</div>';

  h+=inspectionBlockHtml(m);
  h+='<hr class="sep">'
    +'<div class="row-end"><button class="btn soft" data-act="editMember"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg> แก้ไขข้อมูลชิ้นส่วน</button>'
    +'<button class="btn danger" data-act="delMember"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/></svg> ลบชิ้นส่วนนี้</button></div>';
  return h;
}

/** ชิ้นส่วนที่กำลังตรวจอยู่ — planEditor ใช้ selMemberId, หน้า detail ใช้ memberId */
function activeMemberId(){ return state.screen==="planEditor" ? state.selMemberId : state.memberId; }

/** อัปเดตสีปุ่มเช็คลิสต์ + แถบสรุปผล + สถานะปุ่มยืนยัน */
function refreshChecklistUI(){
  var m=getMember(activeMemberId()); if(!m) return;
  var items=checklistFor(m).filter(function(it){ return it.id; });

  var CK='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';
  var CX='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  var DS='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 12h12"/></svg>';
  $$(".chk").forEach(function(w){
    var v=state.answers[w.getAttribute("data-chk")];
    w.classList.remove("st-pass","st-fail","st-na");
    if(v) w.classList.add("st-"+v);
    $$(".c3c",w).forEach(function(b){ b.classList.toggle("on", b.getAttribute("data-v")===v); });
    var dot=w.querySelector(".c3-dot");
    if(dot){ var nn=w.getAttribute("data-n")||""; dot.innerHTML = v==="pass"?CK : v==="fail"?CX : v==="na"?DS : '<span class="c3-num">'+nn+'</span>'; }
  });

  var answered=items.filter(function(it){ return !!state.answers[it.id]; });
  var failed  =items.filter(function(it){ return state.answers[it.id]==="fail"; });
  var complete=answered.length===items.length;
  var cc=$("#chkCount"); if(cc) cc.textContent="(ตอบแล้ว "+answered.length+"/"+items.length+")";

  var v=$("#verdict"); if(!v) return;
  if(failed.length>0){
    v.innerHTML='<div class="verdict bad"><span class="big"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg> ห้ามเท — ต้องแก้ไขก่อน ('+failed.length+' รายการ)</span>'
      +'แจ้งช่างแก้ไขแล้วตรวจซ้ำก่อนเทคอนกรีต<ul>'
      +failed.map(function(it){ return "<li>"+esc(it.t)+"</li>"; }).join("")+'</ul></div>';
  }else if(complete){
    v.innerHTML='<div class="verdict ok"><span class="big"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/></svg> พร้อมเทคอนกรีต</span>ตรวจครบทุกข้อ ไม่พบรายการที่ต้องแก้ไข</div>';
  }else{
    v.innerHTML='<div class="verdict wait"><span class="big"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> ตรวจยังไม่ครบ</span>เหลืออีก '
      +(items.length-answered.length)+' ข้อ จึงจะสรุปผลได้</div>';
  }

  var nameEl=$("#inspector"), btn=$("#btnConfirm");
  if(!btn) return;
  var nameOk=nameEl && nameEl.value.trim().length>0;
  btn.disabled=!(complete&&nameOk);
  btn.textContent = !complete ? "ตรวจให้ครบทุกข้อก่อน"
                  : !nameOk   ? "กรอกชื่อผู้ตรวจก่อน"
                  : (failed.length>0 ? "ยืนยันผล: ต้องแก้ไข ("+failed.length+" รายการ)" : "ยืนยันผล: พร้อมเทคอนกรีต");
  btn.className="btn block"+(failed.length>0?" danger":"");
}

/* ---- รูปถ่าย: ย่อขนาดก่อนเก็บ เพื่อไม่ให้ localStorage เต็ม ---- */
function resizeImage(file,maxSide,quality){
  return new Promise(function(resolve,reject){
    var reader=new FileReader();
    reader.onerror=function(){ reject(new Error("อ่านไฟล์ไม่ได้")); };
    reader.onload=function(){
      var img=new Image();
      img.onerror=function(){ reject(new Error("ไฟล์ไม่ใช่รูปภาพ")); };
      img.onload=function(){
        var sc=Math.min(1, maxSide/Math.max(img.width,img.height));
        var w=Math.round(img.width*sc), hh=Math.round(img.height*sc);
        var cv=document.createElement("canvas"); cv.width=w; cv.height=hh;
        var ctx=cv.getContext("2d");
        ctx.fillStyle="#fff"; ctx.fillRect(0,0,w,hh);
        ctx.drawImage(img,0,0,w,hh);
        try{ resolve(cv.toDataURL("image/jpeg",quality)); }catch(e){ reject(e); }
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function onPhotoPick(e){
  var files=Array.prototype.slice.call(e.target.files||[]);
  if(files.length===0) return;
  toast("กำลังย่อรูป...");
  Promise.all(files.map(function(f){ return resizeImage(f,900,0.6).catch(function(){ return null; }); }))
    .then(function(urls){
      urls.forEach(function(u){ if(u) state.photos.push(u); });
      renderThumbs(); toast("แนบรูปแล้ว "+state.photos.length+" รูป");
    })
    .catch(function(){ toast("แนบรูปไม่สำเร็จ",true); });
  e.target.value="";
}
function renderThumbs(){
  var host=$("#thumbs"); if(!host) return;
  host.innerHTML=state.photos.map(function(src,i){
    return '<div class="thumb"><img src="'+src+'" alt="รูปที่ '+(i+1)+'">'
         + '<button data-del="'+i+'" title="ลบรูป"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>';
  }).join("");
  $$(".thumb img",host).forEach(function(img){ img.addEventListener("click",function(){ openLightbox(img.src); }); });
  $$(".thumb button",host).forEach(function(b){
    b.addEventListener("click",function(){ state.photos.splice(parseInt(b.getAttribute("data-del"),10),1); renderThumbs(); });
  });
}

/* ---- ยืนยันผลการตรวจ ---- */
function confirmInspection(){
  var m=getMember(activeMemberId()); if(!m) return;
  var items=checklistFor(m).filter(function(it){ return it.id; });
  var failed=items.filter(function(it){ return state.answers[it.id]==="fail"; });
  var name=$("#inspector").value.trim();
  if(!name){ toast("กรุณากรอกชื่อผู้ตรวจ",true); return; }
  var f=getFloor(m.floorId);

  var rec={
    id:uid("ins"), projectId:m.projectId, floorId:m.floorId, memberId:m.id,
    memberCode:m.code, memberName:m.name||"", memberType:m.type,
    floorName:f?f.name:"", grid:m.grid||"",
    inspector:name, ts:Date.now(),
    status: failed.length>0 ? "fail" : "pass",
    answers: Object.assign({}, state.answers),
    failedTexts: failed.map(function(it){ return it.t; }),
    note: state.note.trim(), photos: state.photos.slice()
  };
  DB.inspections.unshift(rec);
  DB.inspector=name;
  if(!saveDB()){ DB.inspections.shift(); return; }

  toast(rec.status==="pass" ? "บันทึกแล้ว — พร้อมเทคอนกรีต" : "บันทึกแล้ว — ต้องแก้ไขก่อนเท", rec.status==="fail");
  state.answers={}; state.photos=[]; state.note="";
  if(state.screen==="planEditor"){ render(); }   // อยู่ในเอดิเตอร์: รีเฟรชให้จุดสถานะบนแปลนเปลี่ยน
  else back();                                    // หน้า detail: กลับไปรายการ
}

/* ---- หน้าจอ 5: ประวัติการตรวจ (ของโครงการปัจจุบัน) ---- */
function viewHistory(){
  var p=getProject(state.projectId);
  var list=DB.inspections.filter(function(r){ return r.projectId===state.projectId; });
  var q=state.qh.trim().toLowerCase();
  if(q) list=list.filter(function(r){
    return [r.memberCode,r.memberName,r.inspector,r.floorName,r.grid].join(" ").toLowerCase().indexOf(q)!==-1;
  });

  var h='<div class="screen-title">ประวัติการตรวจ</div>'
      + '<div class="screen-sub">'+esc(p?p.name:"")+'</div>'
      + '<div class="searchbar"><input type="search" id="qh" value="'+esc(state.qh)
      + '" placeholder="ค้นหา รหัส / ชื่อ / ผู้ตรวจ / ชั้น" autocomplete="off"></div>';
  if(list.length===0){
    h+=emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z"/></svg>',"ยังไม่มีประวัติการตรวจ","เลือกชิ้นส่วนแล้วทำเช็คลิสต์ให้ครบ จากนั้นกดยืนยันผล");
    return h;
  }
  list.forEach(function(r){
    h+='<div class="hist'+(r.status==="fail"?" bad":"")+'">'
      +  '<div class="hist-h">'+chipHtml(r.memberCode, TYPES[r.memberType]?TYPES[r.memberType].css:"beam")
      +    '<div style="min-width:0;flex:1"><div style="font-weight:700">'+esc(r.memberName||r.memberCode)+'</div>'
      +      '<div class="tiny muted">'+esc(TYPES[r.memberType]?TYPES[r.memberType].label:"")+'</div></div>'
      +    (r.status==="pass"?'<span class="badge pass"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> พร้อมเท</span>':'<span class="badge fail"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg> ต้องแก้</span>')
      +    '<button class="icon-btn" data-act="delIns" data-id="'+esc(r.id)+'" style="padding:5px 9px"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/></svg></button>'
      +  '</div>'
      +  '<div class="small muted" style="margin-top:6px"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h6"/></svg> '+esc(r.floorName)+(r.grid?' · <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg> แนว '+esc(r.grid):'')+'</div>'
      +  '<div class="small" style="margin-top:2px"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 18a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2 1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z"/><path d="M4 16a8 8 0 0 1 16 0"/><path d="M10 9V6.5a2 2 0 0 1 4 0V9"/></svg> '+esc(r.inspector)+' · <span class="mono">'+esc(fmtTime(r.ts))+'</span></div>';
    if(r.failedTexts && r.failedTexts.length){
      h+='<div class="small" style="margin-top:7px;color:var(--fail);font-weight:600">รายการที่ไม่ผ่าน:<ul style="margin:4px 0 0;padding-left:19px">'
        + r.failedTexts.map(function(t){ return "<li>"+esc(t)+"</li>"; }).join("")+'</ul></div>';
    }
    if(r.note) h+='<div class="small" style="margin-top:7px"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg> '+esc(r.note)+'</div>';
    if(r.photos && r.photos.length){
      h+='<div class="thumbs">'+r.photos.map(function(s){
        return '<div class="thumb"><img src="'+s+'" alt="รูปการตรวจ '+esc(r.memberCode)+'"></div>';
      }).join("")+'</div>';
    }
    h+='</div>';
  });
  return h;
}

/* ---- หน้าจอ 6: เลือกประเภทชิ้นส่วน ---- */
function viewPickType(){
  var f=getFloor(state.floorId);
  var h='<div class="screen-title">เพิ่มชิ้นส่วน</div>'
      + '<div class="screen-sub">'+esc(f?f.name:"")+' — เลือกประเภทที่ต้องการสร้าง</div>'
      + '<div class="type-grid">';
  TYPE_ORDER.forEach(function(t){
    var T=TYPES[t];
    h+='<button class="type-tile" data-act="pickType" data-type="'+t+'">'
      +  chipHtml(T.ab,T.css)
      +  '<div><div class="t1">'+esc(T.label)+'</div><div class="t2">'+esc(T.hint)+'</div></div></button>';
  });
  return h+'</div>';
}

/* ---- หน้าจอ 7: ฟอร์มชิ้นส่วน (สร้างใหม่ / แก้ไข) ---- */
function fieldHtml(fd, val){
  var id="fld_"+fd.k, v=(val===undefined||val===null)?fd.def:val;
  var inner;
  if(fd.t==="dia" || fd.t==="rb" || fd.t==="stir"){
    var opts=(fd.t==="dia"?DIA_LIST:fd.t==="stir"?STIR_LIST:RB_LIST).slice();
    var pre=(fd.t==="rb"?"RB":"DB");
    var zeroOk = (fd.k.indexOf("top")===0) || fd.def===0;
    var o = zeroOk ? '<option value="0"'+(num(v,-1)===0?" selected":"")+'>ไม่มี</option>' : "";
    o += opts.map(function(d){
      return '<option value="'+d+'"'+(num(v,-1)===d?" selected":"")+'>'+pre+d+'</option>';
    }).join("");
    inner='<select id="'+id+'" data-k="'+fd.k+'" data-t="'+fd.t+'">'+o+'</select>';
  }else if(fd.t==="text"){
    inner='<input type="text" id="'+id+'" data-k="'+fd.k+'" data-t="text" value="'+esc(v)+'">';
  }else if(fd.t==="sel"){
    var so=(fd.opts||[]).map(function(op){ return '<option value="'+esc(op.v)+'"'+(String(v)===String(op.v)?" selected":"")+'>'+esc(op.t)+'</option>'; }).join("");
    inner='<select id="'+id+'" data-k="'+fd.k+'" data-t="sel">'+so+'</select>';
  }else if(fd.t==="bool"){
    inner='<input type="checkbox" id="'+id+'" data-k="'+fd.k+'" data-t="bool" style="width:20px;height:20px;align-self:start"'+(num(v,0)?" checked":"")+'>';
  }else if(fd.t==="m"){
    var mv=(num(v,fd.def))/1000;                 // เก็บภายในเป็น มม. แต่กรอกเป็น เมตร
    inner='<input type="number" id="'+id+'" data-k="'+fd.k+'" data-t="m" value="'+esc(mv)+'" step="'+(fd.step||0.05)+'" min="0">';
  }else{
    inner='<input type="number" id="'+id+'" data-k="'+fd.k+'" data-t="num" value="'+esc(v)+'" step="'+(fd.step||1)+'" min="0">';
  }
  var unit = ((fd.t==="num"||fd.t==="m") && fd.unit) ? ' <span class="tiny">('+esc(fd.unit)+')</span>' : "";
  return '<label class="f"><span>'+esc(fd.l)+unit+'</span>'+inner+'</label>';
}
/* ---- ตัวเลือกจำนวน/ขนาดเหล็ก สำหรับฟอร์มคานรายสถานี ---- */
function numCell(stk, key, label, v, minV){
  return '<label class="f mini"><span>'+esc(label)+'</span>'
    + '<input type="number" min="'+(minV==null?0:minV)+'" step="1" value="'+esc(v)+'" data-st="'+stk+'" data-sk="'+key+'"></label>';
}
function diaCell(stk, key, label, v, list, allowNone){
  var o = allowNone ? '<option value="0"'+(num(v,-1)===0?" selected":"")+'>ไม่มี</option>' : '';
  o += (list||DIA_LIST).map(function(d){
    return '<option value="'+d+'"'+(num(v,-1)===d?" selected":"")+'>DB'+d+'</option>';
  }).join("");
  return '<label class="f mini"><span>'+esc(label)+'</span>'
    + '<select data-st="'+stk+'" data-sk="'+key+'">'+o+'</select></label>';
}
/** บล็อกกรอกเหล็กของหนึ่งสถานี */
function stationBlockHtml(stk, label, st){
  var on = !!st.on;
  var t1=st.top[0]||{n:0,d:16}, t2=st.top[1]||{n:0,d:16};
  var b1=st.bot[0]||{n:0,d:16}, b2=st.bot[1]||{n:0,d:16};
  var sd=st.side||{n:0,d:12,rows:0}, tie=st.tie||{d:0}, ctie=st.ctie||{n:0,off:0};
  var active=(state.formStation||"mid")===stk;
  var h='<div class="stn'+(on?"":" off")+'" data-stn="'+stk+'" data-fstn="'+stk+'"'+(active?"":" hidden")+'>'
    + '<div class="stn-h"><label class="sw"><input type="checkbox" data-ston="'+stk+'"'+(on?" checked":"")
    +   '><span></span></label><b>'+esc(label)+'</b>'
    +   '<span class="tiny muted">'+(on?"เปิดใช้":"ปิดอยู่ — เปิดสวิตช์เพื่อกรอก")+'</span></div>'
    + '<div class="stn-b">'
    +   '<div class="stn-cap">เหล็กบน (ชั้นนอก → ใน)</div><div class="grid2 tight">'
    +     numCell(stk,"t1n","ชั้น 1 จำนวน",t1.n)+diaCell(stk,"t1d","ชั้น 1 ขนาด",t1.d,DIA_LIST,false)
    +     numCell(stk,"t2n","ชั้น 2 จำนวน (0=ไม่มี)",t2.n)+diaCell(stk,"t2d","ชั้น 2 ขนาด",t2.d,DIA_LIST,false)
    +   '</div>'
    +   '<div class="stn-cap">เหล็กข้าง (side / skin)</div><div class="grid3 tight">'
    +     numCell(stk,"srows","จำนวนชั้น (0=ไม่มี)",sd.rows)+numCell(stk,"sn","เส้น/ชั้น",sd.n)+diaCell(stk,"sd","ขนาด",sd.d,DIA_LIST,false)
    +   '</div>'
    +   '<div class="stn-cap">เหล็กปลอก (ปลอก + ระยะเรียง)</div><div class="grid3 tight">'
    +     diaCell(stk,"std","ปลอกรัดรอบ (นอก)",st.stir.d,STIR_LIST,false)
    +     diaCell(stk,"tied","ขนาดปลอกใน (tie)",tie.d>0?tie.d:(st.stir.d||10),STIR_LIST,false)
    +     numCell(stk,"stsp","ระยะเรียง @ (มม.)",st.stir.sp)
    +   '</div>'
    +   '<details class="stn-adv"><summary>ปลอกใน / ปลอกรัดรอบกลาง (ตัวเลือกเพิ่มเติม)</summary>'
    +     '<div class="stn-sub">จำนวนปลอกใน — ใส่ ≥ 1 เพื่อเพิ่มปลอก (0 = ไม่มี)</div>'
    +     '<div class="grid2 tight">'
    +       numCell(stk,"ticols","แนวคอลัมน์ (เรียงข้างกัน)",tie.cols!=null?tie.cols:0)
    +       numCell(stk,"tirows","ซ้อนแนวสูง (ตามความลึก)",tie.rows!=null?tie.rows:1)
    +     '</div>'
    +     '<div class="stn-sub">ปลอกรัดรอบกลาง (คร่อมเหล็กแถวกลาง บน↔ล่าง) — คู่คร่อม 2 เส้น/คี่คร่อม 1 เส้น แล้วขยายเพิ่มทีละเส้น</div>'
    +     '<div class="grid3 tight">'
    +       numCell(stk,"ctn","มี (1) / ไม่มี (0)",ctie.n!=null?ctie.n:0)
    +       numCell(stk,"ctl","ขยายซ้าย (เส้น)",ctie.left!=null?ctie.left:0)
    +       numCell(stk,"ctr","ขยายขวา (เส้น)",ctie.right!=null?ctie.right:0)
    +     '</div>'
    +   '</details>'
    +   '<div class="stn-cap">เหล็กล่าง (ชั้นนอก → ใน)</div><div class="grid2 tight">'
    +     numCell(stk,"b1n","ชั้น 1 จำนวน",b1.n)+diaCell(stk,"b1d","ชั้น 1 ขนาด",b1.d,DIA_LIST,false)
    +     numCell(stk,"b2n","ชั้น 2 จำนวน (0=ไม่มี)",b2.n)+diaCell(stk,"b2d","ชั้น 2 ขนาด",b2.d,DIA_LIST,false)
    +   '</div>'
    + '</div></div>';
  return h;
}
/** แถบแท็บเลือกสถานีในฟอร์มคาน + ปุ่มคัดลอกไปสถานีอื่น */
function stationFormBar(sts){
  var cur=state.formStation;
  if(!BEAM_STATIONS.some(function(S){return S.k===cur;})) cur="mid";
  var tabs=BEAM_STATIONS.map(function(S){
    var on=!!(sts[S.k]&&sts[S.k].on);
    return '<button type="button" class="stn-ftab'+(S.k===cur?" act":"")+'" data-act="formStn" data-stn="'+S.k
      +'" data-en="'+(on?1:0)+'" title="'+esc(S.l)+'"><span class="fdot"></span>'+esc(S.short)+'</button>';
  }).join("");
  return '<div class="stn-toolbar"><div class="stn-ftabs">'+tabs+'</div>'
    + '<button type="button" class="stn-copy" data-act="copyStn" title="คัดลอกค่าเหล็กของสถานีที่เปิดอยู่ ไปยังสถานีอื่นทั้งหมด">คัดลอก → สถานีอื่น</button></div>';
}
/** คัดลอกค่าเหล็กของสถานีที่กำลังกรอก ไปยังสถานีอื่นทั้งหมด (DOM→DOM ไม่แตะสวิตช์เปิด/ปิด) */
function copyStationToOthers(){
  var src=state.formStation||"mid";
  var srcBlk=document.querySelector('[data-fstn="'+src+'"]'); if(!srcBlk) return;
  var vals={};
  srcBlk.querySelectorAll("[data-st]").forEach(function(el){ vals[el.getAttribute("data-sk")]=el.value; });
  var n=0;
  BEAM_STATIONS.forEach(function(S){
    if(S.k===src) return;
    var blk=document.querySelector('[data-fstn="'+S.k+'"]'); if(!blk) return;
    blk.querySelectorAll("[data-st]").forEach(function(el){ var sk=el.getAttribute("data-sk"); if(vals[sk]!=null) el.value=vals[sk]; });
    n++;
  });
  updatePreview();
  toast("คัดลอกค่าเหล็กไปอีก "+n+" สถานีแล้ว");
}
/** ตัวเลือกสถานีสำหรับพรีวิว */
function stationTabsHtml(m){
  var sts=ensureBeamStations(m), cur=state.previewStation;
  var enabled=BEAM_STATIONS.filter(function(S){ return sts[S.k] && sts[S.k].on; });
  if(!enabled.length) return "";
  if(!enabled.some(function(S){return S.k===cur;})) cur=enabled[0].k;
  return '<div class="chips stn-tabs">'+enabled.map(function(S){
    return '<button type="button" data-act="prevStn" data-stn="'+S.k+'" aria-pressed="'+(S.k===cur)+'">'+esc(S.short)+'</button>';
  }).join("")+'</div>';
}

/* ---- เทมเพลตชิ้นส่วน (Assign): เก็บใน localStorage แยกจากข้อมูลโครงการ
       ใช้ได้ทุกประเภท — เทมเพลตผูกกับ "ประเภท" (type) ใช้ข้ามประเภทไม่ได้ ---- */
var TPL_KEY="rebarcheck.tpl";
function allTemplates(){
  try{ var a=JSON.parse(localStorage.getItem(TPL_KEY)||"[]"); return Array.isArray(a)?a:[]; }catch(e){ return []; }
}
function saveTemplates(arr){
  try{ localStorage.setItem(TPL_KEY, JSON.stringify(arr)); return true; }catch(e){ toast("บันทึกเทมเพลตไม่สำเร็จ",true); return false; }
}
/** เทมเพลตเฉพาะประเภทที่ต้องการ (เทมเพลตเก่าที่ไม่มี type ถือเป็นคาน) */
function templatesForType(type){
  return allTemplates().filter(function(t){ return (t.type||"beam")===type; });
}
/** ดึงเฉพาะข้อมูลสเปก+เหล็ก(+สี) จากชิ้นส่วน เพื่อทำเทมเพลต/Assign — ตามสคีมาของประเภทนั้น */
function memberSpecData(m){
  var d={ type:m.type, fc:m.fc||"",
    fill:(m.plan&&m.plan.fill)||state.fillColor,
    fillA:(m.plan&&m.plan.fillA!=null)?m.plan.fillA:state.fillAlpha,
    strokeW:(m.plan&&m.plan.strokeW!=null)?m.plan.strokeW:state.strokeW };
  (FIELDS[m.type]||[]).forEach(function(g){ g.f.forEach(function(fd){ if(m[fd.k]!=null) d[fd.k]=m[fd.k]; }); });
  if(m.type==="beam") d.stations=JSON.parse(JSON.stringify(m.stations||{}));
  return d;
}
/** ใส่ข้อมูลเทมเพลตลงชิ้นส่วน (คงรหัส/ตำแหน่ง/plan เดิมไว้ เปลี่ยนแค่สเปก+สี) */
function applyTplToMember(m, d){
  (FIELDS[m.type]||[]).forEach(function(g){ g.f.forEach(function(fd){ if(d[fd.k]!=null) m[fd.k]=d[fd.k]; }); });
  if(d.fc!=null) m.fc=d.fc;
  if(m.type==="beam" && d.stations) m.stations=JSON.parse(JSON.stringify(d.stations));
  if(m.plan){ if(d.fill!=null)m.plan.fill=d.fill; if(d.fillA!=null)m.plan.fillA=d.fillA; if(d.strokeW!=null)m.plan.strokeW=d.strokeW; }
  if(m.type==="beam") syncBeamLegacy(m);
}
var _assignData=null;   // ข้อมูลเทมเพลตที่กำลังจะใส่ลงฟอร์ม (รีเฟรชครั้งเดียว)

/* ===== ตารางมาร์คเหล็กเสริมหัวเสา (T/B) — เก็บใน DB ใช้ร่วมทั้งโครงการ =====
   มาร์ค = {id, name:"T36", side:"T"|"B", n, d, sp, len(mm,0=VARY), floor} */
function allHeadMarks(){ if(!Array.isArray(DB.headMarks)) DB.headMarks=[]; return DB.headMarks; }
function getHeadMark(id){ return allHeadMarks().filter(function(x){return x.id===id;})[0]||null; }
function headMarksOf(m){ return ((m&&m.headMarks)||[]).map(getHeadMark).filter(Boolean); }
function markDetailStr(mk){ return (mk.n||0)+"-DB"+(mk.d||16)+(mk.sp?"@"+mk.sp:""); }
function markLenStr(mk){ return (mk.len&&mk.len>0)? (mk.len/1000).toFixed(2)+" ม." : "VARY"; }
function saveHeadMark(mk){ var arr=allHeadMarks(); var i=arr.map(function(x){return x.id;}).indexOf(mk.id);
  if(i>=0) arr[i]=mk; else arr.push(mk); return saveDB(); }
function deleteHeadMark(id){ DB.headMarks=allHeadMarks().filter(function(x){return x.id!==id;});
  DB.members.forEach(function(m){ if(m.headMarks) m.headMarks=m.headMarks.filter(function(k){return k!==id;}); });
  saveDB(); }
/** กล่องเลือกมาร์คในฟอร์มเสา (ชิปมาร์คที่เลือก + ปุ่มเพิ่ม/จัดการ) */
function headMarksBoxHtml(){
  var ids=state._formMarks||[];
  var h='<div class="hm-chips">';
  if(!ids.length) h+='<span class="tiny muted">ยังไม่ได้เลือกเบอร์ — กด “+ เพิ่มเบอร์”</span>';
  ids.forEach(function(id){ var mk=getHeadMark(id); if(!mk) return;
    h+='<span class="hm-chip '+(mk.side==="B"?"b":"t")+'"><b>'+esc(mk.name)+'</b> '+esc(markDetailStr(mk))+' · '+esc(markLenStr(mk))
      +'<button class="hm-x" data-act="removeHeadMark" data-id="'+esc(id)+'" title="เอาออก">✕</button></span>';
  });
  h+='</div><div style="display:flex;gap:8px;margin-top:9px">'
    +'<button class="btn soft" data-act="addHeadMark"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> เพิ่มเบอร์</button>'
    +'<button class="btn ghost" data-act="manageMarks">จัดการตารางมาร์ค</button></div>';
  return h;
}
function renderHeadMarksBox(){ var el=$("#headMarksBox"); if(el) el.innerHTML=headMarksBoxHtml(); if(typeof updatePreview==="function") updatePreview(); }

/* ---------- ปลอกรัดใน (หลายวง) — กล่อง dynamic list ใน viewMemberForm ---------- */
function curNy(){ var el=$("#fld_ny"); return Math.max(2, num(el?el.value:0, 13)); }   // ny ปัจจุบันจากฟอร์ม
function readCieInputs(){   // อ่านค่าปลอกในจาก DOM → array [{top,bot}] (เรียงตาม index)
  var map={};
  $$("[data-cie]").forEach(function(el){
    var i=+el.getAttribute("data-cie"), cf=el.getAttribute("data-cf");
    if(!map[i]) map[i]={top:1,bot:1};
    map[i][cf]=num(el.value,1);
  });
  return Object.keys(map).sort(function(a,b){return a-b;}).map(function(k){return map[k];});
}
function cieBoxHtml(ny){
  ny=Math.max(2,num(ny,13));
  var list=state._formCie||[];
  var h='<div class="cie-list">';
  if(!list.length) h+='<span class="tiny muted">ยังไม่มีปลอกใน — กด “+ เพิ่มปลอกใน”</span>';
  list.forEach(function(c,i){
    h+='<div class="cie-row"><span class="cie-no">วงที่ '+(i+1)+'</span>'
      +'<label class="f mini"><span>แถวบน</span><input type="number" min="1" max="'+ny+'" step="1" value="'+esc(num(c.top,1))+'" data-cie="'+i+'" data-cf="top"></label>'
      +'<label class="f mini"><span>แถวล่าง</span><input type="number" min="1" max="'+ny+'" step="1" value="'+esc(num(c.bot,1))+'" data-cie="'+i+'" data-cf="bot"></label>'
      +'<button class="hm-x" data-act="removeCie" data-i="'+i+'" title="ลบวงนี้">✕</button></div>';
  });
  h+='</div><div style="margin-top:9px"><button class="btn soft" data-act="addCie"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> เพิ่มปลอกใน</button></div>'
    +'<div class="tiny muted" style="margin-top:6px">แต่ละวง = ปลอกคร่อมเหล็ก “แถวบน→แถวล่าง” (นับจากบนสุด=1 ถึงล่างสุด='+ny+') · กด + จะเริ่มที่แถวกลาง แล้วปรับตำแหน่งเองได้อิสระทุกวง</div>';
  return h;
}
function renderCieBox(){
  var el=$("#cieBox"); if(!el) return;
  el.innerHTML=cieBoxHtml(curNy());
  // ผูก event ให้อินพุตที่เพิ่งสร้างใหม่ (renderCieBox แทนที่ innerHTML → อินพุตใหม่ยังไม่มี listener)
  el.querySelectorAll("[data-cie]").forEach(function(inp){
    inp.addEventListener("input", updatePreview);
    inp.addEventListener("change", updatePreview);
  });
  if(typeof updatePreview==="function") updatePreview();
}
/* ---- ปลอกรัดในอีกทิศ (cix) — คร่อมสดมภ์ ซ้าย→ขวา (แนว nx) ---- */
function curNx(){ var el=$("#fld_nx"); return Math.max(2, num(el?el.value:0, 3)); }
function readCixInputs(){   // อ่านค่าปลอกในขวางจาก DOM → [{left,right}]
  var map={};
  $$("[data-cix]").forEach(function(el){
    var i=+el.getAttribute("data-cix"), cf=el.getAttribute("data-cxf");
    if(!map[i]) map[i]={left:1,right:1};
    map[i][cf]=num(el.value,1);
  });
  return Object.keys(map).sort(function(a,b){return a-b;}).map(function(k){return map[k];});
}
function cixBoxHtml(nx){
  nx=Math.max(2,num(nx,3));
  var list=state._formCix||[];
  var h='<div class="cie-list">';
  if(!list.length) h+='<span class="tiny muted">ยังไม่มีปลอกในขวาง — กด “+ เพิ่มปลอกในขวาง”</span>';
  list.forEach(function(c,i){
    h+='<div class="cie-row"><span class="cie-no">วงที่ '+(i+1)+'</span>'
      +'<label class="f mini"><span>สดมภ์ซ้าย</span><input type="number" min="1" max="'+nx+'" step="1" value="'+esc(num(c.left,1))+'" data-cix="'+i+'" data-cxf="left"></label>'
      +'<label class="f mini"><span>สดมภ์ขวา</span><input type="number" min="1" max="'+nx+'" step="1" value="'+esc(num(c.right,1))+'" data-cix="'+i+'" data-cxf="right"></label>'
      +'<button class="hm-x" data-act="removeCix" data-i="'+i+'" title="ลบวงนี้">✕</button></div>';
  });
  h+='</div><div style="margin-top:9px"><button class="btn soft" data-act="addCix"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> เพิ่มปลอกในขวาง</button></div>'
    +'<div class="tiny muted" style="margin-top:6px">แต่ละวง = ปลอกคร่อมเหล็ก “สดมภ์ซ้าย→สดมภ์ขวา” (นับจากซ้ายสุด=1 ถึงขวาสุด='+nx+') วาดเป็นแถบตั้งเต็มความสูง (ตั้งฉากกับปลอกในปกติ)</div>';
  return h;
}
function renderCixBox(){
  var el=$("#cixBox"); if(!el) return;
  el.innerHTML=cixBoxHtml(curNx());
  el.querySelectorAll("[data-cix]").forEach(function(inp){
    inp.addEventListener("input", updatePreview);
    inp.addEventListener("change", updatePreview);
  });
  if(typeof updatePreview==="function") updatePreview();
}
/* ---------- เหล็กเสริมพิเศษ (Special reinforcement) — 2 ทิศทาง (แดง/น้ำเงิน) × Top/Bottom ---------- */
function spCell(c){ c=c||{}; return { n:num(c.n,0), d:num(c.d,0), sp:num(c.sp,0), len:num(c.len,0) }; }
function spRebarOf(m){
  var s=(m&&m.spRebar)||{};
  return { red:{ top:spCell(s.red&&s.red.top), bot:spCell(s.red&&s.red.bot) },
           blue:{ top:spCell(s.blue&&s.blue.top), bot:spCell(s.blue&&s.blue.bot) } };
}
function spHasAny(m){ var s=spRebarOf(m); return [s.red.top,s.red.bot,s.blue.top,s.blue.bot].some(function(c){return c.n>0;}); }
function spStr(c){ return c.n>0 ? c.n+"-DB"+c.d+"@"+mM(c.sp)+" ม."+(c.len>0?" (ยาว "+mM(c.len)+" ม.)":"") : "—"; }
/** ช่องกรอก 1 ค่า ของเหล็กเสริมพิเศษ — data-spr="<dir>.<side>.<field>" */
function spInput(dir, side, field, c){
  var v=c[field];
  if(field==="d"){
    var o='<option value="0"'+(num(v,-1)===0?" selected":"")+'>—</option>'
      + DIA_LIST.map(function(dd){return '<option value="'+dd+'"'+(num(v,-1)===dd?" selected":"")+'>DB'+dd+'</option>';}).join("");
    return '<select data-spr="'+dir+'.'+side+'.d">'+o+'</select>';
  }
  if(field==="sp"||field==="len"){
    var mv=num(v,0)?(num(v,0)/1000):"";
    return '<input type="number" step="0.01" min="0" value="'+esc(mv)+'" data-spr="'+dir+'.'+side+'.'+field+'" data-spm="1">';
  }
  return '<input type="number" step="1" min="0" value="'+esc(num(v,0)||"")+'" data-spr="'+dir+'.'+side+'.'+field+'">';
}
function spRowHtml(dir, side, label, c){
  return '<div class="sp-row"><span class="sp-lb">'+label+'</span>'
    + '<span class="sp-f n">'+spInput(dir,side,"n",c)+'</span>'
    + '<span class="sp-f d">'+spInput(dir,side,"d",c)+'</span>'
    + '<span class="sp-at">@</span><span class="sp-f sp">'+spInput(dir,side,"sp",c)+'</span><span class="sp-u">ม.</span>'
    + '<span class="sp-u">ยาว</span><span class="sp-f len">'+spInput(dir,side,"len",c)+'</span><span class="sp-u">ม.</span></div>';
}
function spRebarBoxHtml(m){
  var s=spRebarOf(m);
  function dirBlock(dir, cls, title, o){
    return '<div class="sp-dir"><div class="sp-dir-h"><i class="sp-dot '+cls+'"></i> '+title+'</div>'
      + '<div class="sp-cap">จำนวน · ขนาด @ ระยะ(ม.) · ยาว(ม.)</div>'
      + spRowHtml(dir,"top","Top",o.top) + spRowHtml(dir,"bot","Bottom",o.bot) + '</div>';
  }
  return dirBlock("red","red","เหล็กแนวแดง (เรียงตามไดเมนแนวนอน)", s.red)
       + dirBlock("blue","blue","เหล็กแนวน้ำเงิน (เรียงตามไดเมนแนวตั้ง)", s.blue);
}
/** อ่านค่าเหล็กเสริมพิเศษจาก DOM → {red:{top,bot},blue:{top,bot}} */
function readSpRebar(){
  var s={ red:{top:{},bot:{}}, blue:{top:{},bot:{}} };
  $$("[data-spr]").forEach(function(el){
    var p=el.getAttribute("data-spr").split(".");   // [dir,side,field]
    var val = el.getAttribute("data-spm")==="1" ? Math.round(num(el.value,0)*1000) : num(el.value,0);
    if(s[p[0]] && s[p[0]][p[1]]) s[p[0]][p[1]][p[2]]=val;
  });
  return s;
}
/** รูปแปลน (มองจากด้านบน) ของเหล็กเสริมพิเศษ — เสา + เหล็กแดง(แนวตั้ง)/น้ำเงิน(แนวนอน) + ไดเมน + Top/Bottom */
function drawSpRebarPlan(m){
  if(!spHasAny(m)) return null;
  var s=spRebarOf(m), b=num(m.b,400), h=num(m.h,600);
  // เลือกชั้นที่มีข้อมูลไว้จัดเรียง (top ก่อน ไม่มีค่อย bot)
  function pick(dir){ return dir.top.n>0 ? dir.top : (dir.bot.n>0 ? dir.bot : null); }
  var R=pick(s.red), B=pick(s.blue);
  var redLen = R? (R.len>0?R.len:h) : 0;   // แดง = เส้นตั้ง ยาวตามแนวตั้ง
  var bluLen = B? (B.len>0?B.len:b) : 0;   // น้ำเงิน = เส้นนอน ยาวตามแนวนอน
  var redArr = R? (R.n-1)*R.sp : 0;        // แดงเรียงตามแนวนอน (ซ้าย-ขวา)
  var bluArr = B? (B.n-1)*B.sp : 0;        // น้ำเงินเรียงตามแนวตั้ง (บน-ล่าง)
  var spanX = Math.max(b, redArr, bluLen); // ความกว้างรวม (มม.)
  var spanY = Math.max(h, redLen, bluArr); // ความสูงรวม (มม.)
  var sc = 220/Math.max(spanX, spanY, 1);
  var Wd=spanX*sc, Hd=spanY*sc, cw=b*sc, ch=h*sc;
  var PADL=44, PADT=46, PADR=250, PADB=116;
  var cx=PADL+Wd/2, cy=PADT+Hd/2;          // จุดกึ่งกลางเสา = ตัวตั้ง
  var W=Wd+PADL+PADR, H=Hd+PADT+PADB;
  var g='';
  // เสา (กึ่งกลาง) วาดก่อน แล้ววางเหล็กทับ
  var xL=cx-cw/2, yT=cy-ch/2;
  g+='<rect x="'+xL.toFixed(1)+'" y="'+yT.toFixed(1)+'" width="'+cw.toFixed(1)+'" height="'+ch.toFixed(1)+'" fill="#1f74c4" fill-opacity="0.9" stroke="#0b3e73" stroke-width="1.5"/>';
  // เหล็กแนวน้ำเงิน (เส้นนอน) เรียงบน-ล่างจากกลาง
  if(B){ var halfW=bluLen*sc/2;
    for(var i=0;i<B.n;i++){ var y=cy+(i-(B.n-1)/2)*B.sp*sc;
      g+='<line x1="'+(cx-halfW).toFixed(1)+'" y1="'+y.toFixed(1)+'" x2="'+(cx+halfW).toFixed(1)+'" y2="'+y.toFixed(1)+'" stroke="#1d4ed8" stroke-width="1.8"/>'; } }
  // เหล็กแนวแดง (เส้นตั้ง) เรียงซ้าย-ขวาจากกลาง
  if(R){ var halfH=redLen*sc/2;
    for(var j=0;j<R.n;j++){ var x=cx+(j-(R.n-1)/2)*R.sp*sc;
      g+='<line x1="'+x.toFixed(1)+'" y1="'+(cy-halfH).toFixed(1)+'" x2="'+x.toFixed(1)+'" y2="'+(cy+halfH).toFixed(1)+'" stroke="#dc2626" stroke-width="1.8"/>'; } }
  // จุดกึ่งกลาง (กากบาท) + รหัสเสา
  g+='<line class="lead" x1="'+(cx-7).toFixed(1)+'" y1="'+cy.toFixed(1)+'" x2="'+(cx+7).toFixed(1)+'" y2="'+cy.toFixed(1)+'"/>';
  g+='<line class="lead" x1="'+cx.toFixed(1)+'" y1="'+(cy-7).toFixed(1)+'" x2="'+cx.toFixed(1)+'" y2="'+(cy+7).toFixed(1)+'"/>';
  g+='<text x="'+(xL+3).toFixed(1)+'" y="'+(yT+13).toFixed(1)+'" fill="#fff" font-weight="700" font-size="11" stroke="#0b3e73" stroke-width="2.5" paint-order="stroke">'+esc(m.code||"C")+'</text>';
  g+='<text class="lbl" x="'+cx.toFixed(1)+'" y="'+(cy-Hd/2-6).toFixed(1)+'" text-anchor="middle">'+mM(b)+'×'+mM(h)+' ม.</text>';
  // ไดเมนระยะเรียงแนวแดง (ใต้รูป) ระหว่าง 2 เส้นกลาง + Top/Bottom
  var yb=cy+Hd/2+18;
  if(R && R.n>=2){ var x0=cx-0.5*R.sp*sc, x1=cx+0.5*R.sp*sc; g+=dimH(x0, x1, yb, "@"+mM(R.sp)+" ม."); }
  g+='<text class="lbl" x="'+(cx-Wd/2).toFixed(1)+'" y="'+(yb+26)+'"><tspan fill="#dc2626" font-weight="700">Top:</tspan> '+esc(spStr(s.red.top))+'</text>';
  g+='<text class="lbl" x="'+(cx-Wd/2).toFixed(1)+'" y="'+(yb+42)+'"><tspan fill="#dc2626" font-weight="700">Bottom:</tspan> '+esc(spStr(s.red.bot))+'</text>';
  // ไดเมนระยะเรียงแนวน้ำเงิน (ขวารูป) ระหว่าง 2 เส้นกลาง + Top/Bottom
  var xr=cx+Wd/2+18;
  if(B && B.n>=2){ var y0=cy-0.5*B.sp*sc, y1=cy+0.5*B.sp*sc; g+=dimV(y0, y1, xr, "@"+mM(B.sp)+" ม."); }
  g+='<text class="lbl" x="'+(xr+12)+'" y="'+(cy-6).toFixed(1)+'"><tspan fill="#1d4ed8" font-weight="700">Top:</tspan> '+esc(spStr(s.blue.top))+'</text>';
  g+='<text class="lbl" x="'+(xr+12)+'" y="'+(cy+9).toFixed(1)+'"><tspan fill="#1d4ed8" font-weight="700">Bottom:</tspan> '+esc(spStr(s.blue.bot))+'</text>';
  return { svg: wrapSvg(W,H,"แปลนเหล็กเสริมพิเศษ "+m.code, g),
           notes:[{t:"info", x:"เหล็กเสริมพิเศษ (Top view · เรียงจากกึ่งกลางเสา) — แนวแดง Top "+spStr(s.red.top)+" / Bottom "+spStr(s.red.bot)+" · แนวน้ำเงิน Top "+spStr(s.blue.top)+" / Bottom "+spStr(s.blue.bot)}] };
}
function markRowPick(mk){ return '<button class="row-item" data-act="pickHeadMark" data-id="'+esc(mk.id)+'"><span class="hm-tag '+(mk.side==="B"?"b":"t")+'">'+esc(mk.name)+'</span><div class="body"><div class="t1 mono">'+esc(markDetailStr(mk))+'</div><div class="t2">ยาว '+esc(markLenStr(mk))+(mk.floor?" · "+esc(mk.floor):"")+'</div></div></button>'; }
function markPickerSheet(){
  var arr=allHeadMarks();
  var h='<h3>เลือกเบอร์เหล็กเสริมหัวเสา</h3><div class="note-info" style="margin-top:0">กดเบอร์เพื่อเพิ่มลงเสานี้ (เพิ่มได้หลายเบอร์) · หรือสร้างเบอร์ใหม่</div>';
  if(!arr.length) h+='<div class="empty small">ยังไม่มีเบอร์ในตาราง — กด “สร้างเบอร์ใหม่”</div>';
  else { h+='<div class="mk-list">'; ["T","B"].forEach(function(side){ var gp=arr.filter(function(x){return x.side===side;}); if(!gp.length) return;
    h+='<div class="obj-h">'+(side==="T"?"เสริมพิเศษบน (Top)":"เสริมพิเศษล่าง (Bottom)")+'</div>'; gp.forEach(function(mk){ h+=markRowPick(mk); }); }); h+='</div>'; }
  h+='<button class="add-row" data-act="newMark" style="margin-top:8px">+ สร้างเบอร์ใหม่</button>';
  return h;
}
function markManageSheet(){
  var arr=allHeadMarks();
  var del='<svg class="ic" viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/></svg>';
  var h='<h3>ตารางเหล็กเสริมหัวเสา (มาร์ค T/B)</h3><div class="note-info" style="margin-top:0">สร้าง/แก้/ลบเบอร์ที่ใช้ร่วมทั้งโครงการ</div>';
  if(!arr.length) h+='<div class="empty small">ยังไม่มีเบอร์</div>';
  else { h+='<div class="mk-list">'; arr.forEach(function(mk){ h+='<div class="row-item lst"><button class="lst-main" data-act="editMark" data-id="'+esc(mk.id)+'"><span class="hm-tag '+(mk.side==="B"?"b":"t")+'">'+esc(mk.name)+'</span><div class="body"><div class="t1 mono">'+esc(markDetailStr(mk))+'</div><div class="t2">ยาว '+esc(markLenStr(mk))+(mk.floor?" · "+esc(mk.floor):"")+'</div></div></button><button class="lst-ic" data-act="delMark" data-id="'+esc(mk.id)+'" title="ลบเบอร์">'+del+'</button></div>'; }); h+='</div>'; }
  h+='<button class="add-row" data-act="newMark" style="margin-top:8px">+ สร้างเบอร์ใหม่</button>';
  return h;
}
function markFormSheet(mk){
  mk=mk||{id:"",name:"",side:"T",n:4,d:16,sp:150,len:2000,floor:""};
  var opt=DIA_LIST.map(function(d){return '<option value="'+d+'"'+(+mk.d===d?" selected":"")+'>DB'+d+'</option>';}).join("");
  return '<h3>'+(mk.id?"แก้ไขเบอร์ "+esc(mk.name):"สร้างเบอร์ใหม่")+'</h3>'
    +'<input type="hidden" id="mk_id" value="'+esc(mk.id)+'">'
    +'<div class="grid2"><label class="f"><span>ชื่อเบอร์ (เช่น T36 / B36)</span><input id="mk_name" value="'+esc(mk.name)+'" placeholder="T36"></label>'
    +'<label class="f"><span>ประเภท</span><select id="mk_side"><option value="T"'+(mk.side==="T"?" selected":"")+'>Top — เสริมบน</option><option value="B"'+(mk.side==="B"?" selected":"")+'>Bottom — เสริมล่าง</option></select></label></div>'
    +'<div class="grid3"><label class="f"><span>จำนวน (เส้น)</span><input type="number" id="mk_n" min="0" value="'+esc(mk.n)+'"></label>'
    +'<label class="f"><span>ขนาด</span><select id="mk_d">'+opt+'</select></label>'
    +'<label class="f"><span>ระยะ @ (มม.)</span><input type="number" id="mk_sp" min="0" value="'+esc(mk.sp)+'"></label></div>'
    +'<div class="grid2"><label class="f"><span>ความยาว (มม., 0 = VARY)</span><input type="number" id="mk_len" min="0" value="'+esc(mk.len)+'"></label>'
    +'<label class="f"><span>ชั้น / หมายเหตุ</span><input id="mk_floor" value="'+esc(mk.floor||"")+'" placeholder="เช่น 2ND-4TH"></label></div>'
    +'<div class="row-end" style="margin-top:12px"><button class="btn ghost" data-act="closeMarkForm">ยกเลิก</button><button class="btn" data-act="saveMarkForm">บันทึกเบอร์</button></div>';
}

function viewMemberForm(){
  var type=state.addType, editing=state.editId ? getMember(state.editId) : null;
  var T=TYPES[type], f=getFloor(state.floorId);
  if(_assignData && (_assignData.type||"beam")===type){   // เพิ่งกด Assign → ใส่ค่าลงฟอร์ม
    if(editing){ applyTplToMember(editing, _assignData); }
    else {
      var seed=Object.assign(defaultsFor(type), {});
      (FIELDS[type]||[]).forEach(function(g){ g.f.forEach(function(fd){ if(_assignData[fd.k]!=null) seed[fd.k]=_assignData[fd.k]; }); });
      if(_assignData.fc!=null) seed.fc=_assignData.fc;
      if(type==="beam" && _assignData.stations) seed.stations=JSON.parse(JSON.stringify(_assignData.stations));
      state._formSeed=seed;
    }
    _assignData=null;
  }
  var base = editing || state._formSeed || null;
  var val=function(k,d){ return base && base[k]!=null ? base[k] : d; };

  var h='<div class="screen-title">'+(editing?"แก้ไข":"เพิ่ม")+esc(T.label)+'</div>'
      + '<div class="screen-sub">'+esc(f?f.name:"")+'</div>'
      + '<div class="card" style="max-width:660px;margin:0 auto"><div class="card-b">'
      + '<div class="fgroup-t">ข้อมูลระบุตัวชิ้นส่วน</div>'
      + '<div class="grid2">'
      +   '<label class="f"><span>รหัส (Mark) *</span><input type="text" id="fi_code" value="'+esc(val("code",""))
      +     '" placeholder="เช่น '+esc(T.ab)+'1"></label>'
      +   '<label class="f"><span>แนวเสา (Grid)</span><input type="text" id="fi_grid" value="'+esc(val("grid",""))
      +     '" placeholder="เช่น A-B / 2"></label>'
      + '</div>'
      + '<label class="f"><span>ชื่อ / หน้าที่</span><input type="text" id="fi_name" value="'+esc(val("name",""))
      +   '" placeholder="เช่น คานหลักรับพื้น"></label>'
      + '<label class="f"><span>หมายเหตุ / จุดที่ต้องระวัง</span><textarea id="fi_note" rows="2" placeholder="เช่น ระวังสับสนกับ B3 หน้าตัดต่างกัน">'+esc(val("note",""))+'</textarea></label>'
      + '<div class="note-info" style="margin-top:8px"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16v-4M12 8h.01"/><circle cx="12" cy="12" r="9"/></svg> รายละเอียดหน้าตัด/เหล็ก อัปโหลด “แบบก่อสร้างจริง” ในหน้ารายละเอียดแทนการกรอก</div>'
      + '</div></div>';
  var _skipForm=true;   // ฟอร์มแบบย่อ — ข้ามฟิลด์ขนาด/เหล็ก/สถานี/พรีวิวทั้งหมด
  if(!_skipForm){

  (FIELDS[type]||[]).forEach(function(g){
    h+='<div class="fgroup-t">'+esc(g.g)+'</div><div class="grid2">';
    g.f.forEach(function(fd){ h+=fieldHtml(fd, base?base[fd.k]:undefined); });
    h+='</div>';
  });

  // คาน: ตัวแก้เหล็กเสริม "รายสถานี" ตามตารางรายละเอียดคาน
  if(type==="beam"){
    var mForm = base || defaultsFor("beam");
    var sts = ensureBeamStations(mForm);
    h+='<div class="fgroup-t">เหล็กเสริมตามตำแหน่ง (สถานี)</div>'
      +'<div class="note-info" style="margin:2px 0 10px"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z"/></svg> กดแท็บเพื่อสลับสถานี (กรอกทีละสถานี) — ปิดสวิตช์สถานีที่ไม่มี เช่น คานยื่น หรือกด “คัดลอก → สถานีอื่น” ถ้าเหล็กเหมือนกัน</div>'
      + stationFormBar(sts)
      +'<div class="stations">';
    BEAM_STATIONS.forEach(function(S){ h+=stationBlockHtml(S.k, S.l, sts[S.k]); });
    h+='</div>';
  }

  // เสา: ปลอกรัดใน (หลายวง) + เหล็กเสริมหัวเสา (มาร์ค T/B จากตารางกลาง)
  if(type==="column"){
    var fmId=editing?editing.id:"__new__";
    if(state._fmId!==fmId){
      state._fmId=fmId;
      state._formCie=cieListOf(base||{}).map(function(c){return {top:c.top,bot:c.bot};});   // รองรับ/ย้ายข้อมูลเก่า
      state._formCix=cixListOf(base||{}).map(function(c){return {left:c.left,right:c.right};});
    }
    h+='<div class="fgroup-t">ปลอกรัดใน (คร่อมเหล็กแถวบน-ล่าง — กด + เพิ่มได้หลายวง)</div>'
      +'<div class="note-info" style="margin:2px 0 8px"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> กด “+ เพิ่มปลอกใน” เพื่อเพิ่มปลอกทีละวง (เริ่มที่แถวกลาง) แล้วปรับ “แถวบน/แถวล่าง” ของแต่ละวงเองได้อิสระ · ขนาดปลอกในตั้งที่หมวด “เหล็กปลอก (Tie)”</div>'
      +'<div id="cieBox">'+cieBoxHtml(num(base&&base.ny,13))+'</div>';
    h+='<div class="fgroup-t">ปลอกรัดในขวาง (คร่อมสดมภ์ ซ้าย-ขวา — ตั้งฉากกับปลอกในปกติ)</div>'
      +'<div class="note-info" style="margin:2px 0 8px"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> เหล็กรัดรอบอีกแนว — วาดเป็นแถบตั้งเต็มความสูง คร่อมเหล็ก “สดมภ์ซ้าย→สดมภ์ขวา” · ใช้เมื่อต้องรัดกลุ่มเหล็กในแนวกว้าง (b) เพิ่ม</div>'
      +'<div id="cixBox">'+cixBoxHtml(num(base&&base.nx,3))+'</div>';
    h+='<div class="fgroup-t">เหล็กเสริมพิเศษ (Top/Bottom · 2 ทิศทาง)</div>'
      +'<div class="note-info" style="margin:2px 0 8px"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg> เหล็ก 2 ทิศทาง — แนวแดง (เรียงตามไดเมนแนวนอน) และแนวน้ำเงิน (เรียงตามไดเมนแนวตั้ง) · แต่ละทิศมี Top/Bottom · กรอก จำนวน–ขนาด @ ระยะเรียง และ ความยาว (เมตร)</div>'
      +'<div id="spRebarBox">'+spRebarBoxHtml(base||{})+'</div>';
  }

  h+='<div class="fgroup-t">อื่น ๆ</div>'
    +'<label class="f"><span>กำลังคอนกรีต</span><input type="text" id="fi_fc" value="'+esc(val("fc",""))
    +  '" placeholder="เช่น fc′ 240 ksc"></label>'
    +'<label class="f"><span>หมายเหตุ / จุดที่ต้องระวัง</span><textarea id="fi_note" rows="2" '
    +  'placeholder="เช่น ระวังสับสนกับ B3 หน้าตัดต่างกัน">'+esc(val("note",""))+'</textarea></label>'
    +'</div></div>';
  h+='</div>';   // ปิด form-right

  // คอลัมน์ขวา: พรีวิวขึ้นบนสุด (เห็นตลอด) → สรุปวิศวกรรม → Assign (พับได้)
  h+='<div class="form-left"><div class="form-left-inner">';
  h+='<div class="card"><div class="card-h"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg> ตัวอย่างหน้าตัด (อัปเดตตามที่กรอก)</div>'
    +'<div class="card-b"><div id="previewTabs"></div><div class="section-box" id="preview"></div>'
    +'<div id="previewSpan"></div><div id="previewNotes"></div><div id="previewSummary"></div></div></div>';
  if(type==="beam" || FIELDS[type]){
    var _tpls=templatesForType(type);
    h+=rpSec('เทมเพลต'+esc((TYPES[type]&&TYPES[type].label)||'')+' (Assign)', (_tpls.length?'<span class="sec-badge">'+_tpls.length+'</span>':''), assignPanelHtml(editing,type), _tpls.length>0);
  }
  h+='</div></div>';   // ปิด form-left-inner, form-left
  h+='</div>';   // ปิด form-split
  }   // จบ if(!_skipForm) — ฟอร์มแบบย่อไม่เรนเดอร์ส่วนนี้
  // แถบบันทึกลอยด้านล่าง
  h+='<div class="form-savebar"><div class="fsb-inner">'
    +'<button class="btn ghost" data-act="goBack">ยกเลิก</button><div style="flex:1"></div>'
    +(editing?'':'<button class="btn soft" data-act="saveMemberNew">บันทึก &amp; เพิ่มตัวถัดไป</button>')
    +'<button class="btn" data-act="saveMember">'+(editing?"บันทึกการแก้ไข":"บันทึกชิ้นส่วน")+'</button>'
    +'</div></div>';
  return h;
}
/** พาเนล Assign เทมเพลต (เนื้อในอย่างเดียว — viewMemberForm เอาไปห่อในส่วนพับได้) */
function assignPanelHtml(editing, type){
  var tpls=templatesForType(type||"beam"), tl=(TYPES[type]&&TYPES[type].label)||"ชิ้นส่วน";
  var h='';
  h+='<div class="tiny muted" style="margin-bottom:7px">กดเทมเพลตเพื่อ<b>ใส่ค่าลงฟอร์มทันที</b> (ขนาด+เหล็ก+สี) แล้วแก้เพิ่มได้</div>';
  if(!tpls.length){ h+='<div class="empty small" style="margin:0 0 8px">ยังไม่มีเทมเพลต'+esc(tl)+' — กรอกฟอร์มให้ครบแล้วกด “บันทึกเป็นเทมเพลต”</div>'; }
  else {
    h+='<div class="tpl-list">';
    tpls.forEach(function(tp){
      h+='<div class="tpl-item"><button class="tpl-use" data-act="assignTpl" data-tid="'+esc(tp.id)+'"><span class="sw-dot" style="background:'+esc((tp.data&&tp.data.fill)||"#f59e0b")+'"></span>'+esc(tp.name)+'</button>'
        +'<button class="tpl-del lst-ic" data-act="delTpl" data-tid="'+esc(tp.id)+'" title="ลบเทมเพลต"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/></svg></button></div>';
    });
    h+='</div>';
  }
  h+='<button class="add-row" data-act="saveTpl" style="margin-top:8px">+ บันทึกค่าปัจจุบันเป็นเทมเพลต</button>';
  return h;
}
/** อ่านค่าจากฟอร์มเป็นอ็อบเจ็กต์ชิ้นส่วน */
function readMemberForm(){
  var type=state.addType, editing=state.editId?getMember(state.editId):null;
  var m = editing ? Object.assign({}, editing) : defaultsFor(type);
  m.type=type;
  m.id        = editing ? editing.id : uid("m");
  m.projectId = state.projectId;
  m.floorId   = state.floorId;
  var _g=function(id){ var e=$(id); return e?e.value.trim():null; };
  var _c=_g("#fi_code"); if(_c!=null) m.code=_c;
  var _gr=_g("#fi_grid"); if(_gr!=null) m.grid=_gr;
  var _nm=_g("#fi_name"); if(_nm!=null) m.name=_nm;
  var _fc=_g("#fi_fc"); if(_fc!=null) m.fc=_fc;
  var _nt=_g("#fi_note"); if(_nt!=null) m.note=_nt;
  $$("[data-k]").forEach(function(el){
    var k=el.getAttribute("data-k"), t=el.getAttribute("data-t");
    m[k] = (t==="text") ? el.value.trim()
         : (t==="sel")  ? el.value
         : (t==="bool") ? (el.checked?1:0)
         : (t==="m")    ? Math.round(num(el.value,0)*1000)   // เมตร → มม.
         : num(el.value, 0);
  });
  if(type==="beam") readBeamStations(m);
  if(type==="column"){
    if($("[data-cie]")) m.cieList=readCieInputs();   // มีในฟอร์มเท่านั้นจึงเขียนทับ (ฟอร์มย่อไม่มี → คงค่าเดิม)
    if($("[data-cix]")) m.cixList=readCixInputs();
    if($("[data-spr]")) m.spRebar=readSpRebar();
  }
  return m;
}
/** อ่านค่าเหล็กรายสถานีจากฟอร์มคาน → m.stations แล้ว sync ฟิลด์แบน */
function readBeamStations(m){
  if(!$("[data-ston]")) return;   // ฟอร์มยังไม่ได้เรนเดอร์สถานี → คงค่าเดิม
  var s={};
  BEAM_STATIONS.forEach(function(S){ s[S.k]={ on:false,
    top:[{n:0,d:16},{n:0,d:16}], bot:[{n:0,d:16},{n:0,d:16}],
    side:{n:0,d:12,rows:0}, stir:{d:9,sp:200}, tie:{d:10,rows:1,cols:0}, ctie:{n:0,left:0,right:0} }; });
  $$("[data-ston]").forEach(function(el){ var k=el.getAttribute("data-ston"); if(s[k]) s[k].on=el.checked; });
  $$("[data-st]").forEach(function(el){
    var k=el.getAttribute("data-st"), sk=el.getAttribute("data-sk"), v=num(el.value,0), st=s[k]; if(!st) return;
    switch(sk){
      case "t1n": st.top[0].n=v; break; case "t1d": st.top[0].d=v; break;
      case "t2n": st.top[1].n=v; break; case "t2d": st.top[1].d=v; break;
      case "b1n": st.bot[0].n=v; break; case "b1d": st.bot[0].d=v; break;
      case "b2n": st.bot[1].n=v; break; case "b2d": st.bot[1].d=v; break;
      case "srows": st.side.rows=v; break; case "sn": st.side.n=v; break; case "sd": st.side.d=v; break;
      case "std": st.stir.d=v; break; case "stsp": st.stir.sp=v; break; case "tied": st.tie.d=v; break;
      case "tirows": st.tie.rows=Math.max(0,v); break; case "ticols": st.tie.cols=Math.max(0,v); break;
      case "ctn": st.ctie.n=Math.max(0,v); break;
      case "ctl": st.ctie.left=Math.max(0,v); break; case "ctr": st.ctie.right=Math.max(0,v); break;
    }
  });
  // ตัดชั้นที่ว่าง (n=0) ออกจากท้าย เพื่อความสะอาดของข้อมูล
  BEAM_STATIONS.forEach(function(S){
    var st=s[S.k];
    st.top=st.top.filter(function(t){return t.n>0;}); if(!st.top.length) st.top=[{n:0,d:16}];
    st.bot=st.bot.filter(function(b){return b.n>0;}); if(!st.bot.length) st.bot=[{n:0,d:16}];
  });
  m.stations=s; syncBeamLegacy(m);
}
function updatePreview(){
  var box=$("#preview"); if(!box) return;
  var m=readMemberForm();
  if(!m.code) m.code="(ยังไม่ระบุรหัส)";
  // อัปเดตแท็บสถานี + สถานะเปิด/ปิดของบล็อก
  if(m.type==="beam"){
    var tb=$("#previewTabs"); if(tb) tb.innerHTML=stationTabsHtml(m);
    $$("[data-stn]").forEach(function(el){
      if(!el.classList.contains("stn")) return;
      var k=el.getAttribute("data-stn"), on=m.stations[k]&&m.stations[k].on;
      el.classList.toggle("off",!on);
      var st=el.querySelector(".stn-h .tiny"); if(st) st.textContent=on?"เปิดใช้":"ปิดอยู่ — เปิดสวิตช์เพื่อกรอก";
    });
    $$(".stn-ftab").forEach(function(t){       // อัปเดตจุดสี เปิด/ปิด บนแท็บสถานี
      var k=t.getAttribute("data-stn"); t.setAttribute("data-en", (m.stations[k]&&m.stations[k].on)?"1":"0");
    });
  }
  var d=(m.type==="beam") ? drawBeam(m, state.previewStation) : drawSection(m);
  box.innerHTML = d ? d.svg : '<div class="empty small">กรอกขนาดให้ครบเพื่อดูตัวอย่าง</div>';
  var nb=$("#previewNotes"); if(nb) nb.innerHTML="";   // เอาโน้ต ℹ ใต้รูปออก (ลดความรก)
  // รูปด้านยาว (span คาน / elevation เสา) + แปลนเหล็กเสริมพิเศษ (เสา)
  var sp=$("#previewSpan");
  if(sp){ var ds=(m.type==="beam") ? drawBeamContinuous(m)
                : (m.type==="column" && num(m.height,0)>0) ? drawColumnElev(m) : null;
    var spHtml = ds ? '<div class="section-box" style="margin-top:8px">'+ds.svg+'</div>' : '';
    if(m.type==="column"){ var dp=drawSpRebarPlan(m); if(dp) spHtml += '<div class="section-box" style="margin-top:8px">'+dp.svg+'</div>'; }
    if(m.type==="slab"){ spHtml += '<div class="section-box" style="margin-top:8px">'+drawSlabSpan(m).svg+'</div>'; }
    sp.innerHTML = spHtml; }
  // สรุปวิศวกรรม
  var su=$("#previewSummary"); if(su) su.innerHTML=memberSummaryHtml(m);
}
/** สรุปวิศวกรรมสั้น ๆ (โดยประมาณ) ใต้พรีวิว */
function barArea(n,dmm){ return (n||0)*Math.PI/4*dmm*dmm; }            // mm²
function barWtPerM(dmm){ return dmm*dmm/162.2; }                       // kg/m ต่อเส้น
/** ระยะทาบโดยประมาณตามข้อกำหนด (SD40=40db, SD50=50db, ขั้นต่ำ 300มม.) */
function lapLen(dmm){ var f=(dmm>=25)?50:40; return Math.max(f*dmm, 300); }
function columnSummaryHtml(m){
  var b=num(m.b,0), hh=num(m.h,0), cov=num(m.cover,0), Hc=num(m.height,3000);
  var nx=num(m.nx,0), ny=num(m.ny,0), m1d=num(m.mainDia,20), totMain=colMainTotal(m), dMax=m1d;
  // ปริมาณคอนกรีต (ม³) = b×h×H
  var vol=(b/1000)*(hh/1000)*(Hc/1000);
  var Ag=b*hh; var As=barArea(totMain,m1d); var rho=Ag>0?(As/Ag*100):0;
  // น้ำหนักเหล็ก (kg) โดยประมาณ: เหล็กยืน (ตามสูง+ทาบ) + ปลอก + เหล็กเสริมหัว
  var lap=lapLen(dMax);
  var vertLen=(Hc+lap)/1000;   // ยาวต่อเส้น (รวมทาบ 1 จุด)
  var wVert=totMain*barWtPerM(m1d)*vertLen;
  // ปลอก: เส้นรอบรูป × จำนวนปลอกตามสูง (ประมาณจากช่วงกลาง)
  var tieN=Math.max(1, Math.round(Hc/Math.max(num(m.stirMid,200),50)));
  var periM=2*((b-2*cov)+(hh-2*cov))/1000;  // เส้นรอบปลอกนอก (ม.)
  var _cieL=cieListOf(m), nCie=_cieL.length;
  var _cixL=cixListOf(m), nCix=_cixL.length;
  var innerLegs=nCie*((b-2*cov)/1000) + nCix*((hh-2*cov)/1000);  // ปลอกใน(แถว)=กว้าง b · ปลอกในขวาง(สดมภ์)=สูง h
  var wTie=(periM+innerLegs)*tieN*barWtPerM(num(m.stirDia,12));
  // เหล็กเสริมพิเศษ 2 ทิศทาง — น้ำหนัก = n × dia²/162 × ความยาว(ถ้ามี)
  var sp=spRebarOf(m), spAll=[["แดง-บน",sp.red.top],["แดง-ล่าง",sp.red.bot],["น้ำเงิน-บน",sp.blue.top],["น้ำเงิน-ล่าง",sp.blue.bot]];
  var wSp=0; spAll.forEach(function(p){ var c=p[1]; if(c.n>0&&c.len>0) wSp+=c.n*barWtPerM(c.d||16)*(c.len/1000); });
  var hasSp=spHasAny(m);
  var wSteel=wVert+wTie+wSp;
  var rows=[
    ["เหล็กยืน (เมน)", (nx&&ny? totMain+"-DB"+m1d+" (nx"+nx+"×ny"+ny+")" : totMain+"-DB"+m1d)],
    ["จำนวนเหล็กยืนรวม", totMain+" เส้น"],
    ["ρg (เหล็กยืน/หน้าตัด)", rho?rho.toFixed(2)+" %":"—"],
    ["ปลอก", "DB"+num(m.stirDia,12)+(nCie?" + ปลอกใน "+nCie+" วง-DB"+num(m.tieInnerDia,10):"")+(nCix?" + ปลอกในขวาง "+nCix+" วง":"")+" · So@"+num(m.stirEnd,150)+" / @"+num(m.stirMid,200)],
    ["ปลอกตัวแรก S1 (จากขอบคาน/พื้น)", "@"+num(m.stirFirst,50)+" มม. · แนะนำ ≤ So/2 ("+Math.round(num(m.stirEnd,150)/2)+" มม.)"],
    ["ระยะทาบ ≈ (ตาม db เมน)", dMax?lap+" มม. ("+(dMax>=25?"SD50·50db":"SD40·40db")+")":"—"],
    ["ปริมาณคอนกรีต ≈", vol.toFixed(3)+" ม³ (b×h×H)"],
    ["ปริมาณเหล็ก ≈", wSteel.toFixed(1)+" kg (ยืน "+wVert.toFixed(0)+" + ปลอก "+wTie.toFixed(0)+(wSp>0?" + พิเศษ "+wSp.toFixed(0):"")+")"]
  ];
  var spRows = hasSp ? spAll.filter(function(p){return p[1].n>0;}).map(function(p){
    return '<div class="es-r"><span>'+esc(p[0])+'</span><b>'+esc(spStr(p[1]))+'</b></div>'; }).join("") : "";
  return '<div class="eng-sum"><div class="es-h">สรุปวิศวกรรมเสา (โดยประมาณ)</div>'
    + rows.map(function(r){ return '<div class="es-r"><span>'+esc(r[0])+'</span><b>'+esc(r[1])+'</b></div>'; }).join("")
    + (spRows? '<div class="es-h" style="border-top:1px solid var(--border)">เหล็กเสริมพิเศษ (Top/Bottom · 2 ทิศทาง)</div>'+spRows : '')
    + '<div class="es-note">* คอนกรีต=b×h×สูง · เหล็กยืนรวมระยะทาบ 1 จุด/เส้น · ปลอกประมาณจากช่วงกลาง · ระยะทาบ 40db/50db (≥300มม.)<br>* มาตรฐาน So (Special Moment Frame): 10 ≤ So = 10+(35−hx)/3 ≤ 15 ซม. (hx=ระยะเหล็กยืนที่ถูกยึด) · ตรวจกับ SG-03 อีกครั้ง</div></div>';
}
function memberSummaryHtml(m){
  if(m.type==="column") return columnSummaryHtml(m);
  if(m.type!=="beam"){
    var rows=[]; if(m.b&&m.h) rows.push(["หน้าตัด", mM(m.b)+"×"+mM(m.h)+" ม."]);
    if(!rows.length) return "";
    return '<div class="eng-sum"><div class="es-h">สรุป (โดยประมาณ)</div>'+rows.map(function(r){return '<div class="es-r"><span>'+esc(r[0])+'</span><b>'+esc(r[1])+'</b></div>';}).join("")+'</div>';
  }
  var g=beamGov(m), b=num(m.b,0), hh=num(m.h,0), cov=num(m.cover,0), span=num(m.span,0);
  var stirD=(g.stir&&g.stir.d)||9;
  var dTop=g.top&&g.top.d||16, dBot=g.bot&&g.bot.d||16;
  var dEff=hh - cov - stirD - dBot/2;                                   // ความลึกประสิทธิผล (มม.)
  var AsBot=barArea(g.bot&&g.bot.n, dBot), AsTop=barArea(g.top&&g.top.n, dTop);
  var rho=(b>0&&dEff>0)? (AsBot/(b*dEff))*100 : 0;
  var nTot=((g.top&&g.top.n)||0)+((g.bot&&g.bot.n)||0);
  var wt=0; if(span>0){ wt=((g.top&&g.top.n||0)*barWtPerM(dTop)+(g.bot&&g.bot.n||0)*barWtPerM(dBot))*(span/1000); }
  var rows=[
    ["เหล็กบน (ช่วงวิกฤต)", (g.top&&g.top.n?g.top.n+"-DB"+g.top.d:"—")],
    ["เหล็กล่าง (ช่วงวิกฤต)", (g.bot&&g.bot.n?g.bot.n+"-DB"+g.bot.d:"—")],
    ["จำนวนเส้นหลักรวม", nTot+" เส้น"],
    ["ρ (เหล็กล่าง)", rho? rho.toFixed(2)+" %":"—"],
    ["น้ำหนักเหล็กหลัก ≈", (span>0? wt.toFixed(1)+" kg ("+(span/1000).toFixed(1)+" ม.)":"— (ใส่ span)")]
  ];
  return '<div class="eng-sum"><div class="es-h">สรุปวิศวกรรม (โดยประมาณ · ช่วงวิกฤต)</div>'
    + rows.map(function(r){ return '<div class="es-r"><span>'+esc(r[0])+'</span><b>'+esc(r[1])+'</b></div>'; }).join("")
    + '<div class="es-note">* ประมาณจากช่วงที่เหล็กมากสุด · น้ำหนักคิดเฉพาะเหล็กหลักยาว = span</div></div>';
}
function saveMemberForm(andNew){
  var m=readMemberForm();
  if(!m.code || !m.grid){ toast("กรอก รหัส และ แนวเสา ให้ครบ",true); return; }
  var editing=state.editId?getMember(state.editId):null;
  if(!editing){
    var dup=membersOfFloor(state.floorId).some(function(x){ return x.code===m.code; });
    if(dup && !confirm("มีรหัส "+m.code+" ในชั้นนี้อยู่แล้ว ต้องการเพิ่มซ้ำหรือไม่?")) return;
    if(!m.planId) m.planId=curPlanId();   // ผูกกับแปลนที่กำลังเปิด
    DB.members.push(m);
    if(!saveDB()){ DB.members.pop(); return; }
    toast("เพิ่ม "+m.code+" แล้ว");
    state.selMemberId=m.id;   // เลือกชิ้นส่วนใหม่บนแปลนทันที
  }else{
    var i=DB.members.indexOf(editing);
    var backup=DB.members[i];
    DB.members[i]=m;
    if(!saveDB()){ DB.members[i]=backup; return; }
    toast("บันทึกการแก้ไขแล้ว");
  }
  var savedType=m.type;
  state.editId=null;
  if(andNew){   // บันทึก & เพิ่มตัวถัดไป — เปิดฟอร์มเพิ่มใหม่ชนิดเดิม (เดาเบอร์ถัดไป)
    state.catType=savedType;
    go("memberForm", {addType:savedType, editId:null, _formSeed:null, formStation:"mid", previewStation:"mid", selMemberId:null});
    return;
  }
  // กลับไปเอดิเตอร์แปลนของหมวดนั้น (ตั้ง catType ให้ตรงกับประเภทที่เพิ่ง save)
  go("planEditor", {catType:savedType});
}

/* ---- หน้าจอ 8: ข้อมูล / สำรอง ---- */
function viewData(){
  var bytes=0;
  try{ bytes=new Blob([JSON.stringify(DB)]).size; }catch(e){}
  return '<div class="screen-title">ข้อมูล / สำรอง</div>'
    + '<div class="screen-sub">ข้อมูลทั้งหมดเก็บในเครื่องนี้เท่านั้น (localStorage) ไม่มีเซิร์ฟเวอร์</div>'
    + '<div class="card"><div class="card-b">'
    +   '<div class="small mono">โครงการ: '+DB.projects.length+' · ชั้น: '+DB.floors.length
    +     ' · ชิ้นส่วน: '+DB.members.length+' · ประวัติ: '+DB.inspections.length+'</div>'
    +   '<div class="small mono">ขนาดข้อมูล: '+(bytes/1024).toFixed(1)+' KB</div>'
    +   '<hr class="sep">'
    +   '<p class="small muted" style="margin-top:0">ทีมออฟฟิศกรอกชิ้นส่วนแล้ว Export ไฟล์ส่งให้ช่าง Import เข้ามือถือได้</p>'
    +   '<div class="grid2">'
    +     '<button class="btn block" data-act="export"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg> Export ข้อมูล (.json)</button>'
    +     '<label class="btn ghost block" style="text-align:center;margin:0" for="fileImport"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21V9M7 14l5-5 5 5M5 3h14"/></svg> Import ข้อมูล</label>'
    +   '</div>'
    +   '<input type="file" id="fileImport" accept="application/json,.json" hidden>'
    +   '<hr class="sep">'
    +   '<button class="btn danger block" data-act="reset">ล้างข้อมูลทั้งหมด แล้วโหลดตัวอย่างใหม่</button>'
    + '</div></div>';
}
function exportData(){
  try{
    var blob=new Blob([JSON.stringify(DB,null,2)],{type:"application/json"});
    var url=URL.createObjectURL(blob), a=document.createElement("a");
    a.href=url; a.download="rebarcheck-"+new Date().toISOString().slice(0,10)+".json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); },1000);
    toast("ส่งออกไฟล์แล้ว");
  }catch(err){ toast("ส่งออกไม่สำเร็จ",true); }
}
function importData(file){
  var reader=new FileReader();
  reader.onload=function(){
    try{
      var d=JSON.parse(reader.result);
      if(!Array.isArray(d.projects)||!Array.isArray(d.members)) throw new Error("รูปแบบไฟล์ไม่ถูกต้อง");
      if(!confirm("นำเข้า "+d.projects.length+" โครงการ / "+d.members.length+" ชิ้นส่วน\nข้อมูลเดิมในเครื่องจะถูกแทนที่ ยืนยันหรือไม่?")) return;
      DB.projects=d.projects;
      DB.floors=Array.isArray(d.floors)?d.floors:[];
      DB.members=d.members;
      DB.inspections=Array.isArray(d.inspections)?d.inspections:[];
      DB.inspector=typeof d.inspector==="string"?d.inspector:"";
      saveDB();
      state.stack=[]; state.projectId=null; state.floorId=null; state.memberId=null;
      state.screen="home"; render();
      toast("นำเข้าข้อมูลเรียบร้อย");
    }catch(err){ toast("ไฟล์ไม่ถูกต้อง: "+err.message,true); }
  };
  reader.onerror=function(){ toast("อ่านไฟล์ไม่ได้",true); };
  reader.readAsText(file);
}

/* ---------------------------------------------------------------------------
   7) Dialog สร้าง/แก้ไข โครงการและชั้น
   ------------------------------------------------------------------------ */
function openSheet(html){ $("#sheet").innerHTML=html; $("#overlay").classList.add("open"); }
function closeSheet(){ $("#overlay").classList.remove("open"); }

function dlgProject(editId){
  var p=editId?getProject(editId):null;
  openSheet('<h3>'+(p?"แก้ไขโครงการ":"สร้างโครงการใหม่")+'</h3>'
    +'<label class="f"><span>ชื่อโครงการ *</span><input type="text" id="dp_name" value="'+esc(p?p.name:"")
    +  '" placeholder="เช่น อาคารสำนักงาน 4 ชั้น"></label>'
    +'<label class="f"><span>สถานที่ / เจ้าของงาน</span><input type="text" id="dp_loc" value="'+esc(p?p.location:"")
    +  '" placeholder="เช่น ไซต์ A ถ.พระราม 9"></label>'
    +'<div class="row-end">'
    + (p?'<button class="btn danger" data-act="dlgDelProject" data-id="'+esc(p.id)+'">ลบโครงการ</button>':'')
    +'<button class="btn soft" data-act="closeSheet">ยกเลิก</button>'
    +'<button class="btn" data-act="dlgSaveProject" data-id="'+esc(p?p.id:"")+'">บันทึก</button></div>');
  setTimeout(function(){ var e=$("#dp_name"); if(e) e.focus(); },50);
}
function dlgSaveProject(id){
  var name=$("#dp_name").value.trim(), loc=$("#dp_loc").value.trim();
  if(!name){ toast("กรอกชื่อโครงการ",true); return; }
  if(id){
    var p=getProject(id), old={n:p.name, l:p.location};
    p.name=name; p.location=loc;
    if(!saveDB()){ p.name=old.n; p.location=old.l; return; }   // บันทึกไม่ได้ → คืนค่าเดิม
  }else{
    DB.projects.push({ id:uid("p"), name:name, location:loc, createdAt:Date.now() });
    if(!saveDB()){ DB.projects.pop(); return; }
  }
  closeSheet(); render(); toast("บันทึกโครงการแล้ว");
}
function dlgDelProject(id){
  var p=getProject(id); if(!p) return;
  var n=membersOfProject(id).length;
  if(!confirm('ลบโครงการ "'+p.name+'"\nชั้น ชิ้นส่วน และประวัติการตรวจทั้งหมด ('+n+' ชิ้นส่วน) จะถูกลบด้วย ยืนยันหรือไม่?')) return;
  DB.projects=DB.projects.filter(function(x){ return x.id!==id; });
  DB.floors=DB.floors.filter(function(x){ return x.projectId!==id; });
  DB.members=DB.members.filter(function(x){ return x.projectId!==id; });
  DB.inspections=DB.inspections.filter(function(x){ return x.projectId!==id; });
  saveDB(); closeSheet();
  state.stack=[]; state.projectId=null; state.screen="home"; render();
  toast("ลบโครงการแล้ว");
}
function dlgFloor(editId){
  var f=editId?getFloor(editId):null;
  openSheet('<h3>'+(f?"แก้ไขชั้น":"เพิ่มชั้น")+'</h3>'
    +'<label class="f"><span>ชื่อชั้น *</span><input type="text" id="df_name" value="'+esc(f?f.name:"")
    +  '" placeholder="เช่น ชั้น 2 หรือ ฐานราก"></label>'
    +'<label class="f"><span>ระดับ (ม.) — ใช้เรียงลำดับจากล่างขึ้นบน</span>'
    +  '<input type="text" id="df_level" value="'+esc(f?f.level:"")+'" placeholder="เช่น 3.20 หรือ -1.50"></label>'
    +'<div class="row-end">'
    + (f?'<button class="btn danger" data-act="dlgDelFloor" data-id="'+esc(f.id)+'">ลบชั้น</button>':'')
    +'<button class="btn soft" data-act="closeSheet">ยกเลิก</button>'
    +'<button class="btn" data-act="dlgSaveFloor" data-id="'+esc(f?f.id:"")+'">บันทึก</button></div>');
  setTimeout(function(){ var e=$("#df_name"); if(e) e.focus(); },50);
}
function dlgSaveFloor(id){
  var name=$("#df_name").value.trim(), lv=$("#df_level").value.trim();
  if(!name){ toast("กรอกชื่อชั้น",true); return; }
  if(id){
    var f=getFloor(id), old={n:f.name, l:f.level};
    f.name=name; f.level=lv;
    if(!saveDB()){ f.name=old.n; f.level=old.l; return; }      // บันทึกไม่ได้ → คืนค่าเดิม
  }else{
    DB.floors.push({ id:uid("f"), projectId:state.projectId, name:name, level:lv, createdAt:Date.now() });
    if(!saveDB()){ DB.floors.pop(); return; }
  }
  closeSheet(); render(); toast("บันทึกชั้นแล้ว");
}
function dlgDelFloor(id){
  var f=getFloor(id); if(!f) return;
  var n=membersOfFloor(id).length;
  if(!confirm('ลบ "'+f.name+'"\nชิ้นส่วนในชั้นนี้ '+n+' รายการจะถูกลบด้วย ยืนยันหรือไม่?')) return;
  DB.floors=DB.floors.filter(function(x){ return x.id!==id; });
  DB.members=DB.members.filter(function(x){ return x.floorId!==id; });
  DB.inspections=DB.inspections.filter(function(x){ return x.floorId!==id; });
  saveDB(); closeSheet();
  if(state.floorId===id){ state.floorId=null; state.screen="floors"; }
  render(); toast("ลบชั้นแล้ว");
}

/* ---- จัดการสถานะโซนเท (กำหนดเอง แยกตามแปลน) ---- */
function _zsCapture(){
  $$(".zs-label").forEach(function(el){ var s=(state._stEdit||[])[+el.getAttribute("data-i")]; if(s) s.label=el.value; });
  $$(".zs-color").forEach(function(el){ var s=(state._stEdit||[])[+el.getAttribute("data-i")]; if(s) s.color=el.value; });
}
function _renderZoneStatusSheet(){
  var list=state._stEdit||[];
  var rows=list.map(function(s,i){
    return '<div class="zs-row" data-i="'+i+'">'
      +'<input type="color" class="zs-color" value="'+esc(s.color||"#94a3b8")+'" data-i="'+i+'">'
      +'<input type="text" class="zs-label" value="'+esc(s.label||"")+'" data-i="'+i+'" placeholder="ชื่อสถานะ เช่น เทคอนกรีตเสร็จ">'
      +'<button class="btn soft zs-del" data-act="zsDelStatus" data-sid="'+esc(s.id)+'" title="ลบสถานะนี้"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>'
      +'</div>';
  }).join("");
  openSheet('<h3>จัดการสถานะโซน (เฉพาะแปลนนี้)</h3>'
    +'<p class="tiny muted" style="margin:0 0 8px">ตั้งชื่อสถานะและสีเองได้ เช่น “เสริมเหล็กเสร็จ”, “เทคอนกรีตเสร็จ”</p>'
    +'<div class="zs-list">'+rows+'</div>'
    +'<button class="btn soft zs-add" data-act="zsAddStatus"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> เพิ่มสถานะ</button>'
    +'<div class="row-end" style="margin-top:12px">'
    +'<button class="btn soft" data-act="closeSheet">ยกเลิก</button>'
    +'<button class="btn" data-act="zsSaveStatus">บันทึก</button></div>');
}
function dlgZoneStatus(){
  state._stEdit=zoneStatuses(state.floorId, curPlanId()).map(function(s){ return Object.assign({},s); });
  _renderZoneStatusSheet();
}
function zsAddStatus(){ _zsCapture(); if(!state._stEdit) state._stEdit=[]; state._stEdit.push({id:uid("st"), label:"สถานะใหม่", color:"#3b82f6"}); _renderZoneStatusSheet(); }
function zsDelStatus(sid){
  _zsCapture();
  if((state._stEdit||[]).length<=1){ toast("ต้องมีอย่างน้อย 1 สถานะ",true); return; }
  state._stEdit=state._stEdit.filter(function(s){ return s.id!==sid; });
  _renderZoneStatusSheet();
}
function zsSaveStatus(){
  _zsCapture();
  var list=(state._stEdit||[]).map(function(s){ return {id:s.id, label:(s.label||"").trim()||"สถานะ", color:s.color||"#94a3b8"}; });
  if(!list.length){ toast("ต้องมีอย่างน้อย 1 สถานะ",true); return; }
  var f=getFloor(state.floorId); if(!f){ closeSheet(); return; }
  if(!f.zoneStatusMap) f.zoneStatusMap={};
  var pid=curPlanId();
  f.zoneStatusMap[pid]=list;
  var ids={}; list.forEach(function(s){ ids[s.id]=1; });
  zonesOfPlan(state.floorId,pid).forEach(function(z){ if(!ids[z.status]) z.status=list[0].id; });   // สถานะที่ถูกลบ → ใช้ตัวแรก
  if(!saveDB()) return;
  state._stEdit=null; closeSheet(); render(); toast("บันทึกสถานะแล้ว");
}

/* ---------------------------------------------------------------------------
   8) สถานะหน้าจอ + การนำทาง
      ลำดับหน้าจอ: projects → floors → members → detail
      (แตกออกได้: pickType/memberForm, history, data)
   ------------------------------------------------------------------------ */
var state = {
  screen:"home",
  projectId:null, floorId:null, memberId:null,
  addType:null, editId:null,
  previewStation:"mid",  // สถานีที่แสดงในพรีวิวฟอร์มคาน
  formStation:"mid",     // สถานีที่กำลังกรอกอยู่ในฟอร์ม (แท็บ)
  snap:true,             // สแนบเข้าเส้น/จุดตัดของแปลน (PDF เวกเตอร์)
  q:"", qh:"", typeFilter:"all",
  answers:{}, photos:[], note:"",
  // ---- เอดิเตอร์แปลน ----
  catType:null,          // ประเภทที่ "กำลังวาด/โฟกัส" (beam/column/...) — โหมดรวมใช้เป็นชนิดที่จะวาด
  unified:true,          // โหมดแปลนรวม: วาด/เห็นทุกชนิดในแปลนเดียว (false = โฟกัสทีละหมวดแบบเดิม)
  hiddenTypes:{},        // เลเยอร์ที่ซ่อนในโหมดรวม {type:true}
  listFilter:"all",      // กรองชนิดในแท็บรายการ (โหมดรวม)
  tool:"select",         // เครื่องมือ: select | draw
  drawShape:"rect",      // รูปทรงที่จะวาด (พื้นที่): rect | oval | poly
  zoneShape:"rect",      // รูปทรงที่จะวาดโซนเท: rect | poly
  showLegend:false, legendPos:null,   // ตารางสีบนแปลน (Legend)
  floatStyleOpen:false, floatStylePos:null,  // หน้าต่างลอยสไตล์กรอบ
  showProgress:true, selZoneId:null, floatProgressOpen:false, floatProgressPos:null,  // ความคืบหน้าเทคอนกรีต
  rightTab:"palette",    // แท็บพาเนลขวา: palette | spec | inspect
  selMemberId:null,      // ชิ้นส่วนที่เลือกบนแปลน
  colorMode:"plain",     // ลงสีตาม: status | plain — ค่าเริ่มต้น = สีประจำประเภท
  showLabels:true,       // แสดงเบอร์บนแปลน
  zoom:1, panX:0, panY:0,// สถานะซูม/เลื่อนแปลน
  fillColor:"#f59e0b",   // สีกรอบที่จะวาด (คาน/พื้น/PT)
  fillAlpha:0.35,        // ความเข้มสีด้านในกรอบ (0..1)
  strokeW:10,            // ความหนาเส้นกรอบ (0 = ไม่มีเส้น)
  rpWidth:380            // ความกว้างพาเนลขวา (ลากเส้นแบ่งปรับได้)
};
try{ var _rw=parseInt(localStorage.getItem("rebarcheck.rpw"),10); if(_rw>=280&&_rw<=760) state.rpWidth=_rw; }catch(e){}

/** หน้าจอที่ปุ่มย้อนกลับควรพาไป — คำนวณจากลำดับชั้นข้อมูล ไม่ต้องเก็บ stack */
function backTarget(){
  switch(state.screen){
    case "home":       return null;
    case "floors":     return "home";
    case "categories": return "floors";
    case "planEditor": return "categories";
    case "progress":   return "home";
    case "members":    return "categories";
    case "detail":     return "planEditor";
    case "memberDetail": return "planEditor";
    case "pickType":   return "categories";
    case "memberForm": return state.editId ? "planEditor" : "planEditor";
    case "history":    return "floors";
    case "data":       return state.floorId ? "categories" : (state.projectId ? "floors" : "home");
  }
  return "home";
}
function navigate(screen){ state.screen=screen; render(); }
function back(){
  var t=backTarget();
  if(t) navigate(t);
}
/** ใช้ตอนเปลี่ยนหน้าพร้อมตั้งค่าอื่น ๆ */
function go(screen, patch){
  if(patch) Object.keys(patch).forEach(function(k){ state[k]=patch[k]; });
  navigate(screen);
}

function headerInfo(){
  var p=getProject(state.projectId), f=getFloor(state.floorId), m=getMember(state.memberId);
  switch(state.screen){
    case "floors":     return [p?p.name:"โครงการ", p&&p.location?p.location:"เลือกชั้น"];
    case "categories": return [f?f.name:"ชั้น", p?p.name:""];
    case "planEditor": return [(TYPES[state.catType]?TYPES[state.catType].label:"หมวด"), f?f.name:""];
    case "progress":   return ["อัพเดทความคืบหน้า", f?f.name:(p?p.name:"")];
    case "members":    return [f?f.name:"ชั้น", p?p.name:""];
    case "detail":     return [m?m.code:"ชิ้นส่วน", (m?m.name:"")||(f?f.name:"")];
    case "memberDetail": return [m?("รายละเอียด "+m.code):"รายละเอียด", (m?m.name:"")||(f?f.name:"")];
    case "pickType":   return ["เพิ่มชิ้นส่วน", f?f.name:""];
    case "memberForm": return [(state.editId?"แก้ไข":"เพิ่ม")+(TYPES[state.addType]?TYPES[state.addType].label:""), f?f.name:""];
    case "history":    return ["ประวัติการตรวจ", p?p.name:""];
    case "data":       return ["ข้อมูล / สำรอง","สำรองและถ่ายโอนข้อมูล"];
  }
  return ["RebarCheck",""];
}

function render(){
  var html="";
  switch(state.screen){
    case "home":       html=viewHome();       break;
    case "floors":     html=viewFloors();     break;
    case "categories": html=viewCategories(); break;
    case "planEditor": html=viewPlanEditor(); break;
    case "progress":   html=viewProgress();   break;
    case "members":    html=viewMembers();    break;
    case "detail":     html=viewDetail();     break;
    case "memberDetail": html=viewMemberDetail(); break;
    case "pickType":   html=viewPickType();   break;
    case "memberForm": html=viewMemberForm(); break;
    case "history":    html=viewHistory();    break;
    case "data":       html=viewData();       break;
  }
  $("#app").innerHTML=html;

  // เอดิเตอร์แปลนใช้พื้นที่กว้างกว่าหน้าอื่น เพื่อให้กรอบแปลนใหญ่ ดูชัด
  document.body.classList.toggle("editor-wide", state.screen==="planEditor" || state.screen==="memberDetail" || state.screen==="memberForm" || state.screen==="progress");
  document.body.classList.toggle("home-mode", state.screen==="home");   // ซ่อน header เดิม โชว์ dashboard เต็ม
  document.body.classList.remove("auth-mode");   // เข้าแอปแล้ว → เลิกโหมด login

  var hi=headerInfo();
  $("#hdTitle").innerHTML=esc(hi[0])+"<small>"+esc(hi[1])+"</small>";
  var atRoot=(backTarget()===null);
  $("#btnBack").hidden = atRoot;
  var bm=$("#brandMark"); if(bm) bm.hidden = !atRoot;   // โลโก้โชว์เฉพาะหน้าแรก

  renderTabbar();   // แถบเมนูล่าง (มือถือ)
  bindScreen();
}
/** แถบเมนูล่าง + ปุ่มลอย — โชว์เฉพาะมือถือ (ดีไซน์แนวแอป) */
var TABBAR_HIDE={planEditor:1, memberDetail:1, memberForm:1, pickType:1};
function renderTabbar(){
  var tb=document.getElementById("tabbar"), fab=document.getElementById("fab"); if(!tb) return;
  var mob=(window.innerWidth||1024)<760;
  var authed=!(CLOUD && !_fbUser), scr=state.screen;
  var show = mob && authed && !TABBAR_HIDE[scr] && scr!=="login" && scr!=="loading";
  document.body.classList.toggle("has-tabbar", show);
  if(!show){ tb.innerHTML=""; if(fab) fab.style.display="none"; return; }
  var inspAct=(scr==="floors"||scr==="categories"||scr==="members"||scr==="detail");
  var IChome='<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/></svg>';
  var ICsearch='<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
  var ICreport='<svg viewBox="0 0 24 24"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/></svg>';
  var ICuser='<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
  function tab(on,act,label,svg){ return '<button class="tab'+(on?" on":"")+'" data-act="'+act+'"><span class="tabic">'+svg+'</span>'+label+'</button>'; }
  tb.innerHTML = tab(scr==="home","goHome","หน้าหลัก",IChome)
    + tab(inspAct,"tabInspect","ตรวจสอบ",ICsearch)
    + tab(scr==="history","goReports","รายงาน",ICreport)
    + tab(scr==="data","goData","โปรไฟล์",ICuser);
  // ปุ่มลอย (FAB) ตามหน้า
  if(fab){
    var fa = scr==="home" ? {a:"newProject",t:"สร้างโครงการใหม่"} : (scr==="floors" ? {a:"addFloorFab",t:"เพิ่มชั้น"} : null);
    if(fa){ fab.style.display="grid"; fab.setAttribute("data-act",fa.a); fab.title=fa.t;
      fab.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'; }
    else fab.style.display="none";
  }
}

/** ผูก event ของอินพุตที่ต้องฟังค่าแบบต่อเนื่อง (ปุ่มใช้ event delegation แยกต่างหาก) */
function bindScreen(){
  if(state.screen==="members"){
    var q=$("#q");
    if(q) q.addEventListener("input",function(){ state.q=q.value; rerenderKeepFocus("#q"); });
  }
  if(state.screen==="history"){
    var qh=$("#qh");
    if(qh) qh.addEventListener("input",function(){ state.qh=qh.value; rerenderKeepFocus("#qh"); });
  }
  if(state.screen==="detail"){
    bindInspectionInputs();
  }
  if(state.screen==="memberDetail"){
    bindDetailEditor();
  }
  if(state.screen==="planEditor"){
    bindPlanEditor();
  }
  if(state.screen==="progress"){
    bindPlanEditor();
  }
  if(state.screen==="memberForm"){
    $$("#app input, #app select, #app textarea").forEach(function(el){
      el.addEventListener("input",updatePreview);
      el.addEventListener("change",updatePreview);
    });
    updatePreview();
  }
  if(state.screen==="data"){
    var fi=$("#fileImport");
    if(fi) fi.addEventListener("change",function(e){
      if(e.target.files && e.target.files[0]) importData(e.target.files[0]);
      e.target.value="";
    });
  }
}
/** เรนเดอร์ใหม่แล้วคืนโฟกัสให้ช่องค้นหา (กันเคอร์เซอร์กระโดดตอนพิมพ์) */
function rerenderKeepFocus(sel){
  var el=$(sel), pos=el?el.selectionStart:null;
  render();
  var e2=$(sel);
  if(e2){ e2.focus(); try{ if(pos!=null) e2.setSelectionRange(pos,pos); }catch(x){} }
}

/* ---------------------------------------------------------------------------
   9) เหตุการณ์ (event delegation) — ปุ่มทั้งหมดใช้ data-act
   ------------------------------------------------------------------------ */
document.addEventListener("click",function(e){
  var el=e.target.closest("[data-act]");
  if(!el) return;
  var act=el.getAttribute("data-act"), id=el.getAttribute("data-id");

  switch(act){
    /* --- นำทาง --- */
    case "openProject": go("floors",{projectId:id, floorId:null, q:"", typeFilter:"all"}); break;
    case "goHome":      navigate("home"); break;
    case "goProjects":  navigate("home"); break;
    case "goProgress": {   // อัพเดทความคืบหน้า — ใช้ชั้นที่เปิดอยู่ (ถ้าไม่มีใช้ชั้นแรกของโครงการ)
      var _pf=getFloor(state.floorId);
      if(!_pf){ var _pp=getProject(state.projectId)||(DB.projects||[])[0]; if(_pp){ _pf=floorsOf(_pp.id)[0]; } }
      if(!_pf){ toast("ยังไม่มีชั้น/แปลนให้อัพเดท — สร้างโครงการและชั้นก่อน",true); navigate("home"); break; }
      go("progress",{projectId:_pf.projectId, floorId:_pf.id, tool:"select", selZoneId:null,
                     floatProgressOpen:true, showProgress:true, zoom:1, panX:0, panY:0});
      break;
    }
    case "tabInspect":  { var _pj=(DB.projects||[])[0]; if(_pj) go("floors",{projectId:_pj.id, floorId:null, q:"", typeFilter:"all"}); else navigate("home"); break; }
    case "addFloorFab": dlgFloor(null); break;
    case "goData":      navigate("data"); break;
    case "goReports":   if((DB.projects||[]).length){ go("history",{projectId:DB.projects[0].id, qh:""}); } else { navigate("home"); } break;
    case "theme":       toggleTheme(); break;
    case "authLogin":   doAuth(false); break;
    case "authSignup":  doAuth(true); break;
    case "authToggle":  state._authMode=(state._authMode==="signup"?"login":"signup"); renderLogin(); break;
    case "logout":      if(confirm("ออกจากระบบ?")){ try{ fbAuth.signOut(); }catch(e){} } break;
    case "openFloor":   go("categories",{floorId:id, q:"", typeFilter:"all"}); break;
    case "openCategory":
      go("planEditor",{catType:el.getAttribute("data-type"), unified:false, selMemberId:null,
                       tool:"select", rightTab:"palette", answers:{}, photos:[], note:"",
                       zoom:1, panX:0, panY:0});
      break;
    case "openUnified": {   // เปิดแปลนรวม — วาด/ตรวจทุกชนิดในแปลนเดียว
      var f0=getFloor(state.floorId), ms=f0?membersOfFloor(f0.id):[];
      var firstType=(ms[0]&&ms[0].type)||"beam";
      go("planEditor",{catType:firstType, unified:true, hiddenTypes:{}, selMemberId:null,
                       tool:"select", rightTab:"palette", answers:{}, photos:[], note:"",
                       zoom:1, panX:0, panY:0});
      break;
    }
    case "openMember":
      go("detail",{memberId:id, answers:{}, photos:[], note:""});   // เริ่มเช็คลิสต์ใหม่ทุกครั้ง
      break;
    case "history":     go("history",{qh:""}); break;
    case "filterType":  state.typeFilter=el.getAttribute("data-type"); render(); break;

    /* --- เอดิเตอร์แปลน --- */
    case "setTool":     state.tool=el.getAttribute("data-tool"); render(); break;
    case "setShape":    state.tool="draw"; state.drawShape=el.getAttribute("data-shape"); render(); break;
    case "setPlanMode": state.unified=(el.getAttribute("data-mode")==="unified"); render(); break;
    case "setDrawType": {   // เลือกชนิดที่จะวาด/โฟกัส (โหมดรวม) — เปิดเลเยอร์นั้นให้เห็นด้วย
      var dt=el.getAttribute("data-type"); state.catType=dt; if(state.hiddenTypes) delete state.hiddenTypes[dt];
      render(); break;
    }
    case "toggleLayer": {   // เปิด/ปิดเลเยอร์ตามชนิด (โหมดรวม)
      var lt=el.getAttribute("data-type"); if(!state.hiddenTypes) state.hiddenTypes={};
      state.hiddenTypes[lt]=!state.hiddenTypes[lt];
      var sm=getMember(state.selMemberId); if(sm && state.hiddenTypes[sm.type]) state.selMemberId=null;   // ซ่อนตัวที่เลือก → เลิกเลือก
      render(); break;
    }
    case "setRightTab": state.rightTab=el.getAttribute("data-tab"); render(); break;
    case "setRibbonTab": state.ribbonTab=el.getAttribute("data-rtab"); render(); break;
    case "toggleSnap":   state.snap=!state.snap; render(); break;
    case "toggleLabels": state.showLabels=!state.showLabels; render(); break;
    case "selectPlanMember":
      state.selMemberId=id; state.rightTab="inspect"; state.answers={}; state.photos=[]; state.note="";
      render();
      break;
    case "toggleHide": {
      var hm=getMember(id);
      if(hm){ hm.hidden=!hm.hidden; saveDB();
        if(hm.hidden && state.selMemberId===id) state.selMemberId=null;
        render(); toast(hm.hidden?"ซ่อน "+hm.code+" บนแปลนแล้ว":"แสดง "+hm.code+" แล้ว"); }
      break;
    }
    case "dupMember": {
      var src=getMember(id);
      if(src){
        var cp=JSON.parse(JSON.stringify(src));
        cp.id=uid("m"); cp.hidden=false;
        if(cp.plan){                                  // ขยับตำแหน่งเล็กน้อยไม่ให้ทับตัวเดิม
          var off=0.03;
          if(cp.plan.kind==="point"){ cp.plan.x=Math.min(1,(cp.plan.x||0.5)+off); cp.plan.y=Math.min(1,(cp.plan.y||0.5)+off); }
          else if(cp.plan.x1!=null){ cp.plan.x1+=off; cp.plan.x2+=off; cp.plan.y1+=off; cp.plan.y2+=off;
            ["x1","x2","y1","y2"].forEach(function(k){ cp.plan[k]=Math.max(0,Math.min(1,cp.plan[k])); }); }
        }
        DB.members.push(cp);
        if(!saveDB()){ DB.members.pop(); return; }
        state.selMemberId=cp.id;
        render(); toast("ก๊อป "+src.code+" แล้ว — ลากย้ายไปตำแหน่งใหม่ได้เลย");
      }
      break;
    }
    case "editListMember": {
      var lm=getMember(id);
      if(lm){ state.selMemberId=id; go("detail",{memberId:lm.id, answers:{}, photos:[], note:""}); }   // แตะรายการ → ไปหน้าตรวจเหล็ก
      break;
    }
    case "showDetails": {
      var dm=getMember(state.selMemberId);
      if(!dm){ toast("แตะที่คานในแปลน (หรือเลือกจากรายการ) ก่อน แล้วกดรายละเอียด",true); break; }
      state.memberId=dm.id;
      go("memberDetail");        // เปลี่ยนเป็นหน้าจอรายละเอียดเต็ม (ไม่ใช่ป็อปอัปทับแปลน)
      break;
    }
    case "goInspect": {
      var im=getMember(activeMemberId());
      if(im){ state.selMemberId=im.id; state.rpCollapsed=false; go("planEditor",{rightTab:"inspect"}); }
      break;
    }
    case "colorMode":   state.colorMode=el.getAttribute("data-mode"); render(); break;
    case "toggleLabels":state.showLabels=!state.showLabels; render(); break;
    case "zoomIn": case "zoomOut": {
      var st=$("#planStage"); if(st){ var r=st.getBoundingClientRect();
        planZoomBy(act==="zoomIn"?1.35:1/1.35, r.width/2, r.height/2); }
      break;
    }
    case "zoomFit": planFit(); break;
    case "toggleRp": state.rpCollapsed=!state.rpCollapsed; render(); break;
    case "hideFloatTools": state.floatToolsHidden=true; render(); break;
    case "showFloatTools": state.floatToolsHidden=false; render(); break;
    case "toggleFloatStyle": state.floatStyleOpen=!state.floatStyleOpen; render(); break;
    case "closeFloatStyle": state.floatStyleOpen=false; render(); break;
    case "toggleProgress": state.showProgress=!state.showProgress; render(); break;
    case "toggleProgressPanel": state.floatProgressOpen=!state.floatProgressOpen; render(); break;
    case "closeProgressPanel": state.floatProgressOpen=false; render(); break;
    case "drawZoneStart": { var _zs=el.getAttribute("data-shape"); if(_zs) state.zoneShape=_zs; state.tool="drawZone"; state.floatProgressOpen=true; render(); break; }
    case "manageZoneStatus": dlgZoneStatus(); break;
    case "zsAddStatus": zsAddStatus(); break;
    case "zsDelStatus": zsDelStatus(el.getAttribute("data-sid")); break;
    case "zsSaveStatus": zsSaveStatus(); break;
    case "selectZone": state.selZoneId=el.getAttribute("data-zid"); state.floatProgressOpen=true; render(); break;
    case "deleteZone": {
      var zid=el.getAttribute("data-zid")||state.selZoneId;
      if(zid && confirm("ลบโซนนี้?")){ DB.zones=DB.zones.filter(function(z){return z.id!==zid;}); state.selZoneId=null; saveDB(); render(); }
      break;
    }
    case "exportProgressPdf": exportProgressPDF(); break;
    case "exportPdf": exportPlanPDF(); break;
    case "addPlan": {          // เพิ่มแปลนใหม่ → ตั้ง active เป็น id ใหม่ แล้วเปิดหน้าต่างเลือกไฟล์
      var fA=getFloor(state.floorId); if(!fA.planList) fA.planList=[];
      fA.activePlanId="pl"+Date.now();     // id ใหม่ (ยังไม่ push จนกว่าจะนำเข้าสำเร็จใน storePlan)
      state.zoom=1; state.panX=0; state.panY=0;
      var pfA=$("#planFile"); if(pfA) pfA.click();
      break;
    }
    case "switchPlan": {       // สลับไปแปลนที่เลือก
      var fS=getFloor(state.floorId); fS.activePlanId=el.getAttribute("data-pid");
      state.zoom=1; state.panX=0; state.panY=0; state.selMemberId=null;
      saveDB(); render(); break;
    }
    case "removePlan": {
      var fl=getFloor(state.floorId); var arr=fl?(fl.planList||[]):[];
      var cur=getFloorPlan(fl); if(!cur){ toast("ยังไม่มีแปลน",true); break; }
      if(confirm("ลบ “"+(cur.name||"แปลนนี้")+"”? (เบอร์ที่วาดไว้ยังอยู่)")){
        var pk=planSourceKey();
        ["url","deepUrl","detailUrl","bigUrl"].forEach(function(k){ try{ if(PLAN_DOCS[pk]&&PLAN_DOCS[pk][k]) URL.revokeObjectURL(PLAN_DOCS[pk][k]); }catch(e){} });
        delete PLAN_DOCS[pk]; idbDel(pk); cloudDeletePlan(pk);   // ลบออกจากคลาวด์ด้วย
        fl.planList=arr.filter(function(p){return p.id!==cur.id;});
        fl.activePlanId=fl.planList.length?fl.planList[0].id:null;
        state.zoom=1; state.panX=0; state.panY=0;
        saveDB(); render(); toast("ลบแปลนแล้ว");
      }
      break;
    }
    case "addInCat":
      state._formSeed=null;
      go("memberForm",{addType:state.catType, editId:null});
      break;

    /* --- โครงการ / ชั้น --- */
    case "newProject":  dlgProject(null); break;
    case "editProject": dlgProject(id); break;
    case "newFloor":    dlgFloor(null); break;
    case "editFloor":   dlgFloor(id); break;
    case "dlgSaveProject": dlgSaveProject(id); break;
    case "dlgDelProject":  dlgDelProject(id); break;
    case "dlgSaveFloor":   dlgSaveFloor(id); break;
    case "dlgDelFloor":    dlgDelFloor(id); break;
    case "closeSheet":     closeSheet(); break;

    /* --- ชิ้นส่วน --- */
    case "newMember":  go("pickType",{editId:null}); break;
    case "pickType":   go("memberForm",{addType:el.getAttribute("data-type"), editId:null}); break;
    case "editMember": {
      var em=getMember(activeMemberId());
      if(em){ closeSheet(); go("memberForm",{addType:em.type, editId:em.id}); }
      break;
    }
    case "saveMember": saveMemberForm(false); break;
    case "saveMemberNew": saveMemberForm(true); break;
    /* --- เหล็กเสริมหัวเสา (มาร์ค T/B) --- */
    case "addCie": {     // เพิ่มปลอกในอีก 1 วง (เริ่มที่แถวกลาง) — เก็บค่าที่แก้ไว้ก่อน
      state._formCie=readCieInputs();
      state._formCie.push(cieRowMid(curNy()));
      renderCieBox(); toast("เพิ่มปลอกในแล้ว");
      break;
    }
    case "removeCie": {  // ลบปลอกในวงที่ระบุ
      var ci=+el.getAttribute("data-i");
      state._formCie=readCieInputs(); state._formCie.splice(ci,1);
      renderCieBox(); break;
    }
    case "addCix": {     // เพิ่มปลอกในขวางอีก 1 วง (เริ่มที่สดมภ์กลาง)
      state._formCix=readCixInputs();
      state._formCix.push(cixColMid(curNx()));
      renderCixBox(); toast("เพิ่มปลอกในขวางแล้ว");
      break;
    }
    case "removeCix": {  // ลบปลอกในขวางวงที่ระบุ
      var cxi=+el.getAttribute("data-i");
      state._formCix=readCixInputs(); state._formCix.splice(cxi,1);
      renderCixBox(); break;
    }
    case "addHeadMark":  state._markCtx="pick"; openSheet(markPickerSheet()); break;
    case "manageMarks":  state._markCtx="manage"; openSheet(markManageSheet()); break;
    case "pickHeadMark": {
      var pid=el.getAttribute("data-id"); if(!state._formMarks) state._formMarks=[];
      if(state._formMarks.indexOf(pid)<0) state._formMarks.push(pid);
      closeSheet(); renderHeadMarksBox(); toast("เพิ่มเบอร์แล้ว");
      break;
    }
    case "removeHeadMark": {
      var rid=el.getAttribute("data-id"); state._formMarks=(state._formMarks||[]).filter(function(x){return x!==rid;});
      renderHeadMarksBox(); break;
    }
    case "newMark":  openSheet(markFormSheet(null)); break;
    case "editMark": openSheet(markFormSheet(getHeadMark(el.getAttribute("data-id")))); break;
    case "delMark": {
      var did=el.getAttribute("data-id");
      if(confirm("ลบเบอร์นี้ออกจากตาราง? (จะถูกเอาออกจากเสาที่ใช้อยู่ด้วย)")){
        deleteHeadMark(did); state._formMarks=(state._formMarks||[]).filter(function(x){return x!==did;});
        openSheet(state._markCtx==="manage"?markManageSheet():markPickerSheet()); renderHeadMarksBox();
      }
      break;
    }
    case "closeMarkForm": openSheet(state._markCtx==="manage"?markManageSheet():markPickerSheet()); break;
    case "saveMarkForm": {
      var nm=($("#mk_name")||{}).value; nm=(nm||"").trim();
      if(!nm){ toast("ใส่ชื่อเบอร์ก่อน เช่น T36",true); break; }
      var eid=($("#mk_id")||{}).value||"";
      var mk={ id:eid||uid("mk"), name:nm, side:($("#mk_side")||{}).value||"T",
        n:num(($("#mk_n")||{}).value,0), d:num(($("#mk_d")||{}).value,16),
        sp:num(($("#mk_sp")||{}).value,0), len:num(($("#mk_len")||{}).value,0), floor:(($("#mk_floor")||{}).value||"").trim() };
      saveHeadMark(mk);
      if(state._markCtx==="pick" && !eid){ if(!state._formMarks) state._formMarks=[]; if(state._formMarks.indexOf(mk.id)<0) state._formMarks.push(mk.id); }
      openSheet(state._markCtx==="manage"?markManageSheet():markPickerSheet());
      renderHeadMarksBox(); toast("บันทึกเบอร์ “"+nm+"” แล้ว");
      break;
    }
    case "goBack": back(); break;
    case "prevStn":    state.previewStation=el.getAttribute("data-stn"); updatePreview(); break;
    case "formStn":
      state.formStation=el.getAttribute("data-stn");
      state.previewStation=state.formStation;
      $$("[data-fstn]").forEach(function(b){ b.hidden = b.getAttribute("data-fstn")!==state.formStation; });
      $$(".stn-ftab").forEach(function(t){ t.classList.toggle("act", t.getAttribute("data-stn")===state.formStation); });
      updatePreview();
      break;
    case "copyStn":    copyStationToOthers(); break;
    /* --- เทมเพลต Assign --- */
    case "saveTpl": {
      var mm=readMemberForm();
      var nm=window.prompt("ตั้งชื่อเทมเพลต:", shortSpec(mm)||((TYPES[mm.type]&&TYPES[mm.type].label)||"เทมเพลต"));
      if(nm===null) break; nm=nm.trim()||("เทมเพลต "+(templatesForType(mm.type).length+1));
      var arr=allTemplates(); arr.push({id:uid("tpl"), type:mm.type, name:nm, data:memberSpecData(mm)});
      if(saveTemplates(arr)){ toast("บันทึกเทมเพลต “"+nm+"” แล้ว"); render(); }
      break;
    }
    case "assignTpl": {
      var tid=el.getAttribute("data-tid"), tp=allTemplates().filter(function(x){return x.id===tid;})[0];
      if(tp){ _assignData=tp.data; render(); toast("ใส่ค่าจากเทมเพลต “"+tp.name+"” แล้ว"); }
      break;
    }
    case "delTpl": {
      var tid2=el.getAttribute("data-tid");
      if(confirm("ลบเทมเพลตนี้?")){ saveTemplates(allTemplates().filter(function(x){return x.id!==tid2;})); render(); }
      break;
    }
    case "assignToSel": {   // Assign เทมเพลตให้ชิ้นส่วนที่เลือกบนแปลน (ไฮไลท์แล้ว Assign)
      var sm2=getMember(state.selMemberId), tp2=allTemplates().filter(function(x){return x.id===el.getAttribute("data-tid");})[0];
      if(sm2 && tp2){
        if((tp2.type||"beam")!==sm2.type){ toast("เทมเพลตนี้คนละประเภทกับชิ้นส่วนที่เลือก",true); break; }
        applyTplToMember(sm2, tp2.data); saveDB(); closeSheet(); render(); toast("Assign “"+tp2.name+"” ให้ "+sm2.code+" แล้ว");
      }
      break;
    }
    case "assignSheet": {   // เปิดรายการเทมเพลตเพื่อ Assign ให้ชิ้นส่วนที่เลือก (เฉพาะประเภทเดียวกัน)
      var sm3=getMember(state.selMemberId); if(!sm3){ toast("เลือกชิ้นส่วนก่อน",true); break; }
      var tl3=(TYPES[sm3.type]&&TYPES[sm3.type].label)||"ชิ้นส่วน", tpls3=templatesForType(sm3.type);
      var hb=tpls3.length ? tpls3.map(function(tp){ return '<button class="row-item" data-act="assignToSel" data-tid="'+esc(tp.id)+'"><span class="sw-dot" style="background:'+esc((tp.data&&tp.data.fill)||"#f59e0b")+'"></span><div class="body"><div class="t1">'+esc(tp.name)+'</div></div></button>'; }).join("") : '<div class="empty small">ยังไม่มีเทมเพลต'+esc(tl3)+' — เปิดฟอร์มแก้ไข'+esc(tl3)+'แล้วกด “บันทึกเป็นเทมเพลต”</div>';
      openSheet('<h3>Assign เทมเพลตให้ '+esc(sm3.code)+'</h3>'+hb);
      break;
    }
    case "toggleLegend": state.showLegend=!state.showLegend; render(); break;
    case "toggleSnap": {
      state.snap=!state.snap;
      var doc=PLAN_DOCS[planSourceKey()];
      toast(state.snap ? (doc&&doc.snapIdx?"เปิดสแนบ — ดูดเข้าเส้น/จุดตัดของแปลน":"เปิดสแนบแล้ว (แปลนนี้ยังไม่มีเส้นเวกเตอร์ให้ดูด)") : "ปิดสแนบ");
      render(); break;
    }
    case "delMember": {
      var m=getMember(activeMemberId());
      if(m && confirm('ลบชิ้นส่วน "'+(m.name||m.code)+'" และประวัติการตรวจของชิ้นส่วนนี้?')){
        DB.members=DB.members.filter(function(x){ return x.id!==m.id; });
        DB.inspections=DB.inspections.filter(function(x){ return x.memberId!==m.id; });
        saveDB(); closeSheet();
        var toPlan = (state.screen==="planEditor" || state.screen==="memberDetail");
        state.memberId=null; state.selMemberId=null;
        navigate(toPlan ? "planEditor" : "categories");
        toast("ลบชิ้นส่วนแล้ว");
      }
      break;
    }

    /* --- เช็คลิสต์ / ผลตรวจ --- */
    case "chk": {
      var wrap=el.closest(".chk");
      // ตั้งค่าเสมอ ไม่ยกเลิกเมื่อกดซ้ำ — กันช่างเผลอแตะซ้ำแล้วคำตอบหายโดยไม่รู้ตัว
      state.answers[wrap.getAttribute("data-chk")]=el.getAttribute("data-v");
      refreshChecklistUI();
      break;
    }
    case "addCheck": {
      var cm=getMember(activeMemberId()); if(!cm) break;
      var txt=window.prompt("เพิ่มรายการตรวจ (พิมพ์สิ่งที่ต้องตรวจ):",""); if(txt===null) break;
      txt=txt.trim(); if(!txt) break;
      if(!Array.isArray(cm.checks)) cm.checks=[];
      cm.checks.push({id:uid("chk"), t:txt}); saveDB(); render();
      break;
    }
    case "delCheck": {
      var cm2=getMember(activeMemberId()); if(!cm2||!cm2.checks) break;
      cm2.checks=cm2.checks.filter(function(c){ return c.id!==id; });
      if(state.answers) delete state.answers[id];
      saveDB(); render();
      break;
    }
    case "confirmIns": confirmInspection(); break;
    case "delIns":
      if(confirm("ลบประวัติการตรวจรายการนี้?")){
        DB.inspections=DB.inspections.filter(function(x){ return x.id!==id; });
        saveDB(); render();
      }
      break;

    /* --- ข้อมูล --- */
    case "export": exportData(); break;
    case "reset":
      if(confirm("ล้างข้อมูลทั้งหมดในเครื่องนี้ แล้วโหลดข้อมูลตัวอย่างใหม่?")){
        DB=seedData(); saveDB();
        PLAN_DOCS={}; idbClear();   // ล้างต้นฉบับแปลนใน IndexedDB ด้วย
        state.projectId=null; state.floorId=null; state.memberId=null;
        navigate("home"); toast("รีเซ็ตข้อมูลแล้ว");
      }
      break;
  }
});

/* คลิกรูปในประวัติเพื่อดูเต็มจอ */
document.addEventListener("click",function(e){
  if(e.target.tagName==="IMG" && e.target.closest(".hist")) openLightbox(e.target.src);
});

function openLightbox(src){ $("#lbImg").src=src; $("#lightbox").classList.add("open"); }

/* ============================================================================
   11) เอดิเตอร์แปลน — นำเข้าแปลน + วาดชิ้นส่วนทับ + พาเนลตรวจ 3 แท็บ
   ========================================================================== */

/** ชนิดการวาดของแต่ละประเภท: line=คาน/ผนัง/บันได, point=เสา/ฐานราก, rect=พื้น/PT */
function drawKind(type){
  return "rect";   // ทุกชิ้นส่วนวาดเป็นกรอบ (Rectangle/Polygon/Oval) + เครื่องมือ/สไตล์/สี เหมือนคาน
}
/** รูปทรงแบบกรอบ (มี bbox x1,y1,x2,y2 + rot) — สี่เหลี่ยม/วงรี/รูปหลายเหลี่ยม ใช้จุดจับชุดเดียวกัน */
function isBox(pl){ return !!pl && (pl.kind==="rect"||pl.kind==="oval"||pl.kind==="poly"); }
/** สีของชิ้นส่วนบนแปลน: ตามสถานะการตรวจ หรือสีประจำประเภท */
function planColor(m){
  if(state.colorMode==="plain") return "var(--t-"+TYPES[m.type].css+")";
  var ins=lastInspection(m.id);
  if(!ins) return "var(--text-dim)";
  return ins.status==="pass" ? "var(--pass)" : "var(--fail)";
}
/** สัดส่วนรูปแปลน (สูง/กว้าง) — ใช้ตั้ง aspect ของ stage และ viewBox */
function planRatio(plan){
  if(plan && plan.w && plan.h) return plan.h/plan.w;
  return 0.72;   // ค่าเริ่มต้นเมื่อยังไม่มีรูป (โทนแนวนอน)
}

/* ---------------------------------------------------------------------------
   รูปด้านคานต่อเนื่อง (TYPICAL CONTINUOUS BEAM) — สไตล์ shop drawing โทนน้ำเงิน
   รูปมาตรฐาน วาดครบ 4 โซนเสมอ: EXTERIOR SUPPORT · MID. SPAN · INTERIOR SUPPORT · CANTILEVER
   (เป็นรูป typical ไม่ผูกกับสถานีที่เปิด — หน้าตัดจริงอยู่การ์ดถัดลงไป)
   ------------------------------------------------------------------------ */
function drawBeamContinuous(m){
  var B="var(--brand)";
  var W=980, H=312;
  var yT=166, bh=56, yB=yT+bh, colB=yB+42, midY=(yT+yB)/2;
  var xExt=132, xInt=520, xMid=(xExt+xInt)/2, xCanS=792, xTip=912, xMid2=(xInt+xCanS)/2;
  var xBeamL=xExt-18, xBeamR=xTip;
  var sups=[xExt,xInt,xCanS];
  var g='<defs><pattern id="hbC" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="'+B+'" stroke-width="0.7"/></pattern></defs>';
  function dimb(a,b2,y,label,both){
    var s='<line x1="'+a+'" y1="'+y+'" x2="'+b2+'" y2="'+y+'" stroke="'+B+'" stroke-width="0.8" style="color:'+B+'" '
      +(both===false?'':'marker-start="url(#ar)" ')+'marker-end="url(#ar)"/>';
    if(label) s+='<text x="'+((a+b2)/2)+'" y="'+(y-4)+'" text-anchor="middle" fill="'+B+'" font-size="10">'+esc(label)+'</text>';
    return s;
  }
  // ---- grid CL + เสา (hatch) ----
  sups.forEach(function(cx){
    g+='<line x1="'+cx+'" y1="52" x2="'+cx+'" y2="'+yT+'" stroke="'+B+'" stroke-width="0.7" stroke-dasharray="5 4"/>';
    g+='<circle cx="'+cx+'" cy="32" r="15" fill="var(--surface,#fff)" stroke="'+B+'" stroke-width="1"/>';
    g+='<text x="'+cx+'" y="36" text-anchor="middle" fill="'+B+'" font-size="11">CL.</text>';
    g+='<rect x="'+(cx-12)+'" y="'+yT+'" width="24" height="'+(colB-yT)+'" fill="url(#hbC)" stroke="'+B+'" stroke-width="1"/>';
  });
  // ---- คอนกรีตคาน (พื้นขาว + ขอบ; ปลายขวา = ปลายคานยื่นอิสระ) ----
  g+='<rect x="'+xBeamL+'" y="'+yT+'" width="'+(xBeamR-xBeamL)+'" height="'+bh+'" fill="var(--surface,#fff)" stroke="none"/>';
  g+='<line x1="'+xBeamL+'" y1="'+yT+'" x2="'+xBeamR+'" y2="'+yT+'" stroke="'+B+'" stroke-width="1.4"/>';
  g+='<line x1="'+xBeamL+'" y1="'+yB+'" x2="'+xBeamR+'" y2="'+yB+'" stroke="'+B+'" stroke-width="1.4"/>';
  g+='<line x1="'+xBeamL+'" y1="'+yT+'" x2="'+xBeamL+'" y2="'+yB+'" stroke="'+B+'" stroke-width="1.4"/>';
  g+='<line x1="'+xBeamR+'" y1="'+yT+'" x2="'+xBeamR+'" y2="'+yB+'" stroke="'+B+'" stroke-width="1.4"/>';
  // ---- ปลอก (stirrup) ถี่ที่รองรับ · ห่างที่กลาง ----
  function stir(x,faint){ return '<line x1="'+x+'" y1="'+(yT+4)+'" x2="'+x+'" y2="'+(yB-4)+'" stroke="'+B+'" stroke-width="0.7"'+(faint?' opacity="0.45"':'')+'/>'; }
  sups.forEach(function(cx){ [16,32,48].forEach(function(o){ g+=stir(cx-o)+stir(cx+o); }); });
  [xMid, xMid2].forEach(function(cx){ [-40,0,40].forEach(function(o){ g+=stir(cx+o,true); }); });
  // ---- เหล็กหลัก (บน/ล่าง ต่อเนื่อง) + extra (วาดครบทุกโซน) ----
  var yTop=yT+13, yTx=yT+20, yBot=yB-13, yBx=yB-20;
  g+='<line x1="'+(xBeamL+6)+'" y1="'+yTop+'" x2="'+(xBeamR-6)+'" y2="'+yTop+'" stroke="'+B+'" stroke-width="2.2"/>';
  g+='<line x1="'+(xBeamL+6)+'" y1="'+yBot+'" x2="'+(xBeamR-6)+'" y2="'+yBot+'" stroke="'+B+'" stroke-width="2.2"/>';
  g+='<line x1="'+(xBeamL+6)+'" y1="'+yTx+'" x2="'+(xExt+80)+'" y2="'+yTx+'" stroke="'+B+'" stroke-width="2.2"/>';
  g+='<line x1="'+(xInt-100)+'" y1="'+yTx+'" x2="'+(xInt+100)+'" y2="'+yTx+'" stroke="'+B+'" stroke-width="2.2"/>';
  g+='<line x1="'+(xCanS-70)+'" y1="'+yTx+'" x2="'+(xBeamR-6)+'" y2="'+yTx+'" stroke="'+B+'" stroke-width="2.2"/>';
  g+='<line x1="'+(xExt+60)+'" y1="'+yBx+'" x2="'+(xInt-60)+'" y2="'+yBx+'" stroke="'+B+'" stroke-width="2.2"/>';
  g+='<line x1="'+(xInt+60)+'" y1="'+yBx+'" x2="'+(xCanS-60)+'" y2="'+yBx+'" stroke="'+B+'" stroke-width="2.2"/>';
  // ---- STIRRUP text ----
  g+='<text x="'+xMid+'" y="'+(midY+3)+'" text-anchor="middle" fill="'+B+'" font-size="9">STIRRUP</text>';
  g+='<text x="'+xMid2+'" y="'+(midY+3)+'" text-anchor="middle" fill="'+B+'" font-size="9">STIRRUP</text>';
  // ---- โซน + section marker (ครบ 4 เสมอ) ----
  var zones=[{n:1,x:xExt,name:"EXTERIOR SUPPORT"},{n:2,x:xMid,name:"MID. SPAN"},
             {n:3,x:xInt,name:"INTERIOR SUPPORT"},{n:4,x:(xCanS+xTip)/2,name:"CANTILEVER"}];
  zones.forEach(function(z){
    g+='<text x="'+z.x+'" y="124" text-anchor="middle" fill="'+B+'" font-size="10" font-weight="700">'+z.name+'</text>';
    g+='<circle cx="'+z.x+'" cy="146" r="13" fill="var(--surface,#fff)" stroke="'+B+'" stroke-width="1.1"/>';
    g+='<text x="'+z.x+'" y="150" text-anchor="middle" fill="'+B+'" font-size="11" font-weight="700">'+z.n+'</text>';
    g+='<line x1="'+z.x+'" y1="159" x2="'+z.x+'" y2="'+yT+'" stroke="'+B+'" stroke-width="0.8"/>';
  });
  // ---- ระยะ ----
  g+=dimb(xExt,xInt,72,"L₁");
  g+=dimb(xInt,xCanS,72,"L₂");
  g+=dimb(xCanS,xTip,72,"Lc");
  g+='<text x="'+xInt+'" y="90" text-anchor="middle" fill="'+B+'" font-size="8.5">LENGTH OF EXTRA REINF. (บน)</text>';
  g+=dimb(xInt-100,xInt,112,"0.3L");
  g+=dimb(xInt,xInt+100,112,"0.3L");
  g+=dimb(xBeamL,xExt+80,112,"0.9L / 40Db");
  g+=dimb(xCanS,xBeamR,112,"0.9Lc / 40Db");
  g+=dimb(xInt-90,xInt,yB+28,"0.15L");
  g+=dimb(xInt,xInt+90,yB+28,"0.15L");
  // ---- DEPTH (ขวา) ----
  var xd=xBeamR+22;
  g+='<line x1="'+xd+'" y1="'+yT+'" x2="'+xd+'" y2="'+yB+'" stroke="'+B+'" stroke-width="0.8" style="color:'+B+'" marker-start="url(#ar)" marker-end="url(#ar)"/>';
  g+='<text x="'+(xd+11)+'" y="'+midY+'" text-anchor="middle" fill="'+B+'" font-size="10" transform="rotate(-90 '+(xd+11)+' '+midY+')">DEPTH</text>';
  // ---- ชื่อ ----
  g+='<text x="'+(W/2)+'" y="'+(H-8)+'" text-anchor="middle" fill="var(--text)" font-size="12" font-style="italic" font-weight="700">TYPICAL REINFORCEMENT FOR CONTINUOUS BEAM'+(m.code?" — "+esc(m.code):"")+'</text>';
  return { svg: wrapSvg(W,H,"รูปด้านคานต่อเนื่อง "+m.code,g) };
}

/* ---------------------------------------------------------------------------
   หน้าจอ: การ์ดหมวด (คลิกเข้าไปเปิดเอดิเตอร์แปลนของหมวดนั้น)
   ------------------------------------------------------------------------ */
function viewCategories(){
  var f=getFloor(state.floorId), p=getProject(state.projectId);
  if(!f||!p) return emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',"ไม่พบชั้น","");
  var all=membersOfFloor(f.id);

  var ss=summarize(all), pct=flPct(ss), lv=lvText(f.level);
  var col=ss.fail>0?'var(--fail)':((pct===100&&all.length)?'var(--pass)':'var(--warn)');
  var chips=TYPE_ORDER.map(function(t){ var n=all.filter(function(m){return m.type===t;}).length;
    return n?('<span class="cat2-chip"><i style="background:var(--t-'+TYPES[t].css+')"></i>'+esc(TYPES[t].label)+' '+n+'</span>'):''; }).join("");
  var h='<div class="cat2-context">'+esc(p.name)+(lv?' · ระดับ '+esc(lv):'')+'</div>';
  // ---- การ์ดหลัก: เปิดแปลนรวม ----
  h+='<button class="cat2-hero" data-act="openUnified">'
    +'<span class="cat2-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/></svg></span>'
    +'<span class="cat2-b"><span class="cat2-t">เปิดแปลนรวม</span>'
    +'<span class="cat2-d">วาดและตรวจทุกชนิดในแปลนเดียว</span>';
  if(all.length){
    h+='<span class="cat2-prog"><span class="fl-bar"><i style="width:'+Math.max(4,pct)+'%;background:'+col+'"></i></span><b style="color:'+col+'">ตรวจแล้ว '+(ss.total-ss.todo)+'/'+ss.total+'</b></span>';
    if(chips) h+='<span class="cat2-chips">'+chips+'</span>';
  }else{
    h+='<span class="cat2-d" style="color:var(--warn)">ยังไม่มีชิ้นส่วน — เปิดแปลนเพื่อเริ่มวาด</span>';
  }
  h+='</span><span class="cat2-go">เปิด ›</span></button>';
  // ---- ปุ่มรอง ----
  h+='<div class="fl-act" style="margin-top:14px">'
    +'<button class="fl-a" data-act="history"><span class="ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/></svg></span><span><b>ประวัติการตรวจ</b><small>ผลตรวจทั้งหมด</small></span></button>'
    +'<button class="fl-a" data-act="editFloor" data-id="'+esc(f.id)+'"><span class="ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></span><span><b>แก้ไข / ลบชั้น</b><small>เปลี่ยนชื่อหรือระดับ</small></span></button>'
    +'</div>';
  return h;
}

/* ---------------------------------------------------------------------------
   หน้าจอ: เอดิเตอร์แปลน (ซ้าย = แปลน+เครื่องมือวาด, ขวา = พาเนล 3 แท็บ)
   ------------------------------------------------------------------------ */
/** หมุนจุด (px,py) รอบจุดศูนย์ (cx,cy) เป็นองศา deg */
function rotPt(px,py,cx,cy,deg){
  var a=deg*Math.PI/180, c=Math.cos(a), s=Math.sin(a), dx=px-cx, dy=py-cy;
  return [cx+dx*c-dy*s, cy+dx*s+dy*c];
}
/** สร้าง SVG ของชิ้นส่วนทั้งหมดบนแปลน (รวมจุดจับ ลด/ขยาย/หมุน ของคานที่เลือก) */
/** โหมดของเวทีแปลน: "progress" = หน้าอัพเดทความคืบหน้า (โซน), อื่นๆ = หน้าแก้ไขแปลน (ชิ้นส่วนเหล็ก) */
function stageMode(){ return state.screen==="progress" ? "progress" : "inspect"; }
function planShapesSVG(VW,VH){
  var f=getFloor(state.floorId), type=state.catType;
  var _pid=curPlanId();
  var isProgress=stageMode()==="progress";
  var members=isProgress ? [] : membersOfFloor(f.id).filter(function(m){
    if(!m.plan || m.hidden) return false;
    if(memberPlanId(m)!==_pid) return false;   // แสดงเฉพาะชิ้นที่วาดบน "แปลนที่กำลังเปิด"
    return state.unified ? !state.hiddenTypes[m.type] : (m.type===type);   // รวม = ทุกชนิดที่ไม่ได้ซ่อน
  });
  var shapes="";
  // ── โซนความคืบหน้าเทคอนกรีต (แสดงเฉพาะหน้าอัพเดท) — ไฮไลท์สีสถานะล้วน ไม่มีกรอบ/ป้าย ──
  if(isProgress && state.showProgress){
    var zones=zonesOfPlan(f.id, _pid);
    zones.forEach(function(z){
      var zp=z.plan||{}, stObj=getZoneStatus(f.id,_pid,z.status), col=stObj.color;
      var zx=Math.min(zp.x1,zp.x2)*VW, zy=Math.min(zp.y1,zp.y2)*VH;
      var zw=Math.abs(zp.x2-zp.x1)*VW, zh=Math.abs(zp.y2-zp.y1)*VH;
      var isSel=(z.id===state.selZoneId);
      var fillOp=isSel?0.55:0.32;   // ไม่มีขอบเลย — ใช้ความเข้มของสีบอกว่าเลือกอยู่
      var cur=isSel?"move":"pointer";
      if(zp.kind==="poly" && zp.pts && zp.pts.length){
        var pstr=zp.pts.map(function(p){ return (zx+p[0]*zw).toFixed(1)+","+(zy+p[1]*zh).toFixed(1); }).join(" ");
        shapes+='<polygon data-zid="'+z.id+'" points="'+pstr+'" fill="'+col+'" fill-opacity="'+fillOp+'" stroke="none" style="cursor:'+cur+'"/>';
      }else{
        shapes+='<rect data-zid="'+z.id+'" x="'+zx+'" y="'+zy+'" width="'+zw+'" height="'+zh
          +'" rx="3" fill="'+col+'" fill-opacity="'+fillOp+'" stroke="none" style="cursor:'+cur+'"/>';
      }
      // ป้ายชื่อโซนเล็ก ๆ มุมซ้ายบน (มีขอบขาวให้อ่านง่ายบนแปลนที่ลายเยอะ) — ไม่มีป้ายสถานะกลางโซน
      var nm=(z.name||"")+(z.date?"  ·  "+z.date:"");
      if(nm) shapes+='<text x="'+(zx+7)+'" y="'+(zy+19)+'" font-size="15" font-weight="800" fill="'+col
        +'" stroke="var(--surface,#fff)" stroke-width="3.5" paint-order="stroke" font-family="system-ui,sans-serif" style="pointer-events:none">'+esc(nm)+'</text>';
      // จุดจับ 8 จุด (เฉพาะโซนที่เลือก) — ลากมุม/ขอบเพื่อย่อ-ขยาย (คงขนาดคงที่ด้วย updateLabelScale)
      if(isSel){
        var hx2=zx+zw, hy2=zy+zh;
        var zhs=[["nw",zx,zy],["ne",hx2,zy],["se",hx2,hy2],["sw",zx,hy2],
                 ["n",zx+zw/2,zy],["e",hx2,zy+zh/2],["s",zx+zw/2,hy2],["w",zx,zy+zh/2]];
        zhs.forEach(function(c){
          shapes+='<g class="plan-handle" data-ax="'+c[1].toFixed(1)+'" data-ay="'+c[2].toFixed(1)+'">'
            +'<circle data-zid="'+z.id+'" data-zhandle="'+c[0]+'" cx="'+c[1]+'" cy="'+c[2]+'" r="9" fill="var(--brand)" stroke="#fff" stroke-width="2.5" style="cursor:pointer"/></g>';
        });
      }
    });
  }
  members.forEach(function(m){
    var col=planColor(m), sel=(m.id===state.selMemberId), pl=m.plan;
    // โหมดรวม: ชนิดที่ไม่ได้กำลังวาด/เลือก ทำให้จางลงนิด เพื่อให้ชนิดที่โฟกัสเด่น (เลือกไว้ = เด่นเสมอ)
    var dim=(state.unified && !sel && state.catType && m.type!==state.catType);
    var sw=sel?16:11, op=sel?1:(dim?0.5:0.92);
    var lx, ly;   // จุดวางป้ายเบอร์
    if(pl.kind==="line"){
      if(sel) shapes+='<line x1="'+(pl.x1*VW)+'" y1="'+(pl.y1*VH)+'" x2="'+(pl.x2*VW)+'" y2="'+(pl.y2*VH)
        +'" stroke="var(--brand)" stroke-width="'+(sw+12)+'" stroke-linecap="round" opacity="0.25"/>';
      shapes+='<line data-mid="'+m.id+'" x1="'+(pl.x1*VW)+'" y1="'+(pl.y1*VH)+'" x2="'+(pl.x2*VW)+'" y2="'+(pl.y2*VH)
        +'" stroke="'+col+'" stroke-width="'+sw+'" stroke-linecap="round" opacity="'+op+'"/>';
      lx=(pl.x1+pl.x2)/2*VW; ly=(pl.y1+pl.y2)/2*VH;
    }else if(pl.kind==="rect"||pl.kind==="oval"||pl.kind==="poly"){
      var x=Math.min(pl.x1,pl.x2)*VW, y=Math.min(pl.y1,pl.y2)*VH,
          w=Math.abs(pl.x2-pl.x1)*VW, ht=Math.abs(pl.y2-pl.y1)*VH;
      var cxp=x+w/2, cyp=y+ht/2, rot=pl.rot||0, z=state.zoom||1;
      // โหมด "สถานะการตรวจ" → กรอบลงสีตามสถานะ (เขียว/แดง/เทา); โหมดอื่นใช้สีที่ตั้งเอง
      var fcol=(state.colorMode==="status") ? col : (pl.fill||col);
      var fa=(state.colorMode==="status") ? 0.32 : ((pl.fillA!=null)?pl.fillA:0.14);
      if(window.__exportFACap!=null) fa=Math.min(fa, window.__exportFACap);   // export: จำกัดความทึบ → เห็นแปลนทะลุ
      var bw=(pl.strokeW!=null)?pl.strokeW:10;
      var strokeAttr = bw>0 ? ' stroke="'+fcol+'" stroke-width="'+bw+'"' : ' stroke="none"';
      var mainEl;
      if(pl.kind==="oval"){
        mainEl='<ellipse data-mid="'+m.id+'" cx="'+cxp+'" cy="'+cyp+'" rx="'+(w/2)+'" ry="'+(ht/2)+'" fill="'+fcol+'" fill-opacity="'+fa+'"'+strokeAttr+'/>';
      }else if(pl.kind==="poly"){
        var pstr=(pl.pts||[]).map(function(p){ return (x+p[0]*w).toFixed(1)+","+(y+p[1]*ht).toFixed(1); }).join(" ");
        mainEl='<polygon data-mid="'+m.id+'" points="'+pstr+'" fill="'+fcol+'" fill-opacity="'+fa+'"'+strokeAttr+'/>';
      }else{
        mainEl='<rect data-mid="'+m.id+'" x="'+x+'" y="'+y+'" width="'+w+'" height="'+ht+'" fill="'+fcol+'" fill-opacity="'+fa+'"'+strokeAttr+'/>';
      }
      // กรอบ (หมุนรอบจุดศูนย์) — เส้นประเลือกคงความบางคงที่ด้วยการหาร zoom
      shapes+='<g transform="rotate('+rot+' '+cxp+' '+cyp+')"'+(dim?' opacity="0.5"':'')+'>'
        + mainEl
        +(sel?'<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+ht+'" fill="none" stroke="var(--brand)" stroke-width="'+(2/z)+'" stroke-dasharray="'+(6/z)+' '+(4/z)+'" style="pointer-events:none"/>':'')
        +'</g>';
      // จุดจับ ลด/ขยาย/หมุน (เฉพาะตอนเลือก) — คำนวณตำแหน่งมุมหลังหมุน (จุดจับคงขนาดคงที่ด้วย updateLabelScale)
      if(sel){
        // จุดจับ 8 จุด: 4 มุม (ลด/ขยายสองแกน) + 4 กลางขอบ (ยืดด้านเดียว)
        var hpts=[
          ["nw",x,y],["ne",x+w,y],["se",x+w,y+ht],["sw",x,y+ht],
          ["n",x+w/2,y],["e",x+w,y+ht/2],["s",x+w/2,y+ht],["w",x,y+ht/2]
        ];
        var rh=rotPt(cxp, y-40, cxp, cyp, rot);      // จุดจับหมุน (เหนือขอบบน)
        var topMid=rotPt(cxp, y, cxp, cyp, rot);
        shapes+='<line x1="'+topMid[0]+'" y1="'+topMid[1]+'" x2="'+rh[0]+'" y2="'+rh[1]+'" stroke="var(--brand)" stroke-width="'+(2/z)+'" style="pointer-events:none"/>';
        shapes+='<g class="plan-handle" data-ax="'+rh[0].toFixed(1)+'" data-ay="'+rh[1].toFixed(1)+'">'
          +'<circle data-mid="'+m.id+'" data-handle="rot" cx="'+rh[0]+'" cy="'+rh[1]+'" r="11" fill="var(--brand)" stroke="#fff" stroke-width="2.5"/></g>';
        hpts.forEach(function(c){
          var p=rotPt(c[1],c[2],cxp,cyp,rot);
          shapes+='<g class="plan-handle" data-ax="'+p[0].toFixed(1)+'" data-ay="'+p[1].toFixed(1)+'">'
            +'<circle data-mid="'+m.id+'" data-handle="'+c[0]+'" cx="'+p[0]+'" cy="'+p[1]+'" r="9" fill="var(--brand)" stroke="#fff" stroke-width="2.5"/></g>';
        });
      }
      lx=cxp; ly=cyp;
    }else{ // point
      var r=sel?42:34;
      if(sel) shapes+='<circle cx="'+(pl.x*VW)+'" cy="'+(pl.y*VH)+'" r="'+(r+16)+'" fill="var(--brand)" opacity="0.25"/>';
      shapes+='<circle data-mid="'+m.id+'" cx="'+(pl.x*VW)+'" cy="'+(pl.y*VH)+'" r="'+r+'" fill="'+col+'" stroke="#fff" stroke-width="6"/>';
      lx=pl.x*VW; ly=pl.y*VH;
    }
    if(state.showLabels){
      var labTxt=(pl.labelText!=null && pl.labelText!=="")?pl.labelText:m.code;
      var tw=Math.max(34, labTxt.length*15+18), th=34;
      var lcx=lx+(pl.labelDx||0)*VW, lcy=ly+(pl.labelDy||0)*VH, lsc=pl.labelScale||1;
      var moved=(pl.labelDx||0)!==0 || (pl.labelDy||0)!==0;
      // เส้นชี้จากกล่องเบอร์ → ตัวคาน (เมื่อย้ายกล่องออกไป)
      if(moved) shapes+='<line x1="'+lcx.toFixed(1)+'" y1="'+lcy.toFixed(1)+'" x2="'+lx.toFixed(1)+'" y2="'+ly.toFixed(1)+'" stroke="'+col+'" stroke-width="'+(1.5/(state.zoom||1))+'" stroke-dasharray="'+(5/(state.zoom||1))+' '+(4/(state.zoom||1))+'" style="pointer-events:none"/>';
      var g2='<g class="plan-label" data-lbl="'+m.id+'" data-ax="'+lcx.toFixed(1)+'" data-ay="'+lcy.toFixed(1)+'" data-ls="'+lsc+'" style="cursor:move">'
        +'<rect x="'+(lcx-tw/2)+'" y="'+(lcy-th/2)+'" width="'+tw+'" height="'+th+'" rx="7" fill="var(--surface)" stroke="'+col+'" stroke-width="2.5"/>'
        +'<text x="'+lcx+'" y="'+lcy+'" dominant-baseline="central" text-anchor="middle" font-size="22" font-weight="700" '
        +'fill="var(--text)" font-family="JetBrains Mono,monospace">'+esc(labTxt)+'</text>';
      if(sel) g2+='<circle data-lblsize="'+m.id+'" cx="'+(lcx+tw/2)+'" cy="'+(lcy+th/2)+'" r="7" fill="var(--brand)" stroke="#fff" stroke-width="2" style="cursor:nwse-resize"/>';
      shapes+=g2+'</g>';
    }
  });
  return shapes;
}

/** หน้าต่างเครื่องมือลอย — โผล่ตอนซ่อนพาเนล (จอเต็ม) เพื่อให้ยังวาดได้ ลากย้ายได้ */
function floatToolsHtml(){
  var type=state.catType; if(!type||!TYPES[type]) return "";
  var isD=function(sh){ return state.tool==="draw" && (state.drawShape||"rect")===sh; };
  var b=function(on,act,attr,svg,title){ return '<button class="ftl-b'+(on?" on":"")+'" data-act="'+act+'" '+attr+' title="'+title+'">'+svg+'</button>'; };
  var pos=state.floatToolsPos||{x:14,y:14};
  var ICsel='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 4 7 17 2.5-7.5L21 11Z"/></svg>';
  var ICrect='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="12" rx="1.5"/></svg>';
  var ICpoly='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 6-3 10H7L4 9z"/></svg>';
  var ICoval='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="9" ry="6"/></svg>';
  return '<div class="plan-floattools" id="floatTools" style="left:'+pos.x+'px;top:'+pos.y+'px">'
    + '<div class="ftl-head" id="floatToolsDrag"><svg class="ftl-grip" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>เครื่องมือวาด<button class="ftl-x" data-act="hideFloatTools" title="ซ่อน">✕</button></div>'
    + '<div class="ftl-body">'
    +   '<div class="ftl-row">'
    +     b(state.tool==="select","setTool",'data-tool="select"',ICsel,"เลือก/ย้าย")
    +     b(isD("rect"),"setShape",'data-shape="rect"',ICrect,"สี่เหลี่ยม")
    +     b(isD("poly"),"setShape",'data-shape="poly"',ICpoly,"หลายเหลี่ยม")
    +     b(isD("oval"),"setShape",'data-shape="oval"',ICoval,"วงรี")
    +   '</div>'
    +   '<div class="sel-wrap ftl-sel"><span class="sel-dot" style="background:var(--t-'+TYPES[type].css+')"></span>'
    +     '<select id="drawTypeSelF" class="rp-select">'+TYPE_ORDER.map(function(t){ return '<option value="'+t+'"'+(t===type?" selected":"")+'>'+esc(TYPE_EN[t]||TYPES[t].label)+'</option>'; }).join("")+'</select></div>'
    + '</div></div>';
}
/** หน้าต่างลอย: ความคืบหน้าเทคอนกรีต (รายการโซน + แก้ไข + วาดโซนใหม่) */
function floatProgressHtml(){
  if(!state.floatProgressOpen) return "";
  var f=getFloor(state.floorId); if(!f) return "";
  var _pid=curPlanId();
  var zones=zonesOfPlan(f.id, _pid);
  var stList=zoneStatuses(f.id,_pid);
  var stMap={}; stList.forEach(function(s){ stMap[s.id]=s; });
  var pos=state.floatProgressPos||{x:14,y:60};
  var selZ=state.selZoneId?getZone(state.selZoneId):null;

  // สรุป: จำนวนต่อสถานะ (ไม่ใช้ %)
  var counts={}; zones.forEach(function(z){ counts[z.status]=(counts[z.status]||0)+1; });
  var body='<div class="ftp-summary"><span>'+zones.length+' โซน</span></div>';
  body+='<div class="ftp-stat-counts">';
  stList.forEach(function(s){ body+='<span class="ftp-sc"><span class="ftp-sc-dot" style="background:'+s.color+'"></span>'+esc(s.label)+' '+(counts[s.id]||0)+'</span>'; });
  body+='</div>';

  // Zone list
  zones.forEach(function(z){
    var s=stMap[z.status]||stList[0]||{label:z.status||"—",color:"#94a3b8"}, isSel=(z.id===state.selZoneId);
    body+='<button class="ftp-zone'+(isSel?" sel":"")+'" data-act="selectZone" data-zid="'+esc(z.id)+'">'
      +'<span class="ftp-z-badge" style="background:'+s.color+'"></span>'
      +'<span class="ftp-z-info"><span class="ftp-z-name">'+esc(z.name)+'</span><span class="ftp-z-sub">'+esc(s.label)+(z.date?' · '+esc(z.date):'')+'</span></span>'
      +'</button>';
  });

  // Edit form for selected zone
  if(selZ){
    body+='<div class="ftp-edit">'
      +'<div class="ftp-edit-row"><span>ชื่อ</span><input type="text" id="zoneNameInput" value="'+esc(selZ.name)+'" class="ftp-input"></div>'
      +'<div class="ftp-edit-row"><span>สถานะ</span><select id="zoneStatusSel" class="ftp-input">'
        + stList.map(function(s){ return '<option value="'+esc(s.id)+'"'+(selZ.status===s.id?" selected":"")+'>'+esc(s.label)+'</option>'; }).join("")
      +'</select></div>'
      +'<div class="ftp-edit-row"><span>วันที่</span><input type="date" id="zoneDateInput" value="'+esc(selZ.date||"")+'" class="ftp-input"></div>'
      +'<button class="ftp-del" data-act="deleteZone" data-zid="'+esc(selZ.id)+'"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/></svg> ลบโซน</button>'
      +'</div>';
  }

  // ปุ่มจัดการสถานะ (กำหนดเอง)
  body+='<button class="ftp-managest" data-act="manageZoneStatus"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8 2 2 0 1 1-2.8 2.8 1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0 1.6 1.6 0 0 0-2.6-1.1 2 2 0 1 1-2.8-2.8A1.6 1.6 0 0 0 3.9 15a2 2 0 0 1 0-4 1.6 1.6 0 0 0 1.1-2.6A2 2 0 1 1 7.8 5.6 1.6 1.6 0 0 0 10 5.3V5a2 2 0 0 1 4 0 1.6 1.6 0 0 0 2.2.3 2 2 0 1 1 2.8 2.8A1.6 1.6 0 0 0 20.7 11a2 2 0 0 1 0 4Z"/></svg> จัดการสถานะ + สี</button>';

  // Action buttons
  body+='<div class="ftp-actions">'
    +'<button class="ftp-btn ftp-btn-draw" data-act="drawZoneStart"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M12 6v12M3 12h18"/></svg> วาดโซนใหม่</button>'
    +'<button class="ftp-btn" data-act="exportProgressPdf"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 3v5h5"/><path d="M9 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5H9"/><path d="M12 18v-6M9 15l3 3 3-3"/></svg> PDF อัพเดท</button>'
    +'</div>';

  return '<div class="plan-floatprogress" id="floatProgress" style="left:'+pos.x+'px;top:'+pos.y+'px">'
    +'<div class="ftp-head" id="floatProgressDrag">'
    +'<svg class="ftl-grip" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>'
    +'ความคืบหน้าเท'
    +'<button class="ftl-x" data-act="closeProgressPanel" title="ปิด">✕</button>'
    +'</div>'
    +'<div class="ftp-body">'+body+'</div>'
    +'</div>';
}
/** หน้าต่างลอยสไตล์กรอบ (สี/ความเข้ม/ความหนาเส้น/สีใช้บ่อย) — วางบนแปลน */
function floatStyleHtml(){
  var type=state.catType;
  if(!state.floatStyleOpen || drawKind(type)!=="rect") return "";
  var selM=getMember(state.selMemberId);
  var selRect=(selM&&isBox(selM.plan))?selM:null;
  var sc=selRect?(selRect.plan.fill||"#f59e0b"):state.fillColor;
  var sa=selRect?(selRect.plan.fillA!=null?selRect.plan.fillA:0.28):state.fillAlpha;
  var sww=selRect?(selRect.plan.strokeW!=null?selRect.plan.strokeW:10):state.strokeW;
  var pos=state.floatStylePos||{x:14,y:60};
  var title=selRect?'สไตล์ · '+esc(selRect.code):'สไตล์กรอบ';
  return '<div class="plan-floatstyle" id="floatStyle" style="left:'+pos.x+'px;top:'+pos.y+'px">'
    + '<div class="fts-head" id="floatStyleDrag">'
    +   '<svg class="ftl-grip" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>'
    +   title
    +   '<button class="ftl-x" data-act="closeFloatStyle" title="ปิด">✕</button>'
    + '</div>'
    + '<div class="fts-body">'
    +   '<div class="fts-row">'
    +     '<input type="color" id="drawColor" value="'+esc(sc)+'" class="rbn-color" title="สีกรอบ">'
    +     '<div id="drawSwatch" class="rbn-swatch" style="background:'+esc(sc)+';opacity:'+sa+'"></div>'
    +   '</div>'
    +   '<div class="fts-slider"><span>ความเข้ม</span><input type="range" id="drawAlpha" min="0" max="100" value="'+Math.round(sa*100)+'"></div>'
    +   '<div class="fts-slider"><span>เส้นกรอบ</span><input type="range" id="drawStroke" min="0" max="30" value="'+Math.round(sww)+'"></div>'
    +   '<div class="fts-swatches">'+PRESET_COLORS.map(function(c){ return '<button class="swatch'+(sc.toLowerCase()===c?" on":"")+'" data-swatch="'+c+'" title="'+c+'" style="background:'+c+'"></button>'; }).join("")+'</div>'
    + '</div></div>';
}

function planStageHtml(){
  var f=getFloor(state.floorId), type=state.catType;
  var isProgress=stageMode()==="progress";
  var plan=getFloorPlan(f);
  var ratio=planRatio(plan);
  var VW=1000, VH=Math.round(VW*ratio);
  var _pid2=curPlanId();
  var members=isProgress ? [] : membersOfFloor(f.id).filter(function(m){ return m.plan && memberPlanId(m)===_pid2 && (state.unified ? !state.hiddenTypes[m.type] : m.type===type); });
  var shapes=planShapesSVG(VW,VH);

  var _psrc = plan ? (plan.src || PLAN_PREVIEW[planSourceKey()] || "") : "";   // คลาวด์: floor doc ไม่มี src → ใช้พรีวิว/ต้นฉบับที่โหลดมา
  var bg = plan
    ? '<img class="plan-img"'+(_psrc?' src="'+_psrc+'"':'')+' alt="แปลนโครงสร้าง" draggable="false">'
    : '<div class="plan-grid"></div>';
  var drawing = (state.tool==="draw" || state.tool==="drawZone");

  // แถบมินิเมนูตอนเลือกชิ้นส่วน (ลอยบนกรอบ) — เฉพาะหน้าแก้ไขแปลน
  var _selM=isProgress ? null : getMember(state.selMemberId); if(_selM && !state.unified && _selM.type!==type) _selM=null;
  var selbar = _selM ? '<div class="plan-selbar">'
    + chipHtml(_selM.code,TYPES[_selM.type].css)
    + '<button data-act="goInspect" title="ตรวจเหล็ก"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/></svg> <span class="lb">ตรวจเหล็ก</span></button>'
    + '<button data-act="showDetails" title="รายละเอียด"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 15 5-5 4 4 3-3 6 6"/><circle cx="9" cy="9" r="1.6"/></svg> <span class="lb">รายละเอียด</span></button>'
    + '<button data-act="assignSheet" title="ใส่ค่าจากเทมเพลต"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg> <span class="lb">Assign</span></button>'
    + '<button data-act="dupMember" data-id="'+esc(_selM.id)+'" title="ทำซ้ำ"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg> <span class="lb">ทำซ้ำ</span></button>'
    + '<button class="danger" data-act="delMember" title="ลบ"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/></svg></button>'
    + '</div>' : '';

  return '<div class="plan-stage'+(drawing?" is-draw":"")+(plan?"":" no-plan")+'" id="planStage" style="aspect-ratio:'+ (plan&&plan.w?plan.w+"/"+plan.h : "100/72") +'">'
       + '<div class="plan-canvas" id="planCanvas">'+bg+'</div>'
       // เลเยอร์ความคม + ไฮไลท์ อยู่ "นอก" canvas ที่ถูกซูม → บน iOS ภาพคมไม่โดน CSS transform ขยายจนเบลอ
       +   '<img class="plan-detail" id="planDetail" alt="" draggable="false" style="display:none">'
       +   '<svg class="plan-overlay" id="planOverlay" viewBox="0 0 '+VW+' '+VH+'" '
       +     'data-vw="'+VW+'" data-vh="'+VH+'" preserveAspectRatio="none">'+shapes+'</svg>'
       + selbar
       + (isProgress ? floatProgressHtml() : floatStyleHtml())
       + (!isProgress && state.showLegend ? legendHtml(members) : '')
       + (isProgress
            ? (zonesOfPlan(f.id,_pid2).length===0 && !drawing ? '<div class="plan-hint">ยังไม่มีโซนเท — กด “วาดโซนใหม่” แล้วลากคลุมพื้นที่บนแปลน</div>' : '')
            : (members.length===0 && !drawing ? '<div class="plan-hint">'+(state.unified?'ยังไม่มีชิ้นส่วนในแปลน — เลือกชนิดแล้วกด “วาด” ลากบนแปลน':'ยังไม่มี'+esc(TYPES[type].label)+'ในแปลน — กด “วาด'+esc(TYPES[type].label)+'” แล้วลากบนแปลน')+'</div>' : ''))
       + '</div>';
}
function _planDbg(){}   // (ปิดตัวบอกสถานะดีบั๊กแล้ว)
/** ตารางสี (Legend) บนแปลน — จัดกลุ่มคานตามสีกรอบ → "สีนี้ = คานเบอร์ไหน" */
function legendHtml(members){
  var groups={}, order=[];
  members.forEach(function(m){
    if(!m.plan) return;
    var c=(m.plan.fill||"#f59e0b").toLowerCase();
    if(!groups[c]){ groups[c]=[]; order.push(c); }
    if(groups[c].indexOf(m.code)<0) groups[c].push(m.code);
  });
  var pos=state.legendPos||{x:12,y:12};
  var rows=order.length ? order.map(function(c){
    return '<div class="lg-row"><span class="lg-sw" style="background:'+esc(c)+'"></span><span class="lg-tx">'+esc(groups[c].join(", "))+'</span></div>';
  }).join("") : '<div class="lg-row"><span class="tiny muted">ยังไม่มีคานบนแปลน</span></div>';
  return '<div class="plan-legend" id="planLegend" style="right:auto;left:'+pos.x+'px;top:'+pos.y+'px">'
    + '<div class="lg-head" id="legendDrag">ตารางสี (Legend) <button class="lg-x" data-act="toggleLegend" title="ซ่อน">✕</button></div>'
    + '<div class="lg-body">'+rows+'</div></div>';
}

/** หน้าจอรายละเอียดเต็ม (เปิดจากปุ่ม "รายละเอียด") — หน้าตัดทุกสถานี + span + สเปก จัดสองคอลัมน์ */
function viewMemberDetail(){
  var m=getMember(state.memberId) || getMember(state.selMemberId);
  if(!m) return emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/></svg>',"ไม่พบชิ้นส่วน","");
  var ins=lastInspection(m.id);
  var h='<div class="detail-head">'
    + chipHtml(m.code,TYPES[m.type].css)
    + '<div style="min-width:0;flex:1"><div class="screen-title" style="margin:0">'+esc(m.name||m.code)+'</div>'
    + '<div class="screen-sub" style="margin:2px 0 0">'+esc(TYPES[m.type].label)+(m.grid?" · แนว "+esc(m.grid):"")
    + (m.type==="beam"?" · ช่วง "+(num(m.span,0)/1000).toFixed(2)+" ม.":"")+'</div></div>'
    + dotFor(m)+'</div>';
  if(m.note) h+='<div class="note-warn" style="margin-top:0"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg> '+esc(m.note)+'</div>';
  h+='<div class="row-end" style="margin:12px 0">'
    +'<button class="btn soft" data-act="editMember"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg> แก้ไขข้อมูล</button>'
    +'<button class="btn" data-act="goInspect"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/></svg> ตรวจเหล็ก</button>'
    +'<button class="btn danger" data-act="delMember"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/></svg> ลบ</button></div>';

  // หน้ารายละเอียด = editor (อัปรูป/ครอบตัด/ลาก/ข้อความ/ตาราง) เก็บกับชิ้นส่วน
  h+=detailEditorHtml(m);
  return h;
}

/** แผ่นรายละเอียด (เปิดจากปุ่ม "รายละเอียด") — หน้าตัดทั้งหมด + ช่วงคาน */
function detailsSheetHtml(m){
  var h='<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'
    + chipHtml(m.code,TYPES[m.type].css)
    + '<div style="min-width:0"><div style="font-size:1.14rem;font-weight:800">'+esc(m.name||m.code)+'</div>'
    + '<div class="small muted">'+esc(TYPES[m.type].label)+(m.grid?" · แนว "+esc(m.grid):"")
    + (m.type==="beam"?" · ช่วง "+(num(m.span,0)/1000).toFixed(2)+" ม.":"")+'</div></div>'
    + '<button class="icon-btn close" data-act="closeSheet" style="margin-left:auto">ปิด ✕</button></div>';
  if(m.note) h+='<div class="note-warn" style="margin-top:0;margin-bottom:10px"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg> '+esc(m.note)+'</div>';
  h+=sectionCardHtml(m)+spanCardHtml(m)+summaryCardHtml(m)+spRebarCardHtml(m)+specCardHtml(m);
  h+='<hr class="sep"><div class="row-end">'
    +'<button class="btn soft" data-act="editMember"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg> แก้ไขข้อมูล</button>'
    +'<button class="btn danger" data-act="delMember"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/></svg> ลบ</button></div>';
  return h;
}

/* ===========================================================================
   DETAIL EDITOR — หน้ารายละเอียดแบบ "บล็อกเรียงต่อกัน": อัปรูป/PDF · ครอบตัด ·
   เลื่อนขึ้น-ลง · แทรกข้อความ/ตาราง · เก็บกับชิ้นส่วน (m.doc.els — เรียงตามลำดับ)
   =========================================================================== */
function memberDoc(m){ if(!m.doc || !Array.isArray(m.doc.els)) m.doc={els:[]}; return m.doc; }
function deUid(){ return uid("de"); }

/* ---- แคช/โหลดสื่อจาก IndexedDB (m.doc เก็บแค่ layout เล็ก ๆ — สื่ออยู่ใน IDB) ---- */
var DE_PDF={};   // eid -> {page, pageNo, raster:{w,url}}
var DE_IMG={};   // eid -> dataURL
function deImgEl(id){ return document.querySelector('#deCanvas .de-img[data-eid="'+id+'"]'); }
function deLoadImage(elm){
  var img=deImgEl(elm.id); if(!img) return;
  if(DE_IMG[elm.id]){ if(img.src!==DE_IMG[elm.id]) img.src=DE_IMG[elm.id]; return; }
  idbGet('deimg_'+elm.id).then(function(url){ if(url){ DE_IMG[elm.id]=url; var im=deImgEl(elm.id); if(im) im.src=url; } }).catch(function(){});
}
function deEnsurePage(elm){
  var rec=DE_PDF[elm.id];
  if(rec && rec.page) return Promise.resolve(rec.page);
  return idbGet('depdf_'+elm.id).then(function(v){
    if(!v||!v.bytes) throw new Error('no pdf');
    return loadPdfJs().then(function(lib){
      return lib.getDocument(pdfDocOpts(new Uint8Array(v.bytes.slice(0)))).promise
        .then(function(pdf){ return pdf.getPage(elm.pageNo||v.pageNo||1); })
        .then(function(pg){ DE_PDF[elm.id]=Object.assign(DE_PDF[elm.id]||{},{page:pg,pageNo:elm.pageNo||1}); return pg; });
    });
  });
}
/** เรนเดอร์ PDF element ให้คมตามขนาดที่แสดง (ยิ่งใหญ่ยิ่งเรนเดอร์ละเอียด = deep-zoom) */
function deRenderPdf(elm){
  var img=deImgEl(elm.id); if(!img) return;
  var dpr=window.devicePixelRatio||1;
  var need=Math.max(1200, Math.min(5200, Math.round((elm.w||340)*dpr*1.5)));
  var rec=DE_PDF[elm.id];
  if(rec && rec.raster){ if(img.src!==rec.raster.url) img.src=rec.raster.url; if(rec.raster.w>=need*0.9) return; }  // แสดงของเดิมก่อน แล้วอัปเกรด
  deEnsurePage(elm).then(function(pg){
    renderPdfToCanvas(pg, need).then(function(cv){
      var url; try{ url=cv.toDataURL('image/jpeg',0.93); }catch(e){ return; }
      DE_PDF[elm.id]=Object.assign(DE_PDF[elm.id]||{},{raster:{w:need,url:url}});
      var im=deImgEl(elm.id); if(im) im.src=url;
    }).catch(function(){});
  }).catch(function(){});
}
function deHydrate(doc){
  doc.els.forEach(function(elm){
    if(elm.type==='image') deLoadImage(elm);
    else if(elm.type==='pdf') deRenderPdf(elm);
  });
}

function deTableHtml(elm){
  var rows=elm.rows||[["",""]];
  var ncol=(rows[0]||[]).length||1;
  if(!elm.colW || elm.colW.length!==ncol){ elm.colW=[]; for(var q=0;q<ncol;q++) elm.colW[q]=Math.max(48, Math.floor(((elm.w||300)-16)/ncol)); }
  var cg='<colgroup>'+elm.colW.map(function(w){ return '<col style="width:'+w+'px">'; }).join('')+'</colgroup>';
  var h='<table class="de-table fixed">'+cg+'<tbody>';
  rows.forEach(function(r,ri){
    h+='<tr>';
    r.forEach(function(c,ci){
      var tag=ri===0?"th":"td";
      var grip=(ri===0 && ci<ncol-1)?'<span class="de-colgrip" data-de="colresize" data-c="'+ci+'"></span>':'';
      h+='<'+tag+' contenteditable="true" data-r="'+ri+'" data-c="'+ci+'">'+esc(c)+grip+'</'+tag+'>';
    });
    h+='</tr>';
  });
  h+='</tbody></table><div class="de-tadd"><button data-de="addrow">+ แถว</button><button data-de="addcol">+ คอลัมน์</button></div>';
  return h;
}
function deCropOverlay(elm){
  var c=elm._crop||{x:0.1,y:0.1,w:0.8,h:0.8};
  var st='left:'+(c.x*100).toFixed(2)+'%;top:'+(c.y*100).toFixed(2)+'%;width:'+(c.w*100).toFixed(2)+'%;height:'+(c.h*100).toFixed(2)+'%';
  return '<div class="de-crop" data-de="cropmove" style="'+st+'">'
    + ['tl','tr','bl','br'].map(function(k){ return '<span class="de-ch '+k+'" data-de="crophandle" data-corner="'+k+'"></span>'; }).join('')
    + '<div class="de-cbar"><button data-de="cropok">✓ ยืนยันครอบตัด</button><button data-de="cropcancel">ยกเลิก</button></div></div>';
}
function deElHtml(elm){
  var st='left:'+Math.round(elm.x||0)+'px;top:'+Math.round(elm.y||0)+'px;width:'+Math.round(elm.w||300)+'px;'+(elm.h?('height:'+Math.round(elm.h)+'px;'):'');
  var isMedia=(elm.type==='image'||elm.type==='pdf');
  var inner='';
  if(isMedia){
    var fst=(elm.frame&&elm.frame.w>0)?' style="border:'+elm.frame.w+'px solid '+(elm.frame.color||'#1f2937')+'"':'';
    inner='<img class="de-img" data-eid="'+elm.id+'" draggable="false" alt=""'+fst+'>';
    if(elm.id===state.deCrop) inner+=deCropOverlay(elm);
  }else if(elm.type==='text'){
    var ts=''; if(elm.color)ts+='color:'+elm.color+';'; if(elm.font)ts+='font-family:'+elm.font+';';
    if(elm.size)ts+='font-size:'+elm.size+'px;'; if(elm.weight)ts+='font-weight:'+elm.weight+';';
    inner='<div class="de-txt" contenteditable="true" style="'+ts+'">'+(elm.html||'')+'</div>';
  }else if(elm.type==='table'){
    inner='<div class="de-tablewrap">'+deTableHtml(elm)+'</div>';
  }
  var tools='<div class="de-move" data-de="move">✥ ลาก</div>'
    + '<button class="de-del" data-de="del" title="ลบ">✕</button>'
    + (isMedia?'<button class="de-crop-btn" data-de="crop" title="ครอบตัด">✂</button>':'')
    + (elm.type==='pdf'?'<span class="de-pdftag">PDF · ยิ่งขยายยิ่งคม</span>':'')
    + ['tl','tr','bl','br'].map(function(c){ return '<span class="de-h '+c+'" data-de="resize" data-corner="'+c+'"></span>'; }).join('');
  return '<div class="de-el'+(elm.id===state.deSel?' sel':'')+'" data-eid="'+elm.id+'" data-type="'+elm.type+'" style="'+st+'">'+inner+tools+'</div>';
}
function detailEditorHtml(m){
  var doc=memberDoc(m);
  var body=doc.els.map(deElHtml).join('');
  var hint=doc.els.length ? '' : '<div class="de-hint">กด “อัปโหลดรูป” หรือ “นำเข้า PDF” เพื่อเริ่ม — ลากย้าย/ย่อขยายอิสระ · PDF ยิ่งขยายยิ่งคม (deep-zoom) · ครอบตัด/ใส่ข้อความ/ตารางได้</div>';
  return '<div class="card"><div class="card-h"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 15 5-5 4 4 3-3 6 6"/><circle cx="9" cy="9" r="1.6"/></svg> รูปแบบ / รายละเอียด (แก้ไขได้)</div>'
    + '<div class="de-tools">'
    +   '<button class="de-tbtn primary" data-de="upload"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4m0 0 4 4m-4-4-4 4M4 20h16"/></svg> อัปโหลดรูป</button>'
    +   '<button class="de-tbtn" data-de="uploadpdf"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg> นำเข้า PDF</button>'
    +   '<button class="de-tbtn" data-de="addtext"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V5h16v2M9 20h6M12 5v15"/></svg> + ข้อความ</button>'
    +   '<button class="de-tbtn" data-de="addtable"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg> + ตาราง</button>'
    +   '<input type="file" id="deFile" accept="image/*" hidden><input type="file" id="dePdf" accept="application/pdf" hidden>'
    + '</div>'
    + '<div class="de-canvas" id="deCanvas">'+hint+'<div class="de-props" id="deProps"></div>'+body+'</div></div>';
}
function deSelEl(){ var m=getMember(activeMemberId()); return m?memberDoc(m).els.filter(function(x){return x.id===state.deSel;})[0]:null; }
/** แถบเครื่องมือลอยติดกับองค์ประกอบที่เลือก (โผล่เหนือกล่อง · ไม่กินพื้นที่ · ตารางใช้ที่ตัวมันเอง) */
function deUpdateProps(){
  var bar=document.getElementById('deProps'); if(!bar) return;
  var elm=deSelEl();
  if(!elm || elm.type==='table'){ bar.classList.remove('on'); bar.innerHTML=''; return; }
  var h='';
  if(elm.type==='text'){
    var fonts=[['','ฟอนต์'],['Sarabun, sans-serif','Sarabun'],['Tahoma, sans-serif','Tahoma'],["'Times New Roman', serif",'Times'],['Arial, sans-serif','Arial']];
    var sizes=[12,14,16,18,22,28,36,48];
    h+='<button class="de-pb'+(elm.weight==700?' on':'')+'" data-dp="bold" title="ตัวหนา"><b>B</b></button>';
    h+='<select class="de-psel" data-dp="font">'+fonts.map(function(f){return '<option value="'+f[0]+'"'+((elm.font||'')===f[0]?' selected':'')+'>'+f[1]+'</option>';}).join('')+'</select>';
    h+='<select class="de-psel" data-dp="size">'+sizes.map(function(s){return '<option value="'+s+'"'+((elm.size||16)==s?' selected':'')+'>'+s+'</option>';}).join('')+'</select>';
    h+='<label class="de-pcolor"><input type="color" data-dp="color" value="'+(elm.color||'#1f2937')+'"></label>';
  }else if(elm.type==='image'||elm.type==='pdf'){
    var fw=(elm.frame&&elm.frame.w)||0;
    h+='<span class="de-plabel">กรอบ</span>';
    h+='<select class="de-psel" data-dp="frame">'+[[0,'ไม่มี'],[1,'บาง'],[2,'กลาง'],[4,'หนา'],[8,'หนามาก']].map(function(o){return '<option value="'+o[0]+'"'+(fw==o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select>';
    h+='<label class="de-pcolor"><input type="color" data-dp="framecolor" value="'+((elm.frame&&elm.frame.color)||'#1f2937')+'"></label>';
  }
  bar.innerHTML=h; bar.classList.add('on'); dePositionProps();
}
/** วางตำแหน่งแถบลอยเหนือกล่องที่เลือก (ถ้าชนขอบบนให้ไปอยู่ใต้กล่อง) */
function dePositionProps(){
  var bar=document.getElementById('deProps'); if(!bar||!bar.classList.contains('on')) return;
  var elm=deSelEl(); if(!elm) return;
  var canvas=document.getElementById('deCanvas'); if(!canvas) return;
  var bw=bar.offsetWidth||220, bh=bar.offsetHeight||38;
  var maxL=canvas.clientWidth + canvas.scrollLeft - bw - 8;
  var left=Math.max(6+canvas.scrollLeft, Math.min(elm.x||0, Math.max(6, maxL)));
  var top=(elm.y||0)-bh-10; if(top<4) top=(elm.y||0)+(elm.h||60)+12;
  bar.style.left=left+'px'; bar.style.top=top+'px';
}
function deCurSel(){ return deSelEl(); }
function deApplyTextStyle(elm){
  var d=document.querySelector('#deCanvas .de-el[data-eid="'+elm.id+'"] .de-txt'); if(!d) return;
  d.style.color=elm.color||''; d.style.fontFamily=elm.font||''; d.style.fontSize=elm.size?elm.size+'px':''; d.style.fontWeight=elm.weight||'';
}
function deApplyFrame(elm){
  var im=deImgEl(elm.id); if(!im) return;
  im.style.border=(elm.frame&&elm.frame.w>0)?(elm.frame.w+'px solid '+(elm.frame.color||'#1f2937')):'';
}
/** ครอบตัด — PDF เรนเดอร์สดความละเอียดสูงก่อนตัด (คมสุด), รูปตัดจากต้นฉบับ; ผลลัพธ์เป็นรูปนิ่งใน IDB */
function deApplyCrop(elm, done){
  var c=elm._crop||{x:0,y:0,w:1,h:1};
  function fromCanvasSized(getSrcCanvas){
    getSrcCanvas.then(function(scv){
      var iw=scv.width, ih=scv.height;
      var sx=Math.max(0,c.x*iw), sy=Math.max(0,c.y*ih), sw=Math.min(iw-sx,c.w*iw), sh=Math.min(ih-sy,c.h*ih);
      if(sw<4||sh<4){ done(); return; }
      var cv=document.createElement('canvas'); cv.width=Math.round(sw); cv.height=Math.round(sh);
      cv.getContext('2d').drawImage(scv, sx,sy,sw,sh, 0,0,sw,sh);
      var url; try{ url=cv.toDataURL('image/jpeg',0.93); }catch(e){ done(); return; }
      idbPut('deimg_'+elm.id, url).then(function(){
        DE_IMG[elm.id]=url;
        if(DE_PDF[elm.id]){ delete DE_PDF[elm.id]; idbDel('depdf_'+elm.id).catch(function(){}); }
        elm.type='image'; delete elm.pageNo; if(elm.w) elm.h=elm.w*(sh/sw);
        done();
      }).catch(function(){ toast('บันทึกภาพครอบตัดไม่สำเร็จ',true); done(); });
    }).catch(function(){ done(); });
  }
  if(elm.type==='pdf'){
    fromCanvasSized(deEnsurePage(elm).then(function(pg){ return renderPdfToCanvas(pg, 5000); }));
  }else{
    var src=DE_IMG[elm.id] || (deImgEl(elm.id)&&deImgEl(elm.id).src);
    if(!src){ done(); return; }
    fromCanvasSized(new Promise(function(res,rej){
      var img=new Image(); img.onload=function(){ var cv=document.createElement('canvas'); cv.width=img.width; cv.height=img.height; cv.getContext('2d').drawImage(img,0,0); res(cv); }; img.onerror=rej; img.src=src;
    }));
  }
}
function bindDetailEditor(){
  var canvas=$('#deCanvas'); if(!canvas) return;
  var m=getMember(activeMemberId()); if(!m) return;
  var doc=memberDoc(m), fileInput=$('#deFile'), pdfInput=$('#dePdf');
  function findEl(id){ return doc.els.filter(function(x){return x.id===id;})[0]; }
  function selectDom(elDiv){
    state.deSel = elDiv ? elDiv.getAttribute('data-eid') : null;
    $$('.de-el',canvas).forEach(function(d){ d.classList.toggle('sel', !!elDiv && d===elDiv); });
    deUpdateProps();
  }
  // ---- property bar (สี/ฟอนต์/ความหนา · กรอบ) ----
  var props=$('#deProps');
  if(props){
    function onProp(e){
      var t=e.target, dp=t.getAttribute&&t.getAttribute('data-dp'); if(!dp) return;
      var elm=deCurSel(); if(!elm) return;
      if(dp==='font'){ elm.font=t.value; deApplyTextStyle(elm); }
      else if(dp==='size'){ elm.size=+t.value; deApplyTextStyle(elm); }
      else if(dp==='color'){ elm.color=t.value; deApplyTextStyle(elm); }
      else if(dp==='frame'){ elm.frame=elm.frame||{}; elm.frame.w=+t.value; if(!elm.frame.color) elm.frame.color='#1f2937'; deApplyFrame(elm); }
      else if(dp==='framecolor'){ elm.frame=elm.frame||{}; elm.frame.color=t.value; deApplyFrame(elm); }
      saveDB();
    }
    props.addEventListener('change',onProp);
    props.addEventListener('input',onProp);
    props.addEventListener('click',function(e){
      var b=e.target.closest('[data-dp="bold"]'); if(!b) return;
      var elm=deCurSel(); if(!elm) return;
      elm.weight = (elm.weight==700? undefined : 700); deApplyTextStyle(elm);
      b.classList.toggle('on', elm.weight==700); saveDB();
    });
  }
  // ---- upload image → เก็บใน IndexedDB ----
  if(fileInput) fileInput.addEventListener('change',function(e){
    var f=e.target.files&&e.target.files[0]; if(!f){ return; }
    toast('กำลังย่อรูป...');
    resizeImage(f,4000,0.9).then(function(url){
      var id=deUid();
      idbPut('deimg_'+id,url).then(function(){
        DE_IMG[id]=url;
        var im=new Image(); im.onload=function(){ var w=Math.min(360,im.width||360), hh=w*(im.height/im.width||0.7);
          doc.els.push({id:id,type:'image',x:20,y:20,w:w,h:hh}); state.deSel=id; saveDB(); render(); };
        im.src=url;
      }).catch(function(){ toast('บันทึกรูปไม่สำเร็จ (พื้นที่เต็ม?)',true); });
    }).catch(function(){ toast('อัปโหลดรูปไม่สำเร็จ',true); });
    e.target.value='';
  });
  // ---- import PDF → เก็บไฟล์ต้นฉบับใน IndexedDB (เรนเดอร์คมตามซูม) ----
  if(pdfInput) pdfInput.addEventListener('change',function(e){
    var f=e.target.files&&e.target.files[0]; if(!f){ return; }
    toast('กำลังอ่าน PDF...');
    loadPdfJs().then(function(lib){
      var reader=new FileReader();
      reader.onload=function(){
        var buf=reader.result;
        lib.getDocument(pdfDocOpts(new Uint8Array(buf.slice(0)))).promise.then(function(pdf){
          var pageNo=1;
          if(pdf.numPages>1){
            var ans=window.prompt('PDF มี '+pdf.numPages+' หน้า — เลือกหน้า (1-'+pdf.numPages+'):','1');
            if(ans===null) return;
            pageNo=Math.min(Math.max(1,parseInt(ans,10)||1), pdf.numPages);
          }
          pdf.getPage(pageNo).then(function(page){
            var id=deUid(); DE_PDF[id]={page:page,pageNo:pageNo};
            idbPut('depdf_'+id, {bytes:buf, pageNo:pageNo}).catch(function(){ toast('บันทึก PDF ไม่สำเร็จ',true); });
            var vp=page.getViewport({scale:1}); var w=360, hh=w*(vp.height/vp.width);
            doc.els.push({id:id,type:'pdf',x:20,y:20,w:w,h:hh,pageNo:pageNo}); state.deSel=id;
            saveDB(); render();
            toast('นำเข้า PDF แล้ว — ลากมุมขยายให้ใหญ่ ยิ่งคม (deep-zoom)');
          }).catch(function(){ toast('อ่านหน้า PDF ไม่ได้',true); });
        }).catch(function(){ toast('เปิดไฟล์ PDF ไม่ได้ (อาจเสีย/มีรหัสผ่าน)',true); });
      };
      reader.readAsArrayBuffer(f);
    }).catch(function(){ toast('โหลดตัวอ่าน PDF ไม่ได้',true); });
    e.target.value='';
  });
  // ---- toolbar / element buttons (click) ----
  var card=canvas.closest('.card');
  card.addEventListener('click',function(e){
    var b=e.target.closest('[data-de]'); if(!b) return;
    var act=b.getAttribute('data-de');
    var elDiv=b.closest('.de-el'), elm=elDiv?findEl(elDiv.getAttribute('data-eid')):null;
    if(act==='upload'){ fileInput.click(); }
    else if(act==='uploadpdf'){ pdfInput.click(); }
    else if(act==='addtext'){ var t={id:deUid(),type:'text',x:24,y:24,w:280,h:80,html:'ใส่ข้อความ...'}; doc.els.push(t); state.deSel=t.id; saveDB(); render(); }
    else if(act==='addtable'){ var tb={id:deUid(),type:'table',x:24,y:24,w:360,rows:[['หัวข้อ','หัวข้อ','หัวข้อ'],['','',''],['','','']]}; doc.els.push(tb); state.deSel=tb.id; saveDB(); render(); }
    else if(act==='del' && elm){ if(confirm('ลบสิ่งนี้?')){ doc.els=doc.els.filter(function(x){return x.id!==elm.id;});
        idbDel('deimg_'+elm.id).catch(function(){}); idbDel('depdf_'+elm.id).catch(function(){}); delete DE_IMG[elm.id]; delete DE_PDF[elm.id];
        state.deSel=null; saveDB(); render(); } }
    else if(act==='crop' && elm){ state.deSel=elm.id; state.deCrop=elm.id; elm._crop={x:0.1,y:0.1,w:0.8,h:0.8}; render(); }
    else if(act==='cropcancel' && elm){ state.deCrop=null; delete elm._crop; render(); }
    else if(act==='cropok' && elm){ toast('กำลังครอบตัด (คมสูง)...'); deApplyCrop(elm,function(){ state.deCrop=null; delete elm._crop; saveDB(); render(); }); }
    else if(act==='addrow' && elm){ var cols=(elm.rows[0]||['']).length; var nr=[]; for(var k=0;k<cols;k++) nr.push(''); elm.rows.push(nr); saveDB(); render(); }
    else if(act==='addcol' && elm){ elm.rows.forEach(function(r){ r.push(''); }); saveDB(); render(); }
  });
  // ---- edit text / table cells ----
  canvas.addEventListener('input',function(e){
    var t=e.target, elDiv=t.closest('.de-el'); if(!elDiv) return;
    var elm=findEl(elDiv.getAttribute('data-eid')); if(!elm) return;
    if(t.classList.contains('de-txt')) elm.html=t.innerHTML;
    else if(t.matches('.de-table [contenteditable]')){ var r=+t.getAttribute('data-r'),c=+t.getAttribute('data-c'); if(elm.rows[r]) elm.rows[r][c]=t.textContent; }
  });
  canvas.addEventListener('blur',function(e){ if(e.target.isContentEditable) saveDB(); },true);
  // ---- drag / resize / crop (pointer, วางอิสระ) ----
  var drag=null;
  canvas.addEventListener('pointerdown',function(e){
    if(e.target.closest('#deProps')) return;   // กดบนแถบเครื่องมือลอย อย่าเพิ่งยกเลิกการเลือก
    var b=e.target.closest('[data-de]'), elDiv=e.target.closest('.de-el');
    selectDom(elDiv);
    if(b && elDiv){
      var elm=findEl(elDiv.getAttribute('data-eid')), act=b.getAttribute('data-de');
      if(act==='resize'){ drag={mode:'resize',elm:elm,elDiv:elDiv,corner:b.getAttribute('data-corner'),sx:e.clientX,sy:e.clientY,ox:elm.x,oy:elm.y,ow:elm.w,oh:elm.h||elDiv.offsetHeight}; }
      else if(act==='move'){ drag={mode:'move',elm:elm,elDiv:elDiv,sx:e.clientX,sy:e.clientY,ox:elm.x,oy:elm.y}; }
      else if(act==='colresize'){ var ci=+b.getAttribute('data-c'), col=elDiv.querySelectorAll('.de-table col')[ci];
        drag={mode:'colresize',elm:elm,ci:ci,col:col,sx:e.clientX,w0:(elm.colW&&elm.colW[ci])||(col?col.offsetWidth:80)}; }
      else if(act==='crophandle'||act==='cropmove'){ var im=elDiv.querySelector('.de-img'); drag={mode:act,elm:elm,cropDiv:elDiv.querySelector('.de-crop'),corner:b.getAttribute('data-corner'),sx:e.clientX,sy:e.clientY,box:im.getBoundingClientRect(),c0:Object.assign({},elm._crop)}; }
      if(drag){ try{canvas.setPointerCapture(e.pointerId);}catch(x){} e.preventDefault(); return; }
    }
    if(elDiv && !b && !e.target.isContentEditable){
      var em=findEl(elDiv.getAttribute('data-eid'));
      drag={mode:'move',elm:em,elDiv:elDiv,sx:e.clientX,sy:e.clientY,ox:em.x,oy:em.y};
      try{canvas.setPointerCapture(e.pointerId);}catch(x){} e.preventDefault();
    }
  });
  canvas.addEventListener('pointermove',function(e){
    if(!drag) return;
    var dx=e.clientX-drag.sx, dy=e.clientY-drag.sy, el=drag.elm;
    if(drag.mode==='move'){ el.x=Math.max(0,drag.ox+dx); el.y=Math.max(0,drag.oy+dy); drag.elDiv.style.left=el.x+'px'; drag.elDiv.style.top=el.y+'px'; dePositionProps(); }
    else if(drag.mode==='colresize'){ var nw=Math.max(36, drag.w0+dx); if(!el.colW) el.colW=[]; el.colW[drag.ci]=nw; if(drag.col) drag.col.style.width=nw+'px'; }
    else if(drag.mode==='resize'){
      if(el.type==='image'||el.type==='pdf'){   // ล็อกสัดส่วน กันภาพยืด
        var ratio=(drag.oh/drag.ow)||0.7, rr=drag.corner.indexOf('r')>=0;
        el.w=Math.max(80, drag.ow + (rr?dx:-dx)); el.h=el.w*ratio;
        if(!rr){ el.x=drag.ox+(drag.ow-el.w); drag.elDiv.style.left=el.x+'px'; }
        drag.elDiv.style.width=el.w+'px'; drag.elDiv.style.height=el.h+'px';
      }else{
        var right=drag.corner.indexOf('r')>=0, bottom=drag.corner.indexOf('b')>=0;
        el.w=Math.max(80, drag.ow + (right?dx:-dx));
        if(!right){ el.x=drag.ox+dx; drag.elDiv.style.left=el.x+'px'; }
        drag.elDiv.style.width=el.w+'px';
        if(el.h!=null){ el.h=Math.max(40, drag.oh + (bottom?dy:-dy)); if(!bottom){ el.y=drag.oy+dy; drag.elDiv.style.top=el.y+'px'; } drag.elDiv.style.height=el.h+'px'; }
      }
    }else{  // crop
      var fx=dx/drag.box.width, fy=dy/drag.box.height, c=drag.c0, nc=Object.assign({},c);
      if(drag.mode==='cropmove'){ nc.x=Math.min(1-c.w,Math.max(0,c.x+fx)); nc.y=Math.min(1-c.h,Math.max(0,c.y+fy)); }
      else{
        if(drag.corner.indexOf('l')>=0){ nc.x=Math.min(c.x+c.w-0.06,Math.max(0,c.x+fx)); nc.w=c.w+(c.x-nc.x); }
        if(drag.corner.indexOf('r')>=0){ nc.w=Math.min(1-c.x,Math.max(0.06,c.w+fx)); }
        if(drag.corner.indexOf('t')>=0){ nc.y=Math.min(c.y+c.h-0.06,Math.max(0,c.y+fy)); nc.h=c.h+(c.y-nc.y); }
        if(drag.corner.indexOf('b')>=0){ nc.h=Math.min(1-c.y,Math.max(0.06,c.h+fy)); }
      }
      el._crop=nc; var s=drag.cropDiv.style; s.left=(nc.x*100)+'%'; s.top=(nc.y*100)+'%'; s.width=(nc.w*100)+'%'; s.height=(nc.h*100)+'%';
    }
  });
  canvas.addEventListener('pointerup',function(){
    if(!drag){ return; }
    var wasResize=drag.mode==='resize', el=drag.elm; drag=null; saveDB();
    dePositionProps();
    if(wasResize && el.type==='pdf') deRenderPdf(el);   // ขยายแล้วเรนเดอร์ให้คมขึ้น
  });
  // ---- โหลด/เรนเดอร์สื่อจาก IndexedDB + แถบเครื่องมือเริ่มต้น ----
  deHydrate(doc);
  deUpdateProps();
}

/** ส่วนพับได้ในพาเนลขวา (details/summary) — ใช้จัดกลุ่มให้ไม่รก */
function rpSec(title, badge, body, open){
  return '<details class="rp-sec"'+(open?' open':'')+'><summary><span class="rp-sec-t">'+esc(title)+'</span>'+(badge||'')+'</summary><div class="rp-sec-b">'+body+'</div></details>';
}
function rightPanelHtml(){
  var type=state.catType, m=getMember(state.selMemberId);
  var tab=state.rightTab;
  if(tab==="spec") tab="list";              // แท็บเดิม "รายละเอียด" ย้ายไปเป็นปุ่มบนแถบเครื่องมือ
  if(tab!=="palette"&&tab!=="list"&&tab!=="inspect") tab="palette";
  var h='<div class="rp-tabs">'
      + '<button data-act="setRightTab" data-tab="palette" aria-selected="'+(tab==="palette")+'"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13.5" cy="6.8" r="1.1" fill="currentColor" stroke="none"/><circle cx="17.4" cy="10.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="8.4" cy="7.4" r="1.1" fill="currentColor" stroke="none"/><circle cx="6.6" cy="12.4" r="1.1" fill="currentColor" stroke="none"/><path d="M12 2a10 10 0 1 0 0 20 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 1 2-4h1a4 4 0 0 0 4-4 10 10 0 0 0-9-8Z"/></svg> สไตล์/ลาย</button>'
      + '<button data-act="setRightTab" data-tab="list" aria-selected="'+(tab==="list")+'"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/></svg> '+(state.unified?'รายการ':'รายการ'+esc(TYPES[type].label))+'</button>'
      + '<button data-act="setRightTab" data-tab="inspect" aria-selected="'+(tab==="inspect")+'"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/></svg> ตรวจเหล็ก</button>'
      + '</div><div class="rp-body">';

  if(tab==="palette"){
    var _flr=getFloor(state.floorId), _allM=_flr?membersOfFloor(_flr.id):[];
    var eyeO='<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
    var eyeX='<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 4.2A9.8 9.8 0 0 1 12 4c6.5 0 10 7 10 7a13 13 0 0 1-2.3 3M6.6 6.6A13 13 0 0 0 2 12s3.5 7 10 7a9.5 9.5 0 0 0 4.3-1M3 3l18 18"/></svg>';
    // เครื่องมือวาด / โหมด / ชนิดที่วาด / สไตล์กรอบ ย้ายไปที่แถบริบบอนด้านบนแล้ว — พาเนลนี้เหลือ เลเยอร์
    h+='<div class="note-info" style="margin-top:0;display:flex;gap:8px;align-items:flex-start"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;margin-top:1px"><path d="M12 8h.01M11 12h1v4h1"/><circle cx="12" cy="12" r="9"/></svg><span>เครื่องมือวาด · สไตล์กรอบ · โหมด · ป้าย/สี อยู่ที่<b>แถบริบบอนด้านบน</b> (แท็บ “วาด” / “มุมมอง”) — ตรงนี้ปรับ<b>เลเยอร์</b></span></div>';

    // ── เลเยอร์ (พับ) ──
    if(state.unified){
      var shown=TYPE_ORDER.filter(function(t){return !state.hiddenTypes[t];}).length;
      var layerChips=TYPE_ORDER.map(function(t){
        var cnt=_allM.filter(function(mm){return mm.type===t && mm.plan;}).length, vis=!state.hiddenTypes[t];
        return '<button class="tchip lay'+(vis?" on":"")+'" data-act="toggleLayer" data-type="'+t+'" title="'+(vis?"ซ่อน":"แสดง")+'"><span class="tc-eye">'+(vis?eyeO:eyeX)+'</span><span class="tc-sw" style="background:var(--t-'+TYPES[t].css+')"></span>'+esc(TYPE_EN[t]||TYPES[t].label)+' <b>'+cnt+'</b></button>';
      }).join("");
      h+=rpSec('เลเยอร์ที่แสดง','<span class="sec-badge">'+shown+'/'+TYPE_ORDER.length+'</span>','<div class="type-chips">'+layerChips+'</div>',false);
    }

    // (ย้าย "การแสดงผลบนแปลน" ไปริบบอนแท็บ "มุมมอง" และ "สไตล์กรอบ" ไปริบบอนแท็บ "วาด")

  }else if(tab==="list"){
    // รายการชิ้นส่วน — โหมดรวมมีดรอปดาวน์กรองชนิด, โหมดโฟกัสโชว์เฉพาะหมวด
    var lf=state.unified?(state.listFilter||"all"):type;
    var _lpid=curPlanId();
    var listAll=membersOfFloor(state.floorId).filter(function(x){ return memberPlanId(x)===_lpid && (state.unified ? true : x.type===type); });
    var list=listAll.filter(function(x){ return lf==="all"||x.type===lf; })
      .sort(function(a,b){ return (TYPE_ORDER.indexOf(a.type)-TYPE_ORDER.indexOf(b.type)) || String(a.code).localeCompare(String(b.code)); });
    if(state.unified){
      h+='<div class="fld" style="margin-bottom:10px"><span class="fld-l">แสดงชนิด</span><div class="sel-wrap">'
        +'<select id="listFilterSel" class="rp-select"><option value="all"'+(lf==="all"?" selected":"")+'>ทุกชนิด ('+listAll.length+')</option>'
        + TYPE_ORDER.map(function(t){ var n=listAll.filter(function(x){return x.type===t;}).length; return n?('<option value="'+t+'"'+(lf===t?" selected":"")+'>'+esc(TYPES[t].label)+' ('+n+')</option>'):''; }).join("")
        +'</select></div></div>';
    }
    h+='<div class="note-info" style="margin-top:0">แตะรายการเพื่อ<b>ตรวจเหล็ก</b> · กด “รายละเอียด” บนแถบเครื่องมือเพื่อดู/แก้รูปแบบ</div>';
    h+='<div class="card"><div class="card-b" style="padding:8px">';
    if(list.length===0){
      h+='<div class="empty small">ยังไม่มี — วาดบนแปลน หรือกด “เพิ่ม…”</div>';
    }else{
      var eyeOpen='<svg class="ic" viewBox="0 0 24 24" width="1.15em" height="1.15em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
      var eyeOff='<svg class="ic" viewBox="0 0 24 24" width="1.15em" height="1.15em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 4.2A9.8 9.8 0 0 1 12 4c6.5 0 10 7 10 7a13 13 0 0 1-2.3 3M6.6 6.6A13 13 0 0 0 2 12s3.5 7 10 7a9.5 9.5 0 0 0 4.3-1M3 3l18 18"/></svg>';
      var copyIc='<svg class="ic" viewBox="0 0 24 24" width="1.15em" height="1.15em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
      var grouped=(lf==="all"), curType=null;
      list.forEach(function(x){
        if(grouped && x.type!==curType){ curType=x.type; var gc=list.filter(function(y){return y.type===x.type;}).length;
          h+='<div class="lst-group"><span class="lst-g-sw" style="background:var(--t-'+TYPES[x.type].css+')"></span>'+esc(TYPES[x.type].label)+' <span class="muted">('+gc+')</span></div>'; }
        h+='<div class="row-item lst'+(x.hidden?" is-hidden":"")+(x.id===state.selMemberId?" sel":"")+'" style="margin-bottom:6px">'
          +  '<button class="lst-main" data-act="editListMember" data-id="'+esc(x.id)+'">'
          +    chipHtml(x.code,TYPES[x.type].css)
          +    '<div class="body"><div class="t1">'+esc(x.name||x.code)+'</div>'
          +      '<div class="t2 mono">'+esc(shortSpec(x))+'</div>'
          +      '<div class="t2">'+(x.plan?'<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg> วางบนแปลนแล้ว':'<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2.5"/></svg> ยังไม่วางบนแปลน')+'</div></div></button>'
          +  '<button class="lst-ic" data-act="toggleHide" data-id="'+esc(x.id)+'" title="'+(x.hidden?"แสดงบนแปลน":"ซ่อนบนแปลน")+'">'+(x.hidden?eyeOff:eyeOpen)+'</button>'
          +  '<button class="lst-ic" data-act="dupMember" data-id="'+esc(x.id)+'" title="ทำซ้ำชิ้นนี้ (เบอร์เดียวกัน คนละตำแหน่ง)">'+copyIc+'</button>'
          +  '</div>';
      });
    }
    h+='<button class="add-row" data-act="addInCat" style="margin-top:2px">+ เพิ่ม'+esc(TYPES[type].label)+'ด้วยฟอร์ม</button>';
    h+='</div></div>';

  }else if(tab==="spec"){
    if(!m){
      h+=emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/></svg>',"ยังไม่ได้เลือก"+TYPES[type].label,"แตะที่รูปบนแปลน หรือเลือกจากแท็บ “สไตล์/ลาย”");
    }else{
      h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'+chipHtml(m.code,TYPES[m.type].css)
        +'<div style="min-width:0"><div style="font-size:1.1rem;font-weight:800">'+esc(m.name||m.code)+'</div>'
        +'<div class="small muted">'+esc(TYPES[m.type].label)+(m.grid?" · แนว "+esc(m.grid):"")+'</div></div></div>';
      if(m.note) h+='<div class="note-warn" style="margin-top:0;margin-bottom:10px"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg> '+esc(m.note)+'</div>';
      h+=sectionCardHtml(m)+spanCardHtml(m)+summaryCardHtml(m)+spRebarCardHtml(m)+specCardHtml(m);
      if(isBox(m.plan)){
        h+='<div class="card"><div class="card-h">สไตล์กรอบบนแปลน</div><div class="card-b">'
          +'<div style="display:flex;align-items:center;gap:12px">'
          +'<input type="color" id="memFill" value="'+esc(m.plan.fill||"#f59e0b")+'" style="width:54px;height:42px;padding:2px;border-radius:9px">'
          +'<div style="flex:1"><div class="tiny muted" style="margin-bottom:3px">ความเข้มสีด้านใน</div>'
          +'<input type="range" id="memAlpha" min="0" max="100" value="'+Math.round((m.plan.fillA!=null?m.plan.fillA:0.28)*100)+'" style="width:100%"></div>'
          +'</div>'
          +'<div style="margin-top:10px"><div class="tiny muted" style="margin-bottom:3px">ความหนาเส้นกรอบ (0 = ไม่มีเส้น)</div>'
          +'<input type="range" id="memStroke" min="0" max="30" value="'+Math.round(m.plan.strokeW!=null?m.plan.strokeW:10)+'" style="width:100%"></div>'
          +'</div></div>';
      }
      h+='<hr class="sep"><div class="row-end">'
        +'<button class="btn soft" data-act="editMember"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg> แก้ไขสเปก</button>'
        +'<button class="btn danger" data-act="delMember"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/></svg> ลบ</button></div>';
    }
  }else{ // inspect
    if(!m){
      h+=emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/></svg>',"ยังไม่ได้เลือก"+TYPES[type].label,"แตะที่รูปบนแปลนเพื่อดูข้อมูล + ตรวจเหล็ก");
    }else{
      h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'+chipHtml(m.code,TYPES[m.type].css)
        +'<div style="min-width:0"><div style="font-size:1.1rem;font-weight:800">'+esc(m.name||m.code)+'</div>'
        +'<div class="small muted">'+esc(TYPES[m.type].label)+(m.grid?" · แนว "+esc(m.grid):"")+'</div></div></div>';
      if(m.note) h+='<div class="note-warn" style="margin-top:0;margin-bottom:10px"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg> '+esc(m.note)+'</div>';
      h+=inspectionBlockHtml(m);   // เหลือแค่เช็คลิสต์ตรวจเหล็ก + หลักฐาน/ยืนยัน
    }
  }
  return h+'</div>';
}

/* ---- ริบบอนบนสุดของเอดิเตอร์ (แนว Office/Revit) — เดสก์ท็อป ---- */
function planRibbonHtml(type, planMenu, sm, selM){
  var rt=state.ribbonTab||"home";
  var isD=function(sh){ return state.tool==="draw" && (state.drawShape||"rect")===sh; };
  var ICsel='<svg viewBox="0 0 24 24"><path d="m4 4 7 17 2.5-7.5L21 11Z"/></svg>';
  var ICrect='<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="1.5"/></svg>';
  var ICpoly='<svg viewBox="0 0 24 24"><path d="M12 3l8 6-3 10H7L4 9z"/></svg>';
  var ICoval='<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="6"/></svg>';
  var ICsnap='<svg viewBox="0 0 24 24"><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="3"/></svg>';
  var ICpdf='<svg viewBox="0 0 24 24"><path d="M14 3v5h5"/><path d="M9 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5H9"/><path d="M12 18v-6M9 15l3 3 3-3"/></svg>';
  var ICtag='<svg viewBox="0 0 24 24"><path d="M20.6 13.4 13 21a2 2 0 0 1-2.8 0L3 13.8V4h9.8l7.8 7.8a2 2 0 0 1 0 1.6Z"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/></svg>';
  var ICgrid='<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>';

  var rbtn=function(on,act,attr,svg,label){ return '<button class="rbn-btn'+(on?" on":"")+'" data-act="'+act+'" '+(attr||"")+'>'+svg+'<span>'+esc(label)+'</span></button>'; };
  var grp=function(cap,inner){ return '<div class="rbn-grp"><div class="rbn-grp-row">'+inner+'</div><div class="rbn-grp-cap">'+esc(cap)+'</div></div>'; };

  var body='';
  if(rt==="home"){
    body+=grp('แปลน', planMenu);
    body+=grp('โหมดแสดง','<div class="rbn-seg">'
      +'<button data-act="setPlanMode" data-mode="unified" aria-pressed="'+(state.unified)+'">รวมทุกชนิด</button>'
      +'<button data-act="setPlanMode" data-mode="focus" aria-pressed="'+(!state.unified)+'">เฉพาะ '+esc(TYPE_EN[type]||TYPES[type].label)+'</button></div>');
    body+=grp('ชนิดที่วาด','<div class="sel-wrap rbn-sel"><span class="sel-dot" style="background:var(--t-'+TYPES[type].css+')"></span>'
      +'<select id="drawTypeSel" class="rp-select">'+TYPE_ORDER.map(function(t){ return '<option value="'+t+'"'+(t===type?" selected":"")+'>'+esc(TYPE_EN[t]||TYPES[t].label)+'</option>'; }).join("")+'</select></div>');
    body+=grp('นำออก', rbtn(false,"exportPdf",'title="นำออกแปลน + ไฮไลท์ เป็น PDF"',ICpdf,'ออก PDF'));
  }else if(rt==="draw"){
    body+=grp('เลือก', rbtn(state.tool==="select","setTool",'data-tool="select"',ICsel,'เลือก/ย้าย'));
    body+=grp('วาดรูป', rbtn(isD("rect"),"setShape",'data-shape="rect"',ICrect,'สี่เหลี่ยม')
      +rbtn(isD("poly"),"setShape",'data-shape="poly"',ICpoly,'หลายเหลี่ยม')
      +rbtn(isD("oval"),"setShape",'data-shape="oval"',ICoval,'วงรี'));
    body+=grp('ตัวช่วย', rbtn(!!state.snap,"toggleSnap",'',ICsnap,'สแนบเส้น'));
    // ปุ่มเปิดหน้าต่างลอยสไตล์กรอบ (สี/ความเข้ม/ความหนาเส้น)
    if(drawKind(type)==="rect"){
      var selRect=(selM&&isBox(selM.plan))?selM:null;
      var sc=selRect?(selRect.plan.fill||"#f59e0b"):state.fillColor;
      var styleBtnInner='<div class="rbn-swatch" style="background:'+esc(sc)+';opacity:'+(selRect?(selRect.plan.fillA!=null?selRect.plan.fillA:0.28):state.fillAlpha)+';width:28px;height:28px;border-radius:6px"></div>';
      body+=grp('สไตล์กรอบ', '<button class="rbn-style-toggle'+(state.floatStyleOpen?" on":"")+'" data-act="toggleFloatStyle" title="ตั้งค่าสไตล์กรอบ">'
        +styleBtnInner
        +'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20a7 7 0 0 0 0-14H4"/><path d="M7.5 3 4 6.5 7.5 10"/></svg>'
        +'</button>');
    }
  }else{ // view
    body+=grp('ลงสีตาม','<div class="rbn-seg">'
      +'<button data-act="colorMode" data-mode="status" aria-pressed="'+(state.colorMode==="status")+'">สถานะ</button>'
      +'<button data-act="colorMode" data-mode="plain" aria-pressed="'+(state.colorMode==="plain")+'">ประเภท</button></div>');
    body+=grp('บนแปลน', rbtn(!!state.showLabels,"toggleLabels",'',ICtag,'ป้ายเบอร์')
      +rbtn(!!state.showLegend,"toggleLegend",'',ICgrid,'ตารางสี'));
  }

  var tab=function(id,label){ return '<button class="rbn-tab" data-act="setRibbonTab" data-rtab="'+id+'" aria-selected="'+(rt===id)+'">'+esc(label)+'</button>'; };
  var stats='<div class="tb-stats">'
    +'<span class="tb-chip"><b>'+sm.total+'</b> ชิ้น</span>'
    +'<span class="tb-chip ok"><b>'+sm.pass+'</b> ผ่าน</span>'
    +'<span class="tb-chip bad"><b>'+sm.fail+'</b> ไม่ผ่าน</span>'
    +'<span class="tb-chip wait"><b>'+sm.todo+'</b> รอตรวจ</span></div>';
  var collapse='<button class="btn soft rbn-collapse tb-collapse'+(state.rpCollapsed?" on":"")+'" data-act="toggleRp" title="'+(state.rpCollapsed?"แสดงพาเนลข้อมูล":"ซ่อนพาเนลข้อมูล")+'"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>'+(state.rpCollapsed?'<path d="m9 9 2 3-2 3"/>':'<path d="m11 9-2 3 2 3"/>')+'</svg> <span class="tbc-tx">'+(state.rpCollapsed?"แสดงพาเนล":"ซ่อนพาเนล")+'</span></button>';

  return '<div class="ribbon">'
    + '<div class="rbn-tabs">'+tab("home","หน้าแรก")+tab("draw","วาด")+tab("view","มุมมอง")+'<span class="rbn-tabs-sp"></span>'+stats+collapse+'</div>'
    + '<div class="rbn-body">'+body+'</div>'
    + '</div>';
}

function viewPlanEditor(){
  var f=getFloor(state.floorId), type=state.catType;
  if(!f||!type) return emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',"ไม่พบหมวด","");
  var plan=getFloorPlan(f);
  var kindWord = drawKind(type)==="point" ? "จุด" : drawKind(type)==="rect" ? "พื้นที่" : "แนว";
  var selM=getMember(state.selMemberId); if(selM && !state.unified && selM.type!==type) selM=null;   // โหมดรวมเลือกได้ทุกชนิด
  // สรุปสถานะของชิ้นส่วนบนแปลนปัจจุบัน (ใช้ทำชิปบนแถบเครื่องมือ)
  var _pidTB=curPlanId();
  var _vm=membersOfFloor(f.id).filter(function(m){ return m.plan && memberPlanId(m)===_pidTB && (state.unified ? !state.hiddenTypes[m.type] : m.type===type); });
  var sm=summarize(_vm);

  var _plans=floorPlans(f), _icPlan='<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m21 15-5-5L5 21"/></svg>';
  var planMenu='<details class="tb-menu"><summary class="btn soft" style="margin:0">'+_icPlan+' '
      + (plan? esc(plan.name||"แปลน")+(_plans.length>1?' <span class="tb-badge">'+_plans.length+'</span>':'') : 'นำเข้าแปลน')
      + ' <span class="caret">▾</span></summary><div class="tb-menu-b">';
  if(_plans.length){
    planMenu+='<div class="tbm-h">แปลนในชั้นนี้</div>';
    _plans.forEach(function(pp){ planMenu+='<button class="tbm-item'+(pp.id===f.activePlanId?" on":"")+'" data-act="switchPlan" data-pid="'+esc(pp.id)+'">'+_icPlan+' <span class="tbm-t">'+esc(pp.name||"แปลน")+'</span>'+(pp.id===f.activePlanId?'<span class="tbm-ck">✓</span>':'')+'</button>'; });
    planMenu+='<div class="tbm-sep"></div>';
  }
  planMenu+='<button class="tbm-item" data-act="addPlan"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> <span class="tbm-t">นำเข้าแปลนใหม่ (รูป / PDF)</span></button>';
  if(plan){
    planMenu+='<button class="tbm-item" id="btnPickPlan"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg> <span class="tbm-t">เปลี่ยนรูปแปลนนี้</span></button>';
    planMenu+='<button class="tbm-item danger" data-act="removePlan"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/></svg> <span class="tbm-t">ลบแปลนนี้</span></button>';
  }
  planMenu+='</div></details>';

  var left='<div class="editor-left">'
    + planRibbonHtml(type, planMenu, sm, selM)
    + '<input type="file" id="planFile" accept="image/*,application/pdf,.pdf" hidden>'
    + (state.tool==="drawZone" ? '<div class="note-info" style="margin:0 0 8px;border-color:#22c55e;background:rgba(34,197,94,0.06)">วาดโซนเท: ลากสี่เหลี่ยมคลุมพื้นที่บนแปลน แล้วตั้งชื่อโซน</div>'
       : state.tool==="draw" ? '<div class="note-info" style="margin:0 0 8px">โหมดวาด: '
        + (drawKind(type)==="point" ? 'แตะบนแปลนเพื่อวาง'+esc(TYPES[type].label)
          : drawKind(type)!=="rect" ? 'ลากบนแปลนเพื่อกำหนดแนว'+esc(TYPES[type].label)
          : state.drawShape==="poly" ? 'คลิกทีละจุด — ดับเบิลคลิกหรือคลิกที่จุดแรกเพื่อปิดรูป'
          : 'ลากบนแปลนเพื่อวาด'+(state.drawShape==="oval"?'วงรี':'สี่เหลี่ยม'))
        + ' แล้วใส่เบอร์</div>' : '')
    + planStageHtml()
    + '</div>';

  var right='<div class="editor-right">'+rightPanelHtml()+'</div>';
  var split='<div class="rp-splitter" id="rpSplitter" title="ลากเพื่อปรับความกว้างพาเนล"></div>';
  return '<div class="editor'+(state.rpCollapsed?" rp-collapsed":"")+'" id="editorGrid" style="--rp-w:'+(state.rpWidth||380)+'px">'+left+split+right+'</div>';
}

/* ---------------------------------------------------------------------------
   หน้าจอ: อัพเดทความคืบหน้าเทคอนกรีต — แยกจากหน้าแก้ไขแปลน (โชว์เฉพาะโซน)
   ------------------------------------------------------------------------ */
function viewProgress(){
  var f=getFloor(state.floorId), p=getProject(state.projectId);
  if(!f) return emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9h18M9 21V9"/></svg>',"ยังไม่ได้เลือกชั้น","เปิดโครงการและชั้นก่อน แล้วกด “อัพเดทความคืบหน้า”");
  var plan=getFloorPlan(f);
  var _pidP=curPlanId();
  var zones=zonesOfPlan(f.id, _pidP);
  var stListP=zoneStatuses(f.id,_pidP);
  var countsP={}; zones.forEach(function(z){ countsP[z.status]=(countsP[z.status]||0)+1; });

  var _icPlan='<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m21 15-5-5L5 21"/></svg>';
  var _plans=floorPlans(f);
  var planMenu='<details class="tb-menu"><summary class="btn soft" style="margin:0">'+_icPlan+' '
      + (plan? esc(plan.name||"แปลน")+(_plans.length>1?' <span class="tb-badge">'+_plans.length+'</span>':'') : 'ยังไม่มีแปลน')
      + ' <span class="caret">▾</span></summary><div class="tb-menu-b">';
  if(_plans.length){
    planMenu+='<div class="tbm-h">แปลนในชั้นนี้</div>';
    _plans.forEach(function(pp){ planMenu+='<button class="tbm-item'+(pp.id===f.activePlanId?" on":"")+'" data-act="switchPlan" data-pid="'+esc(pp.id)+'">'+_icPlan+' <span class="tbm-t">'+esc(pp.name||"แปลน")+'</span>'+(pp.id===f.activePlanId?'<span class="tbm-ck">✓</span>':'')+'</button>'; });
  }else{
    planMenu+='<div class="tbm-h">ยังไม่มีแปลนในชั้นนี้ — เพิ่มแปลนจากหน้า “ตรวจสอบชิ้นส่วน”</div>';
  }
  planMenu+='</div></details>';

  var ICpdf='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v5h5"/><path d="M9 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5H9"/><path d="M12 18v-6M9 15l3 3 3-3"/></svg>';
  var ICdraw='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M12 3v3M12 18v3"/></svg>';
  var ICrect='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="12" rx="1.5"/></svg>';
  var ICpoly='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 6-3 10H7L4 9z"/></svg>';
  var ICsnap='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="3"/></svg>';
  var drawMenu='<details class="tb-menu"'+(state.tool==="drawZone"?' open':'')+'><summary class="btn'+(state.tool==="drawZone"?" on":"")+'" style="margin:0">'+ICdraw+' วาดโซนใหม่ <span class="caret">▾</span></summary><div class="tb-menu-b">'
    +'<div class="tbm-h">รูปทรงโซน</div>'
    +'<button class="tbm-item'+(state.tool==="drawZone"&&state.zoneShape==="rect"?" on":"")+'" data-act="drawZoneStart" data-shape="rect">'+ICrect+' <span class="tbm-t">สี่เหลี่ยม</span></button>'
    +'<button class="tbm-item'+(state.tool==="drawZone"&&state.zoneShape==="poly"?" on":"")+'" data-act="drawZoneStart" data-shape="poly">'+ICpoly+' <span class="tbm-t">หลายเหลี่ยม (คลิกทีละจุด)</span></button>'
    +'<div class="tbm-sep"></div>'
    +'<button class="tbm-item'+(state.snap?" on":"")+'" data-act="toggleSnap">'+ICsnap+' <span class="tbm-t">สแนบเส้นแปลน</span>'+(state.snap?'<span class="tbm-ck">✓</span>':'')+'</button>'
    +'</div></details>';
  var ICeye=state.showProgress?'<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>':'<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.2A9.8 9.8 0 0 1 12 4c6.5 0 10 7 10 7a13 13 0 0 1-2.3 3M6.6 6.6A13 13 0 0 0 2 12s3.5 7 10 7a9.5 9.5 0 0 0 4.3-1M3 3l18 18"/></svg>';

  var toolbar='<div class="prog-bar">'
    + '<button class="btn soft prog-back" data-act="back" title="กลับ"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg> กลับ</button>'
    + '<div class="prog-title"><b>อัพเดทความคืบหน้าเทคอนกรีต</b><small>'+esc(p?p.name:"")+(f.name?' · '+esc(f.name):'')+'</small></div>'
    + planMenu
    + '<div class="prog-sp"></div>'
    + '<span class="prog-counts">'+zones.length+' โซน'+stListP.map(function(s){ return ' · <span class="prog-c"><span class="prog-c-dot" style="background:'+s.color+'"></span>'+esc(s.label)+' '+(countsP[s.id]||0)+'</span>'; }).join("")+'</span>'
    + drawMenu
    + '<button class="btn soft" data-act="toggleProgress" title="ซ่อน/แสดงโซน">'+ICeye+'</button>'
    + '<button class="btn soft" data-act="exportProgressPdf">'+ICpdf+' PDF อัพเดท</button>'
    + '</div>';

  var hint = state.tool==="drawZone" ? '<div class="note-info" style="margin:0 0 8px;border-color:#22c55e;background:rgba(34,197,94,0.06)">วาดโซนเท: ลากสี่เหลี่ยมคลุมพื้นที่บนแปลน แล้วตั้งชื่อโซน</div>' : '';

  return '<div class="prog-wrap">'+toolbar+hint+planStageHtml()+'</div>';
}

/* ---------------------------------------------------------------------------
   ผูก event ของเอดิเตอร์แปลน: นำเข้ารูป + วาด + เลือก + อินพุตตรวจเหล็ก
   ------------------------------------------------------------------------ */
/* ---- ซูม/เลื่อนแปลน: ใช้ transform บน #planCanvas (transform-origin 0 0) ---- */
/** ขนาดกรอบแปลน — แคชไว้ 1 เฟรม กันอ่าน clientWidth ซ้ำ ๆ (บังคับ layout reflow = ต้นเหตุกระตุก) */
var _szCache=null, _szAt=0;
function _stageWH(){
  var now=(window.performance&&performance.now)?performance.now():Date.now();
  if(_szCache && (now-_szAt)<16) return _szCache;        // ใช้ซ้ำได้ ~1 เฟรม
  var st=$("#planStage"); if(!st) return null;
  _szCache={w:st.clientWidth, h:st.clientHeight}; _szAt=now;
  return _szCache;
}
/** ทาทรานส์ฟอร์มแบบจำกัด 1 ครั้งต่อเฟรม (rAF) — ล้อเมาส์ยิงถี่แค่ไหนก็ไม่กระตุก */
var _ptRaf=0, _ptPending=false;
function planApplyTransform(){
  if(_ptRaf){ _ptPending=true; return; }          // มีคิวในเฟรมนี้แล้ว → รอรอบหน้า
  _planTransformNow();
  _ptRaf=requestAnimationFrame(function(){
    _ptRaf=0;
    if(_ptPending){ _ptPending=false; planApplyTransform(); }   // ทาค่าล่าสุดอีกรอบ
  });
}
function _planTransformNow(){
  var c=$("#planCanvas"); if(!c) return;
  var t="translate("+state.panX+"px,"+state.panY+"px) scale("+state.zoom+")";
  c.style.transformOrigin="0 0"; c.style.transform=t;
  var ov=$("#planOverlay"); if(ov){ ov.style.transformOrigin="0 0"; ov.style.transform=t; }   // ไฮไลท์ (เวกเตอร์) ซูมตามได้ คมเสมอ
  positionDetail();      // เลเยอร์ภาพคม (screen-space) วางตามตำแหน่งจริงบนจอ
  updateLabelScale();
}
/** วางเลเยอร์ภาพคม (#planDetail) ในพิกัดจอจริง — คมบน iOS เพราะไม่อยู่ใน transform ที่ถูกซูม */
function positionDetail(){
  var det=$("#planDetail"); if(!det || det.style.display==="none") return;
  var doc=PLAN_DOCS[planSourceKey()], sz=_stageWH();
  if(!doc || !doc.detailBox || !sz){ return; }
  var sw=sz.w, sh=sz.h, z=state.zoom, px=state.panX, py=state.panY, b=doc.detailBox;
  det.style.left=(b.rx1*sw*z+px)+"px";
  det.style.top=(b.ry1*sh*z+py)+"px";
  det.style.width=((b.rx2-b.rx1)*sw*z)+"px";
  det.style.height=((b.ry2-b.ry1)*sh*z)+"px";
}
/** ปรับป้ายเบอร์และจุดจับให้คงขนาดคงที่บนจอ (สวนทางกับการซูม) จึงไม่บานตอนซูมเข้า */
function updateLabelScale(){
  var zl=$("#zoomLabel"); if(zl) zl.textContent=Math.round((state.zoom||1)*100)+"%";   // ป้าย % บนแถบลอย
  var ov=$("#planOverlay"); if(!ov) return;
  var s=1/(state.zoom||1);
  $$(".plan-label, .plan-handle", ov).forEach(function(g){
    var ax=+g.getAttribute("data-ax"), ay=+g.getAttribute("data-ay");
    var ls=parseFloat(g.getAttribute("data-ls"))||1;   // ป้ายเบอร์ปรับขนาดเองได้
    var sc=s*ls;
    g.setAttribute("transform","translate("+ax+" "+ay+") scale("+sc+") translate("+(-ax)+" "+(-ay)+")");
  });
}
function planClampPan(){
  var sz=_stageWH(); if(!sz) return;
  var w=sz.w, h=sz.h, s=state.zoom;
  state.panX=Math.min(0, Math.max(w*(1-s), state.panX));   // กันเลื่อนจนภาพหลุดกรอบ
  state.panY=Math.min(0, Math.max(h*(1-s), state.panY));
}
/** ซูมสูงสุด: PDF เรนเดอร์ใหม่ได้ → ซูมลึก; รูปภาพ → ไม่เกินความละเอียดจริง (ไม่เบลอ) */
function planMaxZoom(){
  var sz=_stageWH(); if(!sz||!sz.w) return 8;
  var doc=PLAN_DOCS[planSourceKey()];
  if(doc && doc.kind==="pdf") return 10;                          // เวกเตอร์ เรนเดอร์ใหม่ตามซูม
  var natW = doc&&doc.natW ? doc.natW : (currentPlan()?currentPlan().w:0);
  if(natW) return Math.max(2, Math.min(12, natW/sz.w));
  return 8;
}
/** ซูมโดยคงจุดใต้เคอร์เซอร์ (cx,cy = พิกัดเทียบมุมซ้ายบนของกรอบ) */
function planZoomBy(f, cx, cy){
  var s1=state.zoom, s2=Math.max(1, Math.min(planMaxZoom(), s1*f));
  if(s2===s1){ scheduleEnsure(); return; }   // สุดซูมแล้ว (คลิกต่อ) → ยังสั่งเรนเดอร์ส่วนคมให้
  state.panX = cx - (cx-state.panX)*(s2/s1);
  state.panY = cy - (cy-state.panY)*(s2/s1);
  state.zoom = s2;
  if(Math.abs(s2-1)<0.001){ state.panX=0; state.panY=0; }
  planClampPan(); planApplyTransform();
  scheduleEnsure();   // เรนเดอร์ส่วนคม "หลังหยุดซูม" เท่านั้น (กันกระตุกระหว่างซูม)
}
function planFit(){ state.zoom=1; state.panX=0; state.panY=0; planApplyTransform(); }

function bindPlanEditor(){
  // นำเข้าแปลน (รูป / PDF)
  var pf=$("#planFile");
  if(pf) pf.addEventListener("change",function(e){
    var file=e.target.files && e.target.files[0];
    if(!file){ planLog("ไม่ได้เลือกไฟล์ (ยกเลิก)"); return; }
    planLog("เลือกไฟล์: "+file.name+" · "+(file.type||"ไม่ทราบชนิด")+" · "+Math.round(file.size/1024)+" KB");
    importPlan(file);
    e.target.value="";
  });
  // ปุ่มนำเข้า: เปิดหน้าต่างเลือกไฟล์ + log ให้รู้ว่าคลิกติด
  var pb=$("#btnPickPlan");
  if(pb) pb.addEventListener("click",function(){ planLog("กดปุ่มนำเข้าแปลน — เปิดหน้าต่างเลือกไฟล์"); if(pf) pf.click(); });

  // เส้นแบ่งลากได้ — ปรับความกว้างพาเนลขวา (ลากซ้าย=พาเนลกว้างขึ้น, ลากขวา=แปลนกว้างขึ้น)
  var sp=$("#rpSplitter"), grid=$("#editorGrid");
  if(sp && grid) sp.addEventListener("pointerdown",function(ev){
    ev.preventDefault();
    var startX=ev.clientX, startW=state.rpWidth||380;
    try{ sp.setPointerCapture(ev.pointerId); }catch(x){}
    function mv(e){
      var w=Math.max(300, Math.min(720, startW - (e.clientX-startX)));
      state.rpWidth=w; grid.style.setProperty("--rp-w", w+"px");
    }
    function up(){
      sp.removeEventListener("pointermove",mv); sp.removeEventListener("pointerup",up);
      try{ localStorage.setItem("rebarcheck.rpw", String(state.rpWidth)); }catch(e){}
    }
    sp.addEventListener("pointermove",mv); sp.addEventListener("pointerup",up);
  });

  // ลากย้ายตารางสี (Legend)
  var lgd=$("#legendDrag"), lg=$("#planLegend"), lgStage=$("#planStage");
  if(lgd && lg && lgStage){
    lgd.addEventListener("pointerdown",function(ev){
      if(ev.target.closest(".lg-x")) return;
      ev.preventDefault(); var r=lgStage.getBoundingClientRect(), lr=lg.getBoundingClientRect();
      var ox=ev.clientX-lr.left, oy=ev.clientY-lr.top;
      try{ lgd.setPointerCapture(ev.pointerId); }catch(e){}
      function mvL(e2){ var x=Math.max(0,Math.min(r.width-40, e2.clientX-r.left-ox)), y=Math.max(0,Math.min(r.height-30, e2.clientY-r.top-oy));
        lg.style.left=x+"px"; lg.style.top=y+"px"; state.legendPos={x:Math.round(x),y:Math.round(y)}; }
      function upL(){ lgd.removeEventListener("pointermove",mvL); lgd.removeEventListener("pointerup",upL); }
      lgd.addEventListener("pointermove",mvL); lgd.addEventListener("pointerup",upL);
    });
  }

  // หน้าต่างเครื่องมือลอย (ตอนซ่อนพาเนล): ดรอปดาวน์ชนิด + ลากย้าย
  var dtsF=$("#drawTypeSelF");
  if(dtsF) dtsF.addEventListener("change",function(){ state.catType=dtsF.value; if(state.hiddenTypes) delete state.hiddenTypes[dtsF.value]; render(); });
  var ftd=$("#floatToolsDrag"), ftw=$("#floatTools"), ftStage=$("#planStage");
  if(ftd && ftw && ftStage){
    ftd.addEventListener("pointerdown",function(ev){
      if(ev.target.closest(".ftl-x")) return;
      ev.preventDefault(); var r=ftStage.getBoundingClientRect(), wr=ftw.getBoundingClientRect();
      var ox=ev.clientX-wr.left, oy=ev.clientY-wr.top;
      try{ ftd.setPointerCapture(ev.pointerId); }catch(e){}
      function mvF(e2){ var x=Math.max(0,Math.min(r.width-60, e2.clientX-r.left-ox)), y=Math.max(0,Math.min(r.height-40, e2.clientY-r.top-oy));
        ftw.style.left=x+"px"; ftw.style.top=y+"px"; state.floatToolsPos={x:Math.round(x),y:Math.round(y)}; }
      function upF(){ ftd.removeEventListener("pointermove",mvF); ftd.removeEventListener("pointerup",upF); }
      ftd.addEventListener("pointermove",mvF); ftd.addEventListener("pointerup",upF);
    });
  }

  // หน้าต่างลอยสไตล์กรอบ: ลากย้ายได้
  var fsd=$("#floatStyleDrag"), fsw=$("#floatStyle"), fsStage=$("#planStage");
  if(fsd && fsw && fsStage){
    fsd.addEventListener("pointerdown",function(ev){
      if(ev.target.closest(".ftl-x")) return;
      ev.preventDefault(); var r=fsStage.getBoundingClientRect(), wr=fsw.getBoundingClientRect();
      var ox=ev.clientX-wr.left, oy=ev.clientY-wr.top;
      try{ fsd.setPointerCapture(ev.pointerId); }catch(e){}
      function mvS(e2){ var x=Math.max(0,Math.min(r.width-60, e2.clientX-r.left-ox)), y=Math.max(0,Math.min(r.height-40, e2.clientY-r.top-oy));
        fsw.style.left=x+"px"; fsw.style.top=y+"px"; state.floatStylePos={x:Math.round(x),y:Math.round(y)}; }
      function upS(){ fsd.removeEventListener("pointermove",mvS); fsd.removeEventListener("pointerup",upS); }
      fsd.addEventListener("pointermove",mvS); fsd.addEventListener("pointerup",upS);
    });
  }

  // ผูกลากหน้าต่างลอยความคืบหน้า
  var fpd=$("#floatProgressDrag"), fpw=$("#floatProgress"), fpStage=$("#planStage");
  if(fpd && fpw && fpStage){
    fpd.addEventListener("pointerdown",function(ev){
      if(ev.target.closest(".ftl-x")) return;
      ev.preventDefault(); var r=fpStage.getBoundingClientRect(), wr=fpw.getBoundingClientRect();
      var ox=ev.clientX-wr.left, oy=ev.clientY-wr.top;
      try{ fpd.setPointerCapture(ev.pointerId); }catch(e){}
      function mvP(e2){ var x=Math.max(0,Math.min(r.width-60, e2.clientX-r.left-ox)), y=Math.max(0,Math.min(r.height-40, e2.clientY-r.top-oy));
        fpw.style.left=x+"px"; fpw.style.top=y+"px"; state.floatProgressPos={x:Math.round(x),y:Math.round(y)}; }
      function upP(){ fpd.removeEventListener("pointermove",mvP); fpd.removeEventListener("pointerup",upP); }
      fpd.addEventListener("pointermove",mvP); fpd.addEventListener("pointerup",upP);
    });
  }
  // ผูกอินพุตแก้ไขโซน
  var zni=$("#zoneNameInput"), zsi=$("#zoneStatusSel"), zdi=$("#zoneDateInput");
  if(zni){ zni.addEventListener("input",function(){ var z=getZone(state.selZoneId); if(z){ z.name=zni.value; saveDB(); var ov=$("#planOverlay"); if(ov) ov.innerHTML=planShapesSVG(+ov.getAttribute("data-vw"),+ov.getAttribute("data-vh")); } }); }
  if(zsi){ zsi.addEventListener("change",function(){ var z=getZone(state.selZoneId); if(z){ z.status=zsi.value; saveDB(); render(); } }); }
  if(zdi){ zdi.addEventListener("change",function(){ var z=getZone(state.selZoneId); if(z){ z.date=zdi.value||null; saveDB(); render(); } }); }

  // ผูกอินพุตของบล็อกตรวจเหล็ก เมื่ออยู่แท็บ inspect
  if(state.rightTab==="inspect" && getMember(state.selMemberId)) bindInspectionInputs();

  // toggle แสดงเบอร์
  var cl=$("#chkLabels");
  if(cl) cl.addEventListener("change",function(){ state.showLabels=cl.checked; render(); });
  // toggle สแนบ (ในแท็บเครื่องมือวาด)
  var sc0=$("#snapSwitch");
  if(sc0) sc0.addEventListener("click",function(){ state.snap=!state.snap; var sw=sc0.querySelector(".rp-switch"); if(sw) sw.classList.toggle("off",!state.snap); });
  // ดรอปดาวน์เลือกชนิดที่กำลังวาด
  var dts=$("#drawTypeSel");
  if(dts) dts.addEventListener("change",function(){ state.catType=dts.value; if(state.hiddenTypes) delete state.hiddenTypes[dts.value]; render(); });
  // ดรอปดาวน์กรองชนิดในแท็บรายการ
  var lfs=$("#listFilterSel");
  if(lfs) lfs.addEventListener("change",function(){ state.listFilter=lfs.value; render(); });

  // สี/ความเข้ม/ความหนาเส้น (แท็บสไตล์/ลาย) — ถ้าเลือกคานอยู่ ปรับคานนั้นทันที; ถ้าไม่ ตั้งเป็นค่าเริ่มของคานที่จะวาดใหม่
  var dc=$("#drawColor"), da=$("#drawAlpha"), ds=$("#drawStroke"), dsw=$("#drawSwatch");
  function applyStyle(){
    var col=dc?dc.value:state.fillColor, a=da?(+da.value)/100:state.fillAlpha, ww=ds?+ds.value:state.strokeW;
    if(dsw){ dsw.style.background=col; dsw.style.opacity=a; }
    var mm=getMember(state.selMemberId);
    if(mm && isBox(mm.plan)){    // มีคานเลือกอยู่ → ปรับคานนั้น
      mm.plan.fill=col; mm.plan.fillA=a; mm.plan.strokeW=ww;
      var r=$("#planOverlay").querySelector('[data-mid="'+mm.id+'"]');   // rect/ellipse/polygon
      if(r){
        r.setAttribute("fill",col); r.setAttribute("fill-opacity",a);
        if(ww>0){ r.setAttribute("stroke",col); r.setAttribute("stroke-width",ww); } else r.setAttribute("stroke","none");
      }
    }else{                                          // ไม่ได้เลือก → ตั้งค่าเริ่มของคานที่จะวาดใหม่
      state.fillColor=col; state.fillAlpha=a; state.strokeW=ww;
    }
  }
  function saveStyle(){ applyStyle(); if(getMember(state.selMemberId)) saveDB(); }
  if(dc){ dc.addEventListener("input",applyStyle); dc.addEventListener("change",saveStyle); }
  if(da){ da.addEventListener("input",applyStyle); da.addEventListener("change",saveStyle); }
  if(ds){ ds.addEventListener("input",applyStyle); ds.addEventListener("change",saveStyle); }
  // จานสีใช้บ่อย — กดเลือกแล้วใช้ทันที
  $$(".swatch").forEach(function(b){ b.addEventListener("click",function(){
    if(dc) dc.value=b.getAttribute("data-swatch");
    saveStyle();
    $$(".swatch").forEach(function(x){ x.classList.toggle("on", x===b); });
  }); });

  // โหลด pdf.js ไว้ล่วงหน้าแบบเบื้องหลัง เพื่อให้ตอนกดนำเข้า PDF ขึ้นไว (ไม่ต้องรอโหลด CDN)
  if(!window.pdfjsLib && !_pdfjsPromise){ try{ loadPdfJs(); }catch(e){} }

  var overlay=$("#planOverlay"), stage=$("#planStage");
  if(!overlay) return;
  planApplyTransform();   // คงระดับซูม/ตำแหน่งเดิมหลังเรนเดอร์ใหม่
  applyBestImage();       // แสดงภาพคมที่สุด (โหลดต้นฉบับจาก IDB ถ้าจำเป็น)

  // แก้สี/ความเข้ม/ความหนาเส้น ของคานที่เลือก (แท็บรายละเอียด) — อัปเดตสดบนแปลน + บันทึกเมื่อปล่อย
  var mf=$("#memFill"), ma=$("#memAlpha"), ms=$("#memStroke");
  function liveMem(){
    var m=getMember(state.selMemberId); if(!m||!m.plan) return;
    if(mf) m.plan.fill=mf.value;
    if(ma) m.plan.fillA=(+ma.value)/100;
    if(ms) m.plan.strokeW=+ms.value;
    var r=overlay.querySelector('rect[data-mid="'+m.id+'"]');
    if(r){
      r.setAttribute("fill",m.plan.fill);
      r.setAttribute("fill-opacity",m.plan.fillA);
      var bw=m.plan.strokeW;
      if(bw>0){ r.setAttribute("stroke",m.plan.fill); r.setAttribute("stroke-width",bw); }
      else{ r.setAttribute("stroke","none"); }
    }
  }
  function saveMem(){ liveMem(); saveDB(); }
  if(mf){ mf.addEventListener("input",liveMem); mf.addEventListener("change",saveMem); }
  if(ma){ ma.addEventListener("input",liveMem); ma.addEventListener("change",saveMem); }
  if(ms){ ms.addEventListener("input",liveMem); ms.addEventListener("change",saveMem); }

  var VW=+overlay.getAttribute("data-vw"), VH=+overlay.getAttribute("data-vh");
  var NS="http://www.w3.org/2000/svg";
  // แปลงพิกัดจอ → 0..1 ของรูป โดยอิงกรอบของ overlay (สะท้อน transform อยู่แล้ว)
  function norm(ev){
    var r=overlay.getBoundingClientRect();
    var w=r.width||1, h=r.height||1;             // กัน div/0 → พิกัดเป็น NaN (ทำให้กรอบเพี้ยน/หาย)
    var cx=(ev.touches?ev.touches[0].clientX:ev.clientX)-r.left;
    var cy=(ev.touches?ev.touches[0].clientY:ev.clientY)-r.top;
    return { x:Math.max(0,Math.min(1,cx/w)), y:Math.max(0,Math.min(1,cy/h)) };
  }
  // ---- สแนบ: ดูดจุดเข้าเส้น/จุดตัดของแปลน + แสดงเครื่องหมาย ----
  var snapEl=null;
  function showSnap(pt, r){
    if(!pt){ if(snapEl){ snapEl.remove(); snapEl=null; } return; }
    if(!snapEl){ snapEl=document.createElementNS(NS,"g"); snapEl.setAttribute("style","pointer-events:none"); }
    overlay.appendChild(snapEl);   // ให้อยู่บนสุดเสมอ
    var unit=VW/Math.max(1,r.width);            // 1 พิกเซลจอ = กี่หน่วย viewBox (คงที่ทุกซูม)
    var X=pt.x*VW, Y=pt.y*VH, m=5.5*unit;       // กรอบสแนบ ~11px
    var col=pt.type==="end"?"#ff2d2d":(pt.type==="cross"?"#12b312":"#1f7bff");
    var body = (pt.type==="cross")
      ? '<line x1="'+(X-m)+'" y1="'+(Y-m)+'" x2="'+(X+m)+'" y2="'+(Y+m)+'"/><line x1="'+(X-m)+'" y1="'+(Y+m)+'" x2="'+(X+m)+'" y2="'+(Y-m)+'"/>'
      : '<rect x="'+(X-m)+'" y="'+(Y-m)+'" width="'+(2*m)+'" height="'+(2*m)+'"/>';
    snapEl.innerHTML='<g fill="none" stroke="'+col+'" stroke-width="'+(1.6*unit)+'">'+body+'</g>';
  }
  function snapAt(ev){
    var p=norm(ev), r=overlay.getBoundingClientRect();
    var sp=(state.tool==="draw"||state.tool==="drawZone") ? snapNorm(p.x,p.y,r.width,r.height) : null;
    if(sp){ showSnap(sp,r); return {x:sp.x,y:sp.y}; }
    showSnap(null); return p;
  }

  // ล้อเมาส์ = ซูมเข้า/ออก (ทุกโหมด) โดยซูมไปที่ตำแหน่งเคอร์เซอร์
  stage.addEventListener("wheel",function(ev){
    ev.preventDefault();
    var r=stage.getBoundingClientRect();
    planZoomBy(ev.deltaY<0?1.15:1/1.15, ev.clientX-r.left, ev.clientY-r.top);
  }, {passive:false});

  // สองนิ้ว = pinch zoom (มือถือ/แท็บเล็ต) — ตั้ง window.__planPinch เพื่อให้ตัวจัดการลาก/วาดหยุดชั่วคราว
  var _pts={}, _pd0=0; window.__planPinch=false;
  stage.addEventListener("pointerdown",function(ev){
    if(ev.pointerType!=="touch") return;
    _pts[ev.pointerId]={x:ev.clientX,y:ev.clientY};
    var ids=Object.keys(_pts);
    if(ids.length===2){ var a=_pts[ids[0]], b=_pts[ids[1]]; _pd0=Math.hypot(a.x-b.x,a.y-b.y)||1; window.__planPinch=true; }
  },true);
  stage.addEventListener("pointermove",function(ev){
    if(ev.pointerType!=="touch" || !_pts[ev.pointerId]) return;
    _pts[ev.pointerId]={x:ev.clientX,y:ev.clientY};
    if(!window.__planPinch) return;
    var ids=Object.keys(_pts); if(ids.length<2) return;
    var a=_pts[ids[0]], b=_pts[ids[1]], d=Math.hypot(a.x-b.x,a.y-b.y)||1;
    var r=stage.getBoundingClientRect();
    planZoomBy(d/_pd0, (a.x+b.x)/2-r.left, (a.y+b.y)/2-r.top);
    _pd0=d; if(ev.cancelable) ev.preventDefault();
  },true);
  function _pinchEnd(ev){
    if(ev.pointerType!=="touch") return;
    delete _pts[ev.pointerId];
    if(Object.keys(_pts).length<2){ window.__planPinch=false; }   // เหลือ <2 นิ้ว → เลิก pinch
  }
  stage.addEventListener("pointerup",_pinchEnd,true);
  stage.addEventListener("pointercancel",_pinchEnd,true);

  var kind=drawKind(state.catType);

  /* ---------- โหมดเลือก: ลากจุดจับ=ลด/ขยาย/หมุน · ลากตัวคาน=ย้าย · ลากที่ว่าง=เลื่อนภาพ · แตะ=เลือก ---------- */
  if(state.tool==="select"){
    var ps=null, moved=false, mid=null, tf=null, mv=null, ml=null, lsz=null, ztf=null, zmv=null;
    function repaintShapes(){ overlay.innerHTML=planShapesSVG(VW,VH); updateLabelScale(); }
    function clampGeo(pl){   // กันชิ้นส่วนหลุดออกนอกแปลน
      ["x1","x2","y1","y2","x","y"].forEach(function(k){ if(pl[k]!=null) pl[k]=Math.max(0,Math.min(1,pl[k])); });
    }
    function lblAnchor(pl){ if(pl.kind==="point") return {x:pl.x,y:pl.y}; return {x:(pl.x1+pl.x2)/2,y:(pl.y1+pl.y2)/2}; }
    function lblCenterClient(m){ var a=lblAnchor(m.plan), r=overlay.getBoundingClientRect();
      return { x:r.left+(a.x+(m.plan.labelDx||0))*r.width, y:r.top+(a.y+(m.plan.labelDy||0))*r.height }; }
    overlay.addEventListener("dblclick",function(ev){          // ดับเบิลคลิกกล่องเบอร์ → แก้ข้อความ
      var le=ev.target.closest("[data-lbl]"); if(!le) return;
      var lm=getMember(le.getAttribute("data-lbl")); if(!lm) return;
      var cur=(lm.plan.labelText!=null&&lm.plan.labelText!=="")?lm.plan.labelText:lm.code;
      var t=window.prompt("ข้อความในกล่องเบอร์ (เว้นว่าง = ใช้รหัส "+lm.code+"):", cur);
      if(t===null) return; t=t.trim();
      lm.plan.labelText = (t===""||t===lm.code) ? "" : t;
      saveDB(); repaintShapes();
    });
    overlay.addEventListener("pointerdown",function(ev){
      if(window.__planPinch) return;   // กำลัง pinch สองนิ้ว → ไม่เริ่มลาก/เลือก
      // ผูก move/up ที่ window ระหว่างลาก (ไม่พึ่ง setPointerCapture ของ SVG ที่บางเบราว์เซอร์ไม่ทำงาน
      // → ทำให้ย้าย/ย่อขยาย/หมุนกรอบได้ชัวร์) เพิ่มตอนกด ถอดตอนปล่อยใน selUp จึงไม่ค้าง
      window.addEventListener("pointermove",selMove,true);
      window.addEventListener("pointerup",selUp,true);
      window.addEventListener("pointercancel",selUp,true);
      var szEl=ev.target.closest("[data-lblsize]");   // จับมุมป้าย → ปรับขนาดป้าย
      if(szEl){ var sm=getMember(szEl.getAttribute("data-lblsize"));
        if(sm){ var c=lblCenterClient(sm); lsz={mid:sm.id, ls0:(sm.plan.labelScale||1), d0:Math.max(8,Math.hypot(ev.clientX-c.x,ev.clientY-c.y))};
          try{ overlay.setPointerCapture(ev.pointerId); }catch(x){} ev.preventDefault(); return; } }
      var lblEl=ev.target.closest("[data-lbl]");      // จับป้ายเบอร์ → ย้ายป้าย
      if(lblEl){ var lm=getMember(lblEl.getAttribute("data-lbl"));
        if(lm){ ml={mid:lm.id, start:norm(ev), dx0:(lm.plan.labelDx||0), dy0:(lm.plan.labelDy||0)}; state.selMemberId=lm.id;
          try{ overlay.setPointerCapture(ev.pointerId); }catch(x){} ev.preventDefault(); return; } }
      var hEl=ev.target.closest("[data-handle]");
      if(hEl){        // เริ่มลด/ขยาย/หมุน
        var mh=getMember(hEl.getAttribute("data-mid"));
        if(mh && isBox(mh.plan)){
          tf={ mid:mh.id, handle:hEl.getAttribute("data-handle"),
               cx:(mh.plan.x1+mh.plan.x2)/2, cy:(mh.plan.y1+mh.plan.y2)/2 };
          try{ overlay.setPointerCapture(ev.pointerId); }catch(x){}
          ev.preventDefault(); return;
        }
      }
      var zhEl=ev.target.closest("[data-zhandle]");
      if(zhEl){       // จับจุดจับโซน → ย่อ/ขยาย
        var zh=getZone(zhEl.getAttribute("data-zid"));
        if(zh){ ztf={ zid:zh.id, handle:zhEl.getAttribute("data-zhandle"), geo:JSON.parse(JSON.stringify(zh.plan)) };
          try{ overlay.setPointerCapture(ev.pointerId); }catch(x){} ev.preventDefault(); return; }
      }
      var zEl=ev.target.closest("[data-zid]");
      if(zEl){        // กดที่โซนเท → เตรียมย้าย/เลือก
        var zz=getZone(zEl.getAttribute("data-zid")); var zp0=norm(ev);
        zmv={ zid:zEl.getAttribute("data-zid"), start:zp0, geo:JSON.parse(JSON.stringify(zz.plan)), moved:false };
        try{ overlay.setPointerCapture(ev.pointerId); }catch(x){}
        return;
      }
      var sEl=ev.target.closest("[data-mid]");
      if(sEl){        // กดที่ตัวชิ้นส่วน → เตรียมย้าย/เลือก
        var m=getMember(sEl.getAttribute("data-mid")); var p0=norm(ev);
        mv={ mid:sEl.getAttribute("data-mid"), start:p0, geo:JSON.parse(JSON.stringify(m.plan)), moved:false };
        try{ overlay.setPointerCapture(ev.pointerId); }catch(x){}
        return;
      }
      ps={x:ev.clientX,y:ev.clientY,px:state.panX,py:state.panY}; moved=false; mid=null;
      try{ overlay.setPointerCapture(ev.pointerId); }catch(x){}
    });
    function selMove(ev){
      if(window.__planPinch) return;   // สองนิ้วซูมอยู่ → หยุดลาก/เลื่อน
      if(lsz){       // ปรับขนาดป้ายเบอร์
        var m=getMember(lsz.mid); if(!m) return;
        var c=lblCenterClient(m), d=Math.hypot(ev.clientX-c.x,ev.clientY-c.y);
        m.plan.labelScale=Math.max(0.4, Math.min(4, Math.round(lsz.ls0*(d/lsz.d0)*100)/100));
        repaintShapes(); return;
      }
      if(ml){        // ย้ายป้ายเบอร์
        var m=getMember(ml.mid); if(!m) return;
        var p=norm(ev); m.plan.labelDx=ml.dx0+(p.x-ml.start.x); m.plan.labelDy=ml.dy0+(p.y-ml.start.y);
        repaintShapes(); return;
      }
      if(tf){        // ลด/ขยาย/หมุน
        var m=getMember(tf.mid); if(!m) return;
        var p=norm(ev), pxp=p.x*VW, pyp=p.y*VH, cxp=tf.cx*VW, cyp=tf.cy*VH;
        if(tf.handle==="rot"){
          m.plan.rot=Math.round(Math.atan2(pyp-cyp, pxp-cxp)*180/Math.PI + 90);
        }else{
          // ลด/ขยาย/ยืด โดยตรึงขอบ (หรือมุม) ตรงข้ามให้อยู่กับที่ — คิดในระบบพิกัดที่ยังไม่หมุน
          var pl=m.plan, rotD=pl.rot||0;
          var Cx=(pl.x1+pl.x2)/2*VW, Cy=(pl.y1+pl.y2)/2*VH;
          var hw=Math.abs(pl.x2-pl.x1)/2*VW, hh=Math.abs(pl.y2-pl.y1)/2*VH;
          var rp=rotPt(pxp,pyp,Cx,Cy,-rotD), ox=rp[0]-Cx, oy=rp[1]-Cy;   // ตำแหน่งเมาส์ในแกนท้องถิ่น
          var left=-hw,right=hw,top=-hh,bottom=hh, MIN=8, h=tf.handle;
          if(h.indexOf("w")>=0) left  =Math.min(ox, right-MIN);
          if(h.indexOf("e")>=0) right =Math.max(ox, left+MIN);
          if(h.indexOf("n")>=0) top   =Math.min(oy, bottom-MIN);
          if(h.indexOf("s")>=0) bottom=Math.max(oy, top+MIN);
          var nhw=(right-left)/2, nhh=(bottom-top)/2;
          var rc=rotPt(Cx+(left+right)/2, Cy+(top+bottom)/2, Cx, Cy, rotD);  // ศูนย์ใหม่ (คืนการหมุน)
          pl.x1=(rc[0]-nhw)/VW; pl.x2=(rc[0]+nhw)/VW; pl.y1=(rc[1]-nhh)/VH; pl.y2=(rc[1]+nhh)/VH;
        }
        repaintShapes(); return;
      }
      if(ztf){       // ย่อ/ขยายโซน (ลากจุดจับ)
        var zt=getZone(ztf.zid); if(!zt) return;
        var pz=norm(ev), g=ztf.geo, hh=ztf.handle, MINZ=0.008;
        var x1=Math.min(g.x1,g.x2), x2=Math.max(g.x1,g.x2), y1=Math.min(g.y1,g.y2), y2=Math.max(g.y1,g.y2);
        var cx=Math.max(0,Math.min(1,pz.x)), cy=Math.max(0,Math.min(1,pz.y));
        if(hh.indexOf("w")>=0) x1=Math.min(cx, x2-MINZ);
        if(hh.indexOf("e")>=0) x2=Math.max(cx, x1+MINZ);
        if(hh.indexOf("n")>=0) y1=Math.min(cy, y2-MINZ);
        if(hh.indexOf("s")>=0) y2=Math.max(cy, y1+MINZ);
        zt.plan.x1=x1; zt.plan.y1=y1; zt.plan.x2=x2; zt.plan.y2=y2;
        repaintShapes(); return;
      }
      if(zmv){       // ย้ายตำแหน่งโซน (ทั้งก้อน ไม่บิดรูป)
        var zm=getZone(zmv.zid); if(!zm) return;
        var pz2=norm(ev), dxZ=pz2.x-zmv.start.x, dyZ=pz2.y-zmv.start.y;
        if(!zmv.moved && Math.abs(dxZ)+Math.abs(dyZ)>0.004){ zmv.moved=true; state.selZoneId=zmv.zid; }
        if(zmv.moved){
          var gz=zmv.geo;
          var bx1=Math.min(gz.x1,gz.x2), bx2=Math.max(gz.x1,gz.x2), by1=Math.min(gz.y1,gz.y2), by2=Math.max(gz.y1,gz.y2);
          var ddx=Math.max(-bx1, Math.min(1-bx2, dxZ)), ddy=Math.max(-by1, Math.min(1-by2, dyZ));
          zm.plan.x1=gz.x1+ddx; zm.plan.x2=gz.x2+ddx; zm.plan.y1=gz.y1+ddy; zm.plan.y2=gz.y2+ddy;
          repaintShapes();
        }
        return;
      }
      if(mv){        // ย้ายตำแหน่งชิ้นส่วน
        var m2=getMember(mv.mid); if(!m2) return;
        var p2=norm(ev), dxN=p2.x-mv.start.x, dyN=p2.y-mv.start.y;
        if(!mv.moved && Math.abs(dxN)+Math.abs(dyN)>0.004){ mv.moved=true; state.selMemberId=mv.mid; }
        if(mv.moved){
          var g=mv.geo, pl=m2.plan;
          if(pl.kind==="point"){ pl.x=g.x+dxN; pl.y=g.y+dyN; }
          else{ pl.x1=g.x1+dxN; pl.x2=g.x2+dxN; pl.y1=g.y1+dyN; pl.y2=g.y2+dyN; }
          clampGeo(pl);
          repaintShapes();
        }
        return;
      }
      if(!ps) return;
      var dx=ev.clientX-ps.x, dy=ev.clientY-ps.y;
      if(!moved && Math.abs(dx)+Math.abs(dy)>4) moved=true;
      if(moved){ state.panX=ps.px+dx; state.panY=ps.py+dy; planClampPan(); planApplyTransform(); }
    }
    function selUp(ev){
      window.removeEventListener("pointermove",selMove,true);
      window.removeEventListener("pointerup",selUp,true);
      window.removeEventListener("pointercancel",selUp,true);
      if(lsz){ lsz=null; saveDB(); return; }
      if(ml){ ml=null; saveDB(); return; }
      if(tf){ tf=null; saveDB(); return; }
      if(ztf){ ztf=null; saveDB(); return; }
      if(zmv){
        var wasZ=zmv.moved, zid=zmv.zid; zmv=null;
        if(wasZ){ saveDB(); return; }        // ลากย้ายเสร็จ → บันทึก
        state.selZoneId=zid; state.selMemberId=null; state.floatProgressOpen=true; render();   // แค่แตะ → เลือก
        return;
      }
      if(mv){
        var wasMove=mv.moved, id=mv.mid; mv=null;
        if(wasMove){ saveDB(); return; }        // ลากย้ายเสร็จ → บันทึก
        state.selMemberId=id; state.selZoneId=null;  // แค่แตะ → เลือก (คงแท็บเดิมไว้ เพื่อให้เห็นไฮไลต์ในรายการคาน)
        if(state.rightTab==="palette") state.rightTab="inspect";   // ถ้าอยู่แท็บสไตล์ ค่อยพาไปตรวจเหล็ก
        state.answers={}; state.photos=[]; state.note=""; render();
        return;
      }
      if(!ps) return;
      var wasMoved=moved; ps=null;
      if(wasMoved){ scheduleEnsure(); return; }    // ลากที่ว่าง = เลื่อนภาพ → เรนเดอร์ส่วนที่เห็นใหม่ให้คม
      if(state.selMemberId||state.selZoneId){ state.selMemberId=null; state.selZoneId=null; render(); }   // แตะที่ว่าง = เลิกเลือก
    }
    return;
  }

  /* ---------- โหมดวาดโซนเท (สี่เหลี่ยม / หลายเหลี่ยม + สแนบ) ---------- */
  if(state.tool==="drawZone"){
    var ZCOL="#22c55e";
    if((state.zoneShape||"rect")==="poly"){   // หลายเหลี่ยม: คลิกทีละจุด, ดับเบิลคลิก/คลิกจุดแรกเพื่อปิดรูป
      var zpts=[], zg=document.createElementNS(NS,"g"); zg.setAttribute("id","zonePolyTemp"); overlay.appendChild(zg);
      function zredraw(cur){
        var z=state.zoom||1, arr=zpts.slice(); if(cur) arr.push(cur);
        var out="";
        if(arr.length){
          var dd=arr.map(function(p){ return (p.x*VW).toFixed(1)+","+(p.y*VH).toFixed(1); }).join(" ");
          out+='<polyline points="'+dd+'" fill="'+ZCOL+'" fill-opacity="'+(zpts.length>=2?0.08:0)+'" stroke="'+ZCOL+'" stroke-width="'+(2.4/z)+'" stroke-dasharray="'+(7/z)+' '+(5/z)+'" stroke-linecap="round" stroke-linejoin="round"/>';
          zpts.forEach(function(p){ out+='<circle cx="'+(p.x*VW)+'" cy="'+(p.y*VH)+'" r="'+(5/z)+'" fill="#fff" stroke="'+ZCOL+'" stroke-width="'+(2/z)+'"/>'; });
        }
        zg.innerHTML=out;
      }
      function zfinishPoly(){
        if(zpts.length<3){ zg.remove(); showSnap(null); return; }
        var xs=zpts.map(function(p){return p.x;}), ys=zpts.map(function(p){return p.y;});
        var x1=Math.min.apply(null,xs), x2=Math.max.apply(null,xs), y1=Math.min.apply(null,ys), y2=Math.max.apply(null,ys);
        var w=Math.max(1e-4,x2-x1), hgt=Math.max(1e-4,y2-y1);
        var np=zpts.map(function(p){ return [(p.x-x1)/w, (p.y-y1)/hgt]; });
        zg.remove(); showSnap(null);
        finishDrawZone({kind:"poly", x1:x1, y1:y1, x2:x2, y2:y2, pts:np});
      }
      overlay.addEventListener("pointermove",function(ev){ zredraw(snapAt(ev)); });
      overlay.addEventListener("click",function(ev){
        var p=snapAt(ev);
        if(zpts.length>=3){ var fpt=zpts[0], r=overlay.getBoundingClientRect();
          if(Math.hypot((p.x-fpt.x)*r.width,(p.y-fpt.y)*r.height)<12){ zfinishPoly(); return; } }
        zpts.push(p); zredraw(p);
      });
      overlay.addEventListener("dblclick",function(ev){ ev.preventDefault(); if(zpts.length) zpts.pop(); zfinishPoly(); });
      return;
    }
    var zStart=null, zTemp=null;
    function zDrawMove(ev2){
      if(!zStart||!zTemp) return;
      if(ev2.cancelable) ev2.preventDefault();
      var p=snapAt(ev2);
      zTemp.setAttribute("x",Math.min(zStart.x,p.x)*VW); zTemp.setAttribute("y",Math.min(zStart.y,p.y)*VH);
      zTemp.setAttribute("width",Math.abs(p.x-zStart.x)*VW); zTemp.setAttribute("height",Math.abs(p.y-zStart.y)*VH);
    }
    function zDrawEnd(ev2){
      window.removeEventListener("pointermove",zDrawMove,true);
      window.removeEventListener("pointerup",zDrawEnd,true);
      window.removeEventListener("pointercancel",zDrawEnd,true);
      if(!zStart) return;
      var p=snapAt(ev2), s=zStart; zStart=null; showSnap(null);
      if(zTemp){ zTemp.remove(); zTemp=null; }
      var rb=overlay.getBoundingClientRect();
      if(Math.abs(p.x-s.x)*rb.width<5 && Math.abs(p.y-s.y)*rb.height<5) return;
      finishDrawZone({kind:"rect", x1:s.x, y1:s.y, x2:p.x, y2:p.y});
    }
    overlay.addEventListener("pointermove",function(ev){ if(!zStart) snapAt(ev); });
    overlay.addEventListener("pointerleave",function(){ if(!zStart) showSnap(null); });
    overlay.addEventListener("pointerdown",function(ev){
      if(window.__planPinch) return;
      if(ev.button!=null && ev.button!==0) return;
      ev.preventDefault();
      zStart=snapAt(ev);
      zTemp=document.createElementNS(NS,"rect");
      var z=state.zoom||1;
      zTemp.setAttribute("stroke",ZCOL); zTemp.setAttribute("stroke-width",(2.4/z));
      zTemp.setAttribute("stroke-dasharray",(7/z)+" "+(5/z));
      zTemp.setAttribute("fill",ZCOL); zTemp.setAttribute("fill-opacity","0.08");
      zTemp.setAttribute("rx","4");
      overlay.appendChild(zTemp);
      window.addEventListener("pointermove",zDrawMove,true);
      window.addEventListener("pointerup",zDrawEnd,true);
      window.addEventListener("pointercancel",zDrawEnd,true);
    });
    return;
  }

  /* ---------- โหมดวาด ---------- */
  if(state.tool!=="draw") return;
  var shape=(kind==="rect") ? (state.drawShape||"rect") : kind;   // rect | oval | poly | line | point
  var start=null, tempEl=null;

  if(shape==="point"){
    overlay.addEventListener("pointermove",function(ev){ snapAt(ev); });
    overlay.addEventListener("click",function(ev){
      var p=snapAt(ev); showSnap(null); finishDraw({kind:"point", x:p.x, y:p.y});
    });
    return;
  }

  if(shape==="poly"){        // รูปหลายเหลี่ยม: คลิกทีละจุด, ดับเบิลคลิก/คลิกจุดแรกเพื่อปิดรูป
    var pts=[], g=document.createElementNS(NS,"g"); g.setAttribute("id","polyTemp"); overlay.appendChild(g);
    function redraw(cur){
      var z=state.zoom||1, arr=pts.slice(); if(cur) arr.push(cur), 0;
      var out="";
      if(arr.length){
        var dd=arr.map(function(p){ return (p.x*VW).toFixed(1)+","+(p.y*VH).toFixed(1); }).join(" ");
        out+='<polyline points="'+dd+'" fill="'+state.fillColor+'" fill-opacity="'+(pts.length>=2?state.fillAlpha*0.6:0)+'" stroke="'+state.fillColor+'" stroke-width="'+(2.4/z)+'" stroke-dasharray="'+(7/z)+' '+(5/z)+'" stroke-linecap="round" stroke-linejoin="round"/>';
        pts.forEach(function(p){ out+='<circle cx="'+(p.x*VW)+'" cy="'+(p.y*VH)+'" r="'+(5/z)+'" fill="#fff" stroke="'+state.fillColor+'" stroke-width="'+(2/z)+'"/>'; });
      }
      g.innerHTML=out;
    }
    function finishPoly(){
      if(pts.length<3){ g.remove(); showSnap(null); return; }
      var xs=pts.map(function(p){return p.x;}), ys=pts.map(function(p){return p.y;});
      var x1=Math.min.apply(null,xs), x2=Math.max.apply(null,xs), y1=Math.min.apply(null,ys), y2=Math.max.apply(null,ys);
      var w=Math.max(1e-4,x2-x1), hgt=Math.max(1e-4,y2-y1);
      var np=pts.map(function(p){ return [(p.x-x1)/w, (p.y-y1)/hgt]; });
      g.remove(); showSnap(null);
      finishDraw({kind:"poly", x1:x1, y1:y1, x2:x2, y2:y2, pts:np, fill:state.fillColor, fillA:state.fillAlpha, strokeW:state.strokeW});
    }
    overlay.addEventListener("pointermove",function(ev){ redraw(snapAt(ev)); });
    overlay.addEventListener("click",function(ev){
      var p=snapAt(ev);
      if(pts.length>=3){ var f=pts[0], r=overlay.getBoundingClientRect();
        if(Math.hypot((p.x-f.x)*r.width,(p.y-f.y)*r.height)<12){ finishPoly(); return; } }   // คลิกใกล้จุดแรก = ปิดรูป
      pts.push(p); redraw(p);
    });
    overlay.addEventListener("dblclick",function(ev){ ev.preventDefault(); if(pts.length) pts.pop(); finishPoly(); });
    return;
  }

  // rect / oval / line — ลากกำหนดกรอบ
  // ผูก move/up ที่ window ระหว่างลาก (ไม่พึ่ง setPointerCapture ของ SVG ซึ่งบางเบราว์เซอร์ไม่ทำงาน
  // ทำให้ Rectangle/Oval วาดไม่ออก เหลือแต่ Polygon ที่ใช้คลิก) — เพิ่มตอนกด, ถอดตอนปล่อย จึงไม่ค้าง
  function drawMove(ev){
    if(window.__planPinch) return;   // สองนิ้วซูมอยู่ → ไม่วาด
    if(!start || !tempEl) return;
    if(ev.cancelable) ev.preventDefault();
    var p=snapAt(ev);
    if(shape==="line"){
      tempEl.setAttribute("x1",start.x*VW); tempEl.setAttribute("y1",start.y*VH);
      tempEl.setAttribute("x2",p.x*VW);     tempEl.setAttribute("y2",p.y*VH);
    }else if(shape==="oval"){
      tempEl.setAttribute("cx",(start.x+p.x)/2*VW); tempEl.setAttribute("cy",(start.y+p.y)/2*VH);
      tempEl.setAttribute("rx",Math.abs(p.x-start.x)/2*VW); tempEl.setAttribute("ry",Math.abs(p.y-start.y)/2*VH);
    }else{
      tempEl.setAttribute("x",Math.min(start.x,p.x)*VW); tempEl.setAttribute("y",Math.min(start.y,p.y)*VH);
      tempEl.setAttribute("width",Math.abs(p.x-start.x)*VW); tempEl.setAttribute("height",Math.abs(p.y-start.y)*VH);
    }
  }
  function drawEnd(ev){
    window.removeEventListener("pointermove",drawMove,true);
    window.removeEventListener("pointerup",drawEnd,true);
    window.removeEventListener("pointercancel",drawEnd,true);
    if(!start) return;
    var p=snapAt(ev), s=start; start=null; showSnap(null);
    if(tempEl){ tempEl.remove(); tempEl=null; }
    // เกณฑ์ "แตะเฉย ๆ" วัดเป็นพิกเซลจอจริง (ไม่ใช่สัดส่วนแปลน) → ตอนซูมเข้ามาก ๆ ลากนิดเดียวก็ยังวาดได้
    var rb=overlay.getBoundingClientRect();
    var dpx=Math.abs(p.x-s.x)*rb.width, dpy=Math.abs(p.y-s.y)*rb.height;
    if(dpx<5 && dpy<5){ return; }
    if(shape==="line") finishDraw({kind:"line", x1:s.x, y1:s.y, x2:p.x, y2:p.y});
    else finishDraw({kind:shape, x1:s.x, y1:s.y, x2:p.x, y2:p.y, fill:state.fillColor, fillA:state.fillAlpha, strokeW:state.strokeW});
  }
  // โชว์กรอบสแนปตอนเลื่อนเมาส์ (ยังไม่กด) — hover ก็เห็นว่าจะดูดเข้าเส้น/จุดไหน
  overlay.addEventListener("pointermove",function(ev){ if(!start) snapAt(ev); });
  overlay.addEventListener("pointerleave",function(){ if(!start) showSnap(null); });
  overlay.addEventListener("pointerdown",function(ev){
    if(window.__planPinch) return;   // สองนิ้วซูมอยู่ → ไม่เริ่มวาด
    if(ev.button!=null && ev.button!==0) return;   // เฉพาะปุ่มซ้าย
    ev.preventDefault();
    start=snapAt(ev);
    tempEl=document.createElementNS(NS, shape==="oval"?"ellipse":(shape==="line"?"line":"rect"));
    var z=state.zoom||1;
    tempEl.setAttribute("stroke", shape==="line"?"var(--brand)":state.fillColor);
    tempEl.setAttribute("stroke-width", (2.4/z));
    tempEl.setAttribute("stroke-dasharray", (7/z)+" "+(5/z));
    if(shape==="line"){ tempEl.setAttribute("fill","none"); tempEl.setAttribute("stroke-linecap","round"); }
    else { tempEl.setAttribute("fill",state.fillColor); tempEl.setAttribute("fill-opacity",state.fillAlpha); }
    overlay.appendChild(tempEl);
    window.addEventListener("pointermove",drawMove,true);
    window.addEventListener("pointerup",drawEnd,true);
    window.addEventListener("pointercancel",drawEnd,true);
  });
}

/** สร้างชิ้นส่วนใหม่จากรูปที่วาด: ถามเบอร์ → บันทึก → เลือก */
function finishDraw(geom){
  var type=state.catType;
  var suggest=nextCode(type);
  var code=window.prompt("ใส่เบอร์"+TYPES[type].label+" (Mark):", suggest);
  if(code===null) { render(); return; }        // ยกเลิก
  code=code.trim(); if(!code) code=suggest;
  // ถ้ามีเบอร์เดียวกันในชั้นนี้อยู่แล้ว → ก็อปข้อมูลเดิมมาให้เลย ไม่ต้องกรอกใหม่
  var twin=membersOfFloor(state.floorId).filter(function(x){ return x.type===type && x.code===code; })[0];
  if(twin){
    var m=JSON.parse(JSON.stringify(twin));       // สำเนาสเปกทั้งหมด (รวมสถานีเหล็ก)
    m.id=uid("m"); m.projectId=state.projectId; m.floorId=state.floorId; m.plan=geom; m.planId=curPlanId();
    DB.members.push(m);
    if(!saveDB()){ DB.members.pop(); render(); return; }
    state.selMemberId=m.id;   // เลือกไว้ อยู่หน้าแปลนต่อ (ไม่เด้งไปหน้าอื่น)
    render();
    toast("เพิ่ม "+code+" — ใช้ข้อมูลเดิมของ "+code+" อัตโนมัติ");
    return;
  }
  var m=mkMember(state.projectId, state.floorId, type, code, "", "", {plan:geom}, "");
  m.planId=curPlanId();
  DB.members.push(m);
  if(!saveDB()){ DB.members.pop(); render(); return; }
  state.selMemberId=m.id;    // วาดเสร็จอยู่หน้าแปลนต่อ — กรอกข้อมูลทีหลังจากแท็บ "รายการคาน" ได้
  render();
  toast("เพิ่ม "+code+" แล้ว — แตะแท็บ “รายการคาน” เพื่อกรอกข้อมูลเหล็ก");
}
/** สร้างโซนเทคอนกรีตใหม่จากรูปที่วาด */
function finishDrawZone(geom){
  var existing=zonesOfPlan(state.floorId, curPlanId());
  var suggest="Zone "+"ABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt(existing.length);
  var name=window.prompt("ชื่อโซน:", suggest);
  if(name===null){ state.tool="select"; render(); return; }
  name=name.trim()||suggest;
  var _stL=zoneStatuses(state.floorId, curPlanId()), _st0=(_stL[_stL.length-1]||_stL[0]||{id:"pending"}).id;
  var z={ id:uid("z"), projectId:state.projectId, floorId:state.floorId, planId:curPlanId(),
    name:name, status:_st0, date:null, plan:geom };
  if(!DB.zones) DB.zones=[];
  DB.zones.push(z);
  saveDB();
  state.tool="select"; state.selZoneId=z.id; state.floatProgressOpen=true;
  render();
  toast("เพิ่มโซน "+name+" แล้ว");
}
/** เดาเบอร์ถัดไป เช่น B1,B2,... ตามจำนวนที่มีในชั้น */
function nextCode(type){
  var ab=TYPES[type].ab, list=membersOfFloor(state.floorId).filter(function(m){ return m.type===type; });
  var max=0;
  list.forEach(function(m){
    var mt=String(m.code).match(new RegExp("^"+ab+"(\\d+)"));
    if(mt) max=Math.max(max, parseInt(mt[1],10));
  });
  return ab+(max+1);
}
/* ============================================================================
   Deep-zoom แปลนระดับ CAD
   - เก็บ "ไฟล์ต้นฉบับ" (PDF/รูป) ไว้ใน IndexedDB (ความจุสูงกว่า localStorage มาก)
   - localStorage เก็บแค่ภาพตัวอย่างความละเอียดต่ำ (แสดงทันที) + ขนาด
   - PDF: เรนเดอร์ใหม่ตามระดับซูม จึงคมชัดทุกระดับ (เวกเตอร์)
   - รูปภาพ: แสดงต้นฉบับความละเอียดเต็ม แล้วจำกัดซูมไม่เกินความละเอียดจริง
   ========================================================================== */
var PLAN_DOCS={};        // cache ต่อ session: key -> {kind, page/url/natW ...}
var _idb=null;
function idbOpen(){
  if(_idb) return _idb;
  _idb=new Promise(function(res,rej){
    try{
      var r=indexedDB.open("rebarcheck",1);
      r.onupgradeneeded=function(){ try{ r.result.createObjectStore("plans"); }catch(e){} };
      r.onsuccess=function(){ res(r.result); };
      r.onerror=function(){ rej(r.error); };
    }catch(e){ rej(e); }
  });
  return _idb;
}
function idbPut(key,val){ return idbOpen().then(function(db){ return new Promise(function(res,rej){
  var tx=db.transaction("plans","readwrite"); tx.objectStore("plans").put(val,key);
  tx.oncomplete=function(){res(true);}; tx.onerror=function(){rej(tx.error);}; }); }); }
function idbGet(key){ return idbOpen().then(function(db){ return new Promise(function(res,rej){
  var tx=db.transaction("plans","readonly"); var rq=tx.objectStore("plans").get(key);
  rq.onsuccess=function(){res(rq.result||null);}; rq.onerror=function(){rej(rq.error);}; }); }); }
function idbDel(key){ return idbOpen().then(function(db){ return new Promise(function(res){
  try{ var tx=db.transaction("plans","readwrite"); tx.objectStore("plans")["delete"](key);
    tx.oncomplete=function(){res(true);}; tx.onerror=function(){res(false);}; }catch(e){ res(false); } }); }).catch(function(){}); }
function idbClear(){ return idbOpen().then(function(db){ return new Promise(function(res){
  try{ var tx=db.transaction("plans","readwrite"); tx.objectStore("plans").clear();
    tx.oncomplete=function(){res(true);}; tx.onerror=function(){res(false);}; }catch(e){ res(false); } }); }).catch(function(){}); }

// แปลนใช้ร่วมทั้งชั้น + มีได้หลายแปลน (planList) เลือกด้วย activePlanId
// คีย์: แปลนหลัก(_main)=floorId (คงคีย์เดิม), แปลนใหม่=floorId:<id> (แยก doc/สแนป/ความคม)
function planSourceKey(){
  var f=getFloor(state.floorId), a=f&&f.activePlanId;
  return (a && a!=="_main") ? state.floorId+":"+a : state.floorId;
}
/** รายการแปลนของชั้น (คืนอาเรย์เสมอ) — รองรับข้อมูลเก่า f.plan / f.plans */
function floorPlans(f){
  if(!f) return [];
  if(f.planList && f.planList.length) return f.planList;
  var arr=[];
  if(f.plan) arr.push(Object.assign({id:"_main",name:"แปลน 1"}, f.plan));
  else if(f.plans){ var i=1; for(var k in f.plans){ if(f.plans[k]) arr.push(Object.assign({id:(i===1?"_main":"pl"+i),name:"แปลน "+(i++)}, f.plans[k])); } }
  return arr;
}
/** แปลนที่กำลังแสดง (ตาม activePlanId; ถ้าไม่พบใช้ตัวแรก) */
function getFloorPlan(f){
  var arr=floorPlans(f); if(!arr.length) return null;
  var a=f.activePlanId, hit=arr.filter(function(p){return p.id===a;})[0];
  return hit || arr[0];
}
function currentPlan(){ return getFloorPlan(getFloor(state.floorId)); }
/** id ของแปลนที่กำลังแสดง (ค่าเริ่ม "_main") + planId ของชิ้นส่วน (ของเก่าไม่มี = "_main") */
function curPlanId(){ var f=getFloor(state.floorId); return (f&&f.activePlanId)||"_main"; }
function memberPlanId(m){ return m.planId||"_main"; }

/* ===========================================================================
   สแนบ (osnap) — ดึงเส้นเวกเตอร์จาก PDF แล้วดูดเข้าปลายเส้น/จุดตัด/จุดบนเส้น
   ========================================================================= */
function _applyT(x,y,m){ return [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]]; }
function _compose(a,b){ // จุด p ถูกแปลงเป็น a(b(p))
  return [ a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
           a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
           a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5] ];
}
/** ดึงเส้นตรงทั้งหมดจากหน้า PDF → normalized [x1,y1,x2,y2] (กรองเส้นจิ๋ว) */
function extractPdfSegments(page){
  try{
    return page.getOperatorList().then(function(ol){
      var OPS=window.pdfjsLib.OPS, base=page.getViewport({scale:1});
      var bt=base.transform, W=base.width||1, H=base.height||1;
      var ctm=[1,0,0,1,0,0], stack=[], segs=[];
      function dev(x,y){ var p=_applyT(x,y,ctm); p=_applyT(p[0],p[1],bt); return [p[0]/W, p[1]/H]; }
      function push(x1,y1,x2,y2){ var a=dev(x1,y1),b=dev(x2,y2);
        var dx=(b[0]-a[0])*W, dy=(b[1]-a[1])*H; if(dx*dx+dy*dy<9) return;   // ตัดเส้นสั้น <3pt (ตัวอักษร/hatch)
        segs.push([a[0],a[1],b[0],b[1]]); }
      var fn=ol.fnArray, ar=ol.argsArray;
      for(var i=0;i<fn.length;i++){
        var f=fn[i];
        if(f===OPS.save) stack.push(ctm.slice());
        else if(f===OPS.restore) ctm=stack.pop()||[1,0,0,1,0,0];
        else if(f===OPS.transform) ctm=_compose(ctm, ar[i]);
        else if(f===OPS.constructPath){
          var ops=ar[i][0], co=ar[i][1], k=0, cx=0,cy=0,sx=0,sy=0;
          for(var j=0;j<ops.length;j++){ var op=ops[j];
            if(op===OPS.moveTo){ cx=co[k++];cy=co[k++]; sx=cx;sy=cy; }
            else if(op===OPS.lineTo){ var nx=co[k++],ny=co[k++]; push(cx,cy,nx,ny); cx=nx;cy=ny; }
            else if(op===OPS.curveTo){ k+=4; var ex=co[k++],ey=co[k++]; push(cx,cy,ex,ey); cx=ex;cy=ey; }
            else if(op===OPS.rectangle){ var rx=co[k++],ry=co[k++],rw=co[k++],rh=co[k++];
              push(rx,ry,rx+rw,ry); push(rx+rw,ry,rx+rw,ry+rh); push(rx+rw,ry+rh,rx,ry+rh); push(rx,ry+rh,rx,ry); cx=rx;cy=ry; }
            else if(op===OPS.closePath){ push(cx,cy,sx,sy); cx=sx;cy=sy; }
          }
        }
      }
      if(segs.length>60000) segs.length=60000;   // กันหนักผิดปกติ
      return segs;
    }).catch(function(){ return null; });
  }catch(e){ return Promise.resolve(null); }
}
/** ผูกเส้นเข้ากับ doc + สร้างดัชนีเชิงพื้นที่ (bucket) เพื่อค้นเร็วตอนสแนบ */
function attachSnap(doc, segs){
  if(!doc || !segs || !segs.length){ if(doc){ doc.segs=null; doc.snapIdx=null; } return; }
  doc.segs=segs;
  var CELL=0.012, idx={};
  function add(cx,cy,i){ var k=cx+","+cy; (idx[k]||(idx[k]=[])).push(i); }
  for(var i=0;i<segs.length;i++){
    var s=segs[i], len=Math.hypot(s[2]-s[0],s[3]-s[1]);
    var steps=Math.min(90, Math.max(1, Math.ceil(len/CELL)));
    for(var t=0;t<=steps;t++){ var u=t/steps, x=s[0]+(s[2]-s[0])*u, y=s[1]+(s[3]-s[1])*u;
      add(Math.floor(x/CELL), Math.floor(y/CELL), i); }
  }
  doc.snapIdx={cell:CELL, idx:idx};
  planLog("สแนบพร้อม: ดึงเส้นได้ "+segs.length+" เส้น");
}
function _segNear(doc,nx,ny,tolN){
  var si=doc.snapIdx; if(!si) return [];
  var C=si.cell, r=Math.ceil(tolN/C)+1, cx=Math.floor(nx/C), cy=Math.floor(ny/C), seen={}, out=[];
  for(var dx=-r;dx<=r;dx++)for(var dy=-r;dy<=r;dy++){
    var arr=si.idx[(cx+dx)+","+(cy+dy)]; if(!arr) continue;
    for(var m=0;m<arr.length;m++){ var i=arr[m]; if(!seen[i]){ seen[i]=1; out.push(doc.segs[i]); } }
  }
  return out;
}
/** สแนบจุด (nx,ny normalized) → คืน {x,y,type} หรือ null. pxW/pxH = ขนาดกรอบจริงบนจอ */
function snapNorm(nx, ny, pxW, pxH){
  if(!state.snap) return null;
  var doc=PLAN_DOCS[planSourceKey()]; if(!doc||!doc.snapIdx) return null;
  var TOLPX=13, tolN=TOLPX/Math.max(1,Math.min(pxW,pxH));
  var cand=_segNear(doc,nx,ny,tolN); if(cand.length>240) cand.length=240;
  function dpx(x,y){ return Math.hypot((x-nx)*pxW,(y-ny)*pxH); }
  var best=null;
  function consider(x,y,type,pri){ var d=dpx(x,y); if(d>TOLPX) return;
    if(!best || pri<best.pri || (pri===best.pri && d<best.d)) best={x:x,y:y,type:type,pri:pri,d:d}; }
  // ปลายเส้น (สำคัญสุด)
  for(var i=0;i<cand.length;i++){ var s=cand[i]; consider(s[0],s[1],"end",0); consider(s[2],s[3],"end",0); }
  // จุดตัดของเส้นใกล้เคอร์เซอร์
  for(var a=0;a<cand.length;a++)for(var b=a+1;b<cand.length;b++){
    var p=_segInt(cand[a],cand[b]); if(p) consider(p[0],p[1],"cross",1);
  }
  // จุดบนเส้น (ตั้งฉาก)
  for(var q=0;q<cand.length;q++){ var pp=_projPt(cand[q],nx,ny); if(pp) consider(pp[0],pp[1],"on",2); }
  return best;
}
function _segInt(a,b){
  var x1=a[0],y1=a[1],x2=a[2],y2=a[3], x3=b[0],y3=b[1],x4=b[2],y4=b[3];
  var d=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4); if(Math.abs(d)<1e-9) return null;
  var t=((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/d, u=((x1-x3)*(y1-y2)-(y1-y3)*(x1-x2))/d;
  if(t<-0.02||t>1.02||u<-0.02||u>1.02) return null;
  return [x1+t*(x2-x1), y1+t*(y2-y1)];
}
function _projPt(s,px,py){
  var vx=s[2]-s[0], vy=s[3]-s[1], L2=vx*vx+vy*vy; if(L2<1e-12) return null;
  var t=((px-s[0])*vx+(py-s[1])*vy)/L2; t=Math.max(0,Math.min(1,t));
  return [s[0]+t*vx, s[1]+t*vy];
}
/** ความละเอียดสูงสุดที่ยอมเรนเดอร์ (จำกัดตามอุปกรณ์ กันหน่วยความจำ) */
function deepMaxRasterW(){ return (window.innerWidth||1024)<760 ? 4200 : 8000; }

/** คิวเรนเดอร์ PDF — ให้ page.render ทำทีละงาน (pdf.js เรนเดอร์พร้อมกันบนหน้าเดียวจะพัง) */
var _pdfQ=Promise.resolve();
function queuePdf(fn){
  var run=_pdfQ.then(fn, fn);
  _pdfQ=run.then(function(){}, function(){});   // กันคิวหยุดถ้ามี error
  return run;
}

/** เรนเดอร์หน้า PDF ลง canvas ที่ความกว้าง targetW (มี timeout กันค้าง) */
function renderPdfToCanvas(page, targetW){
  return queuePdf(function(){ return new Promise(function(resolve,reject){
    var base=page.getViewport({scale:1});
    var scale=Math.max(0.4, targetW/base.width);
    var vp=page.getViewport({scale:scale});
    var cv=document.createElement("canvas");
    cv.width=Math.round(vp.width); cv.height=Math.round(vp.height);
    var ctx=cv.getContext("2d"); ctx.fillStyle="#fff"; ctx.fillRect(0,0,cv.width,cv.height);
    var task=page.render({canvasContext:ctx, viewport:vp}), done=false;
    var t=setTimeout(function(){ if(done)return; done=true; try{task.cancel();}catch(e){} reject(new Error("หมดเวลาเรนเดอร์")); }, 22000);
    task.promise.then(function(){ if(done)return; done=true; clearTimeout(t); resolve(cv); })
      .catch(function(e){ if(done)return; done=true; clearTimeout(t); reject(e); });
  }); });
}
/** ภาพตัวอย่าง (JPEG dataURL) สำหรับเก็บใน localStorage */
function renderPdfToDataURL(page, targetW){
  return renderPdfToCanvas(page, targetW).then(function(cv){
    return { src:cv.toDataURL("image/jpeg", targetW>3000?0.9:0.92), w:cv.width, h:cv.height };
  });
}

/* ===========================================================================
   นำออกเป็น PDF — แผ่นรายงาน: หัวกระดาษ + แปลนพร้อมไฮไลท์ + ตารางสี (Legend)
   ทำงานออฟไลน์ล้วน: รวมพื้นหลัง+เลเยอร์ไฮไลท์เป็นภาพเดียว วาดลงแผ่น A4 แล้วห่อเป็น PDF เอง
   ------------------------------------------------------------------------ */
/** อ่านค่าสีจริงของตัวแปร CSS โดยบังคับธีมสว่างชั่วคราว → PDF ขาวพร้อมพิมพ์เสมอ (แม้ผู้ใช้อยู่โหมดมืด) */
function _resolveVarsLight(str){
  var root=document.documentElement, prev=root.getAttribute("data-theme");
  root.setAttribute("data-theme","light");
  var cs=getComputedStyle(root), cache={};
  var out=String(str).replace(/var\(--([a-z0-9-]+)\)/gi,function(_m,name){
    if(cache[name]==null){ var v=cs.getPropertyValue("--"+name).trim(); cache[name]=v||"#333333"; }
    return cache[name];
  });
  if(prev==null) root.removeAttribute("data-theme"); else root.setAttribute("data-theme",prev);
  return out;
}
function _cvar(name){ return _resolveVarsLight("var(--"+name+")"); }

/** แคนวาสกริดเปล่า (กรณีไม่มีรูปแปลน) */
function _blankPlanCanvas(ratio){
  var W=1600, H=Math.round(W*(ratio||0.72));
  var cv=document.createElement("canvas"); cv.width=W; cv.height=H;
  var cx=cv.getContext("2d"); cx.fillStyle="#ffffff"; cx.fillRect(0,0,W,H);
  cx.strokeStyle="#e7eaf0"; cx.lineWidth=1;
  for(var x=0;x<=W;x+=54){ cx.beginPath(); cx.moveTo(x,0); cx.lineTo(x,H); cx.stroke(); }
  for(var y=0;y<=H;y+=54){ cx.beginPath(); cx.moveTo(0,y); cx.lineTo(W,y); cx.stroke(); }
  return cv;
}
/** กรอบครอบ (bounding box) ของชิ้นส่วนที่ไฮไลท์ + เผื่อขอบ → ใช้ซูมเข้าเฉพาะโซนที่ตรวจ */
function _highlightRegion(vm){
  if(!vm || !vm.length) return {x1:0,y1:0,x2:1,y2:1,full:true};
  var minX=1,minY=1,maxX=0,maxY=0;
  vm.forEach(function(m){
    var pl=m.plan; if(!pl) return;
    var xs = pl.kind==="point" ? [pl.x] : [pl.x1,pl.x2];
    var ys = pl.kind==="point" ? [pl.y] : [pl.y1,pl.y2];
    var lcx=(pl.kind==="point"?pl.x:(pl.x1+pl.x2)/2)+(pl.labelDx||0);   // เผื่อกล่องเบอร์ที่ถูกลากออก
    var lcy=(pl.kind==="point"?pl.y:(pl.y1+pl.y2)/2)+(pl.labelDy||0);
    xs.push(lcx); ys.push(lcy);
    minX=Math.min(minX,Math.min.apply(null,xs)); maxX=Math.max(maxX,Math.max.apply(null,xs));
    minY=Math.min(minY,Math.min.apply(null,ys)); maxY=Math.max(maxY,Math.max.apply(null,ys));
  });
  var padX=Math.max(0.05,(maxX-minX)*0.14), padY=Math.max(0.06,(maxY-minY)*0.16);
  minX-=padX; maxX+=padX; minY-=padY; maxY+=padY;
  var MINW=0.24, MINH=0.20;   // กันโซนเล็กจนซูมแตก
  if(maxX-minX<MINW){ var cx=(minX+maxX)/2; minX=cx-MINW/2; maxX=cx+MINW/2; }
  if(maxY-minY<MINH){ var cy=(minY+maxY)/2; minY=cy-MINH/2; maxY=cy+MINH/2; }
  minX=Math.max(0,minX); minY=Math.max(0,minY); maxX=Math.min(1,maxX); maxY=Math.min(1,maxY);
  var full=(minX<=0.02 && minY<=0.02 && maxX>=0.98 && maxY>=0.98);
  return {x1:minX,y1:minY,x2:maxX,y2:maxY,full:full};
}
/** แคนวาสพื้นหลังแปลนความละเอียดสูง — ครอปเฉพาะ region (0..1) (PDF เวกเตอร์ / รูป / กริดเปล่า) */
function planBgCanvasForExport(region, targetW){
  var r=region||{x1:0,y1:0,x2:1,y2:1}, TW=targetW||2400;
  var f=getFloor(state.floorId), plan=getFloorPlan(f), ratio=planRatio(plan), key=planSourceKey();
  var cropRatio=ratio*((r.y2-r.y1)/Math.max(1e-6,(r.x2-r.x1)));   // สัดส่วนของโซนที่ครอป
  return loadPlanSource(key).then(function(doc){
    if(doc && doc.kind==="pdf" && doc.page) return renderPdfRegionToCanvas(doc.page, r.x1,r.y1,r.x2,r.y2, TW);
    if(doc && doc.kind==="img" && doc.url){
      return new Promise(function(res){
        var im=new Image();
        im.onload=function(){
          var nw=im.naturalWidth||1600, nh=im.naturalHeight||Math.round(nw*ratio);
          var sx=r.x1*nw, sy=r.y1*nh, sw=Math.max(1,(r.x2-r.x1)*nw), sh=Math.max(1,(r.y2-r.y1)*nh);
          var scale=Math.min(3, TW/sw), W=Math.round(sw*scale), H=Math.round(sh*scale);
          var cv=document.createElement("canvas"); cv.width=W; cv.height=H;
          var cx=cv.getContext("2d"); cx.fillStyle="#fff"; cx.fillRect(0,0,W,H);
          cx.drawImage(im, sx,sy,sw,sh, 0,0,W,H); res(cv);
        };
        im.onerror=function(){ res(_blankPlanCanvas(cropRatio)); };
        im.src=doc.url;
      });
    }
    return _blankPlanCanvas(cropRatio);
  }).catch(function(){ return _blankPlanCanvas(cropRatio); });
}
/** ภาพเลเยอร์ไฮไลท์ (SVG→Image) — ครอปตาม region · ล้างการเลือก/รีเซ็ตซูม ป้ายขนาดปกติ ไม่มีจุดจับ */
function overlayImageForExport(VW,VH,region,outW,outH){
  var r=region||{x1:0,y1:0,x2:1,y2:1};
  var savSel=state.selMemberId, savZoom=state.zoom, savCat=state.catType, savLbl=state.showLabels;
  state.selMemberId=null; state.zoom=1; state.showLabels=false;   // ไม่เอาป้ายเบอร์ในรายงาน (ใช้ตารางสีแทน)
  if(state.unified) state.catType=null;   // โหมดรวม: ไม่หรี่ชนิดอื่น → ไฮไลท์ทุกชิ้นชัดเท่ากันบนรายงาน
  window.__exportFACap=0.28;              // จำกัดความทึบสูงสุด → สีทึบๆ กลายเป็นโปร่งแสง เห็นแปลนทะลุ
  var shapes;
  try{ shapes=planShapesSVG(VW,VH); } finally{ state.selMemberId=savSel; state.zoom=savZoom; state.catType=savCat; state.showLabels=savLbl; window.__exportFACap=null; }
  shapes=_resolveVarsLight(shapes);
  var rx=r.x1*VW, ry=r.y1*VH, rw=Math.max(1,(r.x2-r.x1)*VW), rh=Math.max(1,(r.y2-r.y1)*VH);
  var W=outW||rw, H=outH||rh;   // เรนเดอร์ SVG ที่ความละเอียดเท่าพื้นหลัง → ไฮไลท์คมไม่แตก
  var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="'+rx+' '+ry+' '+rw+' '+rh+'">'+shapes+'</svg>';
  return new Promise(function(res,rej){
    var url=URL.createObjectURL(new Blob([svg],{type:"image/svg+xml;charset=utf-8"})), im=new Image();
    im.onload=function(){ URL.revokeObjectURL(url); res(im); };
    im.onerror=function(){ URL.revokeObjectURL(url); rej(new Error("แปลงเลเยอร์ไฮไลท์ล้มเหลว")); };
    im.src=url;
  });
}
/** รวมพื้นหลัง+ไฮไลท์ของ region หนึ่ง เป็นแคนวาสเดียว */
function buildComposite(region, targetW){
  var ratio=planRatio(getFloorPlan(getFloor(state.floorId))), VW=1000, VH=Math.round(VW*ratio);
  return planBgCanvasForExport(region, targetW).then(function(bg){
    return overlayImageForExport(VW,VH,region,bg.width,bg.height).then(function(ov){
      var comp=document.createElement("canvas"); comp.width=bg.width; comp.height=bg.height;
      var cc=comp.getContext("2d"); cc.drawImage(bg,0,0); cc.drawImage(ov,0,0,comp.width,comp.height);
      return comp;
    });
  });
}
/** คีย์แปลน: แปลนรวมย่อ + กรอบแดงบอกโซนที่ครอปไปแสดง */
function buildKeyPlan(region){
  return buildComposite({x1:0,y1:0,x2:1,y2:1}, 780).then(function(full){
    var cx=full.getContext("2d"), w=full.width, h=full.height;
    var kx=region.x1*w, ky=region.y1*h, kw=(region.x2-region.x1)*w, kh=(region.y2-region.y1)*h;
    cx.fillStyle="rgba(224,50,45,0.15)"; cx.fillRect(kx,ky,kw,kh);
    cx.strokeStyle="#e0322d"; cx.lineWidth=Math.max(2.5,w*0.007); cx.strokeRect(kx,ky,kw,kh);
    return full;
  }).catch(function(){ return null; });
}
/** รายการตารางสีสำหรับ PDF (จัดกลุ่มตามความหมายของสีที่วาดจริง) */
function _legendForExport(vm){
  var groups={}, order=[];
  vm.forEach(function(m){
    var color,label;
    if(state.colorMode==="status"){
      var ins=lastInspection(m.id), st=!ins?"todo":(ins.status==="pass"?"pass":"fail");
      color=st==="pass"?_cvar("pass"):(st==="fail"?_cvar("fail"):_cvar("text-dim"));
      label=st==="pass"?"ผ่าน":(st==="fail"?"ไม่ผ่าน":"รอตรวจ");
    }else{
      color=_cvar("t-"+TYPES[m.type].css); label=TYPE_EN[m.type]||TYPES[m.type].label;
    }
    if(!groups[label]){ groups[label]={color:color,label:label,codes:[],n:0}; order.push(label); }
    groups[label].n++; if(groups[label].codes.indexOf(m.code)<0) groups[label].codes.push(m.code);
  });
  return order.map(function(k){ return groups[k]; });
}
/** วาดแผ่นรายงาน A4 (หัวกระดาษ + แปลน + Legend + คีย์แปลน) คืนค่า canvas */
function buildReportSheet(planCv, vm, keyCv, opts){
  opts = opts || {};
  var landscape = planCv.width >= planCv.height, DPI=300, FF="'Sarabun','Tahoma','Segoe UI',sans-serif";
  var SW=Math.round((landscape?16.54:11.69)*DPI), SH=Math.round((landscape?11.69:16.54)*DPI);   // A3
  var cv=document.createElement("canvas"); cv.width=SW; cv.height=SH;
  var cx=cv.getContext("2d"); cx.fillStyle="#ffffff"; cx.fillRect(0,0,SW,SH);
  var M=Math.round(SW*0.02), brand=_cvar("brand"), ink="#12233a", sub="#5b6675";
  var p=getProject(state.projectId), f=getFloor(state.floorId), type=state.catType, sm=summarize(vm);
  // ── หัวกระดาษ (กระชับ 2 บรรทัด: ชื่อ+วันที่ / โครงการ+ชิปสรุปชิดขวา) ──
  var y=M, tX=M+Math.round(SW*0.022);
  cx.fillStyle=brand; cx.fillRect(M, y, Math.round(SW*0.009), Math.round(SH*0.048));   // แถบสีนำหน้าชื่อ
  cx.textBaseline="top"; cx.textAlign="left";
  var tS=Math.round(SW*0.019);
  cx.fillStyle=ink; cx.font="800 "+tS+"px "+FF;
  cx.fillText(opts.title || "รายงานแปลนตรวจเหล็กเสริม", tX, y);
  cx.textAlign="right"; cx.fillStyle=sub; cx.font="500 "+Math.round(SW*0.011)+"px "+FF;
  cx.fillText("วันที่ออกรายงาน  "+dMY(Date.now()), SW-M, y+Math.round(tS*0.15));
  cx.textAlign="left";
  // บรรทัด 2: โครงการ (ซ้าย) + ชิปสรุป (ขวา) อยู่แถวเดียวกัน
  var r2H=Math.round(SH*0.034), r2Y=y+tS+Math.round(SH*0.012);
  cx.fillStyle=sub; cx.font="500 "+Math.round(SW*0.0118)+"px "+FF; cx.textBaseline="middle";
  cx.fillText(opts.subtitle || ((p?p.name:"—")+"  ·  "+(f?f.name:"—")+"  ·  หมวด "+(TYPE_EN[type]||TYPES[type].label)), tX, r2Y+r2H/2);
  cx.textBaseline="top";
  var chipFS=Math.round(SW*0.011), pad=Math.round(SW*0.011), gap2=Math.round(SW*0.007), dotR=Math.round(chipFS*0.42), dotGap=Math.round(chipFS*0.55);
  var chips=opts.chips || [["ทั้งหมด "+sm.total+" ชิ้น",null],["ผ่าน "+sm.pass,_cvar("pass")],["ไม่ผ่าน "+sm.fail,_cvar("fail")],["รอตรวจ "+sm.todo,_cvar("text-dim")]];
  cx.font="700 "+chipFS+"px "+FF;
  var cw=chips.map(function(c){ return pad*2+(c[1]?dotR*2+dotGap:0)+cx.measureText(c[0]).width; });
  var totalW=cw.reduce(function(a,w){return a+w;},0)+gap2*(chips.length-1);
  var cxp=Math.max(tX, SW-M-totalW);
  chips.forEach(function(c,i){
    var w=cw[i];
    cx.fillStyle="#f1f3f7"; _rr(cx,cxp,r2Y,w,r2H,r2H/2); cx.fill();
    var tx=cxp+pad;
    if(c[1]){ cx.fillStyle=c[1]; cx.beginPath(); cx.arc(cxp+pad+dotR,r2Y+r2H/2,dotR,0,7); cx.fill(); tx=cxp+pad+dotR*2+dotGap; }
    cx.fillStyle=ink; cx.textBaseline="middle"; cx.font="700 "+chipFS+"px "+FF; cx.fillText(c[0],tx,r2Y+r2H/2+1); cx.textBaseline="top";
    cxp+=w+gap2;
  });
  var headBottom=r2Y+r2H+Math.round(SH*0.01);
  cx.strokeStyle="#e3e7ee"; cx.lineWidth=1.5; cx.beginPath(); cx.moveTo(M,headBottom); cx.lineTo(SW-M,headBottom); cx.stroke();
  // ── Legend (แถบล่าง) — 1 แถวเต็มความกว้างต่อชนิด, โค้ดยาวเกินตัดด้วย …(+N) ไม่ทับกัน ──
  var leg=opts.legend || _legendForExport(vm);
  var legFS=Math.round(SW*0.0105), swz=Math.round(SW*0.015), legRowH=Math.round(SH*0.028);
  var legTitleH=Math.round(SH*0.022);
  var legH = leg.length? (legTitleH + leg.length*legRowH + Math.round(SH*0.006)) : 0;
  var legTop=SH-M-legH;
  if(leg.length){
    cx.fillStyle=ink; cx.font="800 "+Math.round(SW*0.0125)+"px "+FF; cx.textBaseline="top";
    cx.fillText(opts.legendTitle || "ตารางสี (Legend)", M, legTop);
    var rY=legTop+legTitleH;
    leg.forEach(function(g,i){
      var gy=rY+i*legRowH;
      cx.fillStyle=g.color; _rr(cx,M,gy+(legRowH-swz)/2,swz,swz,Math.round(swz*0.28)); cx.fill();
      cx.strokeStyle="rgba(0,0,0,.15)"; cx.lineWidth=1; _rr(cx,M,gy+(legRowH-swz)/2,swz,swz,Math.round(swz*0.28)); cx.stroke();
      var lx=M+swz+Math.round(SW*0.008);
      cx.textBaseline="middle";
      cx.fillStyle=ink; cx.font="700 "+legFS+"px "+FF;
      var head=g.label+" ("+g.n+")";
      cx.fillText(head, lx, gy+legRowH/2);
      var cxs=lx+cx.measureText(head).width+Math.round(SW*0.012);
      cx.fillStyle=sub; cx.font="500 "+legFS+"px "+FF;
      cx.fillText(_fitCodes(cx, g.codes, (SW-M)-cxs), cxs, gy+legRowH/2);
      cx.textBaseline="top";
    });
  }
  // ── รูปแปลน (กลาง) letterbox ──
  var areaTop=headBottom+Math.round(SH*0.008), areaBottom=(leg.length?legTop:SH-M)-Math.round(SH*0.006);
  var pw=SW-2*M, ph=areaBottom-areaTop;
  var s=Math.min(pw/planCv.width, ph/planCv.height);
  var dw=planCv.width*s, dh=planCv.height*s, dx=M+(pw-dw)/2, dy=areaTop+(ph-dh)/2;
  cx.fillStyle="#ffffff"; cx.fillRect(dx-2,dy-2,dw+4,dh+4);
  cx.strokeStyle="#d6dbe4"; cx.lineWidth=2; cx.strokeRect(dx-2,dy-2,dw+4,dh+4);
  // หมายเหตุ: ไม่วาดรูปแปลนลงบนเฟรมนี้ — จะวางเป็น image object แยกความละเอียดสูงใน PDF (คมตอนซูม)
  // ── คีย์แปลน (มุมขวาบนของกรอบแปลน) — บอกว่าโซนที่ซูมมาอยู่ตรงไหนของแปลนรวม ──
  if(keyCv){
    var capH=Math.round(SW*0.016), ipad=Math.round(SW*0.008);
    var kw2=Math.min(SW*0.20, dw*0.34), kh2=kw2*(keyCv.height/keyCv.width);
    var maxKH=ph*0.40; if(kh2>maxKH){ kh2=maxKH; kw2=kh2*(keyCv.width/keyCv.height); }
    var cardW=kw2+ipad*2, cardH=kh2+ipad*2+capH;
    var cardX=dx+dw-cardW-Math.round(SW*0.01), cardY=dy+Math.round(SW*0.01);
    cx.fillStyle="#ffffff"; _rr(cx,cardX,cardY,cardW,cardH,Math.round(SW*0.006)); cx.fill();
    cx.strokeStyle="#c9d1dd"; cx.lineWidth=1.5; _rr(cx,cardX,cardY,cardW,cardH,Math.round(SW*0.006)); cx.stroke();
    cx.fillStyle=sub; cx.font="700 "+Math.round(SW*0.0092)+"px "+FF; cx.textBaseline="top";
    cx.fillText("คีย์แปลน — โซนที่ตรวจ", cardX+ipad, cardY+ipad-1);
    cx.drawImage(keyCv, cardX+ipad, cardY+ipad+capH, kw2, kh2);
  }
  return {cv:cv, rect:{dx:dx, dy:dy, dw:dw, dh:dh}};   // คืนเฟรม + ตำแหน่งกรอบแปลน (พิกเซล) ไว้วางรูปแปลนทับ
}
/** วาดสี่เหลี่ยมมุมมน (helper) */
function _rr(cx,x,y,w,h,r){ r=Math.min(r,w/2,h/2); cx.beginPath();
  cx.moveTo(x+r,y); cx.arcTo(x+w,y,x+w,y+h,r); cx.arcTo(x+w,y+h,x,y+h,r); cx.arcTo(x,y+h,x,y,r); cx.arcTo(x,y,x+w,y,r); cx.closePath(); }
/** แสดงรหัสให้พอดีความกว้างที่มี — ถ้าเกินตัดเป็น "…(+N)" (ตั้งค่า font ก่อนเรียก) */
function _fitCodes(cx, codes, maxW){
  if(!codes.length) return "";
  var full=codes.join(", ");
  if(cx.measureText(full).width<=maxW) return full;   // ครบทุกเบอร์ถ้าพอ
  var shown=1;
  for(var i=1;i<=codes.length;i++){
    var rest=codes.length-i;
    var cand=codes.slice(0,i).join(", ")+(rest>0?" …(+"+rest+")":"");
    if(cx.measureText(cand).width>maxW) break;
    shown=i;
  }
  var rest2=codes.length-shown;
  return codes.slice(0,shown).join(", ")+(rest2>0?" …(+"+rest2+")":"");
}
/** ห่อ JPEG เป็น PDF หน้าเดียว (DeviceRGB/DCTDecode) — สร้างไบต์เอง ไม่ง้อไลบรารี */
function _pdfFromJpeg(jpegU8, iw, ih, pw, ph){
  var chunks=[], offsets=[], pos=0;
  function put(s){ var a=new Uint8Array(s.length); for(var i=0;i<s.length;i++) a[i]=s.charCodeAt(i)&0xff; chunks.push(a); pos+=a.length; }
  function putBytes(u8){ chunks.push(u8); pos+=u8.length; }
  function mark(n){ offsets[n]=pos; }
  pw=Math.round(pw*100)/100; ph=Math.round(ph*100)/100;
  put("%PDF-1.3\n%\xE2\xE3\xCF\xD3\n");
  mark(1); put("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  mark(2); put("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  mark(3); put("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "+pw+" "+ph+"] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n");
  mark(4); put("4 0 obj\n<< /Type /XObject /Subtype /Image /Width "+iw+" /Height "+ih+" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length "+jpegU8.length+" >>\nstream\n");
  putBytes(jpegU8); put("\nendstream\nendobj\n");
  var content="q\n"+pw+" 0 0 "+ph+" 0 0 cm\n/Im0 Do\nQ\n";
  mark(5); put("5 0 obj\n<< /Length "+content.length+" >>\nstream\n"+content+"endstream\nendobj\n");
  var xrefPos=pos, N=5, xref="xref\n0 "+(N+1)+"\n0000000000 65535 f \n";
  for(var i=1;i<=N;i++) xref+=("0000000000"+offsets[i]).slice(-10)+" 00000 n \n";
  put(xref); put("trailer\n<< /Size "+(N+1)+" /Root 1 0 R >>\nstartxref\n"+xrefPos+"\n%%EOF");
  var total=chunks.reduce(function(a,c){return a+c.length;},0), outU=new Uint8Array(total), off=0;
  chunks.forEach(function(c){ outU.set(c,off); off+=c.length; });
  return new Blob([outU],{type:"application/pdf"});
}
/** canvas → ไบต์ JPEG (Uint8Array) */
function _jpegBytes(cv, q){
  var bin=atob(cv.toDataURL("image/jpeg", q||0.92).split(",")[1]);
  var u=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
  return u;
}
/** ห่อหลายภาพเป็น PDF หน้าเดียว — แต่ละภาพวางตามพิกัด (จุด, y นับจากล่าง) → แปลนคมแยกความละเอียดได้ */
function _pdfFromImages(pw, ph, imgs){
  var chunks=[], offsets=[], pos=0;
  function put(s){ var a=new Uint8Array(s.length); for(var i=0;i<s.length;i++) a[i]=s.charCodeAt(i)&0xff; chunks.push(a); pos+=a.length; }
  function putBytes(u8){ chunks.push(u8); pos+=u8.length; }
  function mark(n){ offsets[n]=pos; }
  pw=Math.round(pw*100)/100; ph=Math.round(ph*100)/100;
  var imgStart=5, N=imgs.length;
  put("%PDF-1.3\n%\xE2\xE3\xCF\xD3\n");
  mark(1); put("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  mark(2); put("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  var xo=""; for(var i=0;i<N;i++) xo+="/Im"+i+" "+(imgStart+i)+" 0 R ";
  mark(3); put("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "+pw+" "+ph+"] /Resources << /XObject << "+xo+">> >> /Contents 4 0 R >>\nendobj\n");
  var content=""; imgs.forEach(function(im,i){
    var x=Math.round(im.x*100)/100, y=Math.round(im.y*100)/100, w=Math.round(im.w*100)/100, h=Math.round(im.h*100)/100;
    content+="q\n"+w+" 0 0 "+h+" "+x+" "+y+" cm\n/Im"+i+" Do\nQ\n";
  });
  mark(4); put("4 0 obj\n<< /Length "+content.length+" >>\nstream\n"+content+"endstream\nendobj\n");
  imgs.forEach(function(im,i){
    mark(imgStart+i);
    put((imgStart+i)+" 0 obj\n<< /Type /XObject /Subtype /Image /Width "+im.iw+" /Height "+im.ih+" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length "+im.u8.length+" >>\nstream\n");
    putBytes(im.u8); put("\nendstream\nendobj\n");
  });
  var totalObjs=imgStart+N-1, xrefPos=pos, xref="xref\n0 "+(totalObjs+1)+"\n0000000000 65535 f \n";
  for(var k=1;k<=totalObjs;k++) xref+=("0000000000"+offsets[k]).slice(-10)+" 00000 n \n";
  put(xref); put("trailer\n<< /Size "+(totalObjs+1)+" /Root 1 0 R >>\nstartxref\n"+xrefPos+"\n%%EOF");
  var total=chunks.reduce(function(a,c){return a+c.length;},0), outU=new Uint8Array(total), off=0;
  chunks.forEach(function(c){ outU.set(c,off); off+=c.length; });
  return new Blob([outU],{type:"application/pdf"});
}
function _downloadBlob(blob,name){
  var url=URL.createObjectURL(blob), a=document.createElement("a");
  a.href=url; a.download=name; document.body.appendChild(a); a.click();
  setTimeout(function(){ try{document.body.removeChild(a);}catch(e){} URL.revokeObjectURL(url); },1500);
}
function _safeName(s){ return String(s||"").replace(/[\\\/:*?"<>|]+/g,"").replace(/\s+/g,"-").slice(0,40)||"plan"; }
/** จุดเริ่ม: นำออกแปลนปัจจุบัน (พร้อมไฮไลท์) เป็น PDF */
function exportPlanPDF(){
  var f=getFloor(state.floorId); if(!f){ toast("ยังไม่ได้เลือกชั้น",true); return; }
  var plan=getFloorPlan(f), _pid=curPlanId(), type=state.catType;
  var vm=membersOfFloor(f.id).filter(function(m){ return m.plan && !m.hidden && memberPlanId(m)===_pid && (state.unified?!state.hiddenTypes[m.type]:(m.type===type)); });
  if(!plan && vm.length===0){ toast("ยังไม่มีแปลนหรือชิ้นส่วนให้นำออก",true); return; }
  toast("กำลังสร้าง PDF…");
  buildComposite({x1:0,y1:0,x2:1,y2:1,full:true}, 8000).then(function(planCv){   // แปลน+ไฮไลท์ ความละเอียดสูง (ภาพแยก) สำหรับ A3
    var built=buildReportSheet(planCv, vm, null);   // เฟรม A3: หัว + legend + กรอบแปลนเปล่า
    var frameCv=built.cv, rect=built.rect, landscape=frameCv.width>=frameCv.height;
    var Wpt=landscape?1190.55:841.89, Hpt=landscape?841.89:1190.55;   // A3 (จุด)
    var sx=Wpt/frameCv.width, sy=Hpt/frameCv.height;
    var imgs=[
      { u8:_jpegBytes(frameCv,0.9), iw:frameCv.width, ih:frameCv.height, x:0, y:0, w:Wpt, h:Hpt },                         // เฟรมเต็มหน้า
      { u8:_jpegBytes(planCv,0.92), iw:planCv.width, ih:planCv.height,                                                     // แปลนคมสูงวางทับกรอบ
        x:rect.dx*sx, y:Hpt-(rect.dy+rect.dh)*sy, w:rect.dw*sx, h:rect.dh*sy }
    ];
    var blob=_pdfFromImages(Wpt, Hpt, imgs);
    var p=getProject(state.projectId);
    var fname="RebarCheck-"+_safeName(p&&p.name)+"-"+_safeName(f.name)+"-"+_safeName(TYPE_EN[type]||type)+".pdf";
    _downloadBlob(blob, fname);
    toast("บันทึก PDF แล้ว ✓");
  }).catch(function(e){ toast("สร้าง PDF ไม่สำเร็จ: "+(e&&e.message||e),true); });
}

/** นำออก PDF ความคืบหน้าเทคอนกรีต — แปลน + โซนสี + ป้ายสถานะ */
function exportProgressPDF(){
  var f=getFloor(state.floorId); if(!f){ toast("ยังไม่ได้เลือกชั้น",true); return; }
  var plan=getFloorPlan(f), _pid=curPlanId(), type=state.catType;
  var zones=zonesOfPlan(f.id, _pid);
  if(!plan && zones.length===0){ toast("ยังไม่มีแปลนหรือโซนเทให้นำออก",true); return; }
  var origProgress=state.showProgress; state.showProgress=true;
  var vm=membersOfFloor(f.id).filter(function(m){ return m.plan && !m.hidden && memberPlanId(m)===_pid && (state.unified?!state.hiddenTypes[m.type]:(m.type===type)); });
  toast("กำลังสร้าง PDF อัพเดท…");
  var stListX=zoneStatuses(f.id,_pid);
  var zc={}; zones.forEach(function(z){ zc[z.status]=(zc[z.status]||0)+1; });
  var zChips=[["ทั้งหมด "+zones.length+" โซน",null]].concat(stListX.map(function(s){ return [s.label+" "+(zc[s.id]||0), s.color]; }));
  var zLeg=stListX.filter(function(s){ return (zc[s.id]||0)>0; }).map(function(s){
    return { color:s.color, label:s.label, n:zc[s.id], codes:zones.filter(function(z){return z.status===s.id;}).map(function(z){return z.name;}) };
  });
  var p0=getProject(state.projectId);
  var zSub=(p0?p0.name:"—")+"  ·  "+(f?f.name:"—")+"  ·  "+(plan?(plan.name||"แปลน"):"—");
  buildComposite({x1:0,y1:0,x2:1,y2:1,full:true}, 8000).then(function(planCv){
    state.showProgress=origProgress;
    var built=buildReportSheet(planCv, vm, null, {title:"รายงานความคืบหน้าเทคอนกรีต", subtitle:zSub, chips:zChips, legend:zLeg, legendTitle:"สถานะการเทคอนกรีต"});
    var frameCv=built.cv, rect=built.rect, landscape=frameCv.width>=frameCv.height;
    var Wpt=landscape?1190.55:841.89, Hpt=landscape?841.89:1190.55;
    var sx=Wpt/frameCv.width, sy=Hpt/frameCv.height;
    var imgs=[
      { u8:_jpegBytes(frameCv,0.9), iw:frameCv.width, ih:frameCv.height, x:0, y:0, w:Wpt, h:Hpt },
      { u8:_jpegBytes(planCv,0.92), iw:planCv.width, ih:planCv.height,
        x:rect.dx*sx, y:Hpt-(rect.dy+rect.dh)*sy, w:rect.dw*sx, h:rect.dh*sy }
    ];
    var blob=_pdfFromImages(Wpt, Hpt, imgs);
    var p=getProject(state.projectId);
    var fname="RebarCheck-Progress-"+_safeName(p&&p.name)+"-"+_safeName(f.name)+".pdf";
    _downloadBlob(blob, fname);
    toast("บันทึก PDF อัพเดทแล้ว ✓");
  }).catch(function(e){ state.showProgress=origProgress; toast("สร้าง PDF ไม่สำเร็จ: "+(e&&e.message||e),true); });
}

/** เรนเดอร์เฉพาะ "ส่วนที่มองเห็น" ของหน้า PDF (rx1..rx2, ry1..ry2 = 0..1) ที่ความกว้าง targetW */
function renderPdfRegionToCanvas(page, rx1,ry1,rx2,ry2, targetW){
  return queuePdf(function(){ return new Promise(function(resolve,reject){
    var base=page.getViewport({scale:1});
    var regWpts=Math.max(1,(rx2-rx1)*base.width);
    var scale=Math.max(0.2, Math.min(80, targetW/regWpts));   // เพดานสเกลพอเหมาะ (สูงเกินไปเรนเดอร์ช้า/ค้าง)
    var vp=page.getViewport({scale:scale});
    var cw=Math.round((rx2-rx1)*vp.width), ch=Math.round((ry2-ry1)*vp.height);
    var MAXD=8600;                                   // กันแคนวาสใหญ่เกิน (หน่วยความจำ) — เผื่อ export A3 คมสูง
    if(cw>MAXD||ch>MAXD){ scale*=MAXD/Math.max(cw,ch); vp=page.getViewport({scale:scale});
      cw=Math.round((rx2-rx1)*vp.width); ch=Math.round((ry2-ry1)*vp.height); }
    var offX=rx1*vp.width, offY=ry1*vp.height;
    if(cw<2||ch<2){ reject(new Error("region เล็กเกินไป")); return; }
    var cv=document.createElement("canvas"); cv.width=cw; cv.height=ch;
    var ctx=cv.getContext("2d"); ctx.fillStyle="#fff"; ctx.fillRect(0,0,cw,ch);
    var task=page.render({canvasContext:ctx, viewport:vp, transform:[1,0,0,1,-offX,-offY]}), done=false;
    var t=setTimeout(function(){ if(done)return; done=true; try{task.cancel();}catch(e){} reject(new Error("หมดเวลา")); }, 20000);
    task.promise.then(function(){ if(done)return; done=true; clearTimeout(t); resolve(cv); })
      .catch(function(e){ if(done)return; done=true; clearTimeout(t); reject(e); });
  }); });
}

/** เรนเดอร์ส่วนที่มองเห็นแบบ FOXIT — คมทุกระดับซูม โดยใช้แรมน้อย (raster เท่าที่เห็นบนจอ) */
function renderVisibleRegion(){
  var key=planSourceKey(), doc=PLAN_DOCS[key];
  var det=$("#planDetail"), st=$("#planStage");
  if(!det||!st) return;
  if(!doc || doc.kind!=="pdf" || !doc.page){ det.style.display="none"; _planDbg("doc="+(doc?doc.kind:"null")+" (ไม่มี PDF page → ใช้ภาพฐาน)"); if(state.zoom>1.05) planTip("แปลนนี้ไม่ใช่ PDF เวกเตอร์ — ซูมได้เท่าความละเอียดรูป"); return; }
  var sw=st.clientWidth, sh=st.clientHeight, z=state.zoom, px=state.panX, py=state.panY;
  if(!sw||!sh){ _planDbg("stage 0px"); return; }
  var _mob=(window.innerWidth||1024)<760;
  // มือถือ: เรนเดอร์ส่วนที่เห็นเสมอ (แม้ยังไม่ซูม) เพราะภาพเต็มหน้าความละเอียดสูงเกินลิมิต iOS แล้วเบลอ · เดสก์ท็อป: ซูมต่ำใช้ภาพฐานพอ
  if(z<=1.05 && !_mob){ det.style.display="none"; _planDbg("desktop z ต่ำ (ใช้ภาพฐาน)"); return; }
  var rx1=Math.max(0,(0-px)/(sw*z)), ry1=Math.max(0,(0-py)/(sh*z));
  var rx2=Math.min(1,(sw-px)/(sw*z)), ry2=Math.min(1,(sh-py)/(sh*z));
  if(rx2-rx1<0.002 || ry2-ry1<0.002) return;
  var dpr=Math.min(window.devicePixelRatio||1, 3);
  var SS=_mob?3.0:2.8, cap=_mob?3200:6400;   // มือถือเพดาน 3200px (ต่ำกว่าลิมิต iOS 4096 → เรนเดอร์ผ่านชัวร์ ไม่เบลอ)
  // เรนเดอร์เผื่อขอบรอบ ๆ ที่เห็น → เลื่อน/ซูมนิดหน่อยยังคม ไม่ต้องเรนเดอร์ใหม่ (ลดกระตุก + ลดภาพเบลอระหว่างซูม)
  var mx=(rx2-rx1)*0.18, my=(ry2-ry1)*0.18;
  var ex1=Math.max(0,rx1-mx), ey1=Math.max(0,ry1-my), ex2=Math.min(1,rx2+mx), ey2=Math.min(1,ry2+my);
  var needPPU=sw*z*dpr*SS;                    // พิกเซลที่ต้องการต่อความกว้างแปลนเต็ม
  var targetW=Math.max(1000, Math.min(cap, Math.round((ex2-ex1)*needPPU)));
  // ใช้ภาพคมเดิมซ้ำได้ไหม — ต้องคลุมพื้นที่ที่เห็นอยู่ และความละเอียดยังพอ
  var bx=doc.detailBox;
  if(bx && doc.detailUrl
     && bx.rx1<=rx1+1e-6 && bx.ry1<=ry1+1e-6 && bx.rx2>=rx2-1e-6 && bx.ry2>=ry2-1e-6
     && (doc.detailPPU||0) >= needPPU*0.7){
    if(!det.getAttribute("src")) det.src=doc.detailUrl;   // #planDetail ถูกสร้างใหม่หลัง render → ทาภาพคมที่แคชไว้กลับ
    det.style.display="block"; positionDetail();
    _planDbg("ใช้แคชคม (คลุมพื้นที่+ละเอียดพอ)");
    return;
  }
  if(doc.regionRendering){ doc.regionPending=1; _planDbg("กำลังเรนเดอร์อยู่ (คิว)"); return; }
  doc.regionRendering=true;
  _planDbg("กำลังเรนเดอร์คม tgt="+targetW+"px…");
  renderPdfRegionToCanvas(doc.page, ex1,ey1,ex2,ey2, targetW).then(function(cv){
    function finish(url){
      doc.regionRendering=false;
      if(planSourceKey()===key){
        if(doc.detailUrl){ try{ URL.revokeObjectURL(doc.detailUrl); }catch(e){} }
        if(url.indexOf("blob:")===0) doc.detailUrl=url;
        det.src=url;
        doc.detailBox={rx1:ex1,ry1:ey1,rx2:ex2,ry2:ey2};   // ตำแหน่งภาพคม (พิกัดแปลน 0..1)
        doc.detailPPU=cv.width/Math.max(1e-6,(ex2-ex1));   // ความละเอียดจริงที่ได้ (px ต่อแปลนเต็ม)
        det.style.display="block";
        positionDetail();                                   // วางในพิกัดจอจริง (screen-space) → คมบน iOS
        planLog("🔍 คมส่วนที่เห็น "+cv.width+"×"+cv.height);
        planTip("คมแล้ว "+cv.width+"×"+cv.height+" px");
        _planDbg("OK คม "+cv.width+"×"+cv.height);
      }
      if(doc.regionPending){ doc.regionPending=null; renderVisibleRegion(); }
    }
    if(cv.toBlob){ cv.toBlob(function(b){ finish(b?URL.createObjectURL(b):cv.toDataURL("image/png")); },"image/png"); }
    else finish(cv.toDataURL("image/png"));
  }).catch(function(e){ doc.regionRendering=false; _planDbg("ERR "+(e&&e.message||e)); planLog("โซมชัดส่วนที่เห็นล้มเหลว: "+(e&&e.message||e),true); planTip("เรนเดอร์คมล้มเหลว: "+(e&&e.message||e),true); });
}
// ชื่อเดิมยังถูกเรียกจากที่อื่น → ชี้มาที่ระบบ region ใหม่
function ensurePdfResolution(){ renderVisibleRegion(); }

/** ใช้ภาพที่คมที่สุดสำหรับหมวดปัจจุบัน (โหลดต้นฉบับจาก IDB ถ้ายังไม่มีใน cache) */
function applyBestImage(){
  var img=$(".plan-img"), det=$("#planDetail");
  if(!img) return;
  var key=planSourceKey(), doc=PLAN_DOCS[key];
  if(!doc){ if(det) det.style.display="none"; _planDbg("กำลังโหลดต้นฉบับแปลน…"); loadPlanSource(key).then(function(d){ if(d && planSourceKey()===key) applyBestImage(); else if(!d) _planDbg("โหลดต้นฉบับไม่ได้ (ใช้พรีวิว)"); }); return; }
  if(doc.kind==="img"){
    if(det) det.style.display="none";
    if(doc.url && img.getAttribute("data-full")!==doc.url){ img.src=doc.url; img.setAttribute("data-full",doc.url); }
  }else{
    var _mobA=(window.innerWidth||1024)<760;
    // (1) ภาพฐานทั้งหน้า — เฉพาะเดสก์ท็อป ใช้ตอนซูมต่ำเท่านั้น (ตอนซูมเข้าใช้เลเยอร์ region ที่คมกว่า)
    //     ไม่ต้องใหญ่ 6000px เพราะเรนเดอร์ทีเดียวหนักมาก = ค้างยาว; 3400px คมพอที่ซูม ≤1.05x
    if(!_mobA){
      if(doc.bigUrl){ if(img.src!==doc.bigUrl) img.src=doc.bigUrl; }
      else if(!doc.bigRendering){
        doc.bigRendering=true;
        renderPdfToCanvas(doc.page, 3400).then(function(cv){
          var setu=function(u){ doc.bigRendering=false; doc.bigUrl=u;
            if(planSourceKey()===key){ var im=$(".plan-img"); if(im) im.src=u; }
            planLog("ภาพคมทั้งหน้า "+cv.width+"×"+cv.height+" ✓"); };
          if(cv.toBlob) cv.toBlob(function(b){ setu(b?URL.createObjectURL(b):cv.toDataURL("image/jpeg",0.92)); },"image/jpeg",0.92);
          else setu(cv.toDataURL("image/jpeg",0.92));
        }).catch(function(e){ doc.bigRendering=false; planLog("เรนเดอร์ภาพคมไม่สำเร็จ: "+(e&&e.message||e),true); });
      }
    }
    // (2) region — คมส่วนที่เห็น (บนมือถือคือตัวหลัก เรนเดอร์เสมอที่ขนาดปลอดภัย)
    renderVisibleRegion();
  }
}
/** โหลดไฟล์ต้นฉบับจาก IndexedDB เข้ามาไว้ใน PLAN_DOCS (หลัง reload) */
function loadPlanSource(key){
  if(PLAN_DOCS[key]) return Promise.resolve(PLAN_DOCS[key]);
  return idbGet(key).then(function(rec){
    if(rec) return rec;
    // ของเก่าเคยเก็บต้นฉบับแยกหมวด (floorId:catType) → หาอันแรกที่มี มาใช้ร่วมทั้งชั้น
    var cats=["beam","column","slab","stair","wall","footing","pt"];
    return (function tryNext(i){
      if(i>=cats.length) return null;
      return idbGet(key+":"+cats[i]).then(function(r2){ return r2 || tryNext(i+1); });
    })(0);
  }).then(function(rec){
    if(rec) return rec;
    // ไม่มีในเครื่อง → ลองดึงจากคลาวด์ (Firestore chunking) แล้วแคชลงเครื่อง
    return cloudFetchPlan(key).then(function(cf){
      if(!cf) return null;
      var r={kind:cf.kind, bytes:cf.bytes, pageNo:cf.pageNo};
      idbPut(key, r).catch(function(){});   // แคชไว้ เปิดครั้งต่อไปไว
      return r;
    });
  }).then(function(rec){
    if(!rec) return null;
    if(rec.kind==="img"){
      var url=URL.createObjectURL(new Blob([rec.bytes]));
      return new Promise(function(res){
        var im=new Image();
        im.onload=function(){ PLAN_DOCS[key]={kind:"img", url:url, natW:im.naturalWidth, natH:im.naturalHeight}; res(PLAN_DOCS[key]); };
        im.onerror=function(){ res(null); };
        im.src=url;
      });
    }
    return loadPdfJs().then(function(lib){
      return lib.getDocument(pdfDocOpts(new Uint8Array(rec.bytes.slice(0)))).promise
        .then(function(pdf){ return pdf.getPage(rec.pageNo||1); })
        .then(function(page){ PLAN_DOCS[key]={kind:"pdf", page:page, pageNo:rec.pageNo||1};
          extractPdfSegments(page).then(function(sg){ attachSnap(PLAN_DOCS[key], sg); });   // ดึงเส้นสำหรับสแนบ (หลัง reload)
          return PLAN_DOCS[key]; });
    }).catch(function(){ return null; });
  }).catch(function(){ return null; });
}
var _ensureT=null;
/** เรียก applyBestImage แบบหน่วงเวลา (หลังหยุดซูม) เพื่อไม่เรนเดอร์ถี่เกินไป */
function scheduleEnsure(){ clearTimeout(_ensureT); _ensureT=setTimeout(applyBestImage, 190); }

/** เก็บภาพตัวอย่าง (base raster) — upsert ลง "แปลนที่กำลังเลือก" ใน planList (รองรับหลายแปลน) */
function storePlan(src, w, hh, kind){
  var f=getFloor(state.floorId);
  if(!f.planList) f.planList=[];
  try{ if(f.plan) delete f.plan; if(f.plans) delete f.plans; }catch(e){}   // ล้างของเก่า
  var id=f.activePlanId||"_main"; f.activePlanId=id;
  var entry=f.planList.filter(function(p){return p.id===id;})[0];
  var backup=entry?JSON.parse(JSON.stringify(entry)):null;
  if(entry){ entry.src=src; entry.w=w; entry.h=hh; entry.kind=kind||"img"; }
  else { entry={ id:id, name:"แปลน "+(f.planList.length+1), src:src, w:w, h:hh, kind:kind||"img" }; f.planList.push(entry); }
  if(!saveDB()){
    if(backup){ var i=f.planList.indexOf(entry); f.planList[i]=backup; } else { f.planList=f.planList.filter(function(p){return p!==entry;}); }
    setPlanBusy(null); toast("บันทึกไม่สำเร็จ — พื้นที่เก็บอาจเต็ม",true);
    return false;
  }
  state.zoom=1; state.panX=0; state.panY=0;   // เริ่มที่พอดีกรอบ
  setPlanBusy(null);
  planLog("นำเข้าเสร็จสมบูรณ์ ✓ แสดงบนแปลนแล้ว");
  render(); toast("นำเข้าแปลนแล้ว");
  return true;
}

/** นำเข้าแปลน: รองรับทั้งรูปภาพ และ PDF (deep-zoom ระดับ CAD) */
function importPlan(file){
  var isPdf = file.type==="application/pdf" || /\.pdf$/i.test(file.name||"");
  planLog(isPdf ? "ชนิดไฟล์: PDF → เริ่มประมวลผล" : "ชนิดไฟล์: รูปภาพ → เริ่มประมวลผล");
  if(isPdf){ importPdf(file); return; }

  setPlanBusy("กำลังนำเข้าแปลน...");
  var reader=new FileReader();
  reader.onerror=function(){ setPlanBusy(null); toast("อ่านไฟล์ไม่ได้",true); };
  reader.onload=function(){
    var buf=reader.result;
    var img=new Image();
    img.onerror=function(){ planLog("รูปเสียหรือชนิดไม่รองรับ",true); setPlanStatus("รูปเสียหรือชนิดไม่รองรับ","error"); };
    img.onload=function(){
      planLog("ถอดรหัสรูปได้ "+img.naturalWidth+"×"+img.naturalHeight+" → กำลังบันทึก");
      // ภาพตัวอย่างความละเอียดต่ำสำหรับ localStorage (แสดงทันที)
      var baseSide=1400, sc=Math.min(1, baseSide/Math.max(img.width,img.height));
      var w=Math.round(img.width*sc), hh=Math.round(img.height*sc);
      var cv=document.createElement("canvas"); cv.width=w; cv.height=hh;
      var ctx=cv.getContext("2d"); ctx.fillStyle="#fff"; ctx.fillRect(0,0,w,hh);
      ctx.drawImage(img,0,0,w,hh);
      var src; try{ src=cv.toDataURL("image/jpeg",0.85); }catch(e){ setPlanBusy(null); toast("แปลงรูปไม่สำเร็จ",true); return; }
      var key=planSourceKey();
      // เก็บต้นฉบับความละเอียดเต็มลง IDB + cache ไว้แสดงแบบคมสุด
      idbPut(key, {kind:"img", bytes:buf}).catch(function(){});
      var url=URL.createObjectURL(new Blob([buf]));
      PLAN_DOCS[key]={kind:"img", url:url, natW:img.naturalWidth, natH:img.naturalHeight};
      PLAN_PREVIEW[key]=src;
      storePlan(src, w, hh, "img");   // → render() → applyBestImage() แสดงต้นฉบับคมเต็ม
      cloudUploadPlan(key, buf, {kind:"img", w:w, h:hh, natW:img.naturalWidth, natH:img.naturalHeight, preview:src});   // ขึ้นคลาวด์ให้คนอื่นเห็น
    };
    img.src=URL.createObjectURL(new Blob([buf]));
  };
  reader.readAsArrayBuffer(file);
}

/* ---- โหลด pdf.js: ลองไฟล์ในเครื่อง (vendor/) ก่อน แล้วค่อย fallback ไป CDN ----
   วิธีนี้ทำให้นำเข้า PDF ได้แม้ไม่มีอินเทอร์เน็ต (เช่นอยู่หลัง WiFi ที่ต้องล็อกอิน)
   ขอแค่มีโฟลเดอร์ vendor/ อยู่ข้างไฟล์เว็บ */
var PDFJS_VER="3.11.174";
var PDFJS_CDN="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/"+PDFJS_VER+"/";
var PDFJS_LOCAL="vendor/";
var PDFJS_BASE=PDFJS_CDN;          // ใช้สำหรับ cmap/standard_fonts (ถ้ามีเน็ต)
var _pdfjsPromise=null;
function loadScriptEl(src){
  return new Promise(function(res,rej){
    var s=document.createElement("script"); s.src=src;
    s.onload=function(){ res(src); };
    s.onerror=function(){ rej(new Error("โหลดไม่ได้: "+src)); };
    document.head.appendChild(s);
  });
}
function loadPdfJs(){
  if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if(_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = loadScriptEl(PDFJS_LOCAL+"pdf.min.js")
    .then(function(){ return {worker:PDFJS_LOCAL+"pdf.worker.min.js", local:true}; })
    .catch(function(){    // ไม่มีไฟล์ในเครื่อง → ลอง CDN (ต้องมีเน็ต)
      return loadScriptEl(PDFJS_CDN+"pdf.min.js").then(function(){ return {worker:PDFJS_CDN+"pdf.worker.min.js", local:false}; });
    })
    .then(function(info){
      if(!window.pdfjsLib) throw new Error("โหลด pdf.js ไม่ได้");
      // ใช้ cmap/ฟอนต์มาตรฐานจาก CDN เฉพาะตอนออนไลน์; ออฟไลน์ไม่ตั้งเพื่อไม่ให้ดึงเน็ต
      window.__pdfjsAssets = info.local ? null : PDFJS_CDN;
      planLog("pdf.js "+window.pdfjsLib.version+" โหลดจาก "+(info.local?"ไฟล์ในเครื่อง vendor/":"CDN (เน็ต)"));
      // ตั้ง worker เป็น blob (กลไกเดียวกับตอนที่เคยเรนเดอร์ได้) — ดึงไฟล์ worker มาทำ blob
      return fetch(info.worker).then(function(r){
        if(!r.ok) throw new Error("worker "+r.status);
        return r.text();
      }).then(function(txt){
        var blob=new Blob([txt],{type:"application/javascript"});
        window.pdfjsLib.GlobalWorkerOptions.workerSrc=URL.createObjectURL(blob);
        return window.pdfjsLib;
      }).catch(function(){   // ดึงไม่ได้ → ใช้ path ตรง (ยังทำงานได้ในกรณีทั่วไป)
        try{ window.pdfjsLib.GlobalWorkerOptions.workerSrc=info.worker; }catch(e){}
        return window.pdfjsLib;
      });
    });
  _pdfjsPromise.catch(function(){ _pdfjsPromise=null; });   // ล้มเหลว → ให้ลองใหม่ได้
  return _pdfjsPromise;
}
/** สร้าง options ให้ getDocument — ใส่ cmap/ฟอนต์เฉพาะตอนออนไลน์ */
function pdfDocOpts(bytes){
  var o={ data:bytes };
  if(window.__pdfjsAssets){
    o.cMapUrl=window.__pdfjsAssets+"cmaps/"; o.cMapPacked=true;
    o.standardFontDataUrl=window.__pdfjsAssets+"standard_fonts/";
  }
  return o;
}

/** นำเข้า PDF: เก็บต้นฉบับ (deep-zoom) + เรนเดอร์ภาพตัวอย่างแบบไว จากนั้นอัปเกรดตามซูม */
function importPdf(file){
  planLog(window.pdfjsLib ? "pdf.js พร้อมแล้ว" : "กำลังโหลดตัวอ่าน pdf.js...");
  setPlanBusy(window.pdfjsLib ? "กำลังอ่าน PDF..." : "กำลังโหลดตัวอ่าน PDF...");
  loadPdfJs().then(function(pdfjsLib){
    planLog("โหลด pdf.js สำเร็จ ("+(window.__pdfjsAssets?"CDN":"ไฟล์ในเครื่อง")+") → กำลังอ่านไฟล์");
    setPlanStatus("กำลังอ่านไฟล์ PDF...", "busy");
    var reader=new FileReader();
    reader.onerror=function(){ planLog("อ่านไฟล์ไม่ได้",true); setPlanStatus("อ่านไฟล์ไม่ได้","error"); };
    reader.onload=function(){
      var buf=reader.result;   // ArrayBuffer ต้นฉบับ (เก็บลง IDB)
      planLog("อ่านไฟล์เสร็จ ("+Math.round(buf.byteLength/1024)+" KB) → กำลังเปิด PDF");
      pdfjsLib.getDocument(pdfDocOpts(new Uint8Array(buf.slice(0)))).promise.then(function(pdf){
        planLog("เปิด PDF ได้ "+pdf.numPages+" หน้า");
        var pageNo=1;
        if(pdf.numPages>1){
          var ans=window.prompt("PDF มี "+pdf.numPages+" หน้า — เลือกหน้าที่เป็นแปลน (1-"+pdf.numPages+"):","1");
          if(ans===null){ setPlanStatus(null); planLog("ยกเลิก"); return; }
          pageNo=Math.min(Math.max(1, parseInt(ans,10)||1), pdf.numPages);
        }
        setPlanStatus("กำลังเรนเดอร์แปลน (อาจใช้เวลาสักครู่)...", "busy");
        pdf.getPage(pageNo).then(function(page){
          planLog("ได้หน้า "+pageNo+" → เริ่มเรนเดอร์เป็นภาพ");
          var key=planSourceKey();
          PLAN_DOCS[key]={kind:"pdf", page:page, pageNo:pageNo};   // cache สำหรับ deep-zoom
          idbPut(key, {kind:"pdf", bytes:buf, pageNo:pageNo}).catch(function(){});
          extractPdfSegments(page).then(function(sg){ attachSnap(PLAN_DOCS[key], sg); });   // ดึงเส้นสำหรับสแนบ
          renderPdfToDataURL(page, 2400).then(function(r){
            planLog("เรนเดอร์เสร็จ "+r.w+"×"+r.h+" ✓ กำลังแสดงผล");
            PLAN_DOCS[key].renderedW=r.w;
            PLAN_PREVIEW[key]=r.src;
            storePlan(r.src, r.w, r.h, "pdf");
            cloudUploadPlan(key, buf, {kind:"pdf", pageNo:pageNo, w:r.w, h:r.h, preview:r.src});   // ขึ้นคลาวด์
          }).catch(function(e){ planLog("เรนเดอร์ไม่สำเร็จ: "+(e&&e.message||e),true); setPlanStatus("เรนเดอร์ PDF ไม่สำเร็จ ("+(e&&e.message||"")+") — ลองแปลง PDF เป็นรูป (JPG/PNG) แล้วนำเข้าแทน","error"); });
        }).catch(function(e){ planLog("getPage ล้มเหลว: "+(e&&e.message||e),true); setPlanStatus("อ่านหน้า PDF ไม่ได้ ("+(e&&e.message||"")+")","error"); });
      }).catch(function(e){ planLog("getDocument ล้มเหลว: "+(e&&e.message||e),true); setPlanStatus("เปิดไฟล์ PDF ไม่ได้ ("+(e&&e.message||"")+") — ไฟล์อาจเสียหรือมีรหัสผ่าน","error"); });
    };
    reader.readAsArrayBuffer(file);
  }).catch(function(err){
    planLog("โหลด pdf.js ไม่ได้: "+(err&&err.message||err),true);
    setPlanStatus("โหลดตัวอ่าน PDF ไม่ได้ — ตรวจว่ามีโฟลเดอร์ vendor/ อยู่ข้างไฟล์ หรือแปลง PDF เป็นรูปแล้วนำเข้า","error");
  });
}


/* ---------------------------------------------------------------------------
   10) ธีม + เริ่มระบบ
   ------------------------------------------------------------------------ */
/* ไอคอนในส่วนหัว (สร้างด้วย JS เพราะบางตัวต้องสลับตามธีม) */
function hdSvg(inner){
  return '<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" '
       + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+inner+'</svg>';
}
var HD={
  back:'<path d="M15 18l-6-6 6-6"/>',
  data:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  logo:'<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M8 4v16M12 4v16M16 4v16"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  minus:'<path d="M5 12h14"/>',
  fit:'<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>'
};
/** อัปเดตไอคอนปุ่มธีม (พระจันทร์ตอนสว่าง / พระอาทิตย์ตอนมืด) */
function updateThemeIcon(){
  var dark=document.documentElement.getAttribute("data-theme")==="dark";
  var b=$("#btnTheme"); if(b) b.innerHTML=hdSvg(dark?HD.sun:HD.moon);
}
function initTheme(){
  var saved=null;
  try{ saved=localStorage.getItem("rebarcheck.theme"); }catch(e){}
  if(!saved) saved=(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light";
  document.documentElement.setAttribute("data-theme",saved);
}
function toggleTheme(){
  var cur=document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark";
  document.documentElement.setAttribute("data-theme",cur);
  try{ localStorage.setItem("rebarcheck.theme",cur); }catch(e){}
  updateThemeIcon();
}

/** v45: ทุกชิ้นส่วนวาดเป็น "กรอบ" — แปลงรูปเก่า (จุด/เส้น) ให้เป็นกรอบสี่เหลี่ยม
    เพื่อให้ไฮไลท์/มีจุดจับ/ปรับสไตล์ได้เหมือนคาน (ของเดิมที่วาดเป็นจุดจะเลือกแล้วไม่มีจุดจับ) */
function normalizePlanShapes(){
  var changed=false;
  (DB.members||[]).forEach(function(m){
    var pl=m.plan; if(!pl) return;
    var keep={ fill:(pl.fill||"#f59e0b"), fillA:(pl.fillA!=null?pl.fillA:0.28), strokeW:(pl.strokeW!=null?pl.strokeW:10),
      labelDx:pl.labelDx||0, labelDy:pl.labelDy||0, labelScale:pl.labelScale||1, labelText:pl.labelText||"", rot:pl.rot||0 };
    if(pl.kind==="point"){
      var nx=(pl.x!=null?pl.x:0.5), ny=(pl.y!=null?pl.y:0.5), hw=0.035, hh=0.045;
      m.plan=Object.assign({kind:"rect", x1:Math.max(0,nx-hw), y1:Math.max(0,ny-hh), x2:Math.min(1,nx+hw), y2:Math.min(1,ny+hh)}, keep);
      changed=true;
    }else if(pl.kind==="line"){
      var x1=Math.min(pl.x1,pl.x2), x2=Math.max(pl.x1,pl.x2), y1=Math.min(pl.y1,pl.y2), y2=Math.max(pl.y1,pl.y2);
      if(x2-x1<0.02){ x1-=0.02; x2+=0.02; } if(y2-y1<0.02){ y1-=0.02; y2+=0.02; }
      m.plan=Object.assign({kind:"rect", x1:Math.max(0,x1), y1:Math.max(0,y1), x2:Math.min(1,x2), y2:Math.min(1,y2)}, keep);
      changed=true;
    }
  });
  if(changed) saveDB();
}
/** แปลงแปลนเดี่ยว (f.plan / f.plans เก่า) → รายการแปลน f.planList + activePlanId (รองรับหลายแปลน) */
function normalizeFloorPlans(){
  var changed=false;
  (DB.floors||[]).forEach(function(f){
    if(f.planList && f.planList.length){ if(!f.activePlanId) f.activePlanId=f.planList[0].id; return; }
    var arr=[];
    if(f.plan){ arr.push(Object.assign({id:"_main",name:"แปลน 1"}, f.plan)); }
    else if(f.plans){ var i=1; for(var k in f.plans){ if(f.plans[k]){ arr.push(Object.assign({id:(i===1?"_main":"pl"+i),name:"แปลน "+i}, f.plans[k])); i++; } } }
    if(arr.length){ f.planList=arr; f.activePlanId="_main"; delete f.plan; delete f.plans; changed=true; }
  });
  if(changed) saveDB();
}
/* ===========================================================================
   คลาวด์ (Firebase): login + ฐานข้อมูลกลาง (Firestore) — เลเยอร์เสริมบน localStorage
   ทุกคอลเลกชันเก็บเป็น {id, data:JSON} เพื่อเลี่ยงข้อจำกัดชนิดข้อมูลของ Firestore
   ------------------------------------------------------------------------ */
var CLOUD = !!(window.fbAuth && window.fbDb);
var _fbUser=null, _fbLoaded=false, _syncT=null, _fbUnsub=[];
var _syncBase={projects:{},floors:{},members:{},inspections:{}};
var CLOUD_COLLS=["projects","floors","members","inspections"];

function _isEditing(){ var a=document.activeElement; return !!(a && (a.tagName==="INPUT"||a.tagName==="TEXTAREA"||a.isContentEditable)); }

function cloudBoot(){
  renderLoading();
  fbAuth.onAuthStateChanged(function(user){
    _fbUser=user;
    if(user){ startCloudSession(user); }
    else { teardownCloud(); renderLogin(); }
  });
}
function teardownCloud(){ _fbUnsub.forEach(function(u){ try{u();}catch(e){} }); _fbUnsub=[]; _fbLoaded=false;
  _syncBase={projects:{},floors:{},members:{},inspections:{}}; }

function startCloudSession(user){
  renderLoading();
  var got={};
  CLOUD_COLLS.forEach(function(c){
    var un=fbDb.collection(c).onSnapshot(function(snap){
      DB[c]=snap.docs.map(function(d){ try{ return JSON.parse(d.data().data); }catch(e){ return null; } }).filter(Boolean);
      _syncBase[c]={}; snap.docs.forEach(function(d){ _syncBase[c][d.id]=d.data().data; });
      got[c]=true;
      if(!_fbLoaded){
        if(CLOUD_COLLS.every(function(x){return got[x];})){
          _fbLoaded=true;
          DB.inspector = user.email||"";
          try{ normalizePlanShapes(); normalizeFloorPlans(); }catch(e){}
          document.body.classList.remove("auth-mode");
          if(!state.screen || state.screen==="login" || state.screen==="loading") state.screen="home";
          render();
          setTimeout(offerLocalMigration, 400);   // เสนออัปข้อมูลเดิมในเครื่อง (ถ้ามี)
        }
      }else{
        // มีการเปลี่ยนจากที่อื่น → รีเฟรชจอ (เลี่ยงตอนกำลังพิมพ์)
        if(!(snap.metadata&&snap.metadata.hasPendingWrites) && !_isEditing()) render();
      }
    }, function(err){ console.warn("Firestore listen error ["+c+"]", err); toast("เชื่อมต่อฐานข้อมูลมีปัญหา: "+(err&&err.code||err),true); });
    _fbUnsub.push(un);
  });
}

/** ซิงค์ข้อมูลขึ้น Firestore แบบเทียบส่วนต่าง (เขียนเฉพาะที่เปลี่ยน/ลบที่หายไป) */
function scheduleCloudSync(){ clearTimeout(_syncT); _syncT=setTimeout(cloudSyncNow, 450); }
function cloudSyncNow(){ CLOUD_COLLS.forEach(function(c){ _syncCollection(c, DB[c]||[]); }); }
/** เตรียม item ก่อนขึ้นคลาวด์ — floor: ตัดพรีวิว/ไบต์แปลนออก (เก็บแยกใน planfiles) ให้ doc เล็ก */
function _forCloud(coll, it){
  if(coll==="floors" && it && it.planList){
    var c; try{ c=JSON.parse(JSON.stringify(it)); }catch(e){ return it; }
    (c.planList||[]).forEach(function(p){ if(p){ delete p.src; delete p.bytes; } });
    return c;
  }
  return it;
}
function _syncCollection(coll, items){
  if(!CLOUD || !_fbUser) return;
  var base=_syncBase[coll]||{}, next={}, batch=fbDb.batch(), writes=0;
  items.forEach(function(it){
    if(!it || !it.id) return;
    var json; try{ json=JSON.stringify(_forCloud(coll,it)); }catch(e){ return; }
    if(json.length>950000){ console.warn("ข้าม (ใหญ่เกิน 1MB): "+coll+"/"+it.id); return; }   // กัน doc เกินลิมิต
    next[it.id]=json;
    if(base[it.id]!==json){ batch.set(fbDb.collection(coll).doc(it.id), {id:it.id, data:json}); writes++; }
  });
  Object.keys(base).forEach(function(id){ if(!(id in next)){ batch.delete(fbDb.collection(coll).doc(id)); writes++; } });
  _syncBase[coll]=next;
  if(writes){ batch.commit().catch(function(e){ console.warn("sync "+coll+" fail",e); toast("ซิงค์ข้อมูลไม่สำเร็จ: "+(e&&e.code||e),true); }); }
}

/* ---- หน้า login / โหลด ---- */
function renderLoading(){
  document.body.classList.add("auth-mode");
  $("#app").innerHTML='<div class="auth-wrap"><div class="auth-card"><div class="auth-logo">'+hdSvg(HD.logo)+'</div>'
    +'<div class="auth-spin"></div><div class="auth-sub">กำลังโหลด…</div></div></div>';
  renderTabbar();
}
function renderLogin(){
  document.body.classList.add("auth-mode");
  var lastEmail=""; try{ lastEmail=localStorage.getItem("rc_lastEmail")||""; }catch(e){}
  // ใช้ <form> จริง + autocomplete → เบราว์เซอร์เด้งถามเซฟรหัส และเติมอีเมล/รหัสให้อัตโนมัติครั้งต่อไป
  $("#app").innerHTML='<div class="auth-wrap"><form class="auth-card" id="authForm" autocomplete="on">'
    +'<div class="auth-logo">'+hdSvg(HD.logo)+'</div>'
    +'<div class="auth-title">Rebar<b>Check</b></div>'
    +'<div class="auth-sub">เข้าสู่ระบบเพื่อใช้งาน</div>'
    +'<label class="auth-f"><span>อีเมล</span><input type="email" id="authEmail" name="email" autocomplete="username" value="'+esc(lastEmail)+'" placeholder="you@email.com"></label>'
    +'<label class="auth-f"><span>รหัสผ่าน</span><input type="password" id="authPass" name="password" autocomplete="current-password" placeholder="รหัสผ่าน"></label>'
    +'<div class="auth-err" id="authErr"></div>'
    +'<button type="submit" class="btn auth-btn">เข้าสู่ระบบ</button>'
    +'<div class="auth-note">บัญชีสร้างโดยผู้ดูแลระบบ · ยังไม่มีบัญชี? ติดต่อผู้ดูแล</div>'
    +'</form></div>';
  var frm=$("#authForm");
  if(frm) frm.addEventListener("submit",function(e){ e.preventDefault(); doAuth(false); });
  renderTabbar();
  setTimeout(function(){ var e=$(lastEmail?"#authPass":"#authEmail"); if(e) e.focus(); },60);
}
function _authErr(msg){ var e=$("#authErr"); if(e) e.textContent=msg; }
function _authMsg(code){
  var m={ "auth/invalid-email":"อีเมลไม่ถูกต้อง","auth/missing-password":"กรอกรหัสผ่าน",
    "auth/user-not-found":"อีเมลหรือรหัสผ่านไม่ถูกต้อง","auth/wrong-password":"อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    "auth/invalid-credential":"อีเมลหรือรหัสผ่านไม่ถูกต้อง","auth/email-already-in-use":"อีเมลนี้มีบัญชีแล้ว",
    "auth/weak-password":"รหัสผ่านสั้นไป (อย่างน้อย 6 ตัว)","auth/too-many-requests":"ลองบ่อยเกินไป รอสักครู่",
    "auth/network-request-failed":"เชื่อมต่อเน็ตไม่ได้" };
  return m[code]||("ผิดพลาด: "+code);
}
function doAuth(signup){
  var em=($("#authEmail")||{}).value, pw=($("#authPass")||{}).value;
  em=(em||"").trim();
  if(!em){ _authErr("กรอกอีเมล"); return; }
  if(!pw || pw.length<6){ _authErr("รหัสผ่านอย่างน้อย 6 ตัว"); return; }
  _authErr("");
  var fn=signup ? fbAuth.createUserWithEmailAndPassword(em,pw) : fbAuth.signInWithEmailAndPassword(em,pw);
  fn.then(function(){ try{ localStorage.setItem("rc_lastEmail", em); }catch(e){} })   // จำอีเมลไว้เติมครั้งหน้า
    .catch(function(e){ _authErr(_authMsg(e&&e.code)); });
  // สำเร็จ → onAuthStateChanged จะพาเข้าแอปเอง
}

/* ---- คลาวด์: ไฟล์แปลน เก็บใน Firestore แบบหั่นชิ้น (ไม่ต้องใช้ Storage/บัตร) ---- */
var PLAN_PREVIEW={};   // key -> dataURL พรีวิว (แคชรันไทม์ เพื่อโชว์เร็วก่อนโหลดต้นฉบับ)
function _pfKey(key){ return String(key).replace(/[\/#?%]/g,"_"); }
function _bytesToB64(u8){ var CH=0x8000,s=""; for(var i=0;i<u8.length;i+=CH){ s+=String.fromCharCode.apply(null,u8.subarray(i,i+CH)); } return btoa(s); }
function _b64ToBytes(b64){ var bin=atob(b64),u=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); return u; }

/** อัปไฟล์แปลนขึ้นคลาวด์ (หั่นชิ้น ~500KB/ชิ้น) — เรียกหลังบันทึกลงเครื่องแล้ว */
function cloudUploadPlan(key, buf, meta){
  if(!CLOUD || !_fbUser) return Promise.resolve();
  meta=meta||{};
  var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  var CH=500000, n=Math.max(1, Math.ceil(u8.length/CH));
  var pf=fbDb.collection("planfiles").doc(_pfKey(key));
  if(meta.preview) PLAN_PREVIEW[key]=meta.preview;
  var chain=Promise.resolve();
  for(var i=0;i<n;i++){ (function(idx){
    chain=chain.then(function(){
      try{ setPlanBusy("กำลังอัปแปลนขึ้นคลาวด์… "+(idx+1)+"/"+n); }catch(e){}
      return pf.collection("c").doc(String(idx)).set({ i:idx, b:_bytesToB64(u8.subarray(idx*CH,(idx+1)*CH)) });
    });
  })(i); }
  return chain.then(function(){
    return pf.set({ kind:meta.kind||"img", pageNo:meta.pageNo||1, w:meta.w||0, h:meta.h||0,
      natW:meta.natW||0, natH:meta.natH||0, chunks:n, size:u8.length,
      preview:(meta.preview && meta.preview.length<900000)?meta.preview:"",
      at:Date.now(), by:(_fbUser.email||"") });
  }).then(function(){ try{ setPlanBusy(null); planLog("อัปแปลนขึ้นคลาวด์แล้ว ("+n+" ชิ้น)"); }catch(e){} })
    .catch(function(e){ try{ setPlanBusy(null); }catch(x){} console.warn("cloudUploadPlan",e); toast("อัปแปลนขึ้นคลาวด์ไม่สำเร็จ: "+(e&&e.code||e),true); });
}
/** ดึงไฟล์แปลนจากคลาวด์ → คืน rec {kind,bytes,pageNo} (ตั้งพรีวิวให้ด้วย) */
function cloudFetchPlan(key){
  if(!CLOUD) return Promise.resolve(null);
  var pf=fbDb.collection("planfiles").doc(_pfKey(key));
  return pf.get().then(function(meta){
    if(!meta.exists) return null;
    var md=meta.data(); if(md.preview){ PLAN_PREVIEW[key]=md.preview; _paintPreview(key); }
    var n=md.chunks||0; if(!n) return null;
    var seq=Promise.resolve([]);
    for(var i=0;i<n;i++){ (function(idx){
      seq=seq.then(function(arr){ return pf.collection("c").doc(String(idx)).get().then(function(c){
        if(!c.exists) throw new Error("ชิ้นแปลนหาย "+idx); arr.push(_b64ToBytes(c.data().b)); return arr; }); });
    })(i); }
    return seq.then(function(parts){
      var total=parts.reduce(function(a,p){return a+p.length;},0), out=new Uint8Array(total), off=0;
      parts.forEach(function(p){ out.set(p,off); off+=p.length; });
      return { kind:md.kind, bytes:out.buffer, pageNo:md.pageNo||1 };
    });
  }).catch(function(e){ console.warn("cloudFetchPlan",e); return null; });
}
function _paintPreview(key){ if(planSourceKey()!==key) return; var img=$(".plan-img"); if(img && !img.getAttribute("src") && PLAN_PREVIEW[key]) img.src=PLAN_PREVIEW[key]; }
function cloudDeletePlan(key){
  if(!CLOUD || !_fbUser) return;
  var pf=fbDb.collection("planfiles").doc(_pfKey(key));
  pf.collection("c").get().then(function(snap){ snap.forEach(function(d){ d.ref.delete(); }); }).catch(function(){});
  pf.delete().catch(function(){});
  delete PLAN_PREVIEW[key];
}
/** ครั้งแรกที่ล็อกอินแล้วคลาวด์ยังว่าง แต่มีข้อมูลเดิมในเครื่อง → เสนออัปขึ้นคลาวด์ (รวมไฟล์แปลน) */
function offerLocalMigration(){
  if((DB.projects||[]).length>0) return;                 // คลาวด์มีข้อมูลแล้ว
  var raw; try{ raw=localStorage.getItem(STORE_KEY); }catch(e){ return; }
  if(!raw) return; var local; try{ local=JSON.parse(raw); }catch(e){ return; }
  if(!local || !Array.isArray(local.projects) || !local.projects.length) return;
  if(!confirm("พบข้อมูลเดิมในเครื่องนี้ ("+local.projects.length+" โครงการ)\nอัปขึ้นคลาวด์ให้ทุกคนเห็นไหม? (รวมไฟล์แปลน)")) return;
  migrateLocalToCloud(local);
}
function migrateLocalToCloud(local){
  toast("กำลังอัปข้อมูลขึ้นคลาวด์…");
  DB.projects=local.projects||[]; DB.floors=local.floors||[]; DB.members=local.members||[]; DB.inspections=local.inspections||[];
  try{ normalizePlanShapes(); normalizeFloorPlans(); }catch(e){}
  cloudSyncNow();   // ดันข้อมูลหลักขึ้นก่อน
  render();
  var jobs=[];      // รวบรวมไฟล์แปลนทุกแผ่นที่มีต้นฉบับในเครื่อง
  (DB.floors||[]).forEach(function(f){ (f.planList||[]).forEach(function(p){
    jobs.push({ key:(p.id && p.id!=="_main")?f.id+":"+p.id:f.id, p:p }); }); });
  var idx=0;
  (function nextJob(){
    if(idx>=jobs.length){ toast("อัปข้อมูล+แปลนขึ้นคลาวด์เรียบร้อย ✓"); return; }
    var j=jobs[idx++];
    idbGet(j.key).then(function(rec){
      if(rec && rec.bytes) return cloudUploadPlan(j.key, rec.bytes, {kind:rec.kind, pageNo:rec.pageNo, w:j.p.w, h:j.p.h, preview:j.p.src});
    }).then(nextJob, nextJob);
  })();
}

function init(){
  try{ console.log("%c[RebarCheck] เวอร์ชัน 139 โหลดแล้ว — ย้าย สไตล์กรอบ เข้าไปในริบบอนแท็บ วาด","color:#3a5bd0;font-weight:700"); }catch(e){}
  initTheme();
  if(!CLOUD){
    loadDB();
    normalizePlanShapes();   // แปลงจุด/เส้นเก่า → กรอบ (ครั้งเดียว)
    normalizeFloorPlans();   // แปลงแปลนเดี่ยว → รายการแปลน (ครั้งเดียว)
  }

  // ตั้งไอคอนส่วนหัว
  $("#btnBack").innerHTML=hdSvg(HD.back);
  $("#btnData").innerHTML=hdSvg(HD.data);
  $("#brandMark").innerHTML=hdSvg(HD.logo);
  updateThemeIcon();

  $("#btnBack").addEventListener("click",back);
  $("#btnTheme").addEventListener("click",toggleTheme);
  $("#btnData").addEventListener("click",function(){ navigate("data"); });
  $("#lbClose").addEventListener("click",function(){ $("#lightbox").classList.remove("open"); });
  $("#lightbox").addEventListener("click",function(e){
    if(e.target.id==="lightbox") $("#lightbox").classList.remove("open");
  });
  $("#overlay").addEventListener("click",function(e){ if(e.target.id==="overlay") closeSheet(); });
  var _rzT; window.addEventListener("resize",function(){ clearTimeout(_rzT); _rzT=setTimeout(function(){ try{ renderTabbar(); }catch(e){} },150); });
  document.addEventListener("keydown",function(e){
    if(e.key==="Escape"){ $("#lightbox").classList.remove("open"); closeSheet(); }
    // (หน้า login ใช้ <form> จริงแล้ว → Enter จะ submit เอง ไม่ต้องดักที่นี่)
    // Ctrl/Cmd+S = บันทึกฟอร์มชิ้นส่วน
    if((e.ctrlKey||e.metaKey) && (e.key==="s"||e.key==="S") && state.screen==="memberForm"){
      e.preventDefault(); saveMemberForm(false);
    }
  });

  if(CLOUD){ cloudBoot(); } else { render(); }
}

init();
