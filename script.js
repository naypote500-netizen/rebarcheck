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
var DB = { projects:[], floors:[], members:[], inspections:[], types:[], zones:[], annots:[], headMarks:[], ctypes:[], inspector:"" };

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
        types:       Array.isArray(p.types)       ? p.types       : [],   // ประเภทชิ้นส่วน (แผ่นรายละเอียดใช้ร่วมกัน)
        zones:       Array.isArray(p.zones)       ? p.zones       : [],   // โซนเท
        annots:      Array.isArray(p.annots)      ? p.annots      : [],   // หมายเหตุ/เส้นบอกขนาด/พื้นที่บนแปลน
        headMarks:   Array.isArray(p.headMarks)   ? p.headMarks   : [],   // ตารางมาร์คหัวเสา
        ctypes:      Array.isArray(p.ctypes)      ? p.ctypes      : [],   // ชนิดชิ้นส่วนกำหนดเอง (ซิงก์ข้ามเครื่อง)
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
function getZone(id){    return (DB.zones||[]).filter(function(z){ return z.id===id; })[0] || null; }
function zonesOfFloor(fid){ return (DB.zones||[]).filter(function(z){ return z.floorId===fid; }); }
/* ---- ประเภทชิ้นส่วน (Type) — "แผ่นรายละเอียด" ที่หลายชิ้นใช้ร่วมกัน: แก้ที่ชิ้นไหนก็เปลี่ยนทุกชิ้น
       { id, projectId, mtype:"beam"|..., name, color, doc:{els:[]}, createdAt }  · ชิ้นส่วนผูกด้วย m.typeId ---- */
var TYPE_COLORS=["#2563eb","#7c3aed","#0891b2","#ea580c","#db2777","#16a34a","#ca8a04","#dc2626","#0f766e","#4f46e5","#9333ea","#b45309"];
function getType(id){ return (DB.types||[]).filter(function(t){ return t.id===id; })[0] || null; }
function typesOf(pid, mtype){ return (DB.types||[]).filter(function(t){ return t.projectId===pid && (!mtype || t.mtype===mtype); })
  .sort(function(a,b){ return String(a.name).localeCompare(String(b.name),"th"); }); }
function typeMembers(tid){ return DB.members.filter(function(m){ return m.typeId===tid; }); }
function memberTypeOf(m){ return (m && m.typeId) ? getType(m.typeId) : null; }
/** สีถัดไปที่ยังไม่ซ้ำกับประเภทอื่นในโครงการ */
function typeColorNext(pid){
  var used={}; typesOf(pid).forEach(function(t){ used[(t.color||"").toLowerCase()]=1; });
  for(var i=0;i<TYPE_COLORS.length;i++) if(!used[TYPE_COLORS[i]]) return TYPE_COLORS[i];
  return TYPE_COLORS[typesOf(pid).length % TYPE_COLORS.length];
}
function typeDoc(t){ if(!t.doc || !Array.isArray(t.doc.els)) t.doc={els:[]}; return t.doc; }
/** สร้างประเภทใหม่จากชิ้นส่วน — ย้ายแผ่นรายละเอียดของชิ้นนั้นไปเป็นของประเภท แล้วผูกชิ้นเข้ากับประเภท */
function typeCreateFrom(m, name){
  var t={ id:uid("t"), projectId:m.projectId, mtype:m.type, name:name, color:typeColorNext(m.projectId), doc:{els:[]}, createdAt:Date.now() };
  if(m.doc && Array.isArray(m.doc.els) && m.doc.els.length){ t.doc=m.doc; m.doc={els:[]}; }   // ย้าย (สื่อผูกกับ id ของ element อยู่แล้ว ไม่ต้องก็อป)
  if(!DB.types) DB.types=[];
  DB.types.push(t); m.typeId=t.id;
  return t;
}
/** คัดลอก element ของแผ่นรายละเอียด (id ใหม่ + ก็อปรูป/PDF ใน IndexedDB และคลาวด์) — ใช้ตอน "แยกออก" ให้ชิ้นได้สำเนาของตัวเอง */
function deCloneEls(els){
  return (els||[]).map(function(e){
    var c=JSON.parse(JSON.stringify(e)); var oldId=c.id; c.id=deUid();
    if(c.type==="image"){
      idbGet("deimg_"+oldId).then(function(url){ if(!url) return; idbPut("deimg_"+c.id,url).catch(function(){}); DE_IMG[c.id]=url; deCloudSaveImg(c.id,url); }).catch(function(){});
    }else if(c.type==="pdf"){
      idbGet("depdf_"+oldId).then(function(v){ if(!v||!v.bytes) return; idbPut("depdf_"+c.id,v).catch(function(){}); deCloudSavePdf(c.id,v.bytes,v.pageNo||c.pageNo||1); }).catch(function(){});
    }
    return c;
  });
}
/** ถอดชิ้นออกจากประเภท — copy=true: เอาสำเนาแผ่นรายละเอียดของประเภทติดไปด้วย */
function typeDetach(m, copy){
  var t=memberTypeOf(m); if(!t) return;
  if(copy) m.doc={els:deCloneEls(typeDoc(t).els)};
  m.typeId=null;
}
/** ลบประเภท — ชิ้นที่ผูกอยู่กลับไปใช้แผ่นของตัวเอง · ลบสื่อของแผ่นประเภททิ้ง */
function typeDelete(t){
  typeMembers(t.id).forEach(function(m){ m.typeId=null; });
  typeDoc(t).els.forEach(function(e){
    idbDel("deimg_"+e.id).catch(function(){}); idbDel("depdf_"+e.id).catch(function(){});
    try{ cloudDeletePlan("de_img_"+e.id); cloudDeletePlan("de_pdf_"+e.id); }catch(x){}
    delete DE_IMG[e.id]; delete DE_PDF[e.id];
  });
  DB.types=(DB.types||[]).filter(function(x){ return x.id!==t.id; });
}
function zonesOfPlan(fid, planId){ return (DB.zones||[]).filter(function(z){ return z.floorId===fid && z.planId===planId; }); }
/* ---- หมายเหตุบนแปลน: กล่องข้อความมีลูกศรชี้ (callout) + เส้นบอกขนาด (dim) ---- */
function getAnnot(id){ return (DB.annots||[]).filter(function(a){ return a.id===id; })[0] || null; }
function annotsOfPlan(fid, planId){ return (DB.annots||[]).filter(function(a){ return a.floorId===fid && a.planId===planId; }); }
/** มาตราส่วนของแปลน (หน่วยจริงต่อ 1 พิกเซลของรูป) — เดาจากเส้นบอกขนาดเส้นแรกที่ใส่ตัวเลขไว้ */
function planUnitScale(fid, planId, plan){
  var pw=(plan&&plan.w)||1000, ph=(plan&&plan.h)||700;
  if(plan && plan.scale && plan.scale.px>0 && plan.scale.m>0) return plan.scale.m/plan.scale.px;   // ตั้งเองจาก 2 จุด (แม่นกว่า)
  var ds=annotsOfPlan(fid,planId).filter(function(a){ return a.kind==="dim" && parseFloat(a.label)>0; });
  for(var i=0;i<ds.length;i++){
    var a=ds[i], L=Math.hypot((a.p2.x-a.p1.x)*pw,(a.p2.y-a.p1.y)*ph);
    if(L>2) return parseFloat(a.label)/L;
  }
  return 0;
}
/** แปลนตาม id (ของชั้นใดก็ได้) */
function planById(fid,pid){ var f=getFloor(fid); return floorPlans(f).filter(function(p){ return p.id===(pid||"_main"); })[0]||null; }
/** ข้อมูลมาตราส่วนของแปลนที่เปิดอยู่: us = เมตรต่อ 1 พิกเซลรูป · src = "set" (ตั้งเอง) | "dim" (เดาจากเส้นบอกขนาด) | null */
function planScaleInfo(){
  var f=getFloor(state.floorId), plan=f?getFloorPlan(f):null;
  if(!plan) return {us:0,src:null,plan:null};
  var us=planUnitScale(f.id,curPlanId(),plan);
  var src=(plan.scale&&plan.scale.px>0&&plan.scale.m>0)?"set":(us>0?"dim":null);
  return {us:us, src:src, plan:plan};
}
function fmtScale(us){ if(!(us>0)) return "ยังไม่ตั้งสเกล"; var mm=us*1000; return "1 px = "+(mm>=10?mm.toFixed(1):mm.toFixed(2))+" มม."; }
function fmtNum(n,d){ d=d==null?2:d; return (Math.round(n*Math.pow(10,d))/Math.pow(10,d)).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}); }
/** พื้นที่ (px²) และเส้นรอบรูป (px) ของรูปหลายเหลี่ยม พิกัด 0..1 บนรูป pw×ph */
function polyPx(pts,pw,ph){
  var A=0,P=0,n=(pts||[]).length; if(n<3) return {a:0,p:0};
  for(var i=0;i<n;i++){ var p=pts[i], q=pts[(i+1)%n], x1=p.x*pw,y1=p.y*ph,x2=q.x*pw,y2=q.y*ph; A+=x1*y2-x2*y1; P+=Math.hypot(x2-x1,y2-y1); }
  return {a:Math.abs(A)/2, p:P};
}
function polyCenter(pts){ var n=(pts||[]).length||1, sx=0, sy=0; (pts||[]).forEach(function(p){ sx+=p.x; sy+=p.y; }); return {x:sx/n,y:sy/n}; }
/** ระยะจริงของเส้นบอกขนาด (เมตร, 3 ตำแหน่ง) คำนวณจากมาตราส่วนของแปลน — null ถ้ายังไม่มีสเกล */
function dimAutoLabel(a){
  var plan=planById(a.floorId,a.planId), us=planUnitScale(a.floorId,a.planId,plan);
  if(!(us>0)||!a.p1||!a.p2) return null;
  var pw=(plan&&plan.w)||1000, ph=(plan&&plan.h)||700;
  return (Math.hypot((a.p2.x-a.p1.x)*pw,(a.p2.y-a.p1.y)*ph)*us).toFixed(3);
}
/** เส้นบอกขนาดแบบอัตโนมัติ: อัปเดต label ให้ตรงกับรูป/สเกลปัจจุบัน แล้วคืน label */
function dimLabel(a){
  if(a.auto){ var al=dimAutoLabel(a); if(al!=null){ a.label=al; return al; } }
  return a.label||"";
}
function areasOfPlan(fid,pid){ return annotsOfPlan(fid,pid).filter(function(a){ return a.kind==="area"; }); }
/** ตัวเลขของพื้นที่ที่วัด (หน่วยเมตร) — null ถ้าแปลนยังไม่มีมาตราส่วน */
function areaMetrics(a, plan){
  plan=plan||planById(a.floorId,a.planId);
  var pw=(plan&&plan.w)||1000, ph=(plan&&plan.h)||700, us=planUnitScale(a.floorId,a.planId,plan);
  if(!(us>0)) return null;
  var o=polyPx(a.pts,pw,ph), hs=0;
  (a.holes||[]).forEach(function(h){ hs+=polyPx(h,pw,ph).a; });
  var xs=(a.pts||[]).map(function(p){return p.x*pw;}), ys=(a.pts||[]).map(function(p){return p.y*ph;});
  var bw=xs.length?Math.max.apply(null,xs)-Math.min.apply(null,xs):0, bh=ys.length?Math.max.apply(null,ys)-Math.min.apply(null,ys):0;
  var gross=o.a*us*us, hole=Math.min(gross,hs*us*us), net=gross-hole, th=(a.thick>0?+a.thick:0);
  return {gross:gross, hole:hole, net:net, perim:o.p*us, w:bw*us, h:bh*us, thick:th, vol:net*th};
}
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

  return { projects:[p], floors:[f0,f1,f2,f3], members:ms, inspections:[], types:[], inspector:"" };
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
  var n=String(text).length, cls="chip"+(n>=5?" len5":n===4?" len4":"");   // escape เสมอ (ห้ามเดาว่าเป็น SVG จากเนื้อหา — กัน XSS จากเบอร์ที่ผู้ใช้ตั้ง)
  var ct=String(cssType||"beam").replace(/[^A-Za-z0-9_-]/g,"");
  return '<div class="'+cls+'" style="background:var(--t-'+ct+'-bg);color:var(--t-'+ct+')">'+esc(text)+"</div>";
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
function flPct(s){ return s.total ? Math.floor((s.total-s.todo)/s.total*100) : 0; }
function flBadge(f){
  if(f.level!==""&&f.level!=null) return String(f.level);
  var n=(f.name||"").trim(); if(!n) return "—";
  var w=n.split(/\s+/);
  return (w.length>=2 ? (w[0][0]+w[1][0]) : n.slice(0,2)).toUpperCase();
}
/** ตรวจล่าสุดของชั้น (จากบันทึกการตรวจทุกชิ้นในชั้น) */
function floorLastInspection(fid){
  var ids={}; membersOfFloor(fid).forEach(function(m){ ids[m.id]=1; });
  var found=null;
  (DB.inspections||[]).forEach(function(r){ if((r.floorId===fid || ids[r.memberId]) && (!found || r.ts>found.ts)) found=r; });
  return found;
}
/** เมนูคลิกขวาของชิ้นส่วนบนแปลน (คอม) — ปุ่มใช้ data-act เดิม ผ่าน dispatcher ปกติ */
function closeCtxMenu(){ var m=document.getElementById("planCtx"); if(m&&m.parentNode) m.parentNode.removeChild(m); }
function planCtxMenu(m, x, y){
  closeCtxMenu();
  var it=function(act,attr,ic,label,cls){ return '<button class="rv-mi'+(cls?' '+cls:'')+'" data-act="'+act+'" '+(attr||'')+'>'+rvIc(ic,14)+'<span>'+esc(label)+'</span></button>'; };
  var t=memberTypeOf(m);
  var h='<div class="rv-mh mono">'+esc(m.code)+' · '+esc(TYPES[m.type].label)+'</div>'
    +it("goInspect",'','check','ตรวจเหล็ก')
    +it("showDetails",'','img','รายละเอียด')
    +it("editMember",'','edit','แก้สเปก')
    +it("typeAssignSheet",'','link',t?'เปลี่ยนประเภท ('+t.name+')':'กำหนดประเภท')
    +'<div class="rv-msep"></div>'
    +it("toggleHide",'data-id="'+esc(m.id)+'"',m.hidden?'eyeOff':'eye',m.hidden?'แสดงบนแปลน':'ซ่อนบนแปลน')
    +it("dupMember",'data-id="'+esc(m.id)+'"','copy','ทำซ้ำ')
    +it("zoomToSel",'','fit','ซูมไปหา')
    +'<div class="rv-msep"></div>'
    +it("delMember",'','trash','ลบชิ้นนี้','danger');
  var d=document.createElement("div"); d.id="planCtx"; d.className="rv-fmenu rv-ctx"; d.innerHTML=h;
  document.body.appendChild(d);
  var W=d.offsetWidth||220, H=d.offsetHeight||300;
  d.style.left=Math.max(4, Math.min(window.innerWidth-W-4, x))+"px";
  d.style.top=Math.max(4, Math.min(window.innerHeight-H-4, y))+"px";
  var off=function(){ document.removeEventListener("click",onClick,true); document.removeEventListener("keydown",onKey,true); document.removeEventListener("contextmenu",onCtx,true); window.removeEventListener("wheel",onWheel,true); };
  var onClick=function(){ off(); setTimeout(closeCtxMenu,0); };           // ปุ่มในเมนูให้ dispatcher ทำงานก่อน แล้วค่อยปิด
  var onKey=function(e){ if(e.key==="Escape"){ off(); closeCtxMenu(); e.stopImmediatePropagation(); } };
  var onCtx=function(e){ if(!e.target.closest("#planCtx")){ off(); closeCtxMenu(); } };
  var onWheel=function(){ off(); closeCtxMenu(); };
  setTimeout(function(){ document.addEventListener("click",onClick,true); document.addEventListener("keydown",onKey,true); document.addEventListener("contextmenu",onCtx,true); window.addEventListener("wheel",onWheel,true); },0);
}
/** ตัวย่อชั้นจากชื่อ (2 ตัว) — ระดับแสดงในบรรทัดเล็กแทน */
function pjAb(f){ var nm=(f.name||"").trim(); if(!nm) return "—"; var num=nm.match(/\d+/); if(/[฀-๿]/.test(nm)) return num?num[0]:nm.charAt(0); var w=nm.split(/\s+/); return (w.length>=2 ? (w[0][0]+w[1][0]) : nm.slice(0,2)).toUpperCase(); }
function pjDate(ts){ try{ return new Date(ts).toLocaleDateString('th-TH',{year:'2-digit',month:'short',day:'numeric'}); }catch(e){ return ""; } }
function folderSvg(col,w){ w=w||44; var hh=Math.round(w*46/58);
  return '<svg viewBox="0 0 58 46" style="width:'+w+'px;height:'+hh+'px;display:block">'
    +'<path d="M3 9a3 3 0 0 1 3-3h13l4 5h29a3 3 0 0 1 3 3v25a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z" fill="'+col+'" fill-opacity=".22"/>'
    +'<path d="M3 15h52v22a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z" fill="'+col+'"/></svg>'; }
/** สีสถานะของชั้น/แปลน: ไม่ผ่าน=แดง · เสร็จ100%=เขียว · มีชิ้นส่วน=น้ำเงิน · ว่าง=เทา */
function flStatusCol(s){ return s.fail>0?'var(--fail)':((s.total&&(s.total-s.todo)===s.total)?'var(--pass)':(s.total?'var(--brand)':'var(--text-dim)')); }
/** แหล่งภาพ thumbnail ของแปลน (ถ้ามีในเครื่อง/แคช) ไม่งั้นคืน "" ให้โชว์ placeholder */
function planThumbSrc(f,pl){ if(!f||!pl) return ""; var key=(pl.id&&pl.id!=="_main")?f.id+":"+pl.id:f.id; return pl.src||PLAN_PREVIEW[key]||""; }

function viewFloors(){
  var p=getProject(state.projectId);
  if(!p) return emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',"ไม่พบโครงการ","");
  var fls=floorsOf(p.id), all=membersOfProject(p.id), s=summarize(all), pct=flPct(s);
  var R=27, C=Math.round(2*Math.PI*R), off=Math.round(C*(1-pct/100));
  var ringCol = s.fail>0 ? 'var(--fail)' : (pct===100&&s.total ? 'var(--pass)' : 'var(--brand)');
  var lastAll=null; (DB.inspections||[]).forEach(function(r){ if(r.projectId===p.id && (!lastAll||r.ts>lastAll.ts)) lastAll=r; });
  // ---- หัวโครงการ ----
  var h='<div class="pj-head">'
    +'<div class="pj-ring"><svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="'+R+'" fill="none" stroke="var(--surface-2)" stroke-width="7"/>'
    +'<circle cx="32" cy="32" r="'+R+'" fill="none" stroke="'+ringCol+'" stroke-width="7" stroke-linecap="round" stroke-dasharray="'+C+'" stroke-dashoffset="'+off+'" transform="rotate(-90 32 32)"/>'
    +'<text x="32" y="37" text-anchor="middle" fill="'+ringCol+'" font-size="15" font-weight="800">'+pct+'%</text></svg></div>'
    +'<div class="pj-ht"><h1 class="pj-title">'+esc(p.name)+'</h1>'
    +'<div class="pj-meta">'+(p.location?'<span>'+rvIc('home',13)+esc(p.location)+'</span>':'')
      +'<span>'+fls.length+' ชั้น · '+s.total+' ชิ้นส่วน</span>'
      +'<span>ตรวจแล้ว <b>'+(s.total-s.todo)+'</b> / '+s.total+'</span>'
      +(s.fail?'<span class="bad">ไม่ผ่านค้าง <b>'+s.fail+'</b></span>':'')
      +(lastAll?'<span>ล่าสุด '+esc(pjDate(lastAll.ts))+(lastAll.inspector?' · '+esc(lastAll.inspector):'')+'</span>':'')+'</div></div>'
    +'<div class="pj-acts">'
      +'<button class="btn soft" data-act="history" title="ผลตรวจทั้งหมดของโครงการ">'+rvIc('data',14)+' ประวัติทั้งโครงการ</button>'
      +'<button class="btn soft" data-act="editProject" data-id="'+esc(p.id)+'" title="เปลี่ยนชื่อ / สถานที่ / ลบโครงการ">'+rvIc('edit',14)+' แก้ไขโครงการ</button>'
      +'<button class="btn" data-act="newFloor">'+rvIc('plus',14)+' เพิ่มชั้น</button>'
    +'</div></div>';
  // ---- โฟลเดอร์รายชั้น ----
  h+='<div class="pj-sec">'+rvIc('folder',18)+'<span>โฟลเดอร์ชั้น</span><i class="pj-cnt">'+fls.length+'</i><span class="sp"></span><small>คลิกโฟลเดอร์ชั้นเพื่อดูแปลนข้างใน</small></div>';
  if(!fls.length){
    h+='<div class="pj-empty">'+rvIc('floor',22)+'<div><b>ยังไม่มีชั้น</b><small>กด “เพิ่มชั้น” แล้วนำเข้าแปลนของชั้นนั้น จากนั้นวาดคาน/เสา/พื้นบนแปลนได้เลย</small></div><button class="btn" data-act="newFloor">'+rvIc('plus',14)+' เพิ่มชั้น</button></div>';
    return h;
  }
  h+='<div class="pj-folders">';
  fls.forEach(function(f){
    var ms=membersOfFloor(f.id), fs2=summarize(ms), fp=flPct(fs2), lv=lvText(f.level), plans=floorPlans(f);
    var col=flStatusCol(fs2);
    h+='<div class="fld-card" data-act="openFloor" data-id="'+esc(f.id)+'" role="button" tabindex="0">'
      +'<button class="btn sm ic fld-more" data-act="editFloor" data-id="'+esc(f.id)+'" title="เปลี่ยนชื่อ / ระดับ / ลบชั้น">'+rvIc('more',15)+'</button>'
      +(lv?'<span class="fld-lv">'+esc(lv)+'</span>':'')
      +'<span class="fld-ic">'+folderSvg(col,52)+'</span>'
      +'<b class="fld-nm">'+esc(f.name)+'</b>'
      +'<span class="fld-cnt">'+rvIc('plan',13)+(plans.length?plans.length+' แปลน':'ยังไม่มีแปลน')+'</span>'
      +'<span class="fl-bar"><i style="width:'+Math.max(4,fp)+'%;background:'+col+'"></i></span>'
      +'<span class="fld-foot"><span>'+esc(pjAb(f))+'</span><b style="color:'+col+'">'+(ms.length?fp+'%':'—')+'</b></span>'
      +'</div>';
  });
  h+='<button class="fld-add" data-act="newFloor">'+rvIc('folder',30)+'<span>สร้างชั้นใหม่</span></button>';
  h+='</div>';
  return h;
}

/* ---- หน้าจอ 2.5: แปลนในชั้น (การ์ดแปลน) — เปิดจากการคลิกโฟลเดอร์ชั้น ---- */
function viewFloorPlans(){
  var f=getFloor(state.floorId), p=getProject(state.projectId);
  if(!f||!p) return emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',"ไม่พบชั้น","");
  var plans=floorPlans(f), all=membersOfFloor(f.id), s=summarize(all), pct=flPct(s), lv=lvText(f.level);
  var h='<div class="pj-head">'
    +'<div class="pj-ring" style="width:64px;height:64px;display:grid;place-items:center;background:var(--brand-bg);border-radius:16px">'+folderSvg('var(--brand)',40)+'</div>'
    +'<div class="pj-ht"><h1 class="pj-title">'+esc(f.name)+'</h1>'
    +'<div class="pj-meta"><span>'+esc(p.name)+'</span>'+(lv?'<span>ระดับ '+esc(lv)+'</span>':'')
      +'<span>'+plans.length+' แปลน · '+s.total+' ชิ้นส่วน</span>'
      +(all.length?'<span>ความคืบหน้า <b>'+pct+'%</b></span>':'')
      +(s.fail?'<span class="bad">ไม่ผ่านค้าง <b>'+s.fail+'</b></span>':'')+'</div></div>'
    +'<div class="pj-acts">'
      +'<button class="btn soft" data-act="floorHistory" data-id="'+esc(f.id)+'" title="ประวัติการตรวจของชั้นนี้">'+rvIc('data',14)+' ประวัติชั้นนี้</button>'
      +'<button class="btn soft" data-act="editFloor" data-id="'+esc(f.id)+'" title="เปลี่ยนชื่อ / ระดับ / ลบชั้น">'+rvIc('edit',14)+' แก้ไขชั้น</button>'
      +'<button class="btn" data-act="addPlan">'+rvIc('plus',14)+' เพิ่มแปลน</button>'
    +'</div></div>';
  h+='<div class="pj-sec">'+rvIc('plan',18)+'<span>แปลนในชั้นนี้</span><i class="pj-cnt">'+plans.length+'</i><span class="sp"></span><small>คลิกแปลนเพื่อเปิดวาด/ตรวจ · ⋯ ที่การ์ดเพื่อเปลี่ยนชื่อ/ลบ</small></div>';
  h+='<div class="plan-cards">';
  plans.forEach(function(pl){
    var pm=all.filter(function(m){ return memberPlanId(m)===pl.id; });
    var ps=summarize(pm), ppct=flPct(ps), pcol=flStatusCol(ps);
    var src=planThumbSrc(f,pl), active=(pl.id===(f.activePlanId||"_main"));
    h+='<div class="plan-card'+(active?' on':'')+'" data-act="openPlan" data-pid="'+esc(pl.id)+'" role="button" tabindex="0">'
      +'<div class="plan-card-actions"><button class="btn sm ic" data-act="renamePlan" data-pid="'+esc(pl.id)+'" title="เปลี่ยนชื่อแปลน">'+rvIc('edit',14)+'</button>'
        +'<button class="btn sm ic" data-act="deletePlanById" data-pid="'+esc(pl.id)+'" title="ลบแปลนนี้">'+rvIc('trash',14)+'</button></div>'
      +(pl.kind==="pdf"?'<span class="plan-card-tag">PDF</span>':'')
      +'<div class="plan-card-th">'+(src?'<img src="'+esc(src)+'" alt="'+esc(pl.name||"แปลน")+'">':'<span class="plan-card-ph">'+rvIc('plan',26)+'</span>')+'</div>'
      +'<div class="plan-card-b"><b>'+esc(pl.name||"แปลน")+'</b><div class="plan-card-m">'+(pm.length?pm.length+' ชิ้น · '+ppct+'%':'ยังไม่มีชิ้นส่วน')+'</div>'
      +'<span class="fl-bar"><i style="width:'+Math.max(4,ppct)+'%;background:'+pcol+'"></i></span></div>'
      +'</div>';
  });
  h+='<button class="plan-card plan-add" data-act="addPlan">'+rvIc('plus',28)+'<span>เพิ่มแปลน<br><small>(รูป / PDF)</small></span></button>';
  h+='</div>';
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
          +     '<div class="t2">'+esc(TYPES[m.type].label)+(m.grid?' · '+esc(m.grid):'')+(memberTypeOf(m)?' · <span class="type-pill" style="background:'+esc(memberTypeOf(m).color||"#2563eb")+'">🔗 '+esc(memberTypeOf(m).name)+'</span>':'')+'</div>'
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
  var _am=activeMemberId(); if(state.ansMid!==_am){ state.answers={}; state.photos=[]; state.note=""; state.ansMid=_am; }
  var pi=$("#photoInput"); if(pi) pi.addEventListener("change",onPhotoPick);
  var nt=$("#insNote");    if(nt){ nt.value=state.note; nt.addEventListener("input",function(){ state.note=nt.value; }); }
  var ip=$("#inspector");  if(ip) ip.addEventListener("input",refreshChecklistUI);
  renderThumbs();
  refreshChecklistUI();
}

/** ชิ้นส่วนที่กำลังตรวจอยู่ — หน้าแปลนใช้ selMemberId, หน้ารายละเอียดใช้ memberId */
function activeMemberId(){ return state.screen==="planEditor" ? state.selMemberId : (state.memberId||state.selMemberId); }
/** ลบทุกชิ้นที่เลือกอยู่ (ถามยืนยัน) — ใช้ทั้งปุ่มริบบอนและคีย์ Delete */
function delSelectedMembers(){
  var ds=selIds().map(getMember).filter(Boolean); if(!ds.length) return;
  if(!confirm('ลบ '+ds.length+' ชิ้นที่เลือก ('+ds.map(function(x){ return x.code; }).join(', ')+') และประวัติการตรวจของชิ้นเหล่านี้?')) return;
  plPushUndo(); var dset={}; ds.forEach(function(x){ dset[x.id]=1; });
  DB.members=DB.members.filter(function(x){ return !dset[x.id]; });
  DB.inspections=DB.inspections.filter(function(x){ return !dset[x.memberId]; });
  state.selMemberId=null; state.selMulti=[]; state.memberId=null; saveDB(); render(); toast('ลบ '+ds.length+' ชิ้นแล้ว');
}
/** id ทั้งหมดที่เลือกอยู่บนแปลน (หลายชิ้น หรือชิ้นเดียว) */
function selIds(){ var a=state.selMulti||[]; if(a.length>=2) return a.slice(); return state.selMemberId?[state.selMemberId]:[]; }
/** ตั้งการเลือกหลายชิ้น — ตัวแรกเป็นตัวหลัก */
function setMulti(ids){ ids=(ids||[]).filter(function(id,i,arr){ return getMember(id) && arr.indexOf(id)===i; });
  state.selMulti = ids.length>=2 ? ids : []; state.selMemberId=ids[0]||null; if(ids[0]) state.memberId=ids[0];
  state.selZoneId=null; state.selAnnotId=null; state.selTypeId=null; }
/** กล่องล้อมชิ้นส่วน (พิกัด 0..1) สำหรับเช็กว่าอยู่ในกรอบเลือกไหม */
function memberBBox(m){ var p=m.plan; if(!p) return null;
  if(p.kind==="point"){ return {x1:p.x-0.005,y1:p.y-0.005,x2:p.x+0.005,y2:p.y+0.005}; }
  return {x1:Math.min(p.x1,p.x2),y1:Math.min(p.y1,p.y2),x2:Math.max(p.x1,p.x2),y2:Math.max(p.y1,p.y2)}; }

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
  if(state.ansMid!==m.id){ state.answers={}; state.photos=[]; state.note=""; state.ansMid=m.id; toast("ชิ้นส่วนที่เลือกเปลี่ยนไป — กรุณาตรวจใหม่",true); render(); return; }
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
  var list=DB.inspections.filter(function(r){ return r.projectId===state.projectId && (!state.hFloorId || r.floorId===state.hFloorId); });
  var q=state.qh.trim().toLowerCase();
  if(q) list=list.filter(function(r){
    return [r.memberCode,r.memberName,r.inspector,r.floorName,r.grid].join(" ").toLowerCase().indexOf(q)!==-1;
  });

  var h='<div class="screen-title">ประวัติการตรวจ</div>'
      + '<div class="screen-sub">'+esc(p?p.name:"")+(state.hFloorId&&getFloor(state.hFloorId)?' · '+esc(getFloor(state.hFloorId).name):'')+'</div>'
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
    + '<div class="screen-sub">'+((CLOUD&&_fbUser)?'ข้อมูลเก็บบนคลาวด์ (ฐานข้อมูลกลาง แชร์ทั้งทีม) · นำเข้าไฟล์ = แทนที่ข้อมูลของทุกคน':'ข้อมูลทั้งหมดเก็บในเครื่องนี้เท่านั้น (localStorage) ไม่มีเซิร์ฟเวอร์')+'</div>'
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
    +   ((CLOUD&&_fbUser)?'':'<button class="btn danger block" data-act="reset">ล้างข้อมูลทั้งหมด แล้วโหลดตัวอย่างใหม่</button>')
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
      if(!confirm("นำเข้า "+d.projects.length+" โครงการ / "+d.members.length+" ชิ้นส่วน\n"+((CLOUD&&_fbUser)?"⚠ โหมดคลาวด์: ข้อมูลกลางของทุกคนในทีมจะถูกแทนที่ด้วยไฟล์นี้":"ข้อมูลเดิมในเครื่องจะถูกแทนที่")+" ยืนยันหรือไม่?")) return;
      DB.projects=d.projects;
      DB.floors=Array.isArray(d.floors)?d.floors:[];
      DB.members=d.members;
      DB.inspections=Array.isArray(d.inspections)?d.inspections:[];
      DB.types=Array.isArray(d.types)?d.types:[];
      DB.zones=Array.isArray(d.zones)?d.zones:[];
      DB.annots=Array.isArray(d.annots)?d.annots:[];
      DB.headMarks=Array.isArray(d.headMarks)?d.headMarks:[];
      DB.ctypes=Array.isArray(d.ctypes)?d.ctypes:[];
      DB.inspector=typeof d.inspector==="string"?d.inspector:"";
      try{ normalizePlanShapes(); normalizeFloorPlans(); registerCustomTypes(); }catch(e){}
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
  DB.zones=(DB.zones||[]).filter(function(x){ return x.projectId!==id; });
  DB.annots=(DB.annots||[]).filter(function(x){ return x.projectId!==id; });
  DB.types=(DB.types||[]).filter(function(x){ return x.projectId!==id; });
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
  DB.zones=(DB.zones||[]).filter(function(x){ return x.floorId!==id; });
  DB.annots=(DB.annots||[]).filter(function(x){ return x.floorId!==id; });
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
  autoCode:false,        // วาดต่อเนื่อง: ใส่เบอร์ถัดไปให้เอง ไม่ถาม
  selMulti:[],           // เลือกหลายชิ้น (id) — ใช้ร่วมกับ selMemberId (ตัวหลัก)
  marquee:false,         // เครื่องมือลากกรอบเลือก (ครั้งเดียวแล้วปิดเอง)
  zoneShape:"rect",      // รูปทรงที่จะวาดโซนเท: rect | poly | oval
  areaShape:"poly",      // วัดพื้นที่: poly (คลิกทีละมุม) | rect (ลากสี่เหลี่ยม)
  areaThick:0.2,         // ความหนาเริ่มต้นของพื้นที่ที่วัดใหม่ (ม.) — จำค่าล่าสุดที่ตั้ง
  showLegend:false,                   // ตารางสีบนแปลน (ตรึงมุมขวาล่าง)
  planMode:"inspect",                 // โหมดหน้าแปลน: inspect (ตรวจเหล็ก) | progress (เทคอนกรีต)
  ribbonTab:"structure",              // แท็บริบบอน: file | structure | draw | view | progress
  browserOpen:true,                   // ผังโครงการ (มือถือ: ในแผงเพิ่มเติม) ขยายอยู่
  fileMenu:false,                     // คอม: เมนู "ไฟล์" เปิดอยู่
  statusFilter:null,                  // กรองจากแถบสถานะ: pass | fail | todo | null
  rpSheet:"peek",                     // มือถือ: พาเนลล่าง peek | open
  showProgress:true, selZoneId:null,  // ความคืบหน้าเทคอนกรีต
  selAnnotId:null,                    // หมายเหตุที่เลือก (callout / dim)
  selTypeId:null,                     // ประเภทชิ้นส่วนที่เลือกในผังโครงการ (โชว์ในพาเนลคุณสมบัติ)
  deTab:"add", deTool:"select", deZoom:null, deSelMulti:[], deLibOpen:false, deSideOff:false,   // หน้ารายละเอียด (เลย์เอาต์ Revit)
  mSheet:null, mSheetMin:false,       // มือถือ: แผงเลื่อนขึ้นที่เปิดอยู่ (draw/annot/zone/more/search/add/lib/style) · ย่อแผงของสิ่งที่เลือก
  annotStyle:{color:"#1d4ed8", fill:"#ffffff", sw:1.6, font:"Sarabun", size:12, bold:1, italic:0, underline:0, radius:7, a1:"open", a2:"none"},
  rightTab:"palette",    // แท็บพาเนลขวา: palette | spec | inspect
  selMemberId:null,      // ชิ้นส่วนที่เลือกบนแปลน
  colorMode:"plain",     // ลงสีตาม: status | plain — ค่าเริ่มต้น = สีประจำประเภท
  showLabels:true,       // แสดงเบอร์บนแปลน
  zoom:1, panX:0, panY:0,// สถานะซูม/เลื่อนแปลน
  fillColor:"#f59e0b",   // สีกรอบที่จะวาด (คาน/พื้น/PT)
  fillAlpha:0.35,        // ความเข้มสีด้านในกรอบ (0..1)
  strokeW:10,            // ความหนาเส้นกรอบ (0 = ไม่มีเส้น)
  rpWidth:380,           // ความกว้างพาเนลขวา (ลากเส้นแบ่งปรับได้)
  labelStyle:{ color:"", font:"JetBrains Mono", size:22 }   // แต่งป้ายเบอร์: สี (""=อัตโนมัติ) · ฟอนต์ · ขนาด (viewBox) · ขนาดคงที่บนจอเสมอ
};
try{ var _rw=parseInt(localStorage.getItem("rebarcheck.rpw"),10); if(_rw>=280&&_rw<=760) state.rpWidth=_rw; }catch(e){}
try{ var _lsv=JSON.parse(localStorage.getItem("rebarcheck.labelStyle")||"null"); if(_lsv&&typeof _lsv==="object") state.labelStyle=Object.assign(state.labelStyle,_lsv); }catch(e){}

/** หน้าจอที่ปุ่มย้อนกลับควรพาไป — คำนวณจากลำดับชั้นข้อมูล ไม่ต้องเก็บ stack */
function backTarget(){
  switch(state.screen){
    case "home":       return null;
    case "floors":     return "home";
    case "floorPlans": return "floors";
    case "categories": return "floors";
    case "planEditor": return "floorPlans";
    case "members":    return "floors";
    case "memberDetail": return "planEditor";
    case "pickType":   return "floors";
    case "memberForm": return state.editId ? "planEditor" : "planEditor";
    case "history":    return "floors";
    case "data":       return state.projectId ? "floors" : "home";
  }
  return "home";
}
/** จอโทรศัพท์ (แนวตั้ง) → ใช้เปลือกแบบแอปแทนริบบอน/พาเนลของคอม (เกณฑ์เดียวกับแถบเมนูล่าง) */
function isMobile(){ return (window.innerWidth||1024)<760; }
function navigate(screen){
  state.mSheet=null; state.mSheetMin=false;   // แผงมือถือไม่ข้ามหน้า
  // ก่อนออกจากหน้าแก้ไข member — flush งานที่ค้างขึ้นคลาวด์ทันที (ไม่รอ debounce 450ms)
  // เพื่อกัน race: กลับเข้ามาแล้วเจอ snapshot เก่าทับข้อมูลใหม่
  var leaving=state.screen;
  if(leaving==='memberDetail' || leaving==='memberForm' || leaving==='planEditor'){
    try{ if(typeof _syncT!=='undefined' && _syncT){ clearTimeout(_syncT); _syncT=null; cloudSyncNow(); } }catch(e){}
  }
  state.screen=screen; render();
}
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
    case "floors":     return [p?p.name:"โครงการ", "โครงการ · "+floorsOf(p?p.id:"").length+" ชั้น"];
    case "floorPlans": return [f?f.name:"ชั้น", (p?p.name:"")+" · "+(f?floorPlans(f).length:0)+" แปลน"];
    case "categories": return [f?f.name:"ชั้น", p?p.name:""];
    case "planEditor": return [state.planMode==="progress"?"ความคืบหน้าเทคอนกรีต":"แปลน · "+(TYPES[state.catType]?TYPES[state.catType].label:"หมวด"), (f?f.name:"")+(p?" · "+p.name:"")];
    case "members":    return [f?f.name:"ชั้น", p?p.name:""];
    case "memberDetail": return [m?("รายละเอียด "+m.code):"รายละเอียด", (m?m.name:"")||(f?f.name:"")];
    case "pickType":   return ["เพิ่มชิ้นส่วน", f?f.name:""];
    case "memberForm": return [(state.editId?"แก้ไข":"เพิ่ม")+(TYPES[state.addType]?TYPES[state.addType].label:""), f?f.name:""];
    case "history":    return ["ประวัติการตรวจ", p?p.name:""];
    case "data":       return ["ข้อมูล / สำรอง","สำรองและถ่ายโอนข้อมูล"];
  }
  return ["RebarCheck",""];
}

var _renderSeq=0;   // นับครั้งที่ render (มือถือใช้เช็กว่า act ได้ render ไปแล้วหรือยัง)
function render(){
  _renderSeq++; var html="";
  if(state.selMulti && state.selMulti.length){   // การเลือกหลายชิ้นต้องมีตัวหลักอยู่ในชุด และทุกตัวยังมีอยู่
    state.selMulti=state.selMulti.filter(function(id){ return !!getMember(id); });
    if(state.selMulti.length<2 || state.selMulti.indexOf(state.selMemberId)<0) state.selMulti=[];
  }
  switch(state.screen){
    case "home":       html=viewHome();       break;
    case "floors":     html=viewFloors();     break;
    case "floorPlans": html=viewFloorPlans(); break;
    case "categories": html=viewCategories(); break;
    case "planEditor": html=viewPlanEditor(); break;
    case "members":    html=viewMembers();    break;
    case "memberDetail": html=viewMemberDetail(); break;
    case "pickType":   html=viewPickType();   break;
    case "memberForm": html=viewMemberForm(); break;
    case "history":    html=viewHistory();    break;
    case "data":       html=viewData();       break;
  }
  $("#app").innerHTML=html;

  // เอดิเตอร์แปลนใช้พื้นที่กว้างกว่าหน้าอื่น เพื่อให้กรอบแปลนใหญ่ ดูชัด
  document.body.classList.toggle("editor-wide", state.screen==="planEditor" || state.screen==="memberDetail" || state.screen==="memberForm");
  document.body.classList.toggle("plan-mode", state.screen==="planEditor" || state.screen==="memberDetail");
  document.body.classList.toggle("home-mode", state.screen==="home");
  document.body.classList.toggle("pj-mode", state.screen==="floors"||state.screen==="floorPlans");   // หน้าโครงการ/แปลนในชั้น: ใช้ความกว้างเต็ม
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
  var inspAct=(scr==="floors"||scr==="floorPlans"||scr==="categories"||scr==="members"||scr==="detail");
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
    var fa = scr==="home" ? {a:"newProject",t:"สร้างโครงการใหม่"} : (scr==="floors" ? {a:"addFloorFab",t:"เพิ่มชั้น"} : (scr==="floorPlans" ? {a:"addPlan",t:"เพิ่มแปลน"} : null));
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
  if(state.screen==="memberDetail"){
    bindDetailEditor();
  }
  if(state.screen==="planEditor"){
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
      var _pm=membersOfFloor(_pf.id)[0];
      go("planEditor",{projectId:_pf.projectId, floorId:_pf.id, catType:(_pm&&_pm.type)||state.catType||"beam", unified:true,
                       planMode:"progress", tool:"select", selZoneId:null, selMemberId:null, rightTab:"props",
                       showProgress:true, zoom:1, panX:0, panY:0});
      break;
    }
    case "tabInspect":  { var _pj=(DB.projects||[])[0]; if(_pj) go("floors",{projectId:_pj.id, floorId:null, q:"", typeFilter:"all"}); else navigate("home"); break; }
    case "addFloorFab": dlgFloor(null); break;
    case "goData":      navigate("data"); break;
    case "goReports":   if((DB.projects||[]).length){ go("history",{projectId:DB.projects[0].id, qh:"", hFloorId:null}); } else { navigate("home"); } break;
    case "theme":       toggleTheme(); break;
    case "authLogin":   doAuth(false); break;
    case "authSignup":  doAuth(true); break;
    case "authToggle":  state._authMode=(state._authMode==="signup"?"login":"signup"); renderLogin(); break;
    case "logout":      if(confirm("ออกจากระบบ?")){ try{ fbAuth.signOut(); }catch(e){} } break;
    case "openFloor": {   // คลิกโฟลเดอร์ชั้น → หน้ารวมแปลนของชั้น (การ์ดแปลน)
      var fOF=getFloor(id); if(!fOF) break;
      go("floorPlans",{floorId:fOF.id, q:"", typeFilter:"all"});
      break;
    }
    case "openPlan": {   // คลิกการ์ดแปลน → ตั้งเป็นแปลนที่ใช้งาน แล้วเปิดเอดิเตอร์
      var fOP=getFloor(state.floorId); if(!fOP) break;
      var pidOP=el.getAttribute("data-pid"); if(pidOP){ fOP.activePlanId=pidOP; state.pendingPlanId=null; saveDB(); }
      var msOP=membersOfFloor(fOP.id), tOP=(msOP[0]&&msOP[0].type)||"beam";
      go("planEditor",{floorId:fOP.id, catType:tOP, unified:true, hiddenTypes:{}, selMemberId:null, selZoneId:null, selAnnotId:null, selTypeId:null,
                       planMode:"inspect", tool:"select", rightTab:"props", ribbonTab:"structure", answers:{}, photos:[], note:"", zoom:1, panX:0, panY:0});
      break;
    }
    case "floorHistory": { go("history",{qh:"", hFloorId:id}); break; }
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
    case "openMember": {   // จากรายการชั้น → เปิดแปลนแล้วไปแท็บตรวจเหล็กของชิ้นนั้น
      var om=getMember(id); if(!om) break;
      go("planEditor",{floorId:om.floorId, catType:om.type, unified:true, planMode:"inspect", selMemberId:om.id, memberId:om.id,
                       tool:"select", rightTab:"inspect", answers:{}, photos:[], note:"", zoom:1, panX:0, panY:0});
      break;
    }
    case "history":     go("history",{qh:"", hFloorId:null}); break;
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
    case "setRightTab": state.rightTab=el.getAttribute("data-tab"); state.rpCollapsed=false; state.rpSheet="open"; render(); break;
    case "setPalette": state.rightTab=el.getAttribute("data-tab")||"props"; state.rpCollapsed=false; state.rpSheet="open"; render(); break;
    case "setRibbonTab": {   // แท็บริบบอน — โครงสร้าง/วาด = โหมดตรวจเหล็ก · เทคอนกรีต = โหมดโซน · ไฟล์/มุมมอง ไม่เปลี่ยนโหมด
      var _rt=el.getAttribute("data-rtab")||"structure"; state.ribbonTab=_rt;
      if(_rt==="progress"){ if(state.planMode!=="progress"){ state.planMode="progress"; state.tool="select"; state.selZoneId=null; state.statusFilter=null; state.showProgress=true; state.rightTab="props"; } }
      else if(_rt==="structure"||_rt==="draw"){ if(state.planMode==="progress"){ state.planMode="inspect"; state.tool="select"; state.selZoneId=null; } }
      render(); break;
    }
    case "toggleBrowser": state.browserOpen=(state.browserOpen===false); render(); break;
    case "fileMenu": state.fileMenu=!state.fileMenu; render(); break;
    case "toggleAutoCode": state.autoCode=!state.autoCode; render(); toast(state.autoCode?"วาดต่อเนื่อง: ใส่เบอร์ถัดไปให้อัตโนมัติ (แก้ทีหลังได้)":"วาดแล้วถามเบอร์ทุกครั้ง"); break;
    case "setAutoCode": { var _ac=el.getAttribute("data-v")==="1"; if(state.autoCode!==_ac){ state.autoCode=_ac; render(); } break; }
    case "warnUnplaced": {   // ชิ้นที่ยังไม่วางบนแปลน → เปิดแท็บผัง + เลือกชิ้นแรก + บอกวิธีวาง
      var _un=membersOfFloor(state.floorId).filter(function(m){ return !m.plan; }); if(!_un.length) break;
      state.rightTab="tree"; state.rpCollapsed=false; if(!state.treeOpen) state.treeOpen={members:true,types:false,zones:false,plans:false}; state.treeOpen.members=true;
      state.selMemberId=_un[0].id; state.memberId=_un[0].id; state.selZoneId=null; state.selAnnotId=null; if(!isMobile()) state.ribbonTab="modify";
      render(); toast("ยังไม่วาง: "+_un.map(function(m){ return m.code; }).join(", ")+" — วาดกรอบบนแปลนแล้วใส่เบอร์เดิม ระบบจะวางชิ้นนั้นให้ (ข้อมูลเหล็กคงเดิม)");
      break;
    }
    case "treeToggle": { var _ts=el.getAttribute("data-sec"); if(!state.treeOpen) state.treeOpen={members:true,types:false,zones:false,plans:false}; state.treeOpen[_ts]=!state.treeOpen[_ts]; render(); break; }
    case "clearSel": state.selMemberId=null; state.selMulti=[]; state.selZoneId=null; state.selAnnotId=null; state.selTypeId=null; state.marquee=false; render(); break;
    case "toggleMarquee": state.marquee=!state.marquee; state.tool="select"; render(); break;
    case "toggleHideSel": {
      var _hs=selIds().map(getMember).filter(Boolean); if(!_hs.length) break;
      var _allH=_hs.every(function(x){ return x.hidden; }); plPushUndo();
      _hs.forEach(function(x){ x.hidden=!_allH; }); saveDB(); render(); toast((_allH?'แสดง ':'ซ่อน ')+_hs.length+' ชิ้นแล้ว'); break;
    }
    case "delSelected": delSelectedMembers(); break;
    case "zoomToSel": { var _zm=getMember(state.selMemberId); if(_zm && _zm.plan) planZoomToMember(_zm.id); break; }
    case "browserSelect": {   // กดในผังโครงการ → เลือก + โชว์คุณสมบัติ + ซูมไปหา
      var _bm=getMember(id); if(!_bm) break;
      if(state.hiddenTypes && state.hiddenTypes[_bm.type]) delete state.hiddenTypes[_bm.type];
      state.selMemberId=_bm.id; state.memberId=_bm.id; state.selZoneId=null;
      if(state.rightTab!=="inspect" && state.rightTab!=="tree") state.rightTab="props";
      if(state.planMode==="progress"){ state.planMode="inspect"; state.ribbonTab="structure"; }
      if(!isMobile()) state.ribbonTab="modify";
      state.rpSheet="open"; state.mSheet=null; state.mSheetMin=false; render(); if(_bm.plan) planZoomToMember(_bm.id);
      break;
    }
    case "saveNow": saveDB(); try{ if(CLOUD && _fbUser){ if(typeof _syncT!=='undefined' && _syncT){ clearTimeout(_syncT); _syncT=null; } cloudSyncNow(); } }catch(e){} toast("บันทึกแล้ว ✓"); break;
    case "qatData": navigate("data"); break;
    case "qatTheme": toggleTheme(); render(); break;
    case "focusSearch": { var _q=$("#planSearch"); if(_q){ _q.focus(); _q.select(); } break; }
    case "setStageMode": {   // สลับ ตรวจเหล็ก ↔ เทคอนกรีต ในหน้าเดียวกัน
      var _sm=el.getAttribute("data-mode")||"inspect";
      state.planMode=_sm; state.tool="select"; state.selZoneId=null; state.statusFilter=null;
      if(_sm==="progress"){ state.showProgress=true; state.rightTab="props"; }
      else if(state.rightTab==="props" && !getMember(state.selMemberId)) state.rightTab="items";
      render(); break;
    }
    case "statusFilter": { var _sf=el.getAttribute("data-st"); state.statusFilter=(state.statusFilter===_sf||_sf==="all")?null:_sf; render(); break; }
    /* --- หมายเหตุ: กล่องข้อความ + เส้นบอกขนาด --- */
    case "drawCalloutStart": state.tool="drawCallout"; state.ribbonTab="annot"; state.selAnnotId=null; render(); break;
    case "drawDimStart":     state.tool="drawDim";     state.ribbonTab="annot"; state.selAnnotId=null; render(); break;
    /* --- มาตราส่วน + วัดพื้นที่ --- */
    case "setScaleStart":    state.tool="setScale"; state.ribbonTab="annot"; state.selAnnotId=null; state.selMemberId=null; state.selMulti=[]; state.selZoneId=null; state.marquee=false; render(); break;
    case "drawAreaStart":    { var _ash=el.getAttribute("data-shape"); if(_ash) state.areaShape=_ash; state.tool="drawArea"; state.ribbonTab="annot"; state.selAnnotId=null; state.selMemberId=null; state.selMulti=[]; state.selZoneId=null; state.marquee=false; render(); break; }
    case "setAreaShape":     { state.areaShape=el.getAttribute("data-shape")||"poly"; if(state.tool!=="drawArea" && state.tool!=="drawHole"){ state.tool="drawArea"; state.selAnnotId=null; state.selMemberId=null; state.selMulti=[]; state.selZoneId=null; } state.ribbonTab="annot"; render(); break; }
    case "drawHoleStart":    { var _ha=getAnnot(state.selAnnotId); if(!_ha||_ha.kind!=="area"){ toast("เลือกพื้นที่ที่วัดไว้ก่อน แล้วค่อยหักช่องเปิด",true); break; } state.tool="drawHole"; state.ribbonTab="annot"; render(); break; }
    case "areaClearHoles":   { var _hc=getAnnot(state.selAnnotId); if(!_hc||_hc.kind!=="area"||!(_hc.holes||[]).length) break; plPushUndo(); _hc.holes=[]; saveDB(); render(); break; }
    case "areaToZone":       { var _az=getAnnot(el.getAttribute("data-aid")||state.selAnnotId); if(_az&&_az.kind==="area") areaToZone(_az); break; }
    case "qtySummary":       state.selAnnotId=null; state.selMemberId=null; state.selMulti=[]; state.selZoneId=null; state.selTypeId=null; state.ribbonTab="annot"; state.rightTab="props"; state.rpCollapsed=false; render(); break;
    case "areaCsv":          exportAreaCsv(); break;
    case "clearScale":       { var _cf=getFloor(state.floorId), _cp=_cf?getFloorPlan(_cf):null; if(_cp&&_cp.scale&&confirm("ล้างมาตราส่วนของแปลนนี้? ตัวเลขพื้นที่/ระยะจะแสดงไม่ได้จนกว่าจะตั้งใหม่")){ delete _cp.scale; saveDB(); render(); } break; }
    case "selectAnnot": {
      state.selAnnotId=el.getAttribute("data-aid"); state.selMemberId=null; state.selZoneId=null; state.mSheet=null; state.mSheetMin=false;
      state.ribbonTab="annot"; render(); break;
    }
    case "annotClose": state.selAnnotId=null; render(); break;
    case "dimAuto": { var _dd=getAnnot(state.selAnnotId); if(!_dd||_dd.kind!=="dim") break; plPushUndo(); _dd.auto=true; dimLabel(_dd); saveDB(); render(); break; }
    case "annotPanel": state.ribbonTab="annot"; render(); break;
    case "annotDel": {
      var _ad=state.selAnnotId; if(!_ad) break;
      if(confirm("ลบหมายเหตุนี้?")){ plPushUndo(); DB.annots=(DB.annots||[]).filter(function(x){ return x.id!==_ad; }); state.selAnnotId=null; saveDB(); render(); }
      break;
    }
    case "annotDup": {
      var _as=state.selAnnotId?getAnnot(state.selAnnotId):null; if(!_as) break;
      plPushUndo();
      var cp=JSON.parse(JSON.stringify(_as)); cp.id=uid("an");
      var off=0.02;
      var _sh=function(pt){ return {x:pt.x+off,y:pt.y+off}; };
      if(cp.kind==="dim"){ cp.p1.x+=off; cp.p1.y+=off; cp.p2.x+=off; cp.p2.y+=off; }
      else if(cp.kind==="area"){ cp.pts=(cp.pts||[]).map(_sh); cp.holes=(cp.holes||[]).map(function(h){ return h.map(_sh); }); cp.name=(cp.name||"พื้นที่")+" (สำเนา)"; }
      else { cp.box.x1+=off; cp.box.x2+=off; cp.box.y1+=off; cp.box.y2+=off; cp.tip.x+=off; cp.tip.y+=off; }
      DB.annots.push(cp); state.selAnnotId=cp.id; saveDB(); render(); toast("ทำซ้ำหมายเหตุแล้ว");
      break;
    }
    case "annotArrow": { var _aa=getAnnot(state.selAnnotId); if(!_aa) break; plPushUndo();
      _aa[el.getAttribute("data-which")]=el.getAttribute("data-v"); annotRemember(_aa); saveDB(); render(); break; }
    case "annotSwatch": { var _ac=getAnnot(state.selAnnotId); if(!_ac) break; plPushUndo();
      _ac.color=el.getAttribute("data-c"); if(_ac.kind!=="area") annotRemember(_ac); saveDB(); render(); break; }
    case "annotBold":  { var _ab=getAnnot(state.selAnnotId); if(!_ab) break; plPushUndo(); _ab.bold=annotStyleOf(_ab).bold?0:1; annotRemember(_ab); saveDB(); render(); break; }
    case "annotItalic":{ var _ai=getAnnot(state.selAnnotId); if(!_ai) break; plPushUndo(); _ai.italic=annotStyleOf(_ai).italic?0:1; annotRemember(_ai); saveDB(); render(); break; }
    case "annotUnder": { var _au=getAnnot(state.selAnnotId); if(!_au) break; plPushUndo(); _au.underline=annotStyleOf(_au).underline?0:1; annotRemember(_au); saveDB(); render(); break; }
    case "annotRadius":{ var _ar=getAnnot(state.selAnnotId); if(!_ar) break; plPushUndo(); _ar.radius=+el.getAttribute("data-v"); annotRemember(_ar); saveDB(); render(); break; }
    case "applyStyleAll": {
      var _f=getFloor(state.floorId), _pid=curPlanId();
      var _list=membersOfFloor(_f.id).filter(function(mm){ return mm.plan && isBox(mm.plan) && memberPlanId(mm)===_pid; });
      if(!_list.length){ toast("ยังไม่มีกล่องในแปลนนี้",true); break; }
      if(!confirm("ปรับสี/ความเข้ม/เส้นกรอบ ของกล่องทั้งหมด "+_list.length+" กล่องในแปลนนี้ ให้เท่ากับค่าเริ่มต้น?\n(เห็นผลในโหมดสี “สีที่ตั้งเอง”)")) break;
      plPushUndo();
      _list.forEach(function(mm){ mm.plan.fill=state.fillColor; mm.plan.fillA=state.fillAlpha; mm.plan.strokeW=state.strokeW; });
      saveDB();
      if(state.colorMode!=="plain"){ state.colorMode="plain"; }
      render();
      toast("ปรับ "+_list.length+" กล่องแล้ว");
      break;
    }
    case "planUndo": plUndo(); break;
    case "planRedo": plRedo(); break;
    case "toggleSheet": state.rpSheet=(state.rpSheet==="open"?"peek":"open"); render(); break;
    case "toggleSnap":   state.snap=!state.snap; render(); break;
    case "toggleLabels": state.showLabels=!state.showLabels; render(); break;
    case "labelColorAuto": { state.labelStyle.color=""; try{ localStorage.setItem("rebarcheck.labelStyle",JSON.stringify(state.labelStyle)); }catch(e){} render(); break; }
    case "boxLabelReset": { var _blm=getMember(state.selMemberId); if(_blm&&_blm.plan){ delete _blm.plan.labelColor; delete _blm.plan.labelFont; saveDB(); render(); } break; }
    case "selectPlanMember":
      state.selMemberId=id; state.rightTab="inspect"; state.answers={}; state.photos=[]; state.note=""; if(!isMobile()) state.ribbonTab="modify";
      render();
      break;
    case "toggleHide": {
      var hm=getMember(id);
      if(hm){ plPushUndo(); hm.hidden=!hm.hidden; saveDB();
        if(hm.hidden && state.selMemberId===id) state.selMemberId=null;
        render(); toast(hm.hidden?"ซ่อน "+hm.code+" บนแปลนแล้ว":"แสดง "+hm.code+" แล้ว"); }
      break;
    }
    case "dupMember": {
      var src=getMember(id);
      if(src){
        plPushUndo();
        var cp=JSON.parse(JSON.stringify(src));
        cp.id=uid("m"); cp.hidden=false;
        if(cp.typeId) cp.doc={els:[]};   // ผูกประเภทเดียวกัน → ใช้แผ่นร่วม ไม่ต้องก็อป
        else if(cp.doc && Array.isArray(cp.doc.els)) cp.doc={els:deCloneEls(cp.doc.els), page:cp.doc.page};   // id ใหม่ + ก็อปรูป/PDF ของตัวเอง
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
      if(lm){ state.selMemberId=id; state.memberId=id; state.rightTab="inspect"; state.answers={}; state.photos=[]; state.note=""; state.rpCollapsed=false; render(); planZoomToMember(id); }   // แตะรายการ → ตรวจเหล็กในพาเนล + ซูมไปหา
      break;
    }
    /* --- ประเภทชิ้นส่วน (แผ่นรายละเอียดใช้ร่วมกัน) --- */
    case "typeCreate": closeSheet(); typeCreateAct(); break;
    case "typeDetach": typeDetachAct(); break;
    case "typeAssignSheet": {
      var am=getMember(state.selMemberId); if(!am){ toast("เลือกชิ้นส่วนบนแปลนก่อน",true); break; }
      var tl0=typesOf(am.projectId, am.type);
      var hb0=tl0.map(function(t){ return '<button class="row-item" data-act="typeAssignTo" data-tid="'+esc(t.id)+'"><span class="sw-dot" style="background:'+esc(t.color||"#2563eb")+'"></span><div class="body"><div class="t1">'+esc(t.name)+(am.typeId===t.id?' <span class="small muted">(ใช้อยู่)</span>':'')+'</div><div class="t2">ใช้ร่วมกัน '+typeMembers(t.id).length+' ชิ้น</div></div></button>'; }).join("");
      if(!am.typeId) hb0+='<button class="row-item" data-act="typeCreate"><span class="sw-dot" style="background:#e2e8f0"></span><div class="body"><div class="t1">＋ สร้างประเภทใหม่จากชิ้นนี้</div><div class="t2">แผ่นรายละเอียดของ '+esc(am.code)+' จะกลายเป็นของประเภท</div></div></button>';
      openSheet('<h3>กำหนดประเภทให้ '+esc(am.code)+'</h3><p class="small muted" style="margin-top:0">ชิ้นที่ใช้ประเภทเดียวกันจะใช้หน้ารายละเอียด (รูป/ข้อความ/ตาราง) เดียวกัน — แก้ที่ชิ้นไหนก็เปลี่ยนทุกชิ้น</p>'+hb0);
      break;
    }
    case "typeAssignTo": { var am2=getMember(state.selMemberId), tt=getType(el.getAttribute("data-tid")); closeSheet(); if(am2&&tt) typeAssign(am2, tt); break; }
    case "typeSelect": {
      state.selTypeId=el.getAttribute("data-tid"); state.selMemberId=null; state.memberId=null; state.selZoneId=null; state.selAnnotId=null;
      state.rightTab="props"; state.rpSheet="open"; state.rpCollapsed=false;
      if(state.planMode==="progress"){ state.planMode="inspect"; state.ribbonTab="structure"; }
      render(); break;
    }
    case "typeManage": {   // จากหน้ารายละเอียด → ไปการ์ดประเภทบนหน้าแปลน
      var tmm=getMember(activeMemberId()); if(!tmm||!tmm.typeId) break;
      state.selTypeId=tmm.typeId; state.selMemberId=null; state.memberId=null; state.rightTab="props"; state.rpSheet="open";
      go("planEditor",{floorId:tmm.floorId, catType:tmm.type}); break;
    }
    case "typeColor": { var tc=getType(el.getAttribute("data-tid")); if(tc){ tc.color=el.getAttribute("data-c"); saveDB(); render(); } break; }
    case "typeOpenDetail": {
      var to=getType(el.getAttribute("data-tid")), tms=to?typeMembers(to.id):[];
      if(!tms.length){ toast("ประเภทนี้ยังไม่มีชิ้นส่วน — ผูกชิ้นก่อนแล้วค่อยเปิดรายละเอียด",true); break; }
      var pick=tms.filter(function(x){ return x.floorId===state.floorId; })[0]||tms[0];
      state.selMemberId=pick.id; state.memberId=pick.id; deOpen(); break;
    }
    case "typeGoMember": {   // จากการ์ดประเภท → ไปหาชิ้นนั้น (ข้ามชั้น/แปลนได้)
      var gm=getMember(id); if(!gm) break;
      state.selTypeId=null;
      if(gm.floorId!==state.floorId){ state.floorId=gm.floorId; state.zoom=1; state.panX=0; state.panY=0; }
      var gf=getFloor(gm.floorId); if(gf && gf.activePlanId!==memberPlanId(gm) && (gf.planList||[]).some(function(pp){ return pp.id===memberPlanId(gm); })){ gf.activePlanId=memberPlanId(gm); saveDB(); }
      if(state.hiddenTypes && state.hiddenTypes[gm.type]) delete state.hiddenTypes[gm.type];
      state.selMemberId=gm.id; state.memberId=gm.id; state.rightTab="props"; state.rpSheet="open"; if(!isMobile()) state.ribbonTab="modify";
      render(); if(gm.plan) planZoomToMember(gm.id);
      break;
    }
    case "typeDeleteBtn": {
      var td=getType(el.getAttribute("data-tid")); if(!td) break;
      var tn=typeMembers(td.id).length;
      if(!confirm("ลบประเภท “"+td.name+"”?\n\nหน้ารายละเอียด (รูป/ข้อความ/ตาราง) ของประเภทนี้จะหายไป\nชิ้นส่วน "+tn+" ชิ้นจะกลับไปใช้รายละเอียดของตัวเอง")) break;
      plPushUndo(); typeDelete(td); state.selTypeId=null; saveDB(); render(); toast("ลบประเภท “"+td.name+"” แล้ว");
      break;
    }
    /* --- มือถือ: แผงเลื่อนขึ้น / แถบล่าง --- */
    case "mSheet": {
      var _sh=el.getAttribute("data-sheet")||null;
      if(_sh==="zone" && state.planMode!=="progress"){ state.planMode="progress"; state.tool="select"; state.selMemberId=null; state.selAnnotId=null; state.showProgress=true; state.statusFilter=null; }
      if(_sh==="draw" && state.planMode==="progress"){ state.planMode="inspect"; state.tool="select"; state.selZoneId=null; }
      state.mSheet=(state.mSheet===_sh)?null:_sh; state.mSheetMin=false; render(); break;
    }
    case "mSheetClose": {
      if(state.mSheet) state.mSheet=null;
      else { state.selMemberId=null; state.selZoneId=null; state.selAnnotId=null; state.selTypeId=null; if(state.rightTab==="inspect") state.rightTab="props"; }
      state.mSheetMin=false; render(); break;
    }
    case "mSheetToggle": { if(state.mSheet) state.mSheet=null; else state.mSheetMin=!state.mSheetMin; render(); break; }
    case "mTool": { state.tool=el.getAttribute("data-tool")||"select"; state.mSheet=null; state.mSheetMin=false; render(); break; }
    case "mExitProgress": { state.planMode="inspect"; state.tool="select"; state.selZoneId=null; state.mSheet=null; render(); break; }
    case "showDetails": {
      var dm=getMember(state.selMemberId);
      if(!dm){ toast("แตะที่คานในแปลน (หรือเลือกจากรายการ) ก่อน แล้วกดรายละเอียด",true); break; }
      state.memberId=dm.id;
      deOpen();                  // เปลี่ยนเป็นหน้าจอรายละเอียดเต็ม (ไม่ใช่ป็อปอัปทับแปลน)
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
    case "toggleProgress": state.showProgress=!state.showProgress; render(); break;
    case "setSnap":     { var _sv=el.getAttribute("data-v")==="1"; if(state.snap!==_sv){ state.snap=_sv; render(); } break; }          // มือถือ: ปุ่มคู่ เปิด/ปิด
    case "setProgress": { var _pv=el.getAttribute("data-v")==="1"; if(state.showProgress!==_pv){ state.showProgress=_pv; render(); } break; }
    case "drawZoneStart": { var _zs=el.getAttribute("data-shape"); if(_zs) state.zoneShape=_zs; state.tool="drawZone"; render(); break; }
    case "manageZoneStatus": dlgZoneStatus(); break;
    case "zsAddStatus": zsAddStatus(); break;
    case "zsDelStatus": zsDelStatus(el.getAttribute("data-sid")); break;
    case "zsSaveStatus": zsSaveStatus(); break;
    case "selectZone": {   // เลือกโซน (จากแปลนหรือผังโครงการ) → เข้าโหมดเทคอนกรีตให้เอง
      state.selZoneId=el.getAttribute("data-zid"); state.selMemberId=null; state.rightTab="props"; state.rpCollapsed=false; state.rpSheet="open";
      if(state.planMode!=="progress"){ state.planMode="progress"; state.ribbonTab="progress"; state.tool="select"; state.showProgress=true; }
      render(); break;
    }
    case "back": back(); break;
    case "deleteZone": {
      var zid=el.getAttribute("data-zid")||state.selZoneId;
      if(zid && confirm("ลบโซนนี้?")){ plPushUndo(); DB.zones=DB.zones.filter(function(z){return z.id!==zid;}); state.selZoneId=null; saveDB(); render(); }
      break;
    }
    case "exportProgressPdf": exportProgressPDF(); break;
    case "exportPdf": exportPlanPDF(); break;
    case "addPlan": {          // เพิ่มแปลนใหม่ → ตั้ง active เป็น id ใหม่ แล้วเปิดหน้าต่างเลือกไฟล์
      var fA=getFloor(state.floorId); if(!fA){ toast("ยังไม่ได้เลือกชั้น",true); break; } if(!fA.planList) fA.planList=[];
      state.pendingPlanId="pl"+Date.now();   // id ใหม่ — ตั้งเป็น active ตอนนำเข้าสำเร็จใน storePlan เท่านั้น (ยกเลิกแล้วแปลนเดิมยังอยู่ครบ)
      var pfA=$("#planFile");
      if(pfA){ pfA.click(); }
      else {                    // หน้าการ์ดแปลน (floorPlans) ไม่มี #planFile → สร้าง input ชั่วคราว
        var tmpA=document.createElement("input"); tmpA.type="file"; tmpA.accept="image/*,application/pdf,.pdf"; tmpA.style.display="none";
        document.body.appendChild(tmpA);
        tmpA.addEventListener("change",function(){ var file=tmpA.files&&tmpA.files[0]; try{ document.body.removeChild(tmpA); }catch(e){} if(!file){ state.pendingPlanId=null; return; } importPlan(file); });
        tmpA.addEventListener("cancel",function(){ state.pendingPlanId=null; try{ document.body.removeChild(tmpA); }catch(e){} });
        tmpA.click();
      }
      break;
    }
    case "switchPlan": {       // สลับไปแปลนที่เลือก
      var fS=getFloor(state.floorId); fS.activePlanId=el.getAttribute("data-pid"); state.pendingPlanId=null;
      state.zoom=1; state.panX=0; state.panY=0; state.selMemberId=null; state.selMulti=[]; state.selZoneId=null; state.selAnnotId=null;
      saveDB(); render(); break;
    }
    case "renamePlan": {       // เปลี่ยนชื่อแปลน (จากการ์ดแปลน)
      var fR=getFloor(state.floorId), pidR=el.getAttribute("data-pid");
      var plR=(floorPlans(fR)||[]).filter(function(p){return p.id===pidR;})[0]; if(!plR){ toast("ไม่พบแปลน",true); break; }
      var nmR=prompt("ชื่อแปลน", plR.name||"แปลน"); if(nmR==null) break; nmR=nmR.trim(); if(!nmR) break;
      if(fR.planList){ var hitR=fR.planList.filter(function(p){return p.id===pidR;})[0]; if(hitR) hitR.name=nmR; }
      saveDB(); render(); break;
    }
    case "deletePlanById": {   // ลบแปลนที่ระบุด้วย data-pid (จากการ์ดแปลน)
      var fD=getFloor(state.floorId), pidD=el.getAttribute("data-pid");
      if(!fD||!fD.planList){ toast("ไม่พบแปลน",true); break; }
      var plD=fD.planList.filter(function(p){return p.id===pidD;})[0]; if(!plD){ toast("ไม่พบแปลน",true); break; }
      if(confirm("ลบ “"+(plD.name||"แปลนนี้")+"”? (เบอร์ที่วาดไว้ยังอยู่)")){
        var pkD=(pidD&&pidD!=="_main")?fD.id+":"+pidD:fD.id;
        ["url","deepUrl","detailUrl","bigUrl"].forEach(function(k){ try{ if(PLAN_DOCS[pkD]&&PLAN_DOCS[pkD][k]) URL.revokeObjectURL(PLAN_DOCS[pkD][k]); }catch(e){} });
        delete PLAN_DOCS[pkD]; idbDel(pkD); cloudDeletePlan(pkD);
        fD.planList=fD.planList.filter(function(p){return p.id!==pidD;});
        if(fD.activePlanId===pidD) fD.activePlanId=fD.planList.length?fD.planList[0].id:null;
        saveDB(); render(); toast("ลบแปลนแล้ว");
      }
      break;
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
    case "renameMember": {
      var rm=getMember(activeMemberId()); if(!rm){ toast("ยังไม่ได้เลือกชิ้นส่วน",true); break; }
      var oldC=rm.code||""; var nc=prompt("ชื่อ / เบอร์ชิ้นส่วน", oldC); if(nc==null) break; nc=nc.trim(); if(!nc||nc===oldC) break;
      plPushUndo(); rm.code=nc; saveDB(); render(); toast("เปลี่ยนเป็น “"+nc+"”");
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
        plPushUndo();
        DB.members=DB.members.filter(function(x){ return x.id!==m.id; });
        DB.inspections=DB.inspections.filter(function(x){ return x.memberId!==m.id; });
        saveDB(); closeSheet();
        var toPlan = (state.screen==="planEditor" || state.screen==="memberDetail");
        state.memberId=null; state.selMemberId=null;
        navigate(toPlan ? "planEditor" : "floors");
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
      if(CLOUD && _fbUser){ toast("โหมดคลาวด์: ปุ่มนี้จะลบข้อมูลกลางของทุกคนในทีม — ปิดใช้งานไว้เพื่อความปลอดภัย",true); break; }
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
  if(state.colorMode==="type"){ var _t=memberTypeOf(m); return _t ? (_t.color||"#2563eb") : "#94a3b8"; }   // ลงสีตามประเภท (ไม่มีประเภท = เทา)
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
function stageMode(){ return state.planMode==="progress" ? "progress" : "inspect"; }
/* ---- หมายเหตุ: หัวลูกศร 6 แบบ + การวาด callout / dim เป็น SVG ---- */
var ANNOT_ARROWS=[["none","—","ไม่มี"],["solid","▶","ทึบ"],["open","▷","โปร่ง"],["dot","●","จุด"],["diamond","◆","ข้าวหลามตัด"],["bar","⊢","ขีด"]];
function annotMarker(id,type,col,z){
  if(type==="none") return "";
  var b='<marker id="'+id+'" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="strokeWidth">';
  if(type==="solid")        b+='<path d="M0 0 L10 5 L0 10 z" fill="'+col+'"/>';
  else if(type==="open")    b+='<path d="M0.5 0.5 L9.5 5 L0.5 9.5" fill="none" stroke="'+col+'" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
  else if(type==="dot")     b+='<circle cx="5" cy="5" r="4" fill="'+col+'"/>';
  else if(type==="diamond") b+='<path d="M0 5 L5 0 L10 5 L5 10 z" fill="'+col+'"/>';
  else if(type==="bar")     b+='<path d="M8.5 0.5 L8.5 9.5" stroke="'+col+'" stroke-width="2.2" stroke-linecap="round"/>';
  return b+'</marker>';
}
function annotStyleOf(a){
  var d=state.annotStyle||{};
  return { color:a.color||d.color||"#1d4ed8", fill:a.fill||d.fill||"#ffffff", fillA:(a.fillA!=null?a.fillA:1),
           sw:(a.sw!=null?a.sw:(d.sw||1.6)), radius:(a.radius!=null?a.radius:(d.radius!=null?d.radius:7)),
           font:a.font||d.font||"Sarabun", size:a.size||d.size||12,
           bold:(a.bold!=null?a.bold:d.bold), italic:(a.italic!=null?a.italic:d.italic), underline:(a.underline!=null?a.underline:d.underline),
           a1:a.a1||d.a1||"open", a2:a.a2||d.a2||"none" };
}
function _hx(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
/** จำรูปแบบล่าสุดไว้ใช้กับหมายเหตุชิ้นถัดไป (ไม่ต้องตั้งซ้ำทุกครั้ง) */
function annotRemember(a){
  var s=annotStyleOf(a);
  state.annotStyle={color:s.color, fill:s.fill, sw:s.sw, font:s.font, size:s.size,
                    bold:s.bold, italic:s.italic, underline:s.underline, radius:s.radius, a1:s.a1, a2:s.a2};
}
var AREA_COL="#2563eb";
/** พื้นที่ที่วัด: รูปหลายเหลี่ยม (เจาะช่องเปิดด้วย evenodd) + ป้ายชื่อ/ตร.ม. กลางรูป · เลือกแล้วมีจุดจับทุกมุม */
function areaSvg(a, VW, VH, z, sel){
  var col=a.color||AREA_COL, pts=a.pts||[]; if(pts.length<3) return "";
  var P=function(arr){ return arr.map(function(p){ return (p.x*VW).toFixed(1)+","+(p.y*VH).toFixed(1); }).join(" "); };
  var d="M"+P(pts).split(" ").join(" L")+" Z";
  (a.holes||[]).forEach(function(h){ if(h.length>=3) d+=" M"+P(h).split(" ").join(" L")+" Z"; });
  var out='<path data-aid="'+a.id+'" d="'+d+'" fill="'+col+'" fill-opacity="'+(sel?0.22:0.13)+'" fill-rule="evenodd" stroke="'+col+'" stroke-width="'+((sel?2.8:2)/z)+'"'+(sel?'':' stroke-dasharray="'+(8/z)+' '+(5/z)+'"')+' stroke-linejoin="round" style="cursor:move"/>';
  (a.holes||[]).forEach(function(h){ if(h.length>=3) out+='<polygon points="'+P(h)+'" fill="none" stroke="#dc2626" stroke-width="'+(1.4/z)+'" stroke-dasharray="'+(5/z)+' '+(3/z)+'" style="pointer-events:none"/>'; });
  var mt=areaMetrics(a), c=polyCenter(pts), cx=c.x*VW, cy=c.y*VH;
  var l1=a.name||"พื้นที่", l2=mt?fmtNum(mt.net,2)+" ตร.ม.":"ยังไม่ตั้งสเกล";
  var fs=14/z, w=Math.max(l1.length,l2.length)*fs*0.6+18/z, h=fs*2.9;
  out+='<g data-aid="'+a.id+'" style="cursor:move"><rect x="'+(cx-w/2)+'" y="'+(cy-h/2)+'" width="'+w+'" height="'+h+'" rx="'+(5/z)+'" fill="#fff" fill-opacity="0.93" stroke="'+col+'" stroke-width="'+(1.2/z)+'"/>'
    +'<text x="'+cx+'" y="'+(cy-fs*0.22)+'" font-size="'+fs+'" font-weight="700" fill="'+col+'" text-anchor="middle" font-family="Sarabun, sans-serif">'+_hx(l1)+'</text>'
    +'<text x="'+cx+'" y="'+(cy+fs*0.98)+'" font-size="'+fs+'" font-weight="'+(mt?800:400)+'" fill="'+(mt?"#1d2229":"#b45309")+'" text-anchor="middle" font-family="Sarabun, sans-serif">'+_hx(l2)+'</text></g>';
  if(sel){
    pts.forEach(function(p,i){ out+='<rect data-aid="'+a.id+'" data-ahandle="v'+i+'" x="'+(p.x*VW-4.5/z)+'" y="'+(p.y*VH-4.5/z)+'" width="'+(9/z)+'" height="'+(9/z)+'" fill="#fff" stroke="'+col+'" stroke-width="'+(2/z)+'" style="cursor:crosshair"/>'; });
    (a.holes||[]).forEach(function(h,hi){ h.forEach(function(p,i){ out+='<rect data-aid="'+a.id+'" data-ahandle="h'+hi+'_'+i+'" x="'+(p.x*VW-4/z)+'" y="'+(p.y*VH-4/z)+'" width="'+(8/z)+'" height="'+(8/z)+'" fill="#fff" stroke="#dc2626" stroke-width="'+(1.8/z)+'" style="cursor:crosshair"/>'; }); });
  }
  return out;
}
/** วาดหมายเหตุ 1 ชิ้นเป็น SVG (พิกัด 0..1 → viewBox VW×VH) · z = ระดับซูม ใช้คงความหนาเส้น/จุดจับให้คงที่ */
function annotSvg(a, VW, VH, z, sel){
  if(a.kind==="area") return areaSvg(a, VW, VH, z, sel);
  var s=annotStyleOf(a), col=s.color, sw=s.sw/z, out="";
  var mid1="am1_"+a.id, mid2="am2_"+a.id;
  out+='<defs>'+annotMarker(mid1,s.a1,col,z)+annotMarker(mid2,s.a2,col,z)+'</defs>';
  var fw=(s.bold?700:400), fs=s.size/z, fi=(s.italic?' font-style="italic"':''), fu=(s.underline?' text-decoration="underline"':'');
  if(a.kind==="dim"){
    var x1=a.p1.x*VW, y1=a.p1.y*VH, x2=a.p2.x*VW, y2=a.p2.y*VH;
    var dx=x2-x1, dy=y2-y1, len=Math.hypot(dx,dy)||1, ux=dx/len, uy=dy/len, nx=-uy, ny=ux;
    var offPx=(a.off||0)*VW;                                   // เลื่อนเส้นบอกขนาดออกจากจุดที่วัด (แนวตั้งฉาก) แบบ Revit
    var q1x=x1+nx*offPx, q1y=y1+ny*offPx, q2x=x2+nx*offPx, q2y=y2+ny*offPx;   // ปลายของ "เส้นบอกขนาด" (ที่เลื่อนแล้ว)
    var lbl=dimLabel(a), tw=Math.max(18, lbl.length*fs*0.62), gap=tw/2+6/z;
    var ang=Math.atan2(dy,dx)*180/Math.PI; if(ang>90||ang<-90) ang+=180;   // กันตัวหนังสือกลับหัว
    var mx=(q1x+q2x)/2, my=(q1y+q2y)/2, ext=7/z, hasOff=Math.abs(offPx)>0.5;
    if(hasOff){
      // เส้นต่อ (extension) จากจุดที่วัดจริง → เลยเส้นบอกขนาดเล็กน้อย + จุดเล็กที่จุดวัด
      var dir=offPx>=0?1:-1, gpx=3/z;
      out+='<line x1="'+(x1+nx*gpx*dir)+'" y1="'+(y1+ny*gpx*dir)+'" x2="'+(q1x+nx*ext*dir)+'" y2="'+(q1y+ny*ext*dir)+'" stroke="'+col+'" stroke-width="'+(sw*0.7)+'"/>';
      out+='<line x1="'+(x2+nx*gpx*dir)+'" y1="'+(y2+ny*gpx*dir)+'" x2="'+(q2x+nx*ext*dir)+'" y2="'+(q2y+ny*ext*dir)+'" stroke="'+col+'" stroke-width="'+(sw*0.7)+'"/>';
      out+='<circle cx="'+x1+'" cy="'+y1+'" r="'+(2/z)+'" fill="'+col+'"/><circle cx="'+x2+'" cy="'+y2+'" r="'+(2/z)+'" fill="'+col+'"/>';
    }else{
      // ไม่เลื่อน → เส้นต่อสั้น ๆ ตั้งฉากที่ปลาย (แบบเดิม)
      out+='<line x1="'+(q1x+nx*ext)+'" y1="'+(q1y+ny*ext)+'" x2="'+(q1x-nx*ext)+'" y2="'+(q1y-ny*ext)+'" stroke="'+col+'" stroke-width="'+(sw*0.7)+'"/>';
      out+='<line x1="'+(q2x+nx*ext)+'" y1="'+(q2y+ny*ext)+'" x2="'+(q2x-nx*ext)+'" y2="'+(q2y-ny*ext)+'" stroke="'+col+'" stroke-width="'+(sw*0.7)+'"/>';
    }
    // เส้นวัดแบ่งครึ่ง เว้นช่องให้ตัวเลข (สไตล์ B) — ลูกศรชี้ออกทั้งสองข้าง
    var m1='" marker-start="url(#'+mid1+')"', m2='" marker-end="url(#'+mid2+')"';
    if(len>gap*2+8/z){
      out+='<line x1="'+q1x+'" y1="'+q1y+'" x2="'+(mx-ux*gap)+'" y2="'+(my-uy*gap)+'" stroke="'+col+'" stroke-width="'+sw+(s.a1!=="none"?m1:'"')+'/>';
      out+='<line x1="'+(mx+ux*gap)+'" y1="'+(my+uy*gap)+'" x2="'+q2x+'" y2="'+q2y+'" stroke="'+col+'" stroke-width="'+sw+(s.a2!=="none"?m2:'"')+'/>';
    }else{
      out+='<line x1="'+q1x+'" y1="'+q1y+'" x2="'+q2x+'" y2="'+q2y+'" stroke="'+col+'" stroke-width="'+sw+(s.a1!=="none"?m1:'"')+(s.a2!=="none"?' marker-end="url(#'+mid2+')"':'')+'/>';
    }
    // เส้นทึบโปร่งใสไว้กดเลือก/ลาก (อยู่บนเส้นบอกขนาดที่เลื่อนแล้ว)
    out+='<line data-aid="'+a.id+'" x1="'+q1x+'" y1="'+q1y+'" x2="'+q2x+'" y2="'+q2y+'" stroke="transparent" stroke-width="'+(14/z)+'" style="cursor:move"/>';
    if(lbl) out+='<text data-aid="'+a.id+'" x="'+mx+'" y="'+(my+fs*0.36)+'" transform="rotate('+ang.toFixed(2)+' '+mx+' '+my+')" font-size="'+fs+'" font-weight="'+fw+'"'+fi+fu+' font-family="'+_hx(s.font)+', sans-serif" fill="'+col+'" text-anchor="middle" style="cursor:move">'+_hx(lbl)+'</text>';
    if(sel){
      out+='<line x1="'+q1x+'" y1="'+q1y+'" x2="'+q2x+'" y2="'+q2y+'" stroke="#2b6fe0" stroke-width="'+(1.2/z)+'" stroke-dasharray="'+(5/z)+' '+(4/z)+'" style="pointer-events:none"/>';
      [["p1",x1,y1],["p2",x2,y2]].forEach(function(p){
        out+='<rect data-aid="'+a.id+'" data-ahandle="'+p[0]+'" x="'+(p[1]-4.5/z)+'" y="'+(p[2]-4.5/z)+'" width="'+(9/z)+'" height="'+(9/z)+'" fill="#fff" stroke="#ef4444" stroke-width="'+(2/z)+'" style="cursor:crosshair"/>';
      });
      // จุดจับเลื่อนแนว (offset) — กลางเส้น เยื้องตั้งฉากออกเล็กน้อยให้อยู่ติดตัวเลข ไม่ทับ
      var _gd=(offPx>=0?1:-1), _gg=(fs*0.95+3/z);
      var gx=mx+nx*_gg*_gd, gy=my+ny*_gg*_gd;
      out+='<circle data-aid="'+a.id+'" data-ahandle="off" cx="'+gx+'" cy="'+gy+'" r="'+(5.5/z)+'" fill="#2b6fe0" stroke="#fff" stroke-width="'+(2/z)+'" style="cursor:move"><title>ลากเพื่อเลื่อนเส้นบอกขนาดเข้า/ออกจากแนวที่วัด</title></circle>';
    }
    return out;
  }
  // ---- callout ----
  var bx=Math.min(a.box.x1,a.box.x2)*VW, by=Math.min(a.box.y1,a.box.y2)*VH;
  var bw=Math.abs(a.box.x2-a.box.x1)*VW, bh=Math.abs(a.box.y2-a.box.y1)*VH;
  var tx=a.tip.x*VW, ty=a.tip.y*VH;
  // จุดบนขอบกล่องที่ใกล้ปลายลูกศรที่สุด → เส้นชี้ตรง (สไตล์ B)
  var cx=bx+bw/2, cy=by+bh/2;
  var ex=Math.max(bx, Math.min(bx+bw, tx)), ey=Math.max(by, Math.min(by+bh, ty));
  if(tx<bx) ex=bx; else if(tx>bx+bw) ex=bx+bw; else ex=Math.max(bx,Math.min(bx+bw,tx));
  if(ty<by) ey=by; else if(ty>by+bh) ey=by+bh; else ey=Math.max(by,Math.min(by+bh,ty));
  if(tx>=bx&&tx<=bx+bw&&ty>=by&&ty<=by+bh){ ex=cx; ey=by+bh; }
  out+='<line x1="'+tx+'" y1="'+ty+'" x2="'+ex+'" y2="'+ey+'" stroke="'+col+'" stroke-width="'+sw+'"'+(s.a1!=="none"?' marker-start="url(#'+mid1+')"':'')+(s.a2!=="none"?' marker-end="url(#'+mid2+')"':'')+'/>';
  out+='<rect data-aid="'+a.id+'" x="'+bx+'" y="'+by+'" width="'+bw+'" height="'+bh+'" rx="'+(s.radius/z)+'" fill="'+s.fill+'" fill-opacity="'+s.fillA+'" stroke="'+col+'" stroke-width="'+sw+'" style="cursor:move"/>';
  // ข้อความในกล่อง — ตัดบรรทัดตามตัวขึ้นบรรทัดใหม่ที่ผู้ใช้พิมพ์
  var lines=String(a.text||"").split("\n"), lh=fs*1.35, pad=7/z;
  lines.forEach(function(ln,i){
    out+='<text data-aid="'+a.id+'" x="'+(bx+pad)+'" y="'+(by+pad+fs*0.92+i*lh)+'" font-size="'+fs+'" font-weight="'+(i===0?fw:400)+'"'+fi+fu+' font-family="'+_hx(s.font)+', sans-serif" fill="'+(i===0?col:"#475569")+'" style="cursor:move">'+_hx(ln)+'</text>';
  });
  if(sel){
    out+='<rect x="'+(bx-3/z)+'" y="'+(by-3/z)+'" width="'+(bw+6/z)+'" height="'+(bh+6/z)+'" fill="none" stroke="#2b6fe0" stroke-width="'+(1.2/z)+'" stroke-dasharray="'+(5/z)+' '+(4/z)+'" style="pointer-events:none"/>';
    out+='<rect data-aid="'+a.id+'" data-ahandle="tip" x="'+(tx-5/z)+'" y="'+(ty-5/z)+'" width="'+(10/z)+'" height="'+(10/z)+'" fill="#fff" stroke="#ef4444" stroke-width="'+(2.2/z)+'" style="cursor:crosshair"/>';
    [["nw",bx,by],["ne",bx+bw,by],["sw",bx,by+bh],["se",bx+bw,by+bh]].forEach(function(p){
      out+='<rect data-aid="'+a.id+'" data-ahandle="'+p[0]+'" x="'+(p[1]-4.5/z)+'" y="'+(p[2]-4.5/z)+'" width="'+(9/z)+'" height="'+(9/z)+'" fill="#fff" stroke="#2b6fe0" stroke-width="'+(2/z)+'" style="cursor:nwse-resize"/>';
    });
  }
  return out;
}
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
  // ── พื้นที่ที่วัด (ชั้นล่างสุด — ไม่บังการคลิกชิ้นส่วนที่อยู่ข้างใน) ──
  var _za=state.zoom||1;
  areasOfPlan(f.id,_pid).forEach(function(a){ shapes+=areaSvg(a, VW, VH, _za, a.id===state.selAnnotId); });
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
      }else if(zp.kind==="oval"){
        shapes+='<ellipse data-zid="'+z.id+'" cx="'+(zx+zw/2)+'" cy="'+(zy+zh/2)+'" rx="'+(zw/2)+'" ry="'+(zh/2)+'" fill="'+col+'" fill-opacity="'+fillOp+'" stroke="none" style="cursor:'+cur+'"/>';
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
    var msel=!sel && (state.selMulti||[]).indexOf(m.id)>=0, hi=sel||msel;   // hi = อยู่ในชุดที่เลือก (เส้นประ) · sel = ตัวหลัก (มีจุดจับ)
    // โหมดรวม: ชนิดที่ไม่ได้กำลังวาด/เลือก ทำให้จางลงนิด เพื่อให้ชนิดที่โฟกัสเด่น (เลือกไว้ = เด่นเสมอ)
    var dim=(state.unified && !hi && state.catType && m.type!==state.catType)
         || (!!state.statusFilter && !hi && memberStatus(m)!==state.statusFilter);   // กรองจากแถบสถานะ → ตัวที่ไม่ตรงจางลง
    var sw=sel?16:(msel?13:11), op=hi?1:(dim?0.5:0.92);
    var lx, ly;   // จุดวางป้ายเบอร์
    if(pl.kind==="line"){
      if(hi) shapes+='<line x1="'+(pl.x1*VW)+'" y1="'+(pl.y1*VH)+'" x2="'+(pl.x2*VW)+'" y2="'+(pl.y2*VH)
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
        +(hi?'<rect x="'+(x-(msel?4/z:0))+'" y="'+(y-(msel?4/z:0))+'" width="'+(w+(msel?8/z:0))+'" height="'+(ht+(msel?8/z:0))+'" fill="'+(msel?"var(--brand)":"none")+'" fill-opacity="0.08" stroke="var(--brand)" stroke-width="'+((msel?3:2)/z)+'" stroke-dasharray="'+(6/z)+' '+(4/z)+'" style="pointer-events:none"/>':'')
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
      if(hi) shapes+='<circle cx="'+(pl.x*VW)+'" cy="'+(pl.y*VH)+'" r="'+(r+16)+'" fill="var(--brand)" opacity="0.25"/>';
      shapes+='<circle data-mid="'+m.id+'" cx="'+(pl.x*VW)+'" cy="'+(pl.y*VH)+'" r="'+r+'" fill="'+col+'" stroke="#fff" stroke-width="6"/>';
      lx=pl.x*VW; ly=pl.y*VH;
    }
    if(state.showLabels){
      var _lst=state.labelStyle||{}, _lfs=(+_lst.size||22), _lfont=(pl.labelFont||_lst.font||"JetBrains Mono"), _ltc=(pl.labelColor||_lst.color||"var(--text)");
      var labTxt=(pl.labelText!=null && pl.labelText!=="")?pl.labelText:m.code;
      var tw=Math.max(_lfs+12, labTxt.length*_lfs*0.66+16), th=_lfs+12;
      var lcx=lx+(pl.labelDx||0)*VW, lcy=ly+(pl.labelDy||0)*VH, lsc=pl.labelScale||1;
      var moved=(pl.labelDx||0)!==0 || (pl.labelDy||0)!==0;
      // เส้นชี้จากกล่องเบอร์ → ตัวคาน (เมื่อย้ายกล่องออกไป)
      if(moved) shapes+='<line x1="'+lcx.toFixed(1)+'" y1="'+lcy.toFixed(1)+'" x2="'+lx.toFixed(1)+'" y2="'+ly.toFixed(1)+'" stroke="'+col+'" stroke-width="'+(1.5/(state.zoom||1))+'" stroke-dasharray="'+(5/(state.zoom||1))+' '+(4/(state.zoom||1))+'" style="pointer-events:none"/>';
      var _lz=(1/(state.zoom||1))*lsc;   // ฝัง counter-scale ตั้งแต่เรนเดอร์ → ป้ายขนาดคงที่บนจอทันที ไม่รอ updateLabelScale
      var g2='<g class="plan-label" data-lbl="'+m.id+'" data-ax="'+lcx.toFixed(1)+'" data-ay="'+lcy.toFixed(1)+'" data-ls="'+lsc+'" transform="translate('+lcx.toFixed(1)+' '+lcy.toFixed(1)+') scale('+_lz.toFixed(4)+') translate('+(-lcx).toFixed(1)+' '+(-lcy).toFixed(1)+')" style="cursor:move">'
        +'<rect x="'+(lcx-tw/2)+'" y="'+(lcy-th/2)+'" width="'+tw+'" height="'+th+'" rx="7" fill="var(--surface)" stroke="'+col+'" stroke-width="2.5"/>'
        +'<text x="'+lcx+'" y="'+lcy+'" dominant-baseline="central" text-anchor="middle" font-size="'+_lfs+'" font-weight="700" '
        +'fill="'+_ltc+'" font-family="'+esc(_lfont)+', monospace">'+esc(labTxt)+'</text>';
      if(sel) g2+='<circle data-lblsize="'+m.id+'" cx="'+(lcx+tw/2)+'" cy="'+(lcy+th/2)+'" r="7" fill="var(--brand)" stroke="#fff" stroke-width="2" style="cursor:nwse-resize"/>';
      shapes+=g2+'</g>';
    }
  });
  // ── หมายเหตุ (กล่องข้อความ + เส้นบอกขนาด) — วาดบนสุดเสมอ ทั้งสองโหมด ──
  var _z=state.zoom||1;
  annotsOfPlan(f.id,_pid).forEach(function(a){ if(a.kind!=="area") shapes+=annotSvg(a, VW, VH, _z, a.id===state.selAnnotId); });
  return shapes;
}

/* ---- ย้อนกลับ/ทำซ้ำ บนแปลน — สแนปช็อตชิ้นส่วน+โซนของชั้นที่เปิดอยู่ (เป็น JSON) ---- */
var PL_UNDO={}, PL_REDO={}, PL_UNDO_MAX=40, _plPend=null;
function plSnap(){
  var fid=state.floorId; if(!fid) return null;
  try{
    return JSON.stringify({
      m:DB.members.filter(function(x){ return x.floorId===fid; }),
      z:(DB.zones||[]).filter(function(x){ return x.floorId===fid; }),
      a:(DB.annots||[]).filter(function(x){ return x.floorId===fid; })
    });
  }catch(e){ return null; }
}
function plPushJson(j){
  var fid=state.floorId; if(!fid||j==null) return;
  var st=PL_UNDO[fid]||(PL_UNDO[fid]=[]);
  if(st.length && st[st.length-1]===j) return;
  st.push(j); if(st.length>PL_UNDO_MAX) st.shift();
  PL_REDO[fid]=[];
  plSyncUndoBtns();
}
/** เรียกก่อนทุกการแก้ไขที่เกิดทันที (วาด/ลบ/ทำซ้ำ/ซ่อน/สี/โซน) */
function plPushUndo(){ plPushJson(plSnap()); }
/** การลาก: เก็บสภาพไว้ตอนกด แล้วยืนยันตอนปล่อยเฉพาะเมื่อมีการเปลี่ยนจริง */
function plCommitPend(){ if(_plPend){ plPushJson(_plPend); _plPend=null; } }
/* คืนค่าโดยแก้ในที่เดิมทีละ id — ไม่สร้าง array ใหม่ ระบบ sync คลาวด์ยังจับ object เดิมได้ */
function plRestore(j){
  var fid=state.floorId; if(!fid) return false;
  var snap; try{ snap=JSON.parse(j); }catch(e){ return false; }
  function merge(arr, want){
    var keep={}; want.forEach(function(w){ keep[w.id]=w; });
    for(var i=arr.length-1;i>=0;i--){ var x=arr[i]; if(x.floorId!==fid) continue; if(!keep[x.id]) arr.splice(i,1); }
    var have={}; arr.forEach(function(x){ have[x.id]=x; });
    want.forEach(function(w){
      var ex=have[w.id];
      if(ex){ var _doc=ex.doc; Object.keys(ex).forEach(function(k){ delete ex[k]; }); Object.assign(ex,w); if(_doc!==undefined) ex.doc=_doc; else delete ex.doc; }   // ไม่ย้อนงานในชีตรายละเอียด
      else arr.push(w);
    });
  }
  merge(DB.members, snap.m||[]);
  if(!DB.zones) DB.zones=[];
  merge(DB.zones, snap.z||[]);
  if(!DB.annots) DB.annots=[];
  merge(DB.annots, snap.a||[]);
  if(state.selMemberId && !getMember(state.selMemberId)) state.selMemberId=null;
  if(state.selZoneId && !getZone(state.selZoneId)) state.selZoneId=null;
  if(state.selAnnotId && !getAnnot(state.selAnnotId)) state.selAnnotId=null;
  return true;
}
function plUndo(){
  var fid=state.floorId, st=PL_UNDO[fid];
  if(!st||!st.length){ toast("ไม่มีอะไรให้ย้อนกลับ"); return; }
  var cur=plSnap(); if(!plRestore(st.pop())) return;
  if(cur!=null) (PL_REDO[fid]||(PL_REDO[fid]=[])).push(cur);
  saveDB(); render(); toast("ย้อนกลับแล้ว");
}
function plRedo(){
  var fid=state.floorId, st=PL_REDO[fid];
  if(!st||!st.length){ toast("ไม่มีอะไรให้ทำซ้ำ"); return; }
  var cur=plSnap(); if(!plRestore(st.pop())) return;
  if(cur!=null) (PL_UNDO[fid]||(PL_UNDO[fid]=[])).push(cur);
  saveDB(); render(); toast("ทำซ้ำแล้ว");
}
function plSyncUndoBtns(){
  var fid=state.floorId;
  var u=document.querySelector('[data-act="planUndo"]'), r=document.querySelector('[data-act="planRedo"]');
  if(u) u.disabled=!(PL_UNDO[fid]||[]).length;
  if(r) r.disabled=!(PL_REDO[fid]||[]).length;
}
/** สถานะตรวจของชิ้นส่วน → "pass" | "fail" | "todo" (ใช้กรองบนแถบสถานะ) */
function memberStatus(m){ var ins=lastInspection(m.id); return !ins ? "todo" : (ins.status==="pass" ? "pass" : "fail"); }
/** ซูมไปหาชิ้นส่วนบนแปลน (ให้อยู่กลางจอ ขนาดพอเห็นชัด) */
/** วาดรูปทรงบนแปลนใหม่โดยไม่ render ทั้งหน้า (ใช้ตอนพิมพ์/ลากแถบสีในแผงรูปแบบ) */
function repaintPlanShapes(){
  var ov=document.getElementById("planOverlay"); if(!ov) return;
  ov.innerHTML=planShapesSVG(+ov.getAttribute("data-vw"), +ov.getAttribute("data-vh"));
  updateLabelScale();
}
function planZoomToMember(id){
  var m=getMember(id); if(!m||!m.plan) return;
  var sz=_sheetWH(); if(!sz||!sz.w) return;
  var pl=m.plan, x1,y1,x2,y2;
  if(pl.kind==="point"){ x1=x2=pl.x||0.5; y1=y2=pl.y||0.5; }
  else { x1=Math.min(pl.x1,pl.x2); x2=Math.max(pl.x1,pl.x2); y1=Math.min(pl.y1,pl.y2); y2=Math.max(pl.y1,pl.y2); }
  var bw=Math.max(0.02,(x2-x1))*sz.w, bh=Math.max(0.02,(y2-y1))*sz.h;
  var z=Math.max(1, Math.min(planMaxZoom(), Math.min(sz.W/(bw*2.6), sz.H/(bh*2.6))));
  var cx=(x1+x2)/2*sz.w, cy=(y1+y2)/2*sz.h;   // จุดกึ่งกลางชิ้น (พิกัดแผ่น) → วางกลางกรอบ
  state.zoom=z; state.panX=sz.W/2-cx*z; state.panY=sz.H/2-cy*z;
  planClampPan(); planApplyTransform(); scheduleEnsure();
}
/** ค้นหาเบอร์บนแปลนที่เปิดอยู่ → เลือก + ซูมไปหา */
function planSearch(q){
  q=String(q||"").trim().toLowerCase(); if(!q) return;
  var f=getFloor(state.floorId); if(!f) return;
  var pid=curPlanId();
  var hits=membersOfFloor(f.id).filter(function(m){ return m.plan && memberPlanId(m)===pid && (String(m.code).toLowerCase().indexOf(q)>=0 || String(m.name||"").toLowerCase().indexOf(q)>=0); });
  if(!hits.length){ toast('ไม่พบ "'+q+'" บนแปลนนี้',true); return; }
  var exact=hits.filter(function(m){ return String(m.code).toLowerCase()===q; })[0]||hits[0];
  if(state.hiddenTypes && state.hiddenTypes[exact.type]) delete state.hiddenTypes[exact.type];
  exact.hidden=false;
  state.selMemberId=exact.id; state.memberId=exact.id; state.selZoneId=null; state.mSheet=null; state.mSheetMin=false;
  if(state.rightTab!=="inspect") state.rightTab="props";
  render();
  planZoomToMember(exact.id);
  var q2=$("#planSearch"); if(q2){ q2.value=q; }
  if(hits.length>1) toast("พบ "+hits.length+" รายการ — แสดง "+exact.code);
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
  var drawing = (state.tool==="draw" || state.tool==="drawZone" || state.tool==="drawCallout" || state.tool==="drawDim" || state.tool==="setScale" || state.tool==="drawArea" || state.tool==="drawHole");

  // แถบมินิเมนูตอนเลือกชิ้นส่วน (ลอยบนกรอบ) — เฉพาะหน้าแก้ไขแปลน
  var _selM=isProgress ? null : getMember(state.selMemberId); if(_selM && !state.unified && _selM.type!==type) _selM=null;
  if(selIds().length>1) _selM=null;
  var selbar = _selM ? '<div class="plan-selbar">'
    + chipHtml(_selM.code,TYPES[_selM.type].css)
    + '<button data-act="goInspect" title="ตรวจเหล็ก"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/></svg> <span class="lb">ตรวจเหล็ก</span></button>'
    + '<button data-act="showDetails" title="รายละเอียด"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 15 5-5 4 4 3-3 6 6"/><circle cx="9" cy="9" r="1.6"/></svg> <span class="lb">รายละเอียด</span></button>'
    + '<button data-act="assignSheet" title="ใส่ค่าจากเทมเพลต"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg> <span class="lb">Assign</span></button>'
    + '<button data-act="dupMember" data-id="'+esc(_selM.id)+'" title="ทำซ้ำ"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg> <span class="lb">ทำซ้ำ</span></button>'
    + '<button class="danger" data-act="delMember" title="ลบ"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/></svg></button>'
    + '</div>' : '';

  var _ar=(plan&&plan.w&&plan.h)?(plan.w/plan.h):(100/72);
  // --plan-ar ให้ CSS มือถือคำนวณความกว้างจากความสูงที่เหลือ โดยคงสัดส่วนเดิม (overlay ต้องทับรูปพอดี ห้ามยืด)
  // กรอบ = viewport เต็มพื้นที่ (ไม่ล็อกสัดส่วน) · แผ่นแปลนข้างในคงสัดส่วนด้วย --plan-ar (คำนวณใน _sheetWH)
  return '<div class="plan-stage'+(drawing?" is-draw":"")+(plan?"":" no-plan")+'" id="planStage" style="--plan-ar:'+_ar.toFixed(4)+'">'
       + '<div class="plan-canvas" id="planCanvas">'+bg+'</div>'
       // เลเยอร์ความคม + ไฮไลท์ อยู่ "นอก" canvas ที่ถูกซูม → บน iOS ภาพคมไม่โดน CSS transform ขยายจนเบลอ
       +   '<img class="plan-detail" id="planDetail" alt="" draggable="false" style="display:none">'
       +   '<svg class="plan-overlay" id="planOverlay" viewBox="0 0 '+VW+' '+VH+'" '
       +     'data-vw="'+VW+'" data-vh="'+VH+'" preserveAspectRatio="none">'+shapes+'</svg>'
       + selbar
       + (!isProgress && state.showLegend ? legendHtml(members) : '')
       + (isProgress
            ? (zonesOfPlan(f.id,_pid2).length===0 && !drawing ? '<div class="plan-hint">ยังไม่มีโซนเท — กด “วาดโซนใหม่” แล้วลากคลุมพื้นที่บนแปลน</div>' : '')
            : (members.length===0 && !drawing ? '<div class="plan-hint">'+(state.unified?'ยังไม่มีชิ้นส่วนในแปลน — เลือกชนิดแล้วกด “วาด” ลากบนแปลน':'ยังไม่มี'+esc(TYPES[type].label)+'ในแปลน — กด “วาด'+esc(TYPES[type].label)+'” แล้วลากบนแปลน')+'</div>' : ''))
       + '</div>';
}
function _planDbg(){}   // (ปิดตัวบอกสถานะดีบั๊กแล้ว)
/** ตารางสี (Legend) บนแปลน — จัดกลุ่มคานตามสีกรอบ → "สีนี้ = คานเบอร์ไหน" */
function legendHtml(members){
  if(state.colorMode==="type"){   // โหมดสีตามประเภท → ตารางสี = รายชื่อประเภท
    var tl=typesOf(state.projectId), rowsT=tl.map(function(t){ return '<div class="lg-row"><span class="lg-sw" style="background:'+esc(t.color||"#2563eb")+'"></span><span class="lg-tx">'+esc(t.name)+' ('+typeMembers(t.id).length+')</span></div>'; }).join("")
      +'<div class="lg-row"><span class="lg-sw" style="background:#94a3b8"></span><span class="lg-tx">ไม่มีประเภท</span></div>';
    return '<div class="plan-legend" id="planLegend"><div class="lg-head">ประเภท</div><div class="lg-body">'+rowsT+'</div></div>';
  }
  var groups={}, order=[];
  members.forEach(function(m){
    if(!m.plan) return;
    var c=(m.plan.fill||"#f59e0b").toLowerCase();
    if(!groups[c]){ groups[c]=[]; order.push(c); }
    if(groups[c].indexOf(m.code)<0) groups[c].push(m.code);
  });
  var rows=order.length ? order.map(function(c){
    return '<div class="lg-row"><span class="lg-sw" style="background:'+esc(c)+'"></span><span class="lg-tx">'+esc(groups[c].join(", "))+'</span></div>';
  }).join("") : '<div class="lg-row"><span class="tiny muted">ยังไม่มีคานบนแปลน</span></div>';
  // ตรึงมุมขวาล่างของแปลน (ไม่ลาก) — เปิด/ปิดจากแท็บ "คุณสมบัติ"
  return '<div class="plan-legend" id="planLegend"><div class="lg-head">ตารางสี</div><div class="lg-body">'+rows+'</div></div>';
}

/** หน้าจอรายละเอียดเต็ม (เปิดจากปุ่ม "รายละเอียด") — หน้าตัดทุกสถานี + span + สเปก จัดสองคอลัมน์ */
function viewMemberDetail(){
  var m=getMember(state.memberId) || getMember(state.selMemberId);
  if(!m) return emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/></svg>',"ไม่พบชิ้นส่วน","");
  var p=getProject(m.projectId), f=getFloor(m.floorId), t=memberTypeOf(m);
  var sib=t ? typeMembers(t.id).slice().sort(function(a,b){ return String(a.code).localeCompare(String(b.code)); }) : [m];
  if(isMobile()) return viewMemberDetailMobile(m,p,f,t,sib);
  return '<div class="rv de-rv'+(state.deSideOff?" side-off":"")+'" id="editorGrid" style="--rp-w:252px">'
    + deQatHtml(p,f,m,t) + deRibbonHtml(m,t)
    + '<input type="file" id="deFile" accept="image/*,application/pdf,.pdf" multiple hidden><input type="file" id="deCam" accept="image/*" capture="environment" hidden>'
    + '<div class="rv-body"><div class="rv-side">'+dePaletteHtml(m,t)+'</div><div class="rp-splitter" id="rpSplitter"></div>'
    + '<div class="rv-main">'+deViewTabsHtml(sib,m,t)+'<div class="de-vp" id="deVp">'+(state.deLibOpen?deLibFlyHtml():'')+deSheetHtml(m)+'</div>'+deStatusHtml(m,t)+'</div></div></div>';
}
/** เปิดหน้ารายละเอียดของชิ้นที่เลือกอยู่ — รีเซ็ตซูม (พอดีจอ) และการเลือก */
function deOpen(){ state.deZoom=null; state.deScroll=null; state.deSel=null; state.deSelMulti=[]; state.deLibOpen=false; state.deTool="select"; state.deCrop=null; state.mSheet=null; state.mSheetMin=false; go("memberDetail"); }

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
function memberDoc(m){
  var t=memberTypeOf(m); if(t) return typeDoc(t);   // ผูกประเภทอยู่ → ใช้แผ่นของประเภท (ร่วมกันทุกชิ้น)
  if(!m.doc || !Array.isArray(m.doc.els)) m.doc={els:[]}; return m.doc;
}
function deUid(){ return uid("de"); }

/* ---- แคช/โหลดสื่อจาก IndexedDB (m.doc เก็บแค่ layout เล็ก ๆ — สื่ออยู่ใน IDB) ---- */
var DE_PDF={};   // eid -> {page, pageNo, raster:{w,url}}
var DE_IMG={};   // eid -> dataURL
function deImgEl(id){ return document.querySelector('#deCanvas .de-img[data-eid="'+id+'"]'); }
/* ---- sync สื่อในหน้ารายละเอียดขึ้นคลาวด์ (ใช้ระบบ chunk เดียวกับแปลน) เพื่อให้เห็นข้ามเครื่อง ---- */
var DE_CLOUD_DONE={};   // กันอัปซ้ำในเซสชันเดียว (id -> true)
function deCloudSaveImg(id, dataUrl){
  if(!CLOUD || !_fbUser) return;
  var m=/^data:([^;]+);base64,(.*)$/.exec(dataUrl||''); if(!m) return;
  DE_CLOUD_DONE['de_img_'+id]=true;
  try{ cloudUploadPlan('de_img_'+id, _b64ToBytes(m[2]), {kind:m[1]}).then(function(ok){ if(ok) toast("รูปขึ้นคลาวด์แล้ว — เปิดดูในมือถือได้"); }); }catch(e){}
}
function deCloudSavePdf(id, buf, pageNo){
  if(!CLOUD || !_fbUser) return;
  DE_CLOUD_DONE['de_pdf_'+id]=true;
  try{ cloudUploadPlan('de_pdf_'+id, buf, {kind:'pdf', pageNo:pageNo||1}); }catch(e){}
}
/** เติมสื่อที่มีในเครื่องนี้แต่ยังไม่เคยขึ้นคลาวด์ (แก้รูปเก่าที่อัปก่อนมีระบบ sync) — อัปครั้งเดียวต่อเซสชัน */
function deCloudBackfillImg(id, dataUrl){ if(!DE_CLOUD_DONE['de_img_'+id]) deCloudSaveImg(id, dataUrl); }
function deCloudBackfillPdf(id, buf, pageNo){ if(!DE_CLOUD_DONE['de_pdf_'+id]) deCloudSavePdf(id, buf, pageNo); }
/** ข้อความสถานะในกรอบรูป (กำลังโหลด / ไม่พบในคลาวด์ / โหลดไม่สำเร็จ) — null = เอาออก */
function deImgNote(id, txt){
  var host=document.querySelector('#deCanvas .de-el[data-eid="'+id+'"]'); if(!host) return;
  var n=host.querySelector('.de-imgnote');
  if(!txt){ if(n) n.remove(); return; }
  if(!n){ n=document.createElement('div'); n.className='de-imgnote'; host.appendChild(n); }
  n.textContent=txt;
}
var DE_LOADING={};   // eid -> กำลังดึงจากคลาวด์อยู่ (กัน render ซ้ำแล้วยิงหลายสาย)
function deLoadImage(elm, attempt){
  var img=deImgEl(elm.id); if(!img) return;
  if(DE_IMG[elm.id]){ deSetImgSrc(elm, DE_IMG[elm.id]); deImgNote(elm.id,null); return; }
  attempt=attempt||0;
  if(!attempt && DE_LOADING[elm.id]) return;
  DE_LOADING[elm.id]=true;
  // IndexedDB ใช้ไม่ได้ (เช่น Safari โหมดส่วนตัว) → ถือว่าไม่มีในเครื่อง แล้วไปดึงคลาวด์ต่อ ไม่หยุดแค่นี้
  idbGet('deimg_'+elm.id).catch(function(){ return null; }).then(function(url){
    if(url){ DE_IMG[elm.id]=url; deSetImgSrc(elm, url); deImgNote(elm.id,null); delete DE_LOADING[elm.id]; deCloudBackfillImg(elm.id, url); return; }
    if(!CLOUD){ deImgNote(elm.id,'รูปนี้อยู่ในเครื่องอื่น (โหมดออฟไลน์)'); delete DE_LOADING[elm.id]; return; }
    // ไม่มีในเครื่อง → ดึงจากคลาวด์ (อัปมาจากอีกเครื่อง) แล้วแคชลงเครื่อง
    deImgNote(elm.id, attempt?'รอรูปจากคลาวด์… ('+(attempt+1)+'/4)':'กำลังโหลดรูปจากคลาวด์…');
    return cloudFetchPlan('de_img_'+elm.id).then(function(rec){
      if(rec && rec.bytes){
        var mime=(rec.kind && rec.kind.indexOf('/')>0)?rec.kind:'image/jpeg';
        var durl='data:'+mime+';base64,'+_bytesToB64(new Uint8Array(rec.bytes));
        DE_IMG[elm.id]=durl; idbPut('deimg_'+elm.id,durl).catch(function(){});
        deSetImgSrc(elm, durl); deImgNote(elm.id,null); delete DE_LOADING[elm.id]; return;
      }
      // ยังไม่มี / อัปจากอีกเครื่องยังไม่ครบ → ลองใหม่อีก 3 ครั้ง ห่างกัน 5 วิ
      if(attempt<3){ setTimeout(function(){ if(!DE_IMG[elm.id] && deImgEl(elm.id)) deLoadImage(elm, attempt+1); },5000); return; }
      var err=CLOUD_FETCH_ERR['de_img_'+elm.id]; delete DE_LOADING[elm.id];
      deImgNote(elm.id, err ? 'โหลดรูปจากคลาวด์ไม่สำเร็จ: '+(err.code||err.message||err)
                            : 'ยังไม่มีรูปนี้ในคลาวด์ — เปิดหน้ารายละเอียดนี้ในเครื่องที่ใส่รูป แล้วรอให้ขึ้นข้อความ “อัปแปลนขึ้นคลาวด์แล้ว” ก่อน');
    });
  }).catch(function(e){ delete DE_LOADING[elm.id]; deImgNote(elm.id,'โหลดรูปไม่สำเร็จ: '+(e&&(e.code||e.message)||e)); });
}
function deEnsurePage(elm){
  var rec=DE_PDF[elm.id];
  if(rec && rec.page) return Promise.resolve(rec.page);
  return idbGet('depdf_'+elm.id).then(function(v){
    if(v && v.bytes){ deCloudBackfillPdf(elm.id, v.bytes, v.pageNo||elm.pageNo||1); return v; }
    // ไม่มีในเครื่อง → ดึงจากคลาวด์ แล้วแคชลงเครื่อง
    return cloudFetchPlan('de_pdf_'+elm.id).then(function(cf){
      if(!cf||!cf.bytes) return null;
      var rr={bytes:cf.bytes, pageNo:cf.pageNo||elm.pageNo||1};
      idbPut('depdf_'+elm.id, rr).catch(function(){});
      return rr;
    });
  }).then(function(v){
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
  if(rec && rec.raster){ deSetImgSrc(elm, rec.raster.url); if(rec.raster.w>=need*0.9) return; }  // แสดงของเดิมก่อน แล้วอัปเกรด
  deEnsurePage(elm).then(function(pg){
    renderPdfToCanvas(pg, need).then(function(cv){
      var url; try{ url=cv.toDataURL('image/jpeg',0.93); }catch(e){ return; }
      DE_PDF[elm.id]=Object.assign(DE_PDF[elm.id]||{},{raster:{w:need,url:url}});
      deSetImgSrc(elm, url);
    }).catch(function(){});
  }).catch(function(){});
}
/* ===== G1 · ไกด์อัจฉริยะ (smart guides) — ลากแล้วสแนปเข้าขอบ/กึ่งกลางชิ้นอื่น · กึ่งกลางกระดาษ · ระยะห่างเท่ากัน · กริด ===== */
var DE_GUIDES={el:true,page:true,gap:true,grid:false,gridSize:10};
(function(){ try{ var g=JSON.parse(localStorage.getItem("rebarcheck.deGuides")||"null"); if(g&&typeof g==="object") Object.assign(DE_GUIDES,g); }catch(e){} })();
function deGuidesSave(){ try{ localStorage.setItem("rebarcheck.deGuides",JSON.stringify(DE_GUIDES)); }catch(e){} }
function deGuidesOn(){ return !!(DE_GUIDES.el||DE_GUIDES.page||DE_GUIDES.gap); }
/**
 * คำนวณสแนปของกล่องที่กำลังลาก (พิกัดแผ่น)
 * box={L,T,R,B} · others=[{x,y,w,h}] · page={w,h} · z=ซูม
 * คืน {sx,sy,lines:[{v,x,y1,y2}|{h,y,x1,x2}],gaps:[{axis,a,b,at,val}],tip:[]}
 */
function deSmartSnap(box, others, page, z, alt){
  var th=7/(z||1), res={sx:0,sy:0,lines:[],gaps:[],tip:[]};
  if(alt) return res;
  var W=box.R-box.L, H=box.B-box.T;
  var pi=Math.max(0,Math.floor(((box.T+box.B)/2)/page.h));   // หน้าที่กล่องอยู่
  // ---- แกน x / y ทำด้วยโค้ดเดียวกัน (สลับพิกัด) ----
  function axisSnap(ax){
    var lo=ax==='x'?box.L:box.T, hi=ax==='x'?box.R:box.B, mid=(lo+hi)/2, sz=hi-lo;
    var clo=ax==='x'?box.T:box.L, chi=ax==='x'?box.B:box.R;       // ช่วงแกนตั้งฉาก (ใช้วาดเส้น + เช็คซ้อน)
    var best=null;
    function consider(target,mine,kind,o){ var d=target-mine; if(Math.abs(d)<th && (!best||Math.abs(d)<Math.abs(best.d))) best={d:d,at:target,kind:kind,o:o}; }
    if(DE_GUIDES.el) others.forEach(function(o){
      var ol=ax==='x'?o.x:o.y, oh=ol+(ax==='x'?o.w:o.h), om=(ol+oh)/2;
      consider(ol,lo,'ขอบ',o); consider(oh,hi,'ขอบ',o); consider(ol,hi,'ขอบ',o); consider(oh,lo,'ขอบ',o); consider(om,mid,'กึ่งกลาง',o);
    });
    if(DE_GUIDES.page){
      var P=ax==='x'?{s:0,e:page.w}:{s:page.h*pi,e:page.h*(pi+1)};
      consider((P.s+P.e)/2,mid,'กึ่งกลางกระดาษ',null);
    }
    var out={s:0,line:null,gapSnap:null,label:null};
    if(best){
      out.s=best.d; out.label=best.kind;
      var o=best.o, c1=clo, c2=chi;
      if(o){ var ocl=ax==='x'?o.y:o.x, och=ocl+(ax==='x'?o.h:o.w); c1=Math.min(c1,ocl); c2=Math.max(c2,och); }
      else { c1=ax==='x'?page.h*pi:0; c2=ax==='x'?page.h*(pi+1):page.w; }
      out.line=ax==='x'?{v:1,x:best.at,y1:c1-8,y2:c2+8}:{h:1,y:best.at,x1:c1-8,x2:c2+8};
    }
    // ---- ระยะห่างเท่ากัน (เฉพาะชิ้นที่ซ้อนกันในแกนตั้งฉาก) ----
    if(!best && DE_GUIDES.gap){
      var C=others.filter(function(o){ var a=ax==='x'?o.y:o.x, b=a+(ax==='x'?o.h:o.w); return a<chi && b>clo; })
                  .map(function(o){ var a=ax==='x'?o.x:o.y; return {a:a,b:a+(ax==='x'?o.w:o.h)}; }).sort(function(p,q){ return p.a-q.a; });
      var gb=null;
      function gcons(target,gapv){ var d=target-lo; if(Math.abs(d)<th && (!gb||Math.abs(d)<Math.abs(gb.d))) gb={d:d,val:gapv}; }
      for(var i=0;i<C.length;i++) for(var j=0;j<C.length;j++){
        if(i===j) continue; var p=C[i], q=C[j]; if(q.a<p.b) continue;   // p ต้องอยู่ก่อน q และไม่ซ้อนกัน
        var g=q.a-p.b; if(g<0) continue;
        gcons(q.b+g, g);                       // วางต่อท้าย q ห่างเท่า g
        gcons(p.a-g-sz, g);                    // วางหน้า p ห่างเท่า g
        if(g>=sz+2 && mid>p.b && mid<q.a) gcons(p.b+(g-sz)/2, (g-sz)/2);   // อยู่กึ่งกลางระหว่าง p กับ q
      }
      if(gb){ out.s=gb.d; out.label='ระยะห่างเท่ากัน '+Math.round(gb.val)+' px'; out.gapSnap=true; }
    }
    if(!best && !out.gapSnap && DE_GUIDES.grid){ var gs=DE_GUIDES.gridSize||10; out.s=Math.round(lo/gs)*gs-lo; }
    return out;
  }
  var X=axisSnap('x'), Y=axisSnap('y');
  res.sx=X.s; res.sy=Y.s;
  if(X.line) res.lines.push(X.line); if(Y.line) res.lines.push(Y.line);
  if(X.label) res.tip.push(X.gapSnap?X.label:X.label==='ขอบ'?'ชิดขอบแนวตั้ง':X.label==='กึ่งกลาง'?'กึ่งกลางแนวตั้งตรงกัน':X.label);
  if(Y.label && !(Y.gapSnap && X.gapSnap && Y.label===X.label)) res.tip.push(Y.gapSnap?Y.label:Y.label==='ขอบ'?'ชิดขอบแนวนอน':Y.label==='กึ่งกลาง'?'กึ่งกลางแนวนอนตรงกัน':Y.label);
  // ---- หลังสแนปแล้ว: หา "ระยะเท่ากัน" รอบกล่องเพื่อวาดป้าย ----
  if(DE_GUIDES.gap){
    var fb={L:box.L+res.sx,T:box.T+res.sy,R:box.R+res.sx,B:box.B+res.sy};
    ['x','y'].forEach(function(ax){
      var lo=ax==='x'?fb.L:fb.T, hi=ax==='x'?fb.R:fb.B, clo=ax==='x'?fb.T:fb.L, chi=ax==='x'?fb.B:fb.R;
      var C=others.filter(function(o){ var a=ax==='x'?o.y:o.x, b=a+(ax==='x'?o.h:o.w); return a<chi && b>clo; })
                  .map(function(o){ var a=ax==='x'?o.x:o.y, c=ax==='x'?o.y:o.x; return {a:a,b:a+(ax==='x'?o.w:o.h),c:c,d:c+(ax==='x'?o.h:o.w)}; });
      var left=C.filter(function(o){ return o.b<=lo+0.5; }).sort(function(p,q){ return q.b-p.b; });
      var right=C.filter(function(o){ return o.a>=hi-0.5; }).sort(function(p,q){ return p.a-q.a; });
      var mid=(clo+chi)/2, found=[];
      function eq(a,b){ return Math.abs(a-b)<1.2; }
      if(left[0]&&right[0]){ var g1=lo-left[0].b, g2=right[0].a-hi; if(eq(g1,g2)&&g1>=0) found.push([left[0].b,lo,g1],[hi,right[0].a,g2]); }
      if(!found.length && left[0]&&left[1]){ var ga=lo-left[0].b, gbb=left[0].a-left[1].b; if(eq(ga,gbb)&&ga>=0) found.push([left[1].b,left[0].a,gbb],[left[0].b,lo,ga]); }
      if(!found.length && right[0]&&right[1]){ var gc=right[0].a-hi, gd=right[1].a-right[0].b; if(eq(gc,gd)&&gc>=0) found.push([hi,right[0].a,gc],[right[0].b,right[1].a,gd]); }
      found.forEach(function(f){ if(f[2]>2) res.gaps.push({axis:ax,a:f[0],b:f[1],at:mid,val:Math.round(f[2])}); });
    });
  }
  return res;
}
/** วาด/ลบเส้นไกด์บนแผ่น (ภายใน #deCanvas ที่ถูกซูม → ใช้ --gz ชดเชยความหนา) */
function deDrawGuides(canvas, res, z){
  var g=canvas.querySelector('#deGuides');
  if(!res || (!res.lines.length && !res.gaps.length && !res.tip.length)){ if(g) g.remove(); return; }
  if(!g){ g=document.createElement('div'); g.id='deGuides'; g.className='de-guides'; canvas.appendChild(g); }
  g.style.setProperty('--gz', (1/(z||1)).toFixed(3));
  var h='';
  res.lines.forEach(function(l){
    if(l.v) h+='<div class="de-gl v" style="left:'+l.x+'px;top:'+l.y1+'px;height:'+(l.y2-l.y1)+'px"></div>';
    else h+='<div class="de-gl h" style="top:'+l.y+'px;left:'+l.x1+'px;width:'+(l.x2-l.x1)+'px"></div>';
  });
  res.gaps.forEach(function(gp){
    if(gp.axis==='x') h+='<div class="de-gap h" style="left:'+gp.a+'px;width:'+(gp.b-gp.a)+'px;top:'+gp.at+'px"><span>'+gp.val+'</span></div>';
    else h+='<div class="de-gap v" style="top:'+gp.a+'px;height:'+(gp.b-gp.a)+'px;left:'+gp.at+'px"><span>'+gp.val+'</span></div>';
  });
  g.innerHTML=h;
}

/* ===== G2 · ปรับภาพให้ชัด — ไม่ทำลายต้นฉบับ (เก็บค่าใน elm.adj · ต้นฉบับใน IDB คงเดิม) ===== */
var DE_ADJ={};      // eid -> {key,url}  แคชภาพที่ปรับแล้ว
var DE_NAT={};      // eid -> {w,h}      ขนาดต้นฉบับ (px) ของรูป
var DE_ADJ_TOK={};  // eid -> เลขรอบล่าสุด (กันผลเก่ามาทับ)
var DE_ADJ_TMR={};
function deAdjDefault(){ return {sharp:0,bright:0,contrast:0,lineart:false,debg:false}; }
function deAdjActive(elm){ var a=elm&&elm.adj; return !!a && ((+a.sharp||0)!==0 || (+a.bright||0)!==0 || (+a.contrast||0)!==0 || !!a.lineart || !!a.debg); }
function deBaseSrc(elm){ return elm.type==='pdf' ? (DE_PDF[elm.id]&&DE_PDF[elm.id].raster&&DE_PDF[elm.id].raster.url) : DE_IMG[elm.id]; }
/** ประมวลผลภาพตามค่าปรับ → canvas (ย่อให้ด้านยาวไม่เกิน maxPx เพื่อความเร็ว) */
function deProcessImage(im, a, maxPx){
  var iw=im.naturalWidth||im.width, ih=im.naturalHeight||im.height, k=Math.min(1, maxPx/Math.max(iw,ih,1));
  var w=Math.max(1,Math.round(iw*k)), h=Math.max(1,Math.round(ih*k));
  var cv=document.createElement('canvas'); cv.width=w; cv.height=h; var ctx=cv.getContext('2d');
  ctx.drawImage(im,0,0,w,h);
  var id=ctx.getImageData(0,0,w,h), d=id.data, n=w*h, i, x, y;
  // 1) ลบพื้นหลังเทา/เงาสแกน — ประมาณพื้นหลังด้วยการเบลอกว้าง แล้วหารออก (พื้นกลายเป็นขาว เส้นยังดำ)
  if(a.debg){
    var r=Math.max(6,Math.round(Math.max(w,h)/25)), W1=w+1;
    var S=new Uint32Array((w+1)*(h+1));
    for(y=0;y<h;y++){ var row=0; for(x=0;x<w;x++){ i=(y*w+x)*4; row+=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000|0; S[(y+1)*W1+x+1]=S[y*W1+x+1]+row; } }
    for(y=0;y<h;y++){ var y1=Math.max(0,y-r), y2=Math.min(h,y+r+1);
      for(x=0;x<w;x++){ var x1=Math.max(0,x-r), x2=Math.min(w,x+r+1);
        var sum=S[y2*W1+x2]-S[y1*W1+x2]-S[y2*W1+x1]+S[y1*W1+x1], bg=sum/((y2-y1)*(x2-x1));
        var f=bg>0?255/bg:1; if(f<1) f=1;
        i=(y*w+x)*4; d[i]=Math.min(255,d[i]*f); d[i+1]=Math.min(255,d[i+1]*f); d[i+2]=Math.min(255,d[i+2]*f);
      } }
  }
  // 2) สว่าง / คอนทราสต์ (LUT)
  var b=(+a.bright||0), c=(+a.contrast||0);
  if(b||c){
    var cf=1+c/100, lut=new Uint8ClampedArray(256);
    for(i=0;i<256;i++) lut[i]=(i-128)*cf+128+b*1.28;
    for(i=0;i<n*4;i+=4){ d[i]=lut[d[i]]; d[i+1]=lut[d[i+1]]; d[i+2]=lut[d[i+2]]; }
  }
  // 3) ความคม — unsharp 3×3 (ทำบนสำเนา)
  var s=(+a.sharp||0)/100*1.4;
  if(s>0){
    var src=new Uint8ClampedArray(d), cw=1+4*s;
    for(y=1;y<h-1;y++) for(x=1;x<w-1;x++){ i=(y*w+x)*4;
      for(var ch=0;ch<3;ch++){ var p=i+ch; d[p]=src[p]*cw-s*(src[p-4]+src[p+4]+src[p-w*4]+src[p+w*4]); }
    }
  }
  // 4) ลายเส้นชัด (ขาว–ดำ) — เกรย์สเกล + ธรณีขอบนุ่ม (เก็บขอบเรียบไว้)
  if(a.lineart){
    var lo=105, hi=190, rg=hi-lo;
    for(i=0;i<n*4;i+=4){ var l=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000, t=l<=lo?0:l>=hi?255:((l-lo)/rg)*255; d[i]=d[i+1]=d[i+2]=t; }
  }
  ctx.putImageData(id,0,0);
  return cv;
}
/** ภาพที่ปรับแล้ว (dataURL) — แคชตามค่าปรับ+ขนาด · จดขนาดต้นฉบับไว้ใน DE_NAT ด้วย */
function deAdjustedUrl(elm, maxPx){
  var base=deBaseSrc(elm); if(!base) return Promise.reject(new Error('no src'));
  var a=elm.adj||{}, key=[a.sharp|0,a.bright|0,a.contrast|0,a.lineart?1:0,a.debg?1:0,maxPx,base.length].join('|');
  var cc=DE_ADJ[elm.id]; if(cc && cc.key===key) return Promise.resolve(cc.url);
  return _deLoadImg(base).then(function(im){
    if(elm.type!=='pdf') DE_NAT[elm.id]={w:im.naturalWidth||im.width,h:im.naturalHeight||im.height};
    var cv=deProcessImage(im, a, maxPx), url=cv.toDataURL('image/jpeg',0.92);
    DE_ADJ[elm.id]={key:key,url:url}; return url;
  });
}
/** ตั้ง src ของ <img> ให้ตรงกับค่าปรับ (ใช้แทน im.src=url ทุกจุด) — url = ภาพต้นฉบับ */
function deSetImgSrc(elm, url){
  var im=deImgEl(elm.id); if(!im||!url) return;
  if(elm.type!=='pdf' && !DE_NAT[elm.id] && state.deSel===elm.id) deMeasureNat(elm, function(){ if(state.deSel===elm.id) deUpdateProps(); });
  if(!deAdjActive(elm)){ if(im.src!==url) im.src=url; return; }
  if(!im.getAttribute('src')) im.src=url;   // โชว์ต้นฉบับก่อน แล้วค่อยสลับเป็นภาพปรับแล้ว
  var tok=(DE_ADJ_TOK[elm.id]=(DE_ADJ_TOK[elm.id]||0)+1);
  deAdjustedUrl(elm, 1400).then(function(u){ if(DE_ADJ_TOK[elm.id]!==tok) return; var im2=deImgEl(elm.id); if(im2 && im2.src!==u) im2.src=u; })
    .catch(function(){ var im3=deImgEl(elm.id); if(im3 && im3.src!==url) im3.src=url; });
}
/** ปรับค่าแล้วอัปเดตภาพบนแผ่น (หน่วง 90ms ตอนลากแถบเลื่อน) */
function deApplyAdj(elm){
  clearTimeout(DE_ADJ_TMR[elm.id]);
  DE_ADJ_TMR[elm.id]=setTimeout(function(){ var b=deBaseSrc(elm); if(b) deSetImgSrc(elm,b); },90);
}
/** ขนาด/สัดส่วนต้นฉบับ — รูป: px จริง · PDF: สัดส่วนหน้า */
function deNatOf(elm){
  if(elm.type==='pdf'){ var rec=DE_PDF[elm.id]; if(rec&&rec.page){ var v=rec.page.getViewport({scale:1}); return {w:Math.round(v.width),h:Math.round(v.height),pt:true}; } return null; }
  return DE_NAT[elm.id]||null;
}
function deMeasureNat(elm, cb){
  var base=deBaseSrc(elm); if(!base||DE_NAT[elm.id]) return;
  _deLoadImg(base).then(function(im){ DE_NAT[elm.id]={w:im.naturalWidth||im.width,h:im.naturalHeight||im.height}; if(cb) cb(); }).catch(function(){});
}
/** สัดส่วนปัจจุบันเพี้ยนจากต้นฉบับหรือไม่ (>1.5%) */
function deRatioOff(elm){
  var nat=deNatOf(elm); if(!nat||!nat.w||!nat.h||!elm.w||!elm.h) return false;
  return Math.abs((elm.w/elm.h)/(nat.w/nat.h)-1)>0.015;
}
function deAdjRow(label,ic,dp,val,min,max){
  return '<div class="de-adjr"><span class="de-adjk">'+rvIc(ic,12)+esc(label)+'</span><input type="range" data-dp="'+dp+'" min="'+min+'" max="'+max+'" value="'+val+'"><span class="de-adjv">'+(val>0&&min<0?'+':'')+val+'</span></div>';
}
/** แผง "ปรับภาพให้ชัด" + "สัดส่วน" ในพาเนลสิ่งที่เลือก (รูป/PDF) */
function deAdjPanelHtml(elm){
  var a=Object.assign(deAdjDefault(), elm.adj||{}), on=deAdjActive(elm);
  var h='<div class="de-adj" id="deAdj"><div class="de-adjh">'+rvIc('wand',13)+' ปรับภาพให้ชัด'+(on?'<span class="de-adjon">กำลังใช้</span>':'')+'</div>'
    + deAdjRow('ความคม','sharp','adj_sharp',a.sharp,0,100)
    + deAdjRow('สว่าง','sun','adj_bright',a.bright,-100,100)
    + deAdjRow('คอนทราสต์','contrast','adj_contrast',a.contrast,-100,100)
    + '<label class="de-adjt"><input type="checkbox" data-dp="adj_lineart"'+(a.lineart?' checked':'')+'><span>ลายเส้นชัด (ขาว–ดำ สำหรับแบบ)</span></label>'
    + '<label class="de-adjt"><input type="checkbox" data-dp="adj_debg"'+(a.debg?' checked':'')+'><span>ลบพื้นหลังเทา / เงาสแกน</span></label>'
    + '<div class="de-adjb"><button class="de-pb wide" data-dp="adj_reset"'+(on?'':' disabled')+'>รีเซ็ต</button><span class="de-adjnote">ไม่ทำลายต้นฉบับ · ยกเลิกได้ทุกเมื่อ</span></div>';
  var nat=deNatOf(elm), off=deRatioOff(elm);
  h+='<div class="de-adjh">'+rvIc('ratio',13)+' สัดส่วน</div>';
  if(nat){
    var rn=(nat.w/nat.h), rc=(elm.w&&elm.h)?(elm.w/elm.h):rn;
    h+='<div class="de-adjrow"><span>ต้นฉบับ</span><b>'+(nat.pt?'':nat.w+' × '+nat.h+' · ')+rn.toFixed(2)+':1</b></div>';
    h+='<div class="de-adjrow"><span>ตอนนี้</span><b'+(off?' class="bad"':'')+'>'+Math.round(elm.w||0)+' × '+Math.round(elm.h||0)+' · '+rc.toFixed(2)+':1'+(off?' (เพี้ยน)':' ✓')+'</b></div>';
    h+='<div class="de-adjb"><button class="de-pb wide'+(off?' pri':'')+'" data-dp="adj_ratio"'+(off?'':' disabled')+'>'+rvIc('undo',12)+' คืนสัดส่วนเดิม</button><span class="de-adjnote">ย่อ/ขยายจากมุมล็อกสัดส่วนให้อยู่แล้ว</span></div>';
  }else{
    h+='<div class="de-adjrow"><span>ต้นฉบับ</span><b>กำลังอ่าน…</b></div>';
    if(elm.type==='pdf') deEnsurePage(elm).then(function(){ if(state.deSel===elm.id && deNatOf(elm)) deUpdateProps(); }).catch(function(){});
    else deMeasureNat(elm, function(){ if(state.deSel===elm.id) deUpdateProps(); });
  }
  return h+'</div>';
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
/* ---- Library ตกแต่ง (รูปทรง/เส้น/สติกเกอร์) — เก็บเป็น element ปกติใน doc.els ---- */
var DE_SHAPE_ITEMS=[
  {sub:'rect',      label:'สี่เหลี่ยม',    w:160, h:100},
  {sub:'roundrect', label:'สี่เหลี่ยมมน',  w:160, h:100},
  {sub:'circle',    label:'วงกลม',        w:120, h:120},
  {sub:'triangle',  label:'สามเหลี่ยม',    w:120, h:110},
  {sub:'star',      label:'ดาว',          w:120, h:120},
  {sub:'callout',   label:'ป้ายเรียก',    w:180, h:110}
];
var DE_LINE_ITEMS=[
  {sub:'h-solid',   label:'เส้นตรง',       w:200, h:14},
  {sub:'h-dashed',  label:'เส้นประ',       w:200, h:14},
  {sub:'arrow-r',   label:'ลูกศรขวา',      w:200, h:24},
  {sub:'arrow-lr',  label:'ลูกศรสองทาง',   w:200, h:24},
  {sub:'v-solid',   label:'เส้นแนวตั้ง',   w:14,  h:150},
  {sub:'arrow-d',   label:'ลูกศรลง',       w:24,  h:150}
];
var DE_STICKER_ITEMS=[
  {sub:'check',    label:'ผ่าน',    w:56, h:56, col:'#16a34a'},
  {sub:'cross',    label:'ไม่ผ่าน', w:56, h:56, col:'#dc2626'},
  {sub:'warn',     label:'ระวัง',   w:56, h:56, col:'#f59e0b'},
  {sub:'info',     label:'ข้อมูล',  w:56, h:56, col:'#1d4ed8'},
  {sub:'helmet',   label:'หมวก',    w:64, h:56, col:'#f59e0b'},
  {sub:'ruler',    label:'ตลับเมตร',w:64, h:56, col:'#1d4ed8'},
  {sub:'gear',     label:'ฟันเฟือง',w:56, h:56, col:'#6b7280'},
  {sub:'star',     label:'ดาว',     w:56, h:56, col:'#f59e0b'}
];
var DE_LIB_CATS=[
  {id:'shapes',   label:'รูปทรง',    icon:'▢', items:DE_SHAPE_ITEMS,   kind:'shape'},
  {id:'lines',    label:'เส้น/ลูกศร', icon:'─', items:DE_LINE_ITEMS,    kind:'line'},
  {id:'stickers', label:'สติกเกอร์', icon:'✓', items:DE_STICKER_ITEMS, kind:'sticker'}
];
function deLibCat(id){ return DE_LIB_CATS.filter(function(c){return c.id===id;})[0]||DE_LIB_CATS[0]; }
/** สีด่วนในแถบเครื่องมือ — แดง/ส้ม/เขียว/น้ำเงิน/ม่วง/ดำ (พอสำหรับงานตรวจ) */
var DE_SWATCH=['#dc2626','#f59e0b','#16a34a','#1d4ed8','#7c3aed','#111827'];
/** สีพื้นรูปทรง = สี hex + ความทึบแยกกัน (ค่าเก่าที่เก็บเป็น rgba() ไว้แล้วยังใช้ได้) */
function deShapeFill(elm){
  var op=(elm.fillOpacity==null?0.14:+elm.fillOpacity);
  if(op<=0) return 'none';
  var hex=elm.fill;
  if(!hex) return 'rgba(29,78,216,'+op+')';
  if(hex.charAt(0)!=='#') return hex;
  var n=parseInt(hex.slice(1),16);
  return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+op+')';
}
function deFillHex(elm){ return (elm.fill&&elm.fill.charAt(0)==='#')?elm.fill:'#1d4ed8'; }
/** เปลี่ยนสี/เส้นแล้ววาด SVG ใหม่ในที่เดิม — ไม่ render ทั้งหน้า จะได้ไม่เสียตำแหน่งเลื่อน/ตัวที่เลือก */
function deApplyShape(elm){
  var host=document.querySelector('#deCanvas .de-el[data-eid="'+elm.id+'"] .de-shape'); if(!host) return;
  host.innerHTML = elm.type==='line' ? deLineSvg(elm) : elm.type==='sticker' ? deStickerSvg(elm) : elm.type==='stamp' ? deStampSvg(elm)
    : (elm.type==='callout'||elm.type==='dim'||elm.type==='ink') ? deAnnotElSvg(elm,false) : deShapeSvg(elm);
  deSyncAHandles(elm);
}
/* ===== หมายเหตุบนแผ่นรายละเอียด: กล่องข้อความ (callout) · เส้นบอกขนาด (dim) · ปากกา/ไฮไลต์ (ink) =====
   พิกัดทั้งหมดเป็นพิกเซลของแผ่น สัมพัทธ์กับมุมซ้ายบนของกล่อง element (tx/ty ปลายลูกศร · x1..y2 ปลายเส้น · pts จุดปากกา) */
function deMarkerDef(id,type,col){
  if(!type||type==='none') return '';
  var m='<marker id="'+id+'" markerUnits="strokeWidth" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse" viewBox="0 0 8 8">';
  if(type==='solid') m+='<path d="M0 0.5 L8 4 L0 7.5 z" fill="'+col+'"/>';
  else if(type==='open') m+='<path d="M0.5 0.5 L7.5 4 L0.5 7.5" fill="none" stroke="'+col+'" stroke-width="1.1"/>';
  else if(type==='dot') m+='<circle cx="4" cy="4" r="2.6" fill="'+col+'"/>';
  else if(type==='bar') m+='<path d="M7 0.5v7" stroke="'+col+'" stroke-width="1.3"/>';
  return m+'</marker>';
}
/** ระยะที่หมายเหตุวาดล้นกรอบ (ลูกศรกล่องข้อความ / ขีดปลายเส้น) — ใช้ขยายพื้นที่ตอนออก PDF */
function deAnnotPad(el){
  if(el.type==='callout'){ var w=el.w||160,h=el.h||60,tx=(el.tx!=null?el.tx:-40),ty=(el.ty!=null?el.ty:h+40); return Math.max(0,-tx,tx-w,-ty,ty-h)+26; }
  if(el.type==='dim') return 30;
  return 0;
}
function deAnnotElSvg(el, forExport){
  var w=Math.max(20,el.w||160), h=Math.max(8,el.h||60), pad=forExport?deAnnotPad(el):0;
  var col=el.color||'#dc2626', sw=+el.sw||1.8, id=el.id||'a', font=(el.font||'Sarabun')+', sans-serif';
  var vb = el.type==='ink' ? '0 0 '+(el.vw||w)+' '+(el.vh||h) : (-pad)+' '+(-pad)+' '+(w+pad*2)+' '+(h+pad*2);
  var s='<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="'+vb+'" preserveAspectRatio="none" style="display:block;overflow:visible;pointer-events:none">';
  if(el.type==='callout'){
    var tx=(el.tx!=null?el.tx:-40), ty=(el.ty!=null?el.ty:h+40), r=(el.radius!=null?+el.radius:8), a2=el.a2||'solid';
    var cx=Math.max(0,Math.min(w,tx)), cy=Math.max(0,Math.min(h,ty));   // จุดเกาะขอบกล่องที่ใกล้ปลายลูกศรที่สุด
    s+='<defs>'+deMarkerDef('am_'+id,a2,col)+'</defs>';
    if(!(tx>0&&tx<w&&ty>0&&ty<h)) s+='<line x1="'+cx+'" y1="'+cy+'" x2="'+tx+'" y2="'+ty+'" stroke="'+col+'" stroke-width="'+sw+'"'+(a2!=='none'?' marker-end="url(#am_'+id+')"':'')+'/>';
    s+='<rect x="'+(sw/2)+'" y="'+(sw/2)+'" width="'+(w-sw)+'" height="'+(h-sw)+'" rx="'+r+'" fill="'+(el.fill||'#ffffff')+'" fill-opacity="'+(el.fillA!=null?el.fillA:1)+'" stroke="'+col+'" stroke-width="'+sw+'"/>';
    var fs=+el.size||14, lines=String(el.text||'').split('\n'), lh=fs*1.35, y0=(h-lines.length*lh)/2+lh*0.78;
    if(!el.text) s+='<text x="10" y="'+(h/2+fs*0.35)+'" font-size="'+fs+'" fill="#94a3b8" font-family="'+font+'">ข้อความ…</text>';
    lines.forEach(function(ln,i){ s+='<text x="10" y="'+(y0+i*lh)+'" font-size="'+fs+'" font-weight="'+(el.bold?700:400)+'" fill="'+col+'" font-family="'+font+'">'+_hx(ln)+'</text>'; });
  }else if(el.type==='dim'){
    var x1=+el.x1||0, y1=+el.y1||0, x2=(el.x2!=null?+el.x2:w), y2=(el.y2!=null?+el.y2:0);
    var dx=x2-x1, dy=y2-y1, L=Math.hypot(dx,dy)||1, ux=dx/L, uy=dy/L, nx=-uy, ny=ux, tk=9;
    s+='<defs>'+deMarkerDef('am1_'+id,el.a1||'solid',col)+deMarkerDef('am2_'+id,el.a2||'solid',col)+'</defs>';
    s+='<line x1="'+(x1+nx*tk)+'" y1="'+(y1+ny*tk)+'" x2="'+(x1-nx*tk)+'" y2="'+(y1-ny*tk)+'" stroke="'+col+'" stroke-width="'+sw+'"/>';
    s+='<line x1="'+(x2+nx*tk)+'" y1="'+(y2+ny*tk)+'" x2="'+(x2-nx*tk)+'" y2="'+(y2-ny*tk)+'" stroke="'+col+'" stroke-width="'+sw+'"/>';
    var fs2=+el.size||13, lbl=String(el.text||''), tw=lbl.length*fs2*0.62+10, mx=(x1+x2)/2, my=(y1+y2)/2;
    var m1=(el.a1&&el.a1!=='none')?' marker-start="url(#am1_'+id+')"':'', m2=(el.a2&&el.a2!=='none')?' marker-end="url(#am2_'+id+')"':'';
    if(lbl && L>tw+24){
      s+='<line x1="'+x1+'" y1="'+y1+'" x2="'+(mx-ux*tw/2)+'" y2="'+(my-uy*tw/2)+'" stroke="'+col+'" stroke-width="'+sw+'"'+m1+'/>';
      s+='<line x1="'+(mx+ux*tw/2)+'" y1="'+(my+uy*tw/2)+'" x2="'+x2+'" y2="'+y2+'" stroke="'+col+'" stroke-width="'+sw+'"'+m2+'/>';
    }else s+='<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="'+col+'" stroke-width="'+sw+'"'+m1+m2+'/>';
    var ang=Math.atan2(dy,dx)*180/Math.PI; if(ang>90||ang<-90) ang+=180;
    var ly=(lbl && L>tw+24)? my+fs2*0.35 : my-5;
    s+='<text x="'+mx+'" y="'+ly+'" text-anchor="middle" font-size="'+fs2+'" font-weight="700" fill="'+col+'" font-family="'+font+'" transform="rotate('+ang.toFixed(1)+' '+mx+' '+my+')">'+_hx(lbl)+'</text>';
  }else if(el.type==='ink'){
    s+='<polyline points="'+(el.pts||[]).map(function(p){ return p[0]+','+p[1]; }).join(' ')+'" fill="none" stroke="'+col+'" stroke-width="'+(+el.sw||3)+'" stroke-opacity="'+(el.op!=null?el.op:1)+'" stroke-linecap="round" stroke-linejoin="round"/>';
  }
  return s+'</svg>';
}
function deAHandlesHtml(el){
  if(el.type==='callout') return '<span class="de-ah" data-de="ahandle" data-h="tip" style="left:'+(el.tx!=null?el.tx:-40)+'px;top:'+(el.ty!=null?el.ty:(el.h||60)+40)+'px" title="ลากปลายลูกศร"></span>';
  if(el.type==='dim') return '<span class="de-ah" data-de="ahandle" data-h="p1" style="left:'+(el.x1||0)+'px;top:'+(el.y1||0)+'px"></span><span class="de-ah" data-de="ahandle" data-h="p2" style="left:'+(el.x2||0)+'px;top:'+(el.y2||0)+'px"></span>';
  return '';
}
function deSyncAHandles(el){
  var d=document.querySelector('#deCanvas .de-el[data-eid="'+el.id+'"]'); if(!d) return;
  d.querySelectorAll('.de-ah').forEach(function(hd){
    var k=hd.getAttribute('data-h'), x=k==='tip'?el.tx:k==='p1'?el.x1:el.x2, y=k==='tip'?el.ty:k==='p1'?el.y1:el.y2;
    hd.style.left=(x||0)+'px'; hd.style.top=(y||0)+'px';
  });
}
/** ลากจุดจับของหมายเหตุ (ปลายลูกศร / ปลายเส้น) */
function deAnnotHandle(drag,dx,dy){
  var el=drag.elm, o=drag.o, h=drag.handle;
  if(h==='tip'){ el.tx=(o.tx!=null?o.tx:-40)+dx; el.ty=(o.ty!=null?o.ty:(o.h||60)+40)+dy; }
  else if(h==='p1'){ el.x1=(+o.x1||0)+dx; el.y1=(+o.y1||0)+dy; }
  else if(h==='p2'){ el.x2=(+o.x2||0)+dx; el.y2=(+o.y2||0)+dy; }
  deApplyShape(el);
}
/** ระหว่างลากวาดหมายเหตุ — อัปเดตเงา (ghost) */
function deAnnotDrag(drag,p){
  var g=drag.ghost, p0=drag.p0;
  if(drag.tool==='pen'||drag.tool==='hilite'){
    drag.pts.push([p.x,p.y]);
    var xs=drag.pts.map(function(q){return q[0];}), ys=drag.pts.map(function(q){return q[1];});
    var x=Math.min.apply(null,xs)-10, y=Math.min.apply(null,ys)-10, w=Math.max.apply(null,xs)-x+10, h=Math.max.apply(null,ys)-y+10;
    g.style.left=x+'px'; g.style.top=y+'px'; g.style.width=w+'px'; g.style.height=h+'px';
    var pen=drag.tool==='pen';
    g.innerHTML='<svg viewBox="'+x+' '+y+' '+w+' '+h+'" width="100%" height="100%" style="overflow:visible;display:block"><polyline points="'+drag.pts.map(function(q){return q[0]+','+q[1];}).join(' ')+'" fill="none" stroke="'+(pen?'#dc2626':'#facc15')+'" stroke-width="'+(pen?3:14)+'" stroke-opacity="'+(pen?1:0.45)+'" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return;
  }
  drag.p1=p;
  var bx=Math.min(p0.x,p.x), by=Math.min(p0.y,p.y), bw=Math.abs(p.x-p0.x), bh=Math.abs(p.y-p0.y);
  g.style.left=bx+'px'; g.style.top=by+'px'; g.style.width=Math.max(1,bw)+'px'; g.style.height=Math.max(1,bh)+'px';
  if(drag.tool==='dim') g.innerHTML='<svg viewBox="0 0 '+Math.max(1,bw)+' '+Math.max(1,bh)+'" width="100%" height="100%" preserveAspectRatio="none" style="overflow:visible;display:block"><line x1="'+(p0.x-bx)+'" y1="'+(p0.y-by)+'" x2="'+(p.x-bx)+'" y2="'+(p.y-by)+'" stroke="#1d4ed8" stroke-width="1.8" stroke-dasharray="6 4"/></svg>';
}
/** ปล่อยเมาส์ → สร้าง element หมายเหตุ (null = ยกเลิก) */
function deAnnotFinish(drag,m){
  var p0=drag.p0, p1=drag.p1||p0, t=drag.tool;
  if(t==='callout'){
    var x=Math.min(p0.x,p1.x), y=Math.min(p0.y,p1.y), w=Math.max(130,Math.abs(p1.x-p0.x)), h=Math.max(48,Math.abs(p1.y-p0.y));
    state.deTool='select';
    return {id:deUid(),type:'callout',x:x,y:y,w:w,h:h,tx:-46,ty:h+46,text:'',color:'#dc2626',fill:'#ffffff',fillA:1,sw:1.8,size:14,bold:1,radius:8,a2:'solid'};
  }
  if(t==='dim'){
    if(Math.hypot(p1.x-p0.x,p1.y-p0.y)<10){ return null; }
    var lbl=window.prompt('ตัวเลข / ข้อความบนเส้นบอกขนาด (เช่น 0.300):',''); if(lbl===null) return null;
    var PD=14, dx0=Math.min(p0.x,p1.x)-PD, dy0=Math.min(p0.y,p1.y)-PD;
    state.deTool='select';
    return {id:deUid(),type:'dim',x:dx0,y:dy0,w:Math.abs(p1.x-p0.x)+PD*2,h:Math.abs(p1.y-p0.y)+PD*2,x1:p0.x-dx0,y1:p0.y-dy0,x2:p1.x-dx0,y2:p1.y-dy0,text:lbl.trim(),color:'#1d4ed8',sw:1.6,size:13,a1:'solid',a2:'solid'};
  }
  var pts=drag.pts||[]; if(pts.length<2) return null;
  var sw=(t==='pen')?3:14, pad=sw/2+3;
  var xs=pts.map(function(q){return q[0];}), ys=pts.map(function(q){return q[1];});
  var mx=Math.min.apply(null,xs), my=Math.min.apply(null,ys), bw=Math.max.apply(null,xs)-mx, bh=Math.max.apply(null,ys)-my;
  return {id:deUid(),type:'ink',x:mx-pad,y:my-pad,w:bw+pad*2,h:bh+pad*2,vw:bw+pad*2,vh:bh+pad*2,
    pts:pts.map(function(q){ return [Math.round((q[0]-mx+pad)*10)/10, Math.round((q[1]-my+pad)*10)/10]; }),
    color:(t==='pen')?'#dc2626':'#facc15', sw:sw, op:(t==='pen')?1:0.45};
}
/** พาเนล “สิ่งที่เลือก” ของหมายเหตุ */
function deAnnotProps(el){
  var h='', col=el.color||'#dc2626', sizes=[10,12,13,14,16,18,22,28];
  var sel=function(dp,cur,opts){ return '<select class="de-psel" data-dp="'+dp+'">'+opts.map(function(o){ var v=Array.isArray(o)?o[0]:o, l=Array.isArray(o)?o[1]:o; return '<option value="'+v+'"'+(String(cur)===String(v)?' selected':'')+'>'+l+'</option>'; }).join('')+'</select>'; };
  var arrows=[['none','ไม่มี'],['solid','▶ ทึบ'],['open','▷ โปร่ง'],['dot','● จุด'],['bar','⊢ ขีด']];
  if(el.type==='callout'){
    h+='<textarea class="de-pta" data-dp="an_text" rows="3" placeholder="พิมพ์ข้อความ… (Enter ขึ้นบรรทัดใหม่)">'+esc(el.text||'')+'</textarea>';
    h+='<button class="de-pb'+(el.bold?' on':'')+'" data-dp="an_bold" title="ตัวหนา"><b>B</b></button>'+sel('an_size',el.size||14,sizes);
    h+='<label class="de-pcolor" title="สีเส้น/ตัวอักษร"><input type="color" data-dp="an_color" value="'+col+'"></label>';
    h+='<span class="de-pdiv"></span><span class="de-plabel">พื้น</span><label class="de-pcolor"><input type="color" data-dp="an_fill" value="'+(el.fill||'#ffffff')+'"></label>'+sel('an_fillA',(el.fillA!=null?el.fillA:1),[[0,'โปร่ง'],[0.5,'ครึ่ง'],[1,'ทึบ']]);
    h+='<span class="de-pdiv"></span><span class="de-plabel">หัวลูกศร</span>'+sel('an_a2',el.a2||'solid',arrows);
    h+='<span class="de-plabel">เส้น</span>'+sel('an_sw',el.sw||1.8,[1,1.4,1.8,2.5,3.5]);
    h+='<span class="de-plabel">มุม</span>'+sel('an_radius',(el.radius!=null?el.radius:8),[[0,'เหลี่ยม'],[8,'มน'],[16,'มนมาก']]);
  }else if(el.type==='dim'){
    h+='<input class="de-pin" data-dp="an_text" value="'+esc(el.text||'')+'" placeholder="ตัวเลข / ข้อความบนเส้น">';
    h+=sel('an_size',el.size||13,sizes)+'<label class="de-pcolor"><input type="color" data-dp="an_color" value="'+col+'"></label>';
    h+='<span class="de-plabel">เส้น</span>'+sel('an_sw',el.sw||1.6,[1,1.4,1.6,2,2.5,3.5]);
    h+='<span class="de-pdiv"></span><span class="de-plabel">หัวต้น</span>'+sel('an_a1',el.a1||'solid',arrows)+'<span class="de-plabel">หัวปลาย</span>'+sel('an_a2',el.a2||'solid',arrows);
  }else{
    h+='<span class="de-plabel">สี</span><label class="de-pcolor"><input type="color" data-dp="an_color" value="'+col+'"></label>';
    h+='<span class="de-plabel">หนา</span>'+sel('an_sw',el.sw||3,[2,3,5,8,14,20]);
    h+='<span class="de-plabel">ทึบ</span>'+sel('an_op',(el.op!=null?el.op:1),[[1,'ทึบ'],[0.7,'70%'],[0.45,'45%'],[0.25,'25%']]);
  }
  return h+deSwatchRow();
}
function deAnnotProp(el,key,val,ctl){
  if(key==='bold'){ el.bold=el.bold?0:1; if(ctl) ctl.classList.toggle('on',!!el.bold); }
  else if(key==='text') el.text=val;
  else if(key==='size'||key==='sw'||key==='fillA'||key==='radius'||key==='op') el[key]=+val;
  else el[key]=val;
  deApplyShape(el);
}
/** สร้าง SVG ของรูปทรง (viewBox scale ตาม w/h ปัจจุบัน) */
function deShapeSvg(elm){
  var w=Math.max(20,elm.w||120), h=Math.max(20,elm.h||80);
  var fill=deShapeFill(elm);
  var stroke=elm.stroke||'#1d4ed8';
  var sw=+elm.strokeWidth||2;
  var dash=elm.dashed?' stroke-dasharray="8 5"':'';
  var sub=elm.subtype||'rect';
  var s='<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" style="display:block;pointer-events:none">';
  var p=sw/2;
  if(sub==='rect'){
    s+='<rect x="'+p+'" y="'+p+'" width="'+(w-sw)+'" height="'+(h-sw)+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+sw+'"'+dash+'/>';
  }else if(sub==='roundrect'){
    var r=Math.min(w,h)*0.12;
    s+='<rect x="'+p+'" y="'+p+'" width="'+(w-sw)+'" height="'+(h-sw)+'" rx="'+r+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+sw+'"'+dash+'/>';
  }else if(sub==='circle'){
    s+='<ellipse cx="'+(w/2)+'" cy="'+(h/2)+'" rx="'+((w-sw)/2)+'" ry="'+((h-sw)/2)+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+sw+'"'+dash+'/>';
  }else if(sub==='triangle'){
    s+='<polygon points="'+(w/2)+','+p+' '+(w-p)+','+(h-p)+' '+p+','+(h-p)+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+sw+'" stroke-linejoin="round"'+dash+'/>';
  }else if(sub==='star'){
    var cx=w/2,cy=h/2,ro=Math.min(w,h)/2-p,ri=ro*0.42,pts=[];
    for(var i=0;i<10;i++){ var r=i%2===0?ro:ri,a=Math.PI*2*i/10-Math.PI/2; pts.push((cx+r*Math.cos(a)).toFixed(1)+','+(cy+r*Math.sin(a)).toFixed(1)); }
    s+='<polygon points="'+pts.join(' ')+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+sw+'" stroke-linejoin="round"'+dash+'/>';
  }else if(sub==='callout'){
    var bh=h*0.78,rx=Math.min(w,bh)*0.12;
    s+='<rect x="'+p+'" y="'+p+'" width="'+(w-sw)+'" height="'+(bh-sw)+'" rx="'+rx+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+sw+'"'+dash+'/>';
    s+='<polygon points="'+(w*0.22)+','+bh+' '+(w*0.42)+','+bh+' '+(w*0.26)+','+(h-p)+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+sw+'" stroke-linejoin="round"'+dash+'/>';
  }
  return s+'</svg>';
}
/** SVG เส้น/ลูกศร */
function deLineSvg(elm){
  var w=Math.max(10,elm.w||200), h=Math.max(6,elm.h||20);
  var stroke=elm.stroke||'#1f2937';
  var sw=+elm.strokeWidth||3;
  var dash=elm.dashed||elm.subtype==='h-dashed'?' stroke-dasharray="10 6"':'';
  var sub=elm.subtype||'h-solid';
  var mid='m'+(elm.id||'ln');
  var s='<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" style="display:block;overflow:visible;pointer-events:none">';
  s+='<defs><marker id="'+mid+'" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="'+stroke+'"/></marker></defs>';
  var horizontal=(sub.indexOf('v-')!==0 && sub!=='arrow-d');
  if(horizontal){
    var y=h/2, x1=6, x2=w-6;
    var attr='stroke="'+stroke+'" stroke-width="'+sw+'" stroke-linecap="round"'+dash;
    if(sub==='arrow-r') attr+=' marker-end="url(#'+mid+')"';
    else if(sub==='arrow-lr') attr+=' marker-start="url(#'+mid+')" marker-end="url(#'+mid+')"';
    s+='<line x1="'+x1+'" y1="'+y+'" x2="'+x2+'" y2="'+y+'" '+attr+'/>';
  }else{
    var x=w/2, y1=6, y2=h-6;
    var attr2='stroke="'+stroke+'" stroke-width="'+sw+'" stroke-linecap="round"'+dash;
    if(sub==='arrow-d') attr2+=' marker-end="url(#'+mid+')"';
    s+='<line x1="'+x+'" y1="'+y1+'" x2="'+x+'" y2="'+y2+'" '+attr2+'/>';
  }
  return s+'</svg>';
}
/** SVG สติกเกอร์ (วงกลมสี + icon) */
function deStickerSvg(elm){
  var w=Math.max(24,elm.w||56), h=Math.max(24,elm.h||56);
  var col=elm.color||'#1d4ed8';
  var sub=elm.subtype||'check';
  var s='<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 56 56" preserveAspectRatio="xMidYMid meet" style="display:block;pointer-events:none">';
  s+='<circle cx="28" cy="28" r="26" fill="'+col+'" opacity="0.14"/>';
  s+='<circle cx="28" cy="28" r="24" fill="none" stroke="'+col+'" stroke-width="2.5"/>';
  var ic={
    check:'<path d="M18 29 l7 7 13-15" fill="none" stroke="'+col+'" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>',
    cross:'<path d="M18 18 L38 38 M38 18 L18 38" fill="none" stroke="'+col+'" stroke-width="3.6" stroke-linecap="round"/>',
    warn:'<path d="M28 15 L44 41 H12 Z" fill="none" stroke="'+col+'" stroke-width="3" stroke-linejoin="round"/><path d="M28 24 v9 M28 37 v0.5" stroke="'+col+'" stroke-width="3" stroke-linecap="round"/>',
    info:'<circle cx="28" cy="18" r="2.5" fill="'+col+'"/><path d="M28 24 v16" stroke="'+col+'" stroke-width="3" stroke-linecap="round"/>',
    helmet:'<path d="M12 34 h32 v4 h-32 z" fill="'+col+'"/><path d="M14 34 a14 14 0 0 1 28 0" fill="none" stroke="'+col+'" stroke-width="3"/>',
    ruler:'<rect x="10" y="22" width="36" height="12" fill="none" stroke="'+col+'" stroke-width="2.5"/><path d="M16 22 v5 M22 22 v7 M28 22 v5 M34 22 v7 M40 22 v5" stroke="'+col+'" stroke-width="2"/>',
    gear:'<circle cx="28" cy="28" r="8" fill="none" stroke="'+col+'" stroke-width="3"/><g stroke="'+col+'" stroke-width="3" stroke-linecap="round"><path d="M28 12 v6"/><path d="M28 38 v6"/><path d="M12 28 h6"/><path d="M38 28 h6"/><path d="M17 17 l4 4"/><path d="M35 35 l4 4"/><path d="M39 17 l-4 4"/><path d="M21 35 l-4 4"/></g>',
    star:'<polygon points="28,10 34,22 47,24 37,33 40,46 28,39 16,46 19,33 9,24 22,22" fill="'+col+'" opacity="0.9"/>'
  };
  s+=(ic[sub]||ic.check);
  return s+'</svg>';
}
/** SVG ตราประทับ (กรอบมน + ข้อความใหญ่ + บรรทัดเล็ก: วันที่ · ผู้ตรวจ) */
function deStampSvg(elm){
  var w=Math.max(60,elm.w||170), h=Math.max(30,elm.h||56), col=elm.color||'#16a34a', hasSub=!!elm.sub;
  var s='<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="xMidYMid meet" style="display:block;pointer-events:none">';
  s+='<rect x="2" y="2" width="'+(w-4)+'" height="'+(h-4)+'" rx="8" fill="#fff" fill-opacity="0.86" stroke="'+col+'" stroke-width="3"/>';
  s+='<text x="'+(w/2)+'" y="'+(hasSub?h*0.40:h/2)+'" text-anchor="middle" dominant-baseline="central" font-family="Sarabun, sans-serif" font-weight="800" font-size="'+(hasSub?h*0.36:h*0.42)+'" fill="'+col+'">'+_hx(elm.text||'')+'</text>';
  if(hasSub) s+='<text x="'+(w/2)+'" y="'+(h*0.76)+'" text-anchor="middle" dominant-baseline="central" font-family="Sarabun, sans-serif" font-weight="600" font-size="'+(h*0.19)+'" fill="'+col+'">'+_hx(elm.sub)+'</text>';
  return s+'</svg>';
}
var DE_STAMPS={pass:["✓ ผ่าน","#16a34a"], fix:["✗ แก้ไข","#dc2626"], recheck:["! รอตรวจซ้ำ","#b45309"], name:["","#1d4ed8"], date:["","#1d4ed8"], code:["","#111827"]};
/** สร้าง element ตราประทับ — ใส่วันที่วันนี้ + ชื่อผู้ตรวจ (จากบัญชี) ให้อัตโนมัติ */
function deMakeStamp(sub, m){
  var who=DB.inspector||(typeof _fbUser!=="undefined"&&_fbUser&&_fbUser.email)||"", today=new Date().toLocaleDateString("th-TH",{year:"2-digit",month:"short",day:"numeric"});
  var d=DE_STAMPS[sub]||DE_STAMPS.pass, e={id:deUid(), type:'stamp', x:0, y:0, w:190, h:60, color:d[1], text:d[0], sub:'', rot:-8};
  if(sub==="pass"||sub==="fix"||sub==="recheck"){ e.sub=today+(who?" · "+who:""); }
  else if(sub==="name"){ e.text=who||"ผู้ตรวจ"; e.w=160; e.h=42; e.rot=0; }
  else if(sub==="date"){ e.text=today; e.w=150; e.h=42; e.rot=0; }
  else if(sub==="code"){ e.text=(m&&m.code)||""; e.w=140; e.h=44; e.rot=0; }
  return e;
}
/* ---- ย้อนกลับ / ทำซ้ำ — เก็บสแนปช็อต doc เป็น JSON แยกตามชิ้นส่วน ---- */
var DE_UNDO={}, DE_REDO={}, DE_UNDO_MAX=40;
function deSnap(mid){ var m=getMember(mid); if(!m) return null; try{ return JSON.stringify(memberDoc(m)); }catch(e){ return null; } }
/** เรียกก่อนทุกการแก้ไข — เก็บสภาพ "ก่อนหน้า" ไว้ให้ย้อนได้ */
function dePushUndo(mid){
  var j=deSnap(mid); if(j==null) return;
  var st=DE_UNDO[mid]||(DE_UNDO[mid]=[]);
  if(st.length && st[st.length-1]===j) return;
  st.push(j); if(st.length>DE_UNDO_MAX) st.shift();
  DE_REDO[mid]=[];
  deSyncUndoBtns();
}
/* พิมพ์ข้อความ/ลากกล่อง ไม่ได้ render ใหม่ — ปุ่มจึงต้องอัปเดตสถานะเอง ไม่งั้นค้าง disabled กดไม่ได้ */
function deSyncUndoBtns(){
  var mid=activeMemberId();
  $$('[data-de="undo"]').forEach(function(u){ u.disabled=!(DE_UNDO[mid]||[]).length; });
  $$('[data-de="redo"]').forEach(function(r){ r.disabled=!(DE_REDO[mid]||[]).length; });
}
/* เขียนทับ els ในที่เดิม ห้ามสร้าง doc ใหม่ — ระบบล็อคคลาวด์ยึด object เดิมไว้ */
function deRestoreSnap(mid, json){
  var m=getMember(mid); if(!m) return false;
  var snap; try{ snap=JSON.parse(json); }catch(e){ return false; }
  var doc=memberDoc(m);
  doc.els.length=0;
  (snap.els||[]).forEach(function(e){ doc.els.push(e); });
  return true;
}
function deUndo(){
  var mid=activeMemberId(), st=DE_UNDO[mid];
  if(!st||!st.length){ toast('ไม่มีอะไรให้ย้อนกลับ'); return; }
  var cur=deSnap(mid);
  if(!deRestoreSnap(mid, st.pop())) return;
  if(cur!=null) (DE_REDO[mid]||(DE_REDO[mid]=[])).push(cur);
  state.deSel=null; saveDB(); render(); toast('ย้อนกลับแล้ว');
}
function deRedo(){
  var mid=activeMemberId(), st=DE_REDO[mid];
  if(!st||!st.length){ toast('ไม่มีอะไรให้ทำซ้ำ'); return; }
  var cur=deSnap(mid);
  if(!deRestoreSnap(mid, st.pop())) return;
  if(cur!=null) (DE_UNDO[mid]||(DE_UNDO[mid]=[])).push(cur);
  state.deSel=null; saveDB(); render(); toast('ทำซ้ำแล้ว');
}
function deElHtml(elm){
  var st='left:'+Math.round(elm.x||0)+'px;top:'+Math.round(elm.y||0)+'px;width:'+Math.round(elm.w||300)+'px;'+(elm.h?('height:'+Math.round(elm.h)+'px;'):'');
  var isMedia=(elm.type==='image'||elm.type==='pdf');
  // อัตราส่วน W/H สำหรับให้ภาพย่อพอดีความกว้างจอมือถือแบบไม่บิดสัดส่วน (aspect-ratio ใน CSS)
  if(isMedia && elm.w>0 && elm.h>0) st+='aspect-ratio:'+(+elm.w).toFixed(2)+'/'+(+elm.h).toFixed(2)+';';
  if((elm.type==='shape'||elm.type==='line'||elm.type==='sticker'||elm.type==='stamp') && elm.w>0 && elm.h>0) st+='aspect-ratio:'+(+elm.w).toFixed(2)+'/'+(+elm.h).toFixed(2)+';';
  if(elm.rot) st+='transform:rotate('+(+elm.rot)+'deg);';
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
  }else if(elm.type==='shape'){
    inner='<div class="de-shape">'+deShapeSvg(elm)+'</div>';
  }else if(elm.type==='line'){
    inner='<div class="de-shape">'+deLineSvg(elm)+'</div>';
  }else if(elm.type==='sticker'){
    inner='<div class="de-shape">'+deStickerSvg(elm)+'</div>';
  }else if(elm.type==='stamp'){
    inner='<div class="de-shape">'+deStampSvg(elm)+'</div>';
  }else if(elm.type==='callout'||elm.type==='dim'||elm.type==='ink'){
    inner='<div class="de-shape">'+deAnnotElSvg(elm,false)+'</div>'+deAHandlesHtml(elm);
  }
  var tools='<div class="de-move" data-de="move">✥ ลาก</div>'
    + '<button class="de-del" data-de="del" title="ลบ">✕</button>'
    + (isMedia?'<button class="de-crop-btn" data-de="crop" title="ครอบตัด">✂</button>':'')
    + (elm.type==='pdf'?'<span class="de-pdftag">PDF · ยิ่งขยายยิ่งคม</span>':'')
    + (elm.type==='dim'?'':['tl','tr','bl','br'].map(function(c){ return '<span class="de-h '+c+'" data-de="resize" data-corner="'+c+'"></span>'; }).join(''));
  var msel=(state.deSelMulti||[]).indexOf(elm.id)>=0 && elm.id!==state.deSel;
  return '<div class="de-el'+(elm.id===state.deSel?' sel':'')+(msel?' msel':'')+'" data-eid="'+elm.id+'" data-type="'+elm.type+'" style="'+st+'">'+inner+tools+'</div>';
}
/* ===== หน้ารายละเอียด: เลย์เอาต์ Revit — แผ่นกระดาษ A4 ซูมได้ + หัวกระดาษ ===== */
var DE_PAGES={ a4l:{w:1123,h:794,label:"A4 แนวนอน",pt:[841.89,595.28]}, a4p:{w:794,h:1123,label:"A4 แนวตั้ง",pt:[595.28,841.89]}, a3l:{w:1587,h:1123,label:"A3 แนวนอน",pt:[1190.55,841.89]} };
function dePageOf(doc){ var p=doc.page||{}; return DE_PAGES[p.size]||DE_PAGES.a4l; }
function deTitleOn(doc){ return !(doc.page && doc.page.title===0); }
function dePageCount(doc){
  var pg=dePageOf(doc), maxY=0;
  doc.els.forEach(function(e){ var by=(e.y||0)+(e.h||(e.w?e.w*0.7:200)); if(by>maxY) maxY=by; });
  return Math.max(1, Math.ceil((maxY+30)/pg.h));
}
function deZ(){ return state.deZoom||1; }
/** ข้อมูลหัวกระดาษ (โครงการ · ชิ้นส่วน · ชั้น · ผู้ตรวจ · วันที่) */
function deTitleData(m){
  var p=getProject(m.projectId), f=getFloor(m.floorId), t=memberTypeOf(m), ins=lastInspection(m.id);
  return [["โครงการ",p?p.name:""],["ชิ้นส่วน",(TYPES[m.type]?TYPES[m.type].label+" ":"")+m.code+(t?" · "+t.name:"")],["ชั้น",f?f.name:""],
          ["ผู้ตรวจ",(ins&&ins.inspector)||DB.inspector||"—"],["วันที่",new Date().toLocaleDateString("th-TH",{year:"2-digit",month:"short",day:"numeric"})]];
}
function deTypeLabel(e){ return {image:'รูป',pdf:'PDF',text:'ข้อความ',table:'ตาราง',shape:'รูปทรง',line:'เส้น/ลูกศร',sticker:'สติกเกอร์',stamp:'ตราประทับ',callout:'กล่องข้อความ',dim:'เส้นบอกขนาด',ink:'ปากกา'}[e.type]||e.type; }
function deSheetHtml(m){
  var doc=memberDoc(m), pg=dePageOf(doc), n=dePageCount(doc), z=deZ();
  var extra='';
  for(var i=0;i<n;i++){
    if(i>0) extra+='<div class="de-pbreak" style="top:'+(pg.h*i)+'px"><span>หน้า '+(i+1)+'</span></div>';
    if(deTitleOn(doc)) extra+='<div class="de-title" style="top:'+(pg.h*(i+1)-44)+'px">'
      + deTitleData(m).map(function(r){ return '<div><small>'+esc(r[0])+'</small><b>'+esc(r[1])+'</b></div>'; }).join('')
      + '<div><small>หน้า</small><b>'+(i+1)+' / '+n+'</b></div></div>';
  }
  var hint=doc.els.length ? '' : '<div class="de-hint">กด “เพิ่มไฟล์” หรือ “ถ่ายรูป” เพื่อเริ่ม — หรือหยิบ ข้อความ / ตาราง / รูปทรง จากริบบอน</div>';
  return '<div class="de-sheetwrap" id="deWrap" style="width:'+Math.round(pg.w*z)+'px;height:'+Math.round(pg.h*n*z)+'px">'
    + '<div class="de-canvas" id="deCanvas" data-pw="'+pg.w+'" data-ph="'+pg.h+'"'+(state.deTool&&state.deTool!=="select"?' data-tool="'+state.deTool+'"':'')+' style="width:'+pg.w+'px;height:'+(pg.h*n)+'px;transform:scale('+z+')">'
    + extra + hint + doc.els.map(deElHtml).join('') + '</div></div>';
}
/* ---- คลังรูปทรง/เส้น/สติกเกอร์ — แผงลอย เปิดจากปุ่ม “รูปทรง” ---- */
function deLibFlyHtml(){
  var libCatId=state.deLibCat||'shapes', libCat=deLibCat(libCatId);
  var tabs=DE_LIB_CATS.map(function(c){ return '<button class="de-flytab'+(c.id===libCatId?' on':'')+'" data-de="libcat" data-cat="'+c.id+'">'+c.icon+' '+esc(c.label)+'</button>'; }).join('');
  var items=libCat.items.map(function(it){
    var preview;
    if(libCat.kind==='shape') preview=deShapeSvg({subtype:it.sub,w:it.w,h:it.h});
    else if(libCat.kind==='line') preview=deLineSvg({subtype:it.sub,w:it.w,h:it.h});
    else preview=deStickerSvg({subtype:it.sub,color:it.col,w:it.w,h:it.h});
    return '<button class="de-libitem" data-de="libadd" data-kind="'+libCat.kind+'" data-sub="'+it.sub+'" data-w="'+it.w+'" data-h="'+it.h+'"'+(it.col?' data-col="'+it.col+'"':'')+' title="'+esc(it.label)+'"><div class="de-libprev">'+preview+'</div><span class="de-liblbl">'+esc(it.label)+'</span></button>';
  }).join('');
  return '<div class="de-libfly"><div class="de-flyhead">'+tabs+'<span class="sp"></span><button class="fx-x" data-de="shapes" title="ปิด">✕</button></div><div class="de-libgrid">'+items+'</div></div>';
}
/* ---- ปุ่มริบบอนของหน้ารายละเอียด (ใช้ data-de → จัดการใน bindDetailEditor) ---- */
function deBig(on,act,attr,ic,label,title,dis){ return '<button class="rv-big'+(on?" on":"")+'" data-de="'+act+'" '+(attr||"")+' title="'+esc(title||label)+'"'+(dis?' disabled':'')+'>'+rvIc(ic,22)+'<span>'+esc(label)+'</span></button>'; }
function deSm(on,act,attr,ic,label,title,dis){ return '<button class="rv-sm'+(on?" on":"")+'" data-de="'+act+'" '+(attr||"")+' title="'+esc(title||label)+'"'+(dis?' disabled':'')+'>'+rvIc(ic,15)+'<span>'+esc(label)+'</span></button>'; }
var DE_TABS=[["add","เพิ่ม"],["annot","หมายเหตุ"],["arrange","จัดเรียง"],["view","มุมมอง"]];
function deStampGrp(){
  return rvGrp('ตราประทับ', deBig(false,"stamp",'data-sub="pass"','check','ผ่าน','ตราผ่าน + วันที่ + ผู้ตรวจ')+deBig(false,"stamp",'data-sub="fix"','cross','แก้ไข','ตราแก้ไข + วันที่ + ผู้ตรวจ')
    +rvCol(deSm(false,"stamp",'data-sub="recheck"','filter','รอตรวจซ้ำ')+deSm(false,"stamp",'data-sub="name"','user','ชื่อผู้ตรวจ')+deSm(false,"stamp",'data-sub="date"','calendar','วันที่วันนี้')));
}
function deRibbonHtml(m,t){
  var tab=state.deTab||"add", sel=deSelEl(), nsel=(state.deSelMulti||[]).length, doc=memberDoc(m), pgk=(doc.page&&doc.page.size)||"a4l";
  var selGrp=rvGrp('เลือก', deBig(state.deTool==="select","tool",'data-tool="select"','sel','เลือก/ย้าย','เลือก/ย้าย  (V)'));
  var editGrp=rvGrp('แก้ไข', rvCol(deSm(false,"dup",'','copy','ทำซ้ำ','ทำซ้ำสิ่งที่เลือก  (Ctrl+D)',!sel)+deSm(false,"delsel",'','trash','ลบ','ลบสิ่งที่เลือก  (Delete)',!sel)));
  var body='';
  if(tab==="add"){
    body+=selGrp;
    body+=rvGrp('เพิ่ม', deBig(false,"file",'','img','เพิ่มไฟล์','รูปหรือ PDF — เลือกหลายไฟล์พร้อมกันได้')+deBig(false,"cam",'','camera','ถ่ายรูป','เปิดกล้อง (มือถือ/แท็บเล็ต)')
      +rvCol(deSm(false,"addtext",'','text','ข้อความ')+deSm(false,"addtable",'','grid','ตาราง')+deSm(!!state.deLibOpen,"shapes",'','shapes','รูปทรง / เส้น','คลังรูปทรง เส้น ลูกศร สติกเกอร์')));
    body+=deStampGrp();
    var selMedia=!!(sel&&(sel.type==='image'||sel.type==='pdf'));
    body+=rvGrp('ปรับภาพ', deBig(false,"adjust",'','wand','ปรับภาพให้ชัด','ความคม · สว่าง · คอนทราสต์ · ลายเส้นชัด · คืนสัดส่วนเดิม — เลือกรูปก่อน',!selMedia));
    body+=editGrp;
    body+=rvGrp('ส่งงาน', deBig(false,"inspect",'','check','ตรวจเหล็ก','ไปหน้าตรวจเหล็กของชิ้นนี้')+deBig(false,"exportpdf",'','pdf','ออก PDF','บันทึกแผ่นนี้เป็น PDF (ตามหน้ากระดาษ)'));
  }else if(tab==="annot"){
    body+=selGrp;
    body+=deAnnotGrp();
    body+=deStampGrp();
    body+=editGrp;
  }else if(tab==="arrange"){
    body+=selGrp;
    var need2=nsel<2, need3=nsel<3;
    body+=rvGrp('จัดชิด'+(nsel>1?' ('+nsel+' ชิ้น)':' — Shift+คลิก เลือกหลายชิ้น'), rvCol2(
       deSm(false,"align",'data-mode="l"','alL','ซ้าย','',need2)+deSm(false,"align",'data-mode="t"','alT','บน','',need2)
      +deSm(false,"align",'data-mode="c"','alC','กึ่งกลางแนวตั้ง','',need2)+deSm(false,"align",'data-mode="m"','alM','กึ่งกลางแนวนอน','',need2)
      +deSm(false,"align",'data-mode="r"','alR','ขวา','',need2)+deSm(false,"align",'data-mode="b"','alB','ล่าง','',need2)));
    body+=rvGrp('กระจายระยะ', rvCol(deSm(false,"dist",'data-axis="x"','distX','แนวนอนเท่ากัน','เลือกอย่างน้อย 3 ชิ้น',need3)+deSm(false,"dist",'data-axis="y"','distY','แนวตั้งเท่ากัน','เลือกอย่างน้อย 3 ชิ้น',need3)));
    body+=rvGrp('ลำดับซ้อน', rvCol(deSm(false,"front",'','front','ยกขึ้นบนสุด','',!sel)+deSm(false,"back",'','backz','ส่งลงล่างสุด','',!sel)));
    body+=rvGrp('ไกด์ & สแนป', deBig(deGuidesOn(),"guides",'','magnet','ไกด์อัจฉริยะ','ลากแล้วสแนปเข้าขอบ/กึ่งกลางชิ้นอื่น · กึ่งกลางกระดาษ · ระยะห่างเท่ากัน — กด Alt ค้างเพื่อปิดชั่วคราว')
      +rvCol(deSm(!!DE_GUIDES.grid,"snapgrid",'','grid','สแนปกริด 10 px','จัดตำแหน่งลงตารางทุก 10 px')));
    body+=editGrp;
  }else{
    body+=rvGrp('ซูม', deBig(false,"zoomfit",'','fit','พอดีจอ','ซูมให้เห็นทั้งความกว้างแผ่น  (0)')+rvCol(deSm(false,"zoomin",'','zin','ซูมเข้า','(+)')+deSm(false,"zoomout",'','zout','ซูมออก','(−)')+deSm(false,"zoom100",'','search','100%')));
    body+=rvGrp('หน้ากระดาษ', rvCol(Object.keys(DE_PAGES).map(function(k){ return deSm(pgk===k,"page",'data-size="'+k+'"','plan',DE_PAGES[k].label); }).join(""))
      +rvCol(deSm(deTitleOn(doc),"titletoggle",'','tag','หัวกระดาษ','แสดง/ซ่อนหัวกระดาษบนแผ่นและใน PDF')));
    body+=rvGrp('พาเนล', deSm(!state.deSideOff,"panel",'','panel','คุณสมบัติ','แสดง/ซ่อนพาเนลซ้าย'));
  }
  var tabs=DE_TABS.map(function(x){ return '<button class="rv-tab'+(tab===x[0]?" on":"")+'" data-de="detab" data-tab="'+x[0]+'">'+esc(x[1])+'</button>'; }).join("");
  return '<div class="rv-tabs">'+tabs+'<span class="sp"></span><span class="rv-mode">'+(t?'🔗 ประเภท '+esc(t.name)+' · ใช้ร่วม '+typeMembers(t.id).length+' ชิ้น':'รายละเอียดเฉพาะชิ้นนี้')+'</span></div><div class="rv-ribbon">'+body+'</div>';
}
/** กลุ่ม “หมายเหตุ” (กล่องข้อความ · เส้นบอกขนาด · ปากกา · ไฮไลต์) */
function deAnnotGrp(){
  var tl=state.deTool;
  return rvGrp('หมายเหตุ', deBig(tl==="callout","tool",'data-tool="callout"','callout','กล่องข้อความ','ลากกรอบบนแผ่น แล้วพิมพ์ข้อความ  (C)')
    +deBig(tl==="dim","tool",'data-tool="dim"','dim','เส้นบอกขนาด','ลากจากจุดถึงจุด แล้วใส่ตัวเลข  (D)')
    +deBig(tl==="pen","tool",'data-tool="pen"','pen','ปากกา','วาดเส้นอิสระ  (P)')
    +deBig(tl==="hilite","tool",'data-tool="hilite"','hilite','ไฮไลต์','ปากกาเน้นสีเหลืองโปร่ง  (H)'));
}
/* ---- พาเนลซ้าย: ประเภท · สิ่งที่เลือก · หน้ากระดาษ ---- */
function dePaletteHtml(m,t){
  var doc=memberDoc(m), pg=dePageOf(doc);
  var h='<div class="rv-pal"><div class="rv-pal-h"><span>คุณสมบัติ</span></div><div class="rv-pal-b">';
  h+='<div class="rv-type"><span class="rv-tdot" style="background:'+(t?esc(t.color||'#2563eb'):'var(--t-'+TYPES[m.type].css+')')+'"></span><div><b>'+esc(TYPES[m.type].label)+' · '+esc(m.code)+'</b><small>'+esc(t?t.name:(shortSpec(m)||""))+'</small></div></div>';
  if(t){
    var ms=typeMembers(t.id);
    h+='<div class="rv-ph" style="background:#e7f0fd;color:#1b4f9c">🔗 แผ่นนี้ใช้ร่วมกัน '+ms.length+' ชิ้น</div>';
    h+='<div class="rv-pnote"><span class="mono">'+ms.map(function(x){ return esc(x.code); }).join(' · ')+'</span><br>แก้ที่นี่ = เปลี่ยนทุกชิ้น</div>';
    h+='<div class="rv-pacts"><button class="btn soft" data-act="typeManage">'+rvIc('gear',14)+' จัดการประเภท</button><button class="btn soft" data-act="typeDetach">'+rvIc('unlink',14)+' แยกออก</button></div>';
  }else{
    h+='<div class="rv-pnote">รายละเอียดเฉพาะชิ้นนี้ — ถ้าต้องการให้ชิ้นอื่นใช้แผ่นเดียวกัน ไปที่หน้าแปลน → ช่อง “ประเภท”</div>';
  }
  h+=rvPh('สิ่งที่เลือก')+'<div class="de-props de-props-side on" id="deProps"></div>';
  h+=rvPh('หน้ากระดาษ');
  h+=rvProw('ขนาด',esc(pg.label))+rvProw('จำนวนหน้า',dePageCount(doc)+' (อัตโนมัติ)',1)+rvProw('หัวกระดาษ',deTitleOn(doc)?'แสดง':'ซ่อน');
  h+='<div class="rv-pnote">เปลี่ยนได้ที่แท็บ “มุมมอง” · ออก PDF จะได้หน้ากระดาษตามนี้</div>';
  h+=rvPh('ไกด์อัจฉริยะ');
  h+=deGuideTog('el','สแนปเข้าขอบ/กึ่งกลางชิ้นอื่น')+deGuideTog('page','สแนปกึ่งกลางหน้ากระดาษ')+deGuideTog('gap','บอกระยะห่างเท่ากัน')+deGuideTog('grid','สแนปกริด (10 px)');
  h+='<div class="rv-pnote">ลากชิ้นเข้าใกล้แนวชิ้นอื่น เส้นชมพูจะขึ้นแล้วดูดเข้าที่ให้เอง · กด <b>Alt</b> ค้างเพื่อปิดสแนปชั่วคราว</div>';
  return h+'</div></div>';
}
function deGuideTog(k,label){ return '<label class="rv-tog"><span>'+esc(label)+'</span><input type="checkbox" data-de="gset" data-k="'+k+'"'+(DE_GUIDES[k]?' checked':'')+'></label>'; }
function deViewTabsHtml(sib,m,t){
  var h='<div class="rv-vtabs">', shown=sib.slice(0,14);
  shown.forEach(function(x){ h+='<button class="rv-vt'+(x.id===m.id?" on":"")+'" data-de="switchmember" data-id="'+esc(x.id)+'" title="'+esc((getFloor(x.floorId)||{}).name||"")+'">'+rvIc('img',12)+esc(x.code)+'</button>'; });
  if(sib.length>shown.length) h+='<span class="rv-vt" style="opacity:.7">+'+(sib.length-shown.length)+'</span>';
  h+='<span class="sp"></span><span class="rv-vinfo">'+(t?'ชิ้นอื่นในประเภท '+esc(t.name)+' — แผ่นเดียวกัน':'')+'</span></div>';
  return h;
}
function deStatusHtml(m,t){
  var sel=deSelEl(), n=(state.deSelMulti||[]).length, doc=memberDoc(m);
  var tools={callout:'กล่องข้อความ — ลากกรอบบนแผ่น · Esc เลิก', dim:'เส้นบอกขนาด — ลากจากจุดถึงจุด · Esc เลิก', pen:'ปากกา — ลากวาดบนแผ่น · Esc เลิก', hilite:'ไฮไลต์ — ลากวาดบนแผ่น · Esc เลิก'};
  var msg = tools[state.deTool] || (n>1 ? 'เลือก '+n+' ชิ้น (Shift+คลิก เพิ่ม/ลด)' : sel ? 'เลือก '+deTypeLabel(sel) : 'พร้อม — คลิกเพื่อเลือก · ลากคลุมพื้นว่าง เลือกหลายชิ้น · Shift+คลิก เพิ่ม/ลด · Ctrl+ล้อเมาส์ ซูม');
  return '<div class="rv-status"><span class="rv-smsg">'+esc(msg)+'</span><span class="sp"></span>'
    +'<span class="rv-sc static"><b>'+doc.els.length+'</b> รายการ</span><span class="rv-sc static"><b>'+dePageCount(doc)+'</b> หน้า</span>'
    +'<span class="rv-ssep"></span><span class="rv-zoom"><button data-de="zoomout" title="ซูมออก (−)">−</button><span id="deZoomLabel">'+Math.round(deZ()*100)+'%</span><button data-de="zoomin" title="ซูมเข้า (+)">+</button><button data-de="zoomfit" title="พอดีจอ (0)">⛶</button></span></div>';
}
function deQatHtml(p,f,m,t){
  var mid=m.id, canU=(DE_UNDO[mid]||[]).length>0, canR=(DE_REDO[mid]||[]).length>0;
  var dark=(document.documentElement.getAttribute("data-theme")==="dark");
  return '<div class="rv-qat">'
    +'<button class="rv-qb" data-act="back" title="กลับหน้าแปลน">'+rvIc('back',15)+'</button><span class="rv-qsep"></span>'
    +'<button class="rv-qb" data-act="saveNow" title="บันทึกเดี๋ยวนี้ (บันทึกอัตโนมัติอยู่แล้ว)">'+rvIc('save',14)+'</button>'
    +'<button class="rv-qb" data-de="undo" title="ย้อนกลับ  (Ctrl+Z)"'+(canU?'':' disabled')+'>'+rvIc('undo',14)+'</button>'
    +'<button class="rv-qb" data-de="redo" title="ทำซ้ำ  (Ctrl+Shift+Z)"'+(canR?'':' disabled')+'>'+rvIc('redo',14)+'</button>'
    +'<span class="rv-qtitle">RebarCheck — '+esc(p?p.name:"")+' · '+esc(f?f.name:"")+' · รายละเอียด '+esc(m.code)+(t?' · 🔗 '+esc(t.name):'')+'</span><span class="sp"></span>'
    +'<button class="rv-qb" data-de="exportpdf" title="ออก PDF">'+rvIc('pdf',14)+'</button>'
    +'<button class="rv-qb" data-act="qatTheme" title="สลับโหมดสว่าง/มืด">'+rvIc(dark?'sun':'moon',14)+'</button></div>';
}
function deSelEl(){ var m=getMember(activeMemberId()); return m?memberDoc(m).els.filter(function(x){return x.id===state.deSel;})[0]:null; }
/** แถบเครื่องมือลอยติดกับองค์ประกอบที่เลือก (โผล่เหนือกล่อง · ไม่กินพื้นที่ · ตารางใช้ที่ตัวมันเอง) */
function deUpdateProps(){
  var bar=document.getElementById('deProps'); if(!bar) return;
  var elm=deSelEl(), side=bar.classList.contains('de-props-side');
  if(!elm){
    if(side){ var nm=(state.deSelMulti||[]).length; bar.innerHTML='<div class="de-pnone">'+(nm>1?'เลือกอยู่ '+nm+' ชิ้น — ใช้แท็บ “จัดเรียง” เพื่อจัดชิด/กระจาย':'ยังไม่ได้เลือก — คลิกสิ่งใดบนแผ่น · Shift+คลิก เลือกหลายชิ้น')+'</div>'; bar.classList.add('on'); }
    else { bar.classList.remove('on'); bar.innerHTML=''; }
    return;
  }
  var h=side?'<div class="de-ptitle">'+esc(deTypeLabel(elm))+(elm.type==='table'?' — กด + แถว / + คอลัมน์ ที่ตัวตาราง':'')+'</div>':'';
  if(elm.type==='table' && !side){ bar.classList.remove('on'); bar.innerHTML=''; return; }
  if(elm.type==='text'){
    var fonts=[['','ฟอนต์'],['Sarabun, sans-serif','Sarabun'],['Tahoma, sans-serif','Tahoma'],["'Times New Roman', serif",'Times'],['Arial, sans-serif','Arial']];
    var sizes=[12,14,16,18,22,28,36,48];
    h+='<button class="de-pb'+(elm.weight==700?' on':'')+'" data-dp="bold" title="ตัวหนา"><b>B</b></button>';
    h+='<select class="de-psel" data-dp="font">'+fonts.map(function(f){return '<option value="'+f[0]+'"'+((elm.font||'')===f[0]?' selected':'')+'>'+f[1]+'</option>';}).join('')+'</select>';
    h+='<select class="de-psel" data-dp="size">'+sizes.map(function(s){return '<option value="'+s+'"'+((elm.size||16)==s?' selected':'')+'>'+s+'</option>';}).join('')+'</select>';
    h+='<label class="de-pcolor"><input type="color" data-dp="color" value="'+(elm.color||'#1f2937')+'"></label>';
    h+=deSwatchRow();
  }else if(elm.type==='image'||elm.type==='pdf'){
    var fw=(elm.frame&&elm.frame.w)||0;
    h+='<span class="de-plabel">กรอบ</span>';
    h+='<select class="de-psel" data-dp="frame">'+[[0,'ไม่มี'],[1,'บาง'],[2,'กลาง'],[4,'หนา'],[8,'หนามาก']].map(function(o){return '<option value="'+o[0]+'"'+(fw==o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select>';
    h+='<label class="de-pcolor"><input type="color" data-dp="framecolor" value="'+((elm.frame&&elm.frame.color)||'#1f2937')+'"></label>';
    if(side) h+='<span class="de-pdiv"></span><button class="de-pb wide" data-de="crop" title="ครอบตัด">✂ ครอบตัด</button>';
    if(side) h+=deAdjPanelHtml(elm);
  }else if(elm.type==='shape'){
    var fop=(elm.fillOpacity==null?0.14:+elm.fillOpacity);
    h+='<span class="de-plabel">พื้น</span>';
    h+='<label class="de-pcolor"><input type="color" data-dp="fill" value="'+deFillHex(elm)+'"></label>';
    h+='<select class="de-psel" data-dp="fillop">'+[[0,'โปร่ง'],[0.14,'จาง'],[0.4,'กลาง'],[1,'ทึบ']].map(function(o){return '<option value="'+o[0]+'"'+(fop==o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select>';
    h+='<span class="de-pdiv"></span><span class="de-plabel">เส้น</span>';
    h+='<label class="de-pcolor"><input type="color" data-dp="stroke" value="'+(elm.stroke||'#1d4ed8')+'"></label>';
    h+=deStrokeCtl(elm,2)+deSwatchRow();
  }else if(elm.type==='line'){
    h+='<span class="de-plabel">เส้น</span>';
    h+='<label class="de-pcolor"><input type="color" data-dp="stroke" value="'+(elm.stroke||'#1f2937')+'"></label>';
    h+=deStrokeCtl(elm,3)+deSwatchRow();
  }else if(elm.type==='sticker'){
    h+='<span class="de-plabel">สี</span>';
    h+='<label class="de-pcolor"><input type="color" data-dp="stickercolor" value="'+(elm.color||'#1d4ed8')+'"></label>';
    h+=deSwatchRow();
  }else if(elm.type==='stamp'){
    h+='<input class="de-pin" data-dp="stamptext" value="'+esc(elm.text||'')+'" placeholder="ข้อความ">';
    h+='<input class="de-pin" data-dp="stampsub" value="'+esc(elm.sub||'')+'" placeholder="บรรทัดเล็ก (วันที่ · ผู้ตรวจ)">';
    h+='<span class="de-plabel">สี</span><label class="de-pcolor"><input type="color" data-dp="stickercolor" value="'+(elm.color||'#16a34a')+'"></label>';
    h+='<span class="de-plabel">เอียง</span><select class="de-psel" data-dp="rot">'+[[-15,'-15°'],[-8,'-8°'],[0,'ตรง'],[8,'8°'],[15,'15°']].map(function(o){return '<option value="'+o[0]+'"'+((elm.rot||0)==o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select>';
    h+=deSwatchRow();
  }else if(elm.type==='callout'||elm.type==='dim'||elm.type==='ink'){
    h+=deAnnotProps(elm);
  }
  if(side && elm.type!=='table') h+='<div class="de-pxy mono">x '+Math.round(elm.x||0)+' · y '+Math.round(elm.y||0)+' · '+Math.round(elm.w||0)+'×'+Math.round(elm.h||0)+'</div>';
  bar.innerHTML=h; bar.classList.add('on'); dePositionProps();
}
/** ความหนาเส้น + ปุ่มเส้นประ (ใช้ร่วมกันระหว่างรูปทรงกับเส้น) */
function deStrokeCtl(elm, def){
  var cur=+elm.strokeWidth||def;
  return '<select class="de-psel" data-dp="sw" title="ความหนาเส้น">'
    + [1,2,3,4,6,8,12].map(function(n){ return '<option value="'+n+'"'+(cur==n?' selected':'')+'>'+n+'px</option>'; }).join('')
    + '</select><button class="de-pb'+(elm.dashed?' on':'')+'" data-dp="dashed" title="เส้นประ">╌ ╌</button>';
}
/** สีด่วน — กดทีเดียวเปลี่ยนทั้งชิ้น (เขียว=ผ่าน แดง=ไม่ผ่าน เหลือง=ระวัง) */
function deSwatchRow(){
  return '<span class="de-pdiv"></span><span class="de-pswrap">'+DE_SWATCH.map(function(c){
    return '<button class="de-psw" data-dp="swatch" data-c="'+c+'" style="background:'+c+'"></button>';
  }).join('')+'</span>';
}
/** วางตำแหน่งแถบลอยเหนือกล่องที่เลือก (ถ้าชนขอบบนให้ไปอยู่ใต้กล่อง) */
function dePositionProps(){
  var bar=document.getElementById('deProps'); if(!bar||!bar.classList.contains('on')||bar.classList.contains('de-props-side')) return;
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
  if(!(c.w>0&&c.h>0&&isFinite(c.x)&&isFinite(c.y))){ done(); return; }   // ค่าครอบตัดเสีย → ไม่ทำอะไร
  function fromCanvasSized(getSrcCanvas){
    getSrcCanvas.then(function(scv){
      var iw=scv.width, ih=scv.height;
      var sx=Math.max(0,c.x*iw), sy=Math.max(0,c.y*ih), sw=Math.min(iw-sx,c.w*iw), sh=Math.min(ih-sy,c.h*ih);
      if(sw<4||sh<4){ done(); return; }
      var cv=document.createElement('canvas'); cv.width=Math.round(sw); cv.height=Math.round(sh);
      cv.getContext('2d').drawImage(scv, sx,sy,sw,sh, 0,0,sw,sh);
      var url; try{ url=cv.toDataURL('image/jpeg',0.93); }catch(e){ done(); return; }
      var nid=deUid();
      idbPut('deimg_'+nid, url).then(function(){
        DE_IMG[nid]=url; deCloudSaveImg(nid, url);
        var wasSel=(state.deSel===elm.id);
        elm.id=nid; elm.type='image'; delete elm.pageNo; if(elm.w) elm.h=elm.w*(sh/sw);
        if(wasSel) state.deSel=nid;
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
var MDE_CLOSE={cam:1,file:1,addtext:1,addtable:1,libadd:1,stamp:1,switchmember:1,inspect:1,exportpdf:1,page:1,titletoggle:1,dup:1,delsel:1,front:1,back:1,tool:1};
var _deKeyHandler=null, _plKeyHandler=null;
function bindDetailEditor(){
  var canvas=$('#deCanvas'); if(!canvas) return;
  var m=getMember(activeMemberId()); if(!m) return;
  var root=$('#editorGrid')||document.body, vp=$('#deVp'), wrap=$('#deWrap'), fileInput=$('#deFile'), camInput=$('#deCam'), _mid=m.id;
  /* อ่าน doc "สด" จาก DB ทุกครั้งที่ใช้ — ห้ามเก็บ reference ไว้ใน closure
     เพราะ cloud snapshot สร้าง object ใหม่ทับ DB.members ได้ตลอดเวลา */
  function liveDoc(){
    var mm=getMember(_mid)||getMember(activeMemberId())||getMember(state.memberId)||getMember(state.selMemberId);
    return mm?memberDoc(mm):{els:[]};
  }
  function findEl(id){ return liveDoc().els.filter(function(x){return x.id===id;})[0]; }
  function domOf(id){ return canvas.querySelector('.de-el[data-eid="'+id+'"]'); }
  function selectDom(elDiv, add){
    var id=elDiv?elDiv.getAttribute('data-eid'):null;
    if(add && id){
      var arr=(state.deSelMulti||[]).slice();
      if(!arr.length && state.deSel && state.deSel!==id) arr=[state.deSel];
      var i=arr.indexOf(id); if(i>=0) arr.splice(i,1); else arr.push(id);
      state.deSelMulti=arr; state.deSel=(i>=0 && arr.length)?arr[arr.length-1]:id;
      if(arr.length===1){ state.deSel=arr[0]; state.deSelMulti=[]; }
    }else{ state.deSelMulti=[]; state.deSel=id; }
    $$('.de-el',canvas).forEach(function(d){ var did=d.getAttribute('data-eid'); d.classList.toggle('sel', did===state.deSel); d.classList.toggle('msel', (state.deSelMulti||[]).indexOf(did)>=0 && did!==state.deSel); });
    deUpdateProps(); syncArrangeBtns(); mSyncPropsSheet();
  }
  /** มือถือ: แผงคุณสมบัติเปิด/ปิดตามการเลือก โดยไม่ต้อง render ทั้งหน้า */
  function mSyncPropsSheet(){
    var ps=root.querySelector('.m-sheet.props'); if(!ps) return;
    var e=deSelEl(); ps.classList.toggle('open', !!e && !state.mSheet); if(!e){ ps.classList.remove('min'); state.mSheetMin=false; }
    var hb=ps.querySelector('.m-sh b'); if(hb&&e) hb.textContent=deTypeLabel(e);
  }
  function selIds(){ var a=(state.deSelMulti||[]).slice(); if(state.deSel && a.indexOf(state.deSel)<0) a.push(state.deSel); return a; }
  function syncArrangeBtns(){
    var n=selIds().length, one=!!deSelEl();
    $$('[data-de="align"]',root).forEach(function(b){ b.disabled=n<2; });
    $$('[data-de="dist"]',root).forEach(function(b){ b.disabled=n<3; });
    $$('[data-de="front"],[data-de="back"],[data-de="dup"],[data-de="delsel"]',root).forEach(function(b){ b.disabled=!one; });
    var se0=deSelEl(); $$('[data-de="adjust"]',root).forEach(function(b){ b.disabled=!(se0&&(se0.type==='image'||se0.type==='pdf')); });
    var sm=root.querySelector('.rv-smsg'); if(sm && state.deTool==="select"){ var e=deSelEl(); sm.textContent = n>1 ? 'เลือก '+n+' ชิ้น (Shift+คลิก เพิ่ม/ลด)' : e ? 'เลือก '+deTypeLabel(e) : 'พร้อม — คลิกสิ่งใดบนแผ่นเพื่อเลือก · Shift+คลิก เลือกหลายชิ้น · Ctrl+ล้อเมาส์ ซูม'; }
  }
  /* ---- ซูมแผ่น (transform:scale บน #deCanvas · กรอบ #deWrap ขยายตาม เพื่อให้ viewport เลื่อนได้ถูก) ---- */
  function applyZoom(z, cx, cy){
    z=Math.min(4,Math.max(0.15,z)); var z0=deZ();
    if(cx==null){ cx=vp.clientWidth/2; cy=vp.clientHeight/2; }
    var sx=vp.scrollLeft, sy=vp.scrollTop;
    state.deZoom=z; canvas.style.transform='scale('+z+')';
    var pw=+canvas.getAttribute('data-pw')||canvas.offsetWidth, ph=canvas.offsetHeight;
    wrap.style.width=Math.round(pw*z)+'px'; wrap.style.height=Math.round(ph*z)+'px';
    vp.scrollLeft=(sx+cx)*(z/z0)-cx; vp.scrollTop=(sy+cy)*(z/z0)-cy;
    var lb=$('#deZoomLabel'); if(lb) lb.textContent=Math.round(z*100)+'%';
  }
  function zoomFit(){ var pw=+canvas.getAttribute('data-pw')||1123, mg=(wrap.offsetLeft||24)*2+4; applyZoom(Math.max(0.15,(vp.clientWidth-mg)/pw)); vp.scrollLeft=0; }
  if(state.deZoom==null && vp.clientWidth>0) zoomFit();
  else if(state.deScroll){ vp.scrollLeft=state.deScroll[0]; vp.scrollTop=state.deScroll[1]; }   // render ใหม่ → กลับไปตำแหน่งเดิม
  vp.addEventListener('scroll',function(){ state.deScroll=[vp.scrollLeft,vp.scrollTop]; },{passive:true});
  vp.addEventListener('wheel',function(e){
    if(!(e.ctrlKey||e.metaKey)) return;
    e.preventDefault(); var r=vp.getBoundingClientRect();
    applyZoom(deZ()*(e.deltaY<0?1.12:1/1.12), e.clientX-r.left, e.clientY-r.top);
  },{passive:false});
  var tpts={};   // นิ้วถ่างซูม (2 นิ้ว)
  vp.addEventListener('pointerdown',function(e){ if(e.pointerType==='touch') tpts[e.pointerId]=[e.clientX,e.clientY]; },true);   // capture: ต้องจดก่อน pointerdown ของ #deCanvas
  vp.addEventListener('pointermove',function(e){
    if(e.pointerType!=='touch'||!tpts[e.pointerId]) return;
    var ids=Object.keys(tpts);
    if(ids.length===2){
      var a=tpts[ids[0]], b=tpts[ids[1]], d0=Math.hypot(a[0]-b[0],a[1]-b[1]);
      tpts[e.pointerId]=[e.clientX,e.clientY]; a=tpts[ids[0]]; b=tpts[ids[1]];
      var d1=Math.hypot(a[0]-b[0],a[1]-b[1]), r=vp.getBoundingClientRect();
      if(d0>0 && Math.abs(d1-d0)>1) applyZoom(deZ()*(d1/d0), (a[0]+b[0])/2-r.left, (a[1]+b[1])/2-r.top);
    }else tpts[e.pointerId]=[e.clientX,e.clientY];
  });
  ['pointerup','pointercancel'].forEach(function(ev){ vp.addEventListener(ev,function(e){ delete tpts[e.pointerId]; },true); });
  /** จุดกึ่งกลางของส่วนที่มองเห็น ในพิกัดแผ่น */
  function visCenter(){ var z=deZ(); return { x:(vp.scrollLeft+vp.clientWidth/2-wrap.offsetLeft)/z, y:(vp.scrollTop+vp.clientHeight/2-wrap.offsetTop)/z }; }
  /** พิกัดแผ่นจาก pointer event */
  function sheetPt(e){ var r=canvas.getBoundingClientRect(), z=deZ(); return { x:(e.clientX-r.left)/z, y:(e.clientY-r.top)/z }; }

  // ---- property bar (สี/ฟอนต์/ความหนา · กรอบ · ตราประทับ · หมายเหตุ) ----
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
      else if(dp==='fill'){ elm.fill=t.value; deApplyShape(elm); }
      else if(dp==='fillop'){ elm.fillOpacity=+t.value; deApplyShape(elm); }
      else if(dp==='stroke'){ elm.stroke=t.value; deApplyShape(elm); }
      else if(dp==='sw'){ elm.strokeWidth=+t.value; deApplyShape(elm); }
      else if(dp==='stickercolor'){ elm.color=t.value; deApplyShape(elm); }
      else if(dp==='stamptext'){ elm.text=t.value; deApplyShape(elm); }
      else if(dp==='stampsub'){ elm.sub=t.value; deApplyShape(elm); }
      else if(dp==='rot'){ elm.rot=+t.value; var d=domOf(elm.id); if(d) d.style.transform=elm.rot?'rotate('+elm.rot+'deg)':''; }
      else if(dp.indexOf('an_')===0){ deAnnotProp(elm, dp.slice(3), t.value, t); }
      else if(dp.indexOf('adj_')===0){
        var ak=dp.slice(4); if(ak==='reset'||ak==='ratio') return;
        elm.adj=elm.adj||deAdjDefault();
        if(ak==='lineart'||ak==='debg') elm.adj[ak]=!!t.checked; else elm.adj[ak]=+t.value||0;
        var vv=t.parentNode&&t.parentNode.querySelector('.de-adjv'); if(vv) vv.textContent=(elm.adj[ak]>0&&ak!=='sharp'?'+':'')+elm.adj[ak];
        deApplyAdj(elm);
        if(e.type!=='change') return;            // ลากแถบเลื่อนอยู่ — บันทึกตอนปล่อย
        if(!deAdjActive(elm)) delete elm.adj;
        saveDB(); deUpdateProps(); return;
      }
      saveDB();
    }
    props.addEventListener('change',onProp);
    props.addEventListener('input',onProp);
    props.addEventListener('pointerdown',function(e){ if(e.target.closest('[data-dp]')) dePushUndo(_mid); });
    props.addEventListener('click',function(e){
      var b=e.target.closest('button[data-dp]'); if(!b) return;
      var dp=b.getAttribute('data-dp'), elm=deCurSel(); if(!elm) return;
      if(dp==='bold'){ elm.weight=(elm.weight==700?undefined:700); deApplyTextStyle(elm); b.classList.toggle('on', elm.weight==700); }
      else if(dp==='dashed'){ elm.dashed=!elm.dashed; deApplyShape(elm); b.classList.toggle('on', !!elm.dashed); }
      else if(dp==='swatch'){
        var c=b.getAttribute('data-c');
        if(elm.type==='sticker'||elm.type==='stamp') elm.color=c;
        else if(elm.type==='line') elm.stroke=c;
        else if(elm.type==='text'){ elm.color=c; deApplyTextStyle(elm); }
        else if(elm.type==='callout'||elm.type==='dim'||elm.type==='ink'){ elm.color=c; }
        else { elm.fill=c; elm.stroke=c; }
        if(elm.type!=='text') deApplyShape(elm);
        deUpdateProps();
      }
      else if(dp.indexOf('an_')===0){ deAnnotProp(elm, dp.slice(3), b.getAttribute('data-v'), b); deUpdateProps(); }
      else if(dp==='adj_reset'){ delete elm.adj; var bs=deBaseSrc(elm); if(bs) deSetImgSrc(elm,bs); deUpdateProps(); toast('คืนภาพต้นฉบับแล้ว'); }
      else if(dp==='adj_ratio'){
        var nat=deNatOf(elm); if(!nat||!nat.w||!nat.h||!elm.w) return;
        elm.h=elm.w*(nat.h/nat.w);
        var dd=domOf(elm.id); if(dd){ dd.style.height=Math.round(elm.h)+'px'; dd.style.aspectRatio=(+elm.w).toFixed(2)+'/'+(+elm.h).toFixed(2); }
        if(elm.type==='pdf') deRenderPdf(elm);
        deUpdateProps(); toast('คืนสัดส่วนเดิมแล้ว');
      }
      else return;
      saveDB();
    });
  }
  // ---- เพิ่มไฟล์ (รูป + PDF ปนกันได้) → เก็บใน IndexedDB ----
  function addImages(files){
    dePushUndo(_mid);
    var n=files.length; toast(n>1 ? ('กำลังย่อรูป '+n+' รูป...') : 'กำลังย่อรูป...');
    var baseY=deNextY(), addedIds=[];
    (function processOne(idx){
      if(idx>=files.length){ if(addedIds.length){ state.deSel=addedIds[addedIds.length-1]; state.deSelMulti=[]; saveDB(); render(); deScrollToSel(); toast('เพิ่มรูปแล้ว '+addedIds.length+(n>1?(' / '+n+' รูป'):'')); } return; }
      var f=files[idx];
      resizeImage(f,4000,0.9).then(function(url){
        var id=deUid();
        return idbPut('deimg_'+id,url).then(function(){
          DE_IMG[id]=url; deCloudSaveImg(id, url);
          return new Promise(function(res){
            var im=new Image();
            im.onload=function(){ var w=Math.min(420,im.width||420), hh=w*((im.height/im.width)||0.7); liveDoc().els.push({id:id,type:'image',x:40,y:baseY,w:w,h:hh}); addedIds.push(id); baseY+=hh+16; res(); };
            im.onerror=function(){ res(); }; im.src=url;
          });
        });
      }).catch(function(){ toast('อัปโหลดรูป'+(f.name?' "'+f.name+'"':'')+' ไม่สำเร็จ',true); }).then(function(){ processOne(idx+1); });
    })(0);
  }
  function addPdf(f){
    dePushUndo(_mid); toast('กำลังอ่าน PDF...');
    loadPdfJs().then(function(lib){
      var reader=new FileReader();
      reader.onload=function(){
        var buf=reader.result;
        lib.getDocument(pdfDocOpts(new Uint8Array(buf.slice(0)))).promise.then(function(pdf){
          var pageNo=1;
          if(pdf.numPages>1){ var ans=window.prompt('PDF มี '+pdf.numPages+' หน้า — เลือกหน้า (1-'+pdf.numPages+'):','1'); if(ans===null) return; pageNo=Math.min(Math.max(1,parseInt(ans,10)||1), pdf.numPages); }
          pdf.getPage(pageNo).then(function(page){
            var id=deUid(); DE_PDF[id]={page:page,pageNo:pageNo};
            idbPut('depdf_'+id, {bytes:buf, pageNo:pageNo}).catch(function(){ toast('บันทึก PDF ไม่สำเร็จ',true); });
            deCloudSavePdf(id, buf, pageNo);
            var vw=page.getViewport({scale:1}); var w=420, hh=w*(vw.height/vw.width);
            liveDoc().els.push({id:id,type:'pdf',x:40,y:deNextY(),w:w,h:hh,pageNo:pageNo}); state.deSel=id; state.deSelMulti=[];
            saveDB(); render(); deScrollToSel(); toast('นำเข้า PDF แล้ว — ลากมุมขยายให้ใหญ่ ยิ่งคม');
          }).catch(function(){ toast('อ่านหน้า PDF ไม่ได้',true); });
        }).catch(function(){ toast('เปิดไฟล์ PDF ไม่ได้ (อาจเสีย/มีรหัสผ่าน)',true); });
      };
      reader.readAsArrayBuffer(f);
    }).catch(function(){ toast('โหลดตัวอ่าน PDF ไม่ได้',true); });
  }
  function handleFiles(list){
    var files=list?Array.prototype.slice.call(list):[]; if(!files.length) return;
    var isPdf=function(f){ return /pdf/i.test(f.type||'') || /\.pdf$/i.test(f.name||''); };
    var imgs=files.filter(function(f){ return !isPdf(f); }), pdfs=files.filter(isPdf);
    if(imgs.length) addImages(imgs);
    pdfs.forEach(addPdf);
  }
  if(fileInput) fileInput.addEventListener('change',function(e){ handleFiles(e.target.files); e.target.value=''; });
  if(camInput) camInput.addEventListener('change',function(e){ handleFiles(e.target.files); e.target.value=''; });
  // ---- commit เนื้อหาที่กำลังพิมพ์ (contenteditable) ก่อนสั่ง render — กันข้อความหาย ----
  function deCommitEditable(){
    canvas.querySelectorAll('[contenteditable="true"]').forEach(function(t){
      var elDiv=t.closest('.de-el'); if(!elDiv) return;
      var elm=findEl(elDiv.getAttribute('data-eid')); if(!elm) return;
      if(t.classList.contains('de-txt')) elm.html=t.innerHTML;
      else if(t.matches('.de-table [contenteditable]')){ var r=+t.getAttribute('data-r'),c=+t.getAttribute('data-c'); if(elm.rows[r]) elm.rows[r][c]=t.textContent; }
    });
  }
  function deNextY(){
    var maxY=0;
    liveDoc().els.forEach(function(el){ var by=(el.y||0)+(el.h||(el.w?el.w*0.7:240)); if(by+16>maxY) maxY=by+16; });
    return maxY>0?maxY:40;
  }
  function deScrollToSel(){
    setTimeout(function(){ var el=canvas.querySelector('.de-el[data-eid="'+state.deSel+'"]'); if(el && el.scrollIntoView) el.scrollIntoView({behavior:'smooth', block:'center', inline:'center'}); }, 60);
  }
  function elH(el){ var d=domOf(el.id); return el.h || (d?d.offsetHeight:(el.w?el.w*0.7:120)); }
  function pushEl(newEl){ var _mm=getMember(_mid); if(!_mm){ toast('ไม่พบข้อมูลชิ้นส่วน — รีเฟรชหน้าและลองใหม่',true); return false; } dePushUndo(_mid); memberDoc(_mm).els.push(newEl); state.deSel=newEl.id; state.deSelMulti=[]; saveDB(); render(); deScrollToSel(); return true; }
  function deleteEls(ids){
    if(!ids.length) return;
    dePushUndo(_mid); var _ld=liveDoc();
    // เก็บไฟล์สื่อไว้ (IDB/คลาวด์) เพื่อให้ "ย้อนกลับ" คืนรูป/PDF ได้ครบ
    _ld.els=_ld.els.filter(function(x){ return ids.indexOf(x.id)<0; });
    state.deSel=null; state.deSelMulti=[]; saveDB(); render();
  }
  // ---- ปุ่มทั้งหมด (ริบบอน · QAT · พาเนล · ปุ่มบนชิ้น) — data-de ----
  root.addEventListener('click',function(e){
    var b=e.target.closest('[data-de]'); if(!b || b.disabled) return;
    var act=b.getAttribute('data-de');
    var elDiv=b.closest('.de-el'), elm=elDiv?findEl(elDiv.getAttribute('data-eid')):null;
    if(!elm && (act==='crop') ) elm=deSelEl();
    // มือถือ: แผงเลื่อนขึ้น
    if(act==='msheet'){ deCommitEditable(); var sh0=b.getAttribute('data-sheet')||null; state.mSheet=(sh0&&state.mSheet!==sh0)?sh0:null; state.mSheetMin=false; render(); return; }
    if(act==='msheetclose'){ deCommitEditable(); if(state.mSheet) state.mSheet=null; else { state.deSel=null; state.deSelMulti=[]; } state.mSheetMin=false; render(); return; }
    if(act==='msheettoggle'){ if(state.mSheet) state.mSheet=null; else state.mSheetMin=!state.mSheetMin; render(); return; }
    var inSheet=!!b.closest('.m-sheet'), fromBar=!!b.closest('.m-bar');
    if((inSheet||fromBar) && state.mSheet && MDE_CLOSE[act]){ state.mSheet=null; state.mSheetMin=false; }   // เลือกแล้วไปทำต่อบนแผ่น → ปิดแผง (act ด้านล่างจะ render เอง)
    if(inSheet && (act==='file'||act==='cam')){ deCommitEditable(); render(); var inp=$(act==='file'?'#deFile':'#deCam'); if(inp) inp.click(); return; }
    if(act==='detab'){ state.deTab=b.getAttribute('data-tab'); render(); return; }
    if(act==='tool'){ var tl=b.getAttribute('data-tool')||'select'; state.deTool=(state.deTool===tl&&tl!=='select')?'select':tl; state.deLibOpen=false; if(state.deTool!=='select'){ deCommitEditable(); if(isMobile()){ state.deSel=null; state.deSelMulti=[]; } } render(); return; }
    if(act==='libcat'){ state.deLibCat=b.getAttribute('data-cat')||'shapes'; render(); return; }
    if(act==='shapes'){ state.deLibOpen=!state.deLibOpen; render(); return; }
    if(act==='undo'){ deCommitEditable(); deUndo(); return; }
    if(act==='redo'){ deCommitEditable(); deRedo(); return; }
    if(act==='exportpdf'){ deCommitEditable(); deExportPDF(); return; }
    if(act==='inspect'){ deCommitEditable(); state.selMemberId=_mid; state.rpCollapsed=false; go("planEditor",{rightTab:"inspect"}); return; }
    if(act==='switchmember'){ deCommitEditable(); var sid=b.getAttribute('data-id'); if(sid && sid!==_mid){ state.memberId=sid; state.selMemberId=sid; state.deSel=null; state.deSelMulti=[]; state.deScroll=null; render(); } return; }
    if(act==='zoomin'){ applyZoom(deZ()*1.25); return; }
    if(act==='zoomout'){ applyZoom(deZ()/1.25); return; }
    if(act==='zoomfit'){ zoomFit(); return; }
    if(act==='zoom100'){ applyZoom(1); return; }
    if(act==='panel'){ state.deSideOff=!state.deSideOff; render(); return; }
    if(act==='guides'){ var _gv=b.getAttribute('data-v'), gon=(_gv!=null)?(_gv==="1"):!deGuidesOn(); DE_GUIDES.el=DE_GUIDES.page=DE_GUIDES.gap=gon; deGuidesSave(); deCommitEditable(); render(); toast(gon?'เปิดไกด์อัจฉริยะ — ลากชิ้นแล้วจะสแนปเข้าแนวให้เอง':'ปิดไกด์อัจฉริยะแล้ว'); return; }
    if(act==='snapgrid'){ var _sv=b.getAttribute('data-v'); DE_GUIDES.grid=(_sv!=null)?(_sv==="1"):!DE_GUIDES.grid; deGuidesSave(); deCommitEditable(); render(); return; }
    if(act==='gset'){ var gk=b.getAttribute('data-k'); DE_GUIDES[gk]=!!b.checked; deGuidesSave();
      var gb=root.querySelector('[data-de="guides"]'); if(gb) gb.classList.toggle('on',deGuidesOn());
      var sg=root.querySelector('[data-de="snapgrid"]'); if(sg) sg.classList.toggle('on',!!DE_GUIDES.grid); return; }
    if(act==='adjust'){
      var sa=deSelEl(); if(!sa||!(sa.type==='image'||sa.type==='pdf')){ toast('เลือกรูปหรือ PDF บนแผ่นก่อน',true); return; }
      if(state.deSideOff){ state.deSideOff=false; render(); }
      var ad=document.getElementById('deAdj'); if(ad){ ad.scrollIntoView({block:'nearest'}); ad.classList.add('flash'); setTimeout(function(){ ad.classList.remove('flash'); },1200); var r0=ad.querySelector('input[type=range]'); if(r0) r0.focus(); }
      return;
    }
    if(act==='page'){ var _d0=liveDoc(); _d0.page=_d0.page||{}; _d0.page.size=b.getAttribute('data-size'); state.deZoom=null; saveDB(); render(); return; }
    if(act==='titletoggle'){ var _d1=liveDoc(); _d1.page=_d1.page||{}; var _tv=b.getAttribute('data-v'); _d1.page.title=(_tv!=null)?(+_tv):(deTitleOn(_d1)?0:1); saveDB(); render(); return; }
    if(act==='libadd'){
      var kind=b.getAttribute('data-kind'), sub=b.getAttribute('data-sub'), w=+b.getAttribute('data-w')||120, h=+b.getAttribute('data-h')||100, col=b.getAttribute('data-col');
      var c0=visCenter(), newEl={id:deUid(), type:kind, subtype:sub, x:Math.max(0,c0.x-w/2), y:Math.max(0,c0.y-h/2), w:w, h:h};
      if(kind==='sticker' && col) newEl.color=col;
      pushEl(newEl); return;
    }
    if(act==='file'){ deCommitEditable(); fileInput.click(); return; }
    if(act==='cam'){ deCommitEditable(); camInput.click(); return; }
    if(act==='addtext'){ deCommitEditable(); if(pushEl({id:deUid(),type:'text',x:40,y:deNextY(),w:320,h:80,html:''})) toast('เพิ่มข้อความแล้ว'); return; }
    if(act==='addtable'){ deCommitEditable(); if(pushEl({id:deUid(),type:'table',x:40,y:deNextY(),w:420,rows:[['หัวข้อ','หัวข้อ','หัวข้อ'],['','',''],['','','']]})) toast('เพิ่มตารางแล้ว'); return; }
    if(act==='stamp'){ deCommitEditable(); var st=deMakeStamp(b.getAttribute('data-sub'), getMember(_mid)), c1=visCenter(); st.x=Math.max(0,c1.x-st.w/2); st.y=Math.max(0,c1.y-st.h/2); pushEl(st); return; }
    if(act==='dup'){
      var se=deSelEl(); if(!se) return; deCommitEditable();
      var cp=deCloneEls([se])[0]; cp.x=(se.x||0)+24; cp.y=(se.y||0)+24; pushEl(cp); return;
    }
    if(act==='delsel'){ var ids0=selIds(); if(!ids0.length) return; if(confirm(ids0.length>1?'ลบ '+ids0.length+' ชิ้น?':'ลบสิ่งนี้?')) deleteEls(ids0); return; }
    if(act==='front'||act==='back'){
      var se2=deSelEl(); if(!se2) return; dePushUndo(_mid); var _l=liveDoc(); var ix=_l.els.indexOf(se2); if(ix<0) return;
      _l.els.splice(ix,1); if(act==='front') _l.els.push(se2); else _l.els.unshift(se2); saveDB(); render(); return;
    }
    if(act==='align'||act==='dist'){
      var ids=selIds(); if(ids.length<2) return;
      var items=ids.map(findEl).filter(Boolean).map(function(el){ return {el:el, x:el.x||0, y:el.y||0, w:el.w||100, h:elH(el)}; });
      dePushUndo(_mid);
      if(act==='align'){
        var mode=b.getAttribute('data-mode');
        var L=Math.min.apply(null,items.map(function(i){return i.x;})), R=Math.max.apply(null,items.map(function(i){return i.x+i.w;}));
        var T=Math.min.apply(null,items.map(function(i){return i.y;})), B=Math.max.apply(null,items.map(function(i){return i.y+i.h;}));
        items.forEach(function(i){
          if(mode==='l') i.el.x=L; else if(mode==='r') i.el.x=R-i.w; else if(mode==='c') i.el.x=(L+R)/2-i.w/2;
          else if(mode==='t') i.el.y=T; else if(mode==='b') i.el.y=B-i.h; else if(mode==='m') i.el.y=(T+B)/2-i.h/2;
        });
      }else{
        var ax=b.getAttribute('data-axis')==='y'?'y':'x', sz=ax==='x'?'w':'h';
        items.sort(function(a,c){ return a[ax]-c[ax]; });
        var first=items[0], last=items[items.length-1];
        var span=(last[ax]+last[sz])-first[ax], tot=items.reduce(function(s,i){ return s+i[sz]; },0), gap=(span-tot)/(items.length-1);
        var cur=first[ax]; items.forEach(function(i){ i.el[ax]=cur; cur+=i[sz]+gap; });
      }
      items.forEach(function(i){ var d=domOf(i.el.id); if(d){ d.style.left=Math.round(i.el.x||0)+'px'; d.style.top=Math.round(i.el.y||0)+'px'; } });
      saveDB(); deUpdateProps(); return;
    }
    if(act==='del' && elm){ if(confirm('ลบสิ่งนี้?')) deleteEls([elm.id]); return; }
    if(act==='crop' && elm){ state.deSel=elm.id; state.deCrop=elm.id; elm._crop={x:0.1,y:0.1,w:0.8,h:0.8}; render(); return; }
    if(act==='cropcancel' && elm){ state.deCrop=null; delete elm._crop; render(); return; }
    if(act==='cropok' && elm){ dePushUndo(_mid); toast('กำลังครอบตัด (คมสูง)...'); deApplyCrop(elm,function(){ state.deCrop=null; delete elm._crop; saveDB(); render(); }); return; }
    if(act==='addrow' && elm){ dePushUndo(_mid); var cols=(elm.rows[0]||['']).length; var nr=[]; for(var k=0;k<cols;k++) nr.push(''); elm.rows.push(nr); saveDB(); render(); return; }
    if(act==='addcol' && elm){ dePushUndo(_mid); elm.rows.forEach(function(r){ r.push(''); }); saveDB(); render(); return; }
  });
  // เริ่มพิมพ์ในกล่องข้อความ/ตาราง = การแก้ไข 1 ครั้ง
  canvas.addEventListener('focusin',function(e){ if(e.target.isContentEditable) dePushUndo(_mid); });
  // คีย์ลัด — ผูกที่ document จึงต้องถอดตัวเก่าก่อน
  if(_deKeyHandler) document.removeEventListener('keydown',_deKeyHandler);
  _deKeyHandler=function(e){
    if(state.screen!=='memberDetail') return;
    var editing=!!(e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)));
    var k=(e.key||'').toLowerCase();
    if((e.ctrlKey||e.metaKey) && (k==='z'||k==='y')){ if(editing && e.target.isContentEditable) return; e.preventDefault(); if(k==='y'||e.shiftKey) deRedo(); else deUndo(); return; }
    if((e.ctrlKey||e.metaKey) && k==='d'){ if(editing) return; e.preventDefault(); var bd=root.querySelector('[data-de="dup"]'); if(bd) bd.click(); return; }
    if(editing) return;
    if(k==='delete'||k==='backspace'){ var ids=selIds(); if(ids.length){ e.preventDefault(); if(confirm(ids.length>1?'ลบ '+ids.length+' ชิ้น?':'ลบสิ่งนี้?')) deleteEls(ids); } return; }
    if(k==='escape'){ if(state.deTool!=='select'||state.deLibOpen){ state.deTool='select'; state.deLibOpen=false; render(); } else selectDom(null); return; }
    if(e.ctrlKey||e.metaKey||e.altKey) return;     // ปล่อยคีย์ผสมของเบราว์เซอร์ (Ctrl+C/V/P/0/±)
    if(k==='v'){ state.deTool='select'; render(); return; }
    if(k==='c'||k==='d'||k==='p'||k==='h'){ state.deTool={c:'callout',d:'dim',p:'pen',h:'hilite'}[k]; state.deTab='annot'; render(); return; }
    if(k==='+'||k==='='){ applyZoom(deZ()*1.25); return; }
    if(k==='-'){ applyZoom(deZ()/1.25); return; }
    if(k==='0'){ zoomFit(); return; }
  };
  document.addEventListener('keydown',_deKeyHandler);
  // ---- edit text / table cells ----
  canvas.addEventListener('input',function(e){
    var t=e.target, elDiv=t.closest('.de-el'); if(!elDiv) return;
    var elm=findEl(elDiv.getAttribute('data-eid')); if(!elm) return;
    if(t.classList.contains('de-txt')) elm.html=t.innerHTML;
    else if(t.matches('.de-table [contenteditable]')){ var r=+t.getAttribute('data-r'),c=+t.getAttribute('data-c'); if(elm.rows[r]) elm.rows[r][c]=t.textContent; }
    clearTimeout(_deTypeT); _deTypeT=setTimeout(function(){ saveDB(); },800);   // กันข้อความหายถ้าปิดแท็บก่อน blur
  });
  var _deTypeT=null;
  canvas.addEventListener('blur',function(e){ if(e.target.isContentEditable) saveDB(); },true);
  // ---- drag / resize / crop / วาดหมายเหตุ (pointer · หาร zoom) ----
  var drag=null;
  // ---- ลากจนชิดขอบกรอบ → เลื่อนแผ่นตามอัตโนมัติ (ยิ่งชิดยิ่งเร็ว) แล้วชดเชยจุดเริ่มลากให้ชิ้นตามเคอร์เซอร์ ----
  var _ae={raf:0, ev:null};
  function autoScroll(e){ _ae.ev=e; if(!_ae.raf) _ae.raf=requestAnimationFrame(_aeTick); }
  function autoScrollStop(){ if(_ae.raf) cancelAnimationFrame(_ae.raf); _ae.raf=0; _ae.ev=null; }
  function _aeTick(){
    _ae.raf=0;
    var e=_ae.ev; if(!e || !drag || !vp) return;
    if(drag.mode==='pan' || drag.mode==='cropmove' || drag.mode==='crophandle') return;   // เลื่อนเอง / ครอปยึดกรอบรูปบนจอ
    var r=vp.getBoundingClientRect(); if(!r.width || !r.height) return;
    var M=Math.min(36, r.width/8, r.height/8), MAX=16;
    function v(d){ return d>=M ? 0 : (M-Math.max(0,d))/M*MAX; }
    var vx=v(r.right-e.clientX)-v(e.clientX-r.left), vy=v(r.bottom-e.clientY)-v(e.clientY-r.top);
    if(!vx && !vy) return;
    var sl=vp.scrollLeft, st=vp.scrollTop;
    vp.scrollLeft=sl+vx; vp.scrollTop=st+vy;
    var ddx=vp.scrollLeft-sl, ddy=vp.scrollTop-st;
    if(!ddx && !ddy) return;                       // สุดขอบแผ่นแล้ว
    if(drag.sx!=null) drag.sx-=ddx; if(drag.sy!=null) drag.sy-=ddy;   // ระยะลาก (clientX-sx) ต้องรวมระยะที่แผ่นเลื่อนไป
    deMove(e);
    if(!_ae.raf) _ae.raf=requestAnimationFrame(_aeTick);
  }
  /** นิ้วที่สองแตะลง = ถ่างซูม → ยกเลิกการลากของนิ้วแรก (คืนตำแหน่ง/ลบเส้นร่าง) */
  function cancelDrag(){
    if(!drag) return; var d=drag; drag=null; autoScrollStop();
    deDrawGuides(canvas,null);
    if(d.box && d.box.parentNode) d.box.parentNode.removeChild(d.box);
    if(d.mode==='marquee'){ $$('.de-el.mpre',canvas).forEach(function(x){ x.classList.remove('mpre'); }); }
    if(d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    if(d.mode==='move'){ (d.grp||[{el:d.elm,x:d.ox,y:d.oy}]).forEach(function(g){ g.el.x=g.x; g.el.y=g.y; var dm=domOf(g.el.id); if(dm){ dm.style.left=g.x+'px'; dm.style.top=g.y+'px'; } }); dePositionProps(); }
    else if(d.mode==='resize' && d.elm){ var r=d.elm; r.x=d.ox; r.y=d.oy; r.w=d.ow; if(r.h!=null) r.h=d.oh; var rd=domOf(r.id); if(rd){ rd.style.left=r.x+'px'; rd.style.top=r.y+'px'; rd.style.width=r.w+'px'; if(r.h!=null) rd.style.height=r.h+'px'; } dePositionProps(); }
  }
  canvas.addEventListener('pointerdown',function(e){
    if(e.pointerType==='touch' && Object.keys(tpts).length>1){ cancelDrag(); return; }   // กำลังถ่างซูม
    var b=e.target.closest('[data-de]'), elDiv=e.target.closest('.de-el');
    // เครื่องมือวาดหมายเหตุ — เริ่มลากบนพื้นแผ่น (หรือทับสิ่งอื่นก็ได้)
    if(state.deTool!=='select' && !(b && elDiv)){
      var p0=sheetPt(e); drag={mode:'annot', tool:state.deTool, sx:e.clientX, sy:e.clientY, p0:p0, pts:[[p0.x,p0.y]]};
      var ghost=document.createElement('div'); ghost.className='de-ghost'; ghost.setAttribute('data-tool',state.deTool); canvas.appendChild(ghost); drag.ghost=ghost;
      try{canvas.setPointerCapture(e.pointerId);}catch(x){} e.preventDefault(); return;
    }
    if(b && b.getAttribute('data-de')==='ahandle' && elDiv){   // จุดจับของหมายเหตุ (ปลายลูกศร / ปลายเส้น)
      var ae=findEl(elDiv.getAttribute('data-eid')); if(!ae) return;
      selectDom(elDiv,false);
      drag={mode:'ahandle',elm:ae,elDiv:elDiv,handle:b.getAttribute('data-h'),sx:e.clientX,sy:e.clientY,o:JSON.parse(JSON.stringify(ae))};
      try{canvas.setPointerCapture(e.pointerId);}catch(x){} e.preventDefault(); return;
    }
    if(!elDiv && !b && state.deTool==='select' && !(e.pointerType==='touch' || isMobile())){   // เมาส์: ลากพื้นว่าง = ลากกรอบเลือกหลายชิ้น
      var ae1=document.activeElement; if(ae1 && ae1.isContentEditable){ try{ ae1.blur(); }catch(x){} }
      var mp=sheetPt(e), mbx=document.createElement('div'); mbx.className='de-marquee';
      mbx.style.left=mp.x+'px'; mbx.style.top=mp.y+'px'; mbx.style.width='0'; mbx.style.height='0';
      canvas.appendChild(mbx);
      drag={mode:'marquee',sx:e.clientX,sy:e.clientY,mx:mp.x,my:mp.y,box:mbx,add:e.shiftKey,hit:[]};
      try{canvas.setPointerCapture(e.pointerId);}catch(x){} e.preventDefault(); return;
    }
    var _pid=elDiv?elDiv.getAttribute('data-eid'):null, _keepGrp=!!(_pid && !b && !e.shiftKey && state.deTool==='select' && selIds().length>1 && selIds().indexOf(_pid)>=0);
    if(!_keepGrp) selectDom(elDiv, e.shiftKey);   // กดชิ้นที่อยู่ในกลุ่มที่เลือก → คงทั้งกลุ่มไว้เพื่อลากย้ายพร้อมกัน
    if(b && elDiv){
      var elm=findEl(elDiv.getAttribute('data-eid')), act=b.getAttribute('data-de');
      if(act==='resize'){ drag={mode:'resize',elm:elm,elDiv:elDiv,corner:b.getAttribute('data-corner'),sx:e.clientX,sy:e.clientY,ox:elm.x,oy:elm.y,ow:elm.w,oh:elm.h||elDiv.offsetHeight}; }
      else if(act==='move'){ drag={mode:'move',elm:elm,elDiv:elDiv,sx:e.clientX,sy:e.clientY,ox:elm.x,oy:elm.y}; }
      else if(act==='colresize'){ var ci=+b.getAttribute('data-c'), col=elDiv.querySelectorAll('.de-table col')[ci];
        drag={mode:'colresize',elm:elm,ci:ci,col:col,sx:e.clientX,w0:(elm.colW&&elm.colW[ci])||(col?col.offsetWidth:80)}; }
      else if(act==='crophandle'||act==='cropmove'){ var im=elDiv.querySelector('.de-img'); drag={mode:act,elm:elm,cropDiv:elDiv.querySelector('.de-crop'),corner:b.getAttribute('data-corner'),sx:e.clientX,sy:e.clientY,box:im.getBoundingClientRect(),c0:Object.assign({},elm._crop)}; }
      if(drag){ try{canvas.setPointerCapture(e.pointerId);}catch(x){} e.preventDefault(); return; }
    }
    if(!elDiv && !b && state.deTool==='select' && (e.pointerType==='touch' || isMobile())){   // ลากพื้นว่าง = เลื่อนแผ่น (นิ้ว/มือถือ) · แตะเฉย ๆ = เลิกเลือก — คอม/เมาส์ทำงานเหมือนเดิม
      var ae0=document.activeElement; if(ae0 && ae0.isContentEditable){ try{ ae0.blur(); }catch(x){} }
      drag={mode:'pan',sx:e.clientX,sy:e.clientY,sl:vp.scrollLeft,st:vp.scrollTop,pt:e.pointerType};
      try{canvas.setPointerCapture(e.pointerId);}catch(x){} e.preventDefault(); return;
    }
    if(elDiv && !b && !e.target.isContentEditable){
      var em=findEl(elDiv.getAttribute('data-eid')); if(!em) return;
      // ย้ายทั้งกลุ่มที่เลือก (ถ้าชิ้นนี้อยู่ในกลุ่ม)
      var grp=selIds().indexOf(em.id)>=0 ? selIds().map(findEl).filter(Boolean) : [em];
      drag={mode:'move',elm:em,elDiv:elDiv,sx:e.clientX,sy:e.clientY,ox:em.x,oy:em.y,keepGrp:_keepGrp,grp:grp.map(function(g){ return {el:g, x:g.x||0, y:g.y||0}; })};
      try{canvas.setPointerCapture(e.pointerId);}catch(x){} e.preventDefault();
    }
  });
  function deMove(e){
    if(!drag) return;
    autoScroll(e);   // ชิดขอบกรอบ → เลื่อนแผ่นตาม
    var z=deZ(), rdx=e.clientX-drag.sx, rdy=e.clientY-drag.sy, dx=rdx/z, dy=rdy/z, el=drag.elm;
    if(drag.mode==='annot'){ var p=sheetPt(e); deAnnotDrag(drag, p); return; }
    if(drag.mode==='pan'){ if(Object.keys(tpts).length>1) return; if(Math.abs(rdx)>3||Math.abs(rdy)>3) drag.moved=true; vp.scrollLeft=drag.sl-rdx; vp.scrollTop=drag.st-rdy; return; }
    if(drag.mode==='marquee'){
      var mp2=sheetPt(e);
      var x1=Math.min(drag.mx,mp2.x), y1=Math.min(drag.my,mp2.y), x2=Math.max(drag.mx,mp2.x), y2=Math.max(drag.my,mp2.y);
      var ms=drag.box.style; ms.left=x1+'px'; ms.top=y1+'px'; ms.width=(x2-x1)+'px'; ms.height=(y2-y1)+'px';
      if(Math.abs(rdx)>3||Math.abs(rdy)>3) drag.moved=true;
      var hit=[];
      liveDoc().els.forEach(function(el2){
        var ew=el2.w||100, eh=elH(el2), ex=el2.x||0, ey=el2.y||0;
        var over=(ex<x2 && ex+ew>x1 && ey<y2 && ey+eh>y1);
        var d2=domOf(el2.id); if(d2) d2.classList.toggle('mpre', over);
        if(over) hit.push(el2.id);
      });
      drag.hit=hit;
      var smg2=root.querySelector('.rv-smsg'); if(smg2) smg2.textContent = hit.length ? 'ลากคลุมอยู่ — เลือก '+hit.length+' ชิ้น' : 'ลากคลุมเพื่อเลือกหลายชิ้น';
      return;
    }
    if(drag.mode==='move' && !drag.moved){ if(Math.abs(rdx)<4 && Math.abs(rdy)<4) return; drag.moved=true; }
    if(!drag.snapped){ drag.snapped=true; dePushUndo(_mid); }
    if(drag.mode==='ahandle'){ deAnnotHandle(drag, dx, dy); return; }
    if(drag.mode==='move'){
      var gsl=drag.grp||[{el:el,x:drag.ox,y:drag.oy}], snap=null;
      if(deGuidesOn()||DE_GUIDES.grid){
        var L=Infinity,T=Infinity,R=-Infinity,B=-Infinity;
        gsl.forEach(function(g){ var gw=g.el.w||100, gh=elH(g.el), gx=Math.max(0,g.x+dx), gy=Math.max(0,g.y+dy); L=Math.min(L,gx); T=Math.min(T,gy); R=Math.max(R,gx+gw); B=Math.max(B,gy+gh); });
        var gids=gsl.map(function(g){ return g.el.id; });
        var others=liveDoc().els.filter(function(o){ return gids.indexOf(o.id)<0 && o.type!=='ink'; }).map(function(o){ return {x:o.x||0,y:o.y||0,w:o.w||100,h:elH(o)}; });
        snap=deSmartSnap({L:L,T:T,R:R,B:B}, others, {w:+canvas.getAttribute('data-pw')||1123,h:+canvas.getAttribute('data-ph')||794}, z, !!e.altKey);
        dx+=snap.sx; dy+=snap.sy;
      }
      gsl.forEach(function(g){ g.el.x=Math.max(0,g.x+dx); g.el.y=Math.max(0,g.y+dy); var d=domOf(g.el.id); if(d){ d.style.left=g.el.x+'px'; d.style.top=g.el.y+'px'; } });
      deDrawGuides(canvas, snap, z);
      var smg=root.querySelector('.rv-smsg'); if(smg) smg.textContent = snap&&snap.tip.length ? 'สแนป: '+snap.tip.join(' · ')+'  (Alt = ปิดชั่วคราว)' : 'กำลังลาก… x '+Math.round(gsl[0].el.x)+' · y '+Math.round(gsl[0].el.y);
      dePositionProps();
    }
    else if(drag.mode==='colresize'){ var nw=Math.max(36, drag.w0+dx); if(!el.colW) el.colW=[]; el.colW[drag.ci]=nw; if(drag.col) drag.col.style.width=nw+'px'; }
    else if(drag.mode==='resize'){
      if(el.type==='image'||el.type==='pdf'||el.type==='sticker'||el.type==='stamp'){
        var ratio=(drag.oh/drag.ow)||0.7, rr=drag.corner.indexOf('r')>=0;
        el.w=Math.max(60, drag.ow + (rr?dx:-dx)); el.h=el.w*ratio;
        if(!rr){ el.x=drag.ox+(drag.ow-el.w); drag.elDiv.style.left=el.x+'px'; }
        drag.elDiv.style.width=el.w+'px'; drag.elDiv.style.height=el.h+'px';
      }else{
        var right=drag.corner.indexOf('r')>=0, bottom=drag.corner.indexOf('b')>=0;
        el.w=Math.max(60, drag.ow + (right?dx:-dx));
        if(!right){ el.x=drag.ox+dx; drag.elDiv.style.left=el.x+'px'; }
        drag.elDiv.style.width=el.w+'px';
        if(el.h!=null){ el.h=Math.max(30, drag.oh + (bottom?dy:-dy)); if(!bottom){ el.y=drag.oy+dy; drag.elDiv.style.top=el.y+'px'; } drag.elDiv.style.height=el.h+'px'; }
        if(el.type==='callout'||el.type==='ink'||el.type==='dim') deApplyShape(el);
      }
    }else{  // crop (ใช้ระยะจริงบนจอ เทียบกับกล่องรูปที่ถูกซูมแล้ว)
      var fx=rdx/drag.box.width, fy=rdy/drag.box.height, c=drag.c0, nc=Object.assign({},c);
      if(drag.mode==='cropmove'){ nc.x=Math.min(1-c.w,Math.max(0,c.x+fx)); nc.y=Math.min(1-c.h,Math.max(0,c.y+fy)); }
      else{
        if(drag.corner.indexOf('l')>=0){ nc.x=Math.min(c.x+c.w-0.06,Math.max(0,c.x+fx)); nc.w=c.w+(c.x-nc.x); }
        if(drag.corner.indexOf('r')>=0){ nc.w=Math.min(1-c.x,Math.max(0.06,c.w+fx)); }
        if(drag.corner.indexOf('t')>=0){ nc.y=Math.min(c.y+c.h-0.06,Math.max(0,c.y+fy)); nc.h=c.h+(c.y-nc.y); }
        if(drag.corner.indexOf('b')>=0){ nc.h=Math.min(1-c.y,Math.max(0.06,c.h+fy)); }
      }
      el._crop=nc; var s=drag.cropDiv.style; s.left=(nc.x*100)+'%'; s.top=(nc.y*100)+'%'; s.width=(nc.w*100)+'%'; s.height=(nc.h*100)+'%';
    }
  }
  canvas.addEventListener('pointermove',deMove);
  var _lastTap=0;
  function endDrag(e){
    if(!drag) return;
    var d=drag; drag=null; autoScrollStop();
    if(d.mode==='pan'){   // แตะสองครั้งบนพื้นว่าง (นิ้ว) = พอดีจอ
      if(d.pt==='touch' && !d.moved){ var now=(window.performance&&performance.now)?performance.now():0; if(now-_lastTap<320){ zoomFit(); _lastTap=0; } else _lastTap=now; }
      return;
    }
    if(d.mode==='annot'){ if(d.ghost&&d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost); var ne=deAnnotFinish(d, getMember(_mid)); if(ne){ pushEl(ne); if(ne.type==='callout'){ setTimeout(function(){ var ta=root.querySelector('[data-dp="an_text"]'); if(ta) ta.focus(); },80); } } return; }
    if(d.mode==='marquee'){
      if(d.box && d.box.parentNode) d.box.parentNode.removeChild(d.box);
      $$('.de-el.mpre',canvas).forEach(function(x){ x.classList.remove('mpre'); });
      var hit=d.hit||[];
      if(d.add){
        var arr=(state.deSelMulti||[]).slice(); if(!arr.length && state.deSel) arr=[state.deSel];
        hit.forEach(function(id){ if(arr.indexOf(id)<0) arr.push(id); });
        if(arr.length>1){ state.deSelMulti=arr; state.deSel=arr[arr.length-1]; }
        else { state.deSel=arr[0]||null; state.deSelMulti=[]; }
      }else if(hit.length>1){ state.deSelMulti=hit; state.deSel=hit[hit.length-1]; }
      else if(hit.length===1){ state.deSel=hit[0]; state.deSelMulti=[]; }
      else { state.deSel=null; state.deSelMulti=[]; }
      $$('.de-el',canvas).forEach(function(dd){ var did=dd.getAttribute('data-eid'); dd.classList.toggle('sel', did===state.deSel); dd.classList.toggle('msel', (state.deSelMulti||[]).indexOf(did)>=0 && did!==state.deSel); });
      if((state.deSelMulti||[]).length>1) state.deTab='arrange';
      deUpdateProps(); syncArrangeBtns(); mSyncPropsSheet();
      if((state.deSelMulti||[]).length>1) render();
      return;
    }
    if(d.mode==='move' && d.keepGrp && !d.moved){ selectDom(d.elDiv,false); }   // คลิกเฉย ๆ (ไม่ลาก) = เลือกชิ้นเดียว
    var wasResize=d.mode==='resize', el=d.elm;
    var changed=(d.mode!=='move') || d.moved;
    if(changed) saveDB();
    deDrawGuides(canvas,null); syncArrangeBtns();
    dePositionProps(); deUpdateProps();
    if(wasResize && el.type==='pdf') deRenderPdf(el);
    if(d.mode==='ahandle') saveDB();
  }
  canvas.addEventListener('pointerup',endDrag);
  canvas.addEventListener('pointercancel',endDrag);
  // ---- ตัวแบ่งพาเนล (ลากปรับความกว้าง) ----
  var sp=$('#rpSplitter'), grid=$('#editorGrid');
  if(sp && grid){
    sp.addEventListener('pointerdown',function(e){
      var startX=e.clientX, startW=parseInt(getComputedStyle(grid).getPropertyValue('--rp-w'))||252;
      function mv(ev){ grid.style.setProperty('--rp-w', Math.max(200,Math.min(480,startW+(ev.clientX-startX)))+'px'); }
      function up(){ document.removeEventListener('pointermove',mv); document.removeEventListener('pointerup',up); }
      document.addEventListener('pointermove',mv); document.addEventListener('pointerup',up); e.preventDefault();
    });
  }
  // ---- โหลด/เรนเดอร์สื่อจาก IndexedDB + พาเนลคุณสมบัติเริ่มต้น ----
  deHydrate(liveDoc());
  deUpdateProps(); syncArrangeBtns(); mSyncPropsSheet();
}

/** ส่วนพับได้ในพาเนลขวา (details/summary) — ใช้จัดกลุ่มให้ไม่รก */
function rpSec(title, badge, body, open){
  return '<details class="rp-sec"'+(open?' open':'')+'><summary><span class="rp-sec-t">'+esc(title)+'</span>'+(badge||'')+'</summary><div class="rp-sec-b">'+body+'</div></details>';
}
/* ===========================================================================
   หน้าแปลน — เลย์เอาต์แบบ Revit
   QAT (แถบเข้ม) / แท็บริบบอน / ริบบอน / [คุณสมบัติ + ผังโครงการ] | แท็บวิว + แปลน / แถบสถานะ
   ========================================================================== */
var RV_IC={
  sel:'<path d="m4 4 7 17 2.5-7.5L21 11Z"/>',
  rect:'<rect x="3" y="6" width="18" height="12" rx="1.5"/>',
  poly:'<path d="M12 3l8 6-3 10H7L4 9z"/>',
  oval:'<ellipse cx="12" cy="12" rx="9" ry="6"/>',
  line:'<path d="M4 20 20 4"/><circle cx="4" cy="20" r="2"/><circle cx="20" cy="4" r="2"/>',
  point:'<circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  snap:'<path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="3"/>',
  undo:'<path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 8"/>',
  redo:'<path d="M21 7v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 8"/>',
  fit:'<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  zin:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
  zout:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>',
  pdf:'<path d="M14 3v5h5"/><path d="M9 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5H9"/><path d="M12 18v-6M9 15l3 3 3-3"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  zone:'<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M12 6v12M3 12h18"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:'<path d="M9.9 4.2A9.8 9.8 0 0 1 12 4c6.5 0 10 7 10 7a13 13 0 0 1-2.3 3M6.6 6.6A13 13 0 0 0 2 12s3.5 7 10 7a9.5 9.5 0 0 0 4.3-1M3 3l18 18"/>',
  check:'<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/>',
  edit:'<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  img:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 15 5-5 4 4 3-3 6 6"/><circle cx="9" cy="9" r="1.6"/>',
  copy:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  trash:'<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8 2 2 0 1 1-2.8 2.8 1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0 1.6 1.6 0 0 0-2.6-1.1 2 2 0 1 1-2.8-2.8A1.6 1.6 0 0 0 3.9 15a2 2 0 0 1 0-4 1.6 1.6 0 0 0 1.1-2.6A2 2 0 1 1 7.8 5.6 1.6 1.6 0 0 0 10 5.3V5a2 2 0 0 1 4 0 1.6 1.6 0 0 0 2.2.3 2 2 0 1 1 2.8 2.8A1.6 1.6 0 0 0 20.7 11a2 2 0 0 1 0 4Z"/>',
  layer:'<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',
  grid:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  tag:'<path d="M20.6 13.4 13 21a2 2 0 0 1-2.8 0L3 13.8V4h9.8l7.8 7.8a2 2 0 0 1 0 1.6Z"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/>',
  folder:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  floor:'<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 9h16M4 15h16"/>',
  plan:'<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m21 15-5-5L5 21"/>',
  save:'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  back:'<path d="m15 18-6-6 6-6"/>',
  data:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  chev:'<path d="m9 6 6 6-6 6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  home:'<path d="m3 11 9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2Z"/>',
  filter:'<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
  wand:'<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M12.2 6.2 11 5M3 21l9-9"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  unlink:'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/><path d="M4 4l16 16"/>',
  ruler:'<rect x="2" y="8" width="20" height="8" rx="1.5"/><path d="M6 8v3M10 8v4M14 8v3M18 8v4"/>',
  area:'<path d="M4 6 14 3l6 6-3 11H5z" stroke-dasharray="3.5 2.5"/><path d="M8.5 19.5 15.5 7.5"/>',
  hole:'<rect x="3" y="3" width="18" height="18" rx="1.5"/><rect x="9" y="9" width="6" height="6" stroke-dasharray="2 1.5"/>',
  calc:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 7h7M8.5 11.5h1.5M12 11.5h.01M15.5 11.5h.01M8.5 15h1.5M12 15h.01M15.5 15h.01M8.5 18h7"/>',
  callout:'<rect x="9" y="3" width="13" height="9" rx="2"/><path d="M11.5 12 2.5 21"/><path d="M2.5 21l5-1.2-1.2-5Z" fill="currentColor"/>',
  dim:'<path d="M3 6v12M21 6v12M5 12h14"/><path d="m8 9-3 3 3 3M16 9l3 3-3 3"/>',
  camera:'<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  more:'<circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/>',
  text:'<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  shapes:'<rect x="3" y="3" width="8" height="8" rx="1"/><circle cx="17" cy="7" r="4"/><path d="M3 21l4-8 4 8zM13 13h8v8h-8z"/>',
  cross:'<path d="M6 6l12 12M18 6 6 18"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  alL:'<path d="M4 3v18M8 7h10v3H8zM8 14h6v3H8z"/>',
  alC:'<path d="M12 3v18M7 7h10v3H7zM9 14h6v3H9z"/>',
  alR:'<path d="M20 3v18M6 7h10v3H6zM10 14h6v3h-6z"/>',
  alT:'<path d="M3 4h18M7 8h3v10H7zM14 8h3v6h-3z"/>',
  alM:'<path d="M3 12h18M7 7h3v10H7zM14 9h3v6h-3z"/>',
  alB:'<path d="M3 20h18M7 6h3v10H7zM14 10h3v6h-3z"/>',
  distX:'<path d="M3 4v16M21 4v16M8 9h3v6H8zM13 9h3v6h-3z"/>',
  distY:'<path d="M4 3h16M4 21h16M9 8h6v3H9zM9 13h6v3H9z"/>',
  front:'<rect x="8" y="8" width="13" height="13" rx="1"/><path d="M3 16V3h13"/>',
  backz:'<rect x="3" y="3" width="13" height="13" rx="1"/><path d="M8 21h13V8"/>',
  stamp:'<path d="M9 3h6l-1 8h4a2 2 0 0 1 2 2v3H4v-3a2 2 0 0 1 2-2h4z"/><path d="M5 21h14"/>',
  pen:'<path d="m12 19 7-7 3 3-7 7-3-3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="m2 2 7.586 7.586"/>',
  hilite:'<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  box:'<rect x="4" y="4" width="16" height="16" rx="1.5" stroke-dasharray="3.5 2.5"/><path d="M9 12h6M12 9v6"/>',
  magnet:'<path d="M6 3v8a6 6 0 0 0 12 0V3"/><path d="M6 3h4v8H6M14 3h4v8h-4"/>',
  sharp:'<path d="M12 3 3 20h18L12 3Z"/><path d="M12 9v7"/>',
  contrast:'<circle cx="12" cy="12" r="9"/><path d="M12 3v18A9 9 0 0 0 12 3Z" fill="currentColor"/>',
  ratio:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5v14M3 10h5"/>',
  palette:'<path d="M12 21a9 9 0 1 1 0-18c4.97 0 9 3.58 9 8a4 4 0 0 1-4 4h-1.5a1.5 1.5 0 0 0-1 2.6c.3.3.5.7.5 1.1A1.3 1.3 0 0 1 13.7 21z"/><circle cx="7.5" cy="12" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7.5" r="1.2" fill="currentColor"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor"/><circle cx="17.5" cy="11.5" r="1.2" fill="currentColor"/>'
};
function rvIc(n,sz){ return '<svg class="ic" viewBox="0 0 24 24" style="width:'+(sz||16)+'px;height:'+(sz||16)+'px">'+RV_IC[n]+'</svg>'; }
/* ปุ่มริบบอน: ใหญ่ (ไอคอนบน ป้ายล่าง) / เล็ก (ไอคอนซ้าย ป้ายขวา) */
function rvBig(on,act,attr,ic,label,title,dis){
  return '<button class="rv-big'+(on?" on":"")+(dis?" dis":"")+'" data-act="'+act+'" '+(attr||"")+' title="'+esc(title||label)+'"'+(dis?' disabled':'')+'>'+rvIc(ic,22)+'<span>'+esc(label)+'</span></button>';
}
function rvSm(on,act,attr,ic,label,title,dis){
  return '<button class="rv-sm'+(on?" on":"")+'" data-act="'+act+'" '+(attr||"")+' title="'+esc(title||label)+'"'+(dis?' disabled':'')+'>'+rvIc(ic,15)+'<span>'+esc(label)+'</span></button>';
}
function rvGrp(cap,inner){ return '<div class="rv-grp"><div class="rv-grp-b">'+inner+'</div><div class="rv-grp-c">'+esc(cap)+'</div></div>'; }
function rvCol(inner){ return '<div class="rv-col">'+inner+'</div>'; }
function rvCol2(inner){ return '<div class="rv-col2">'+inner+'</div>'; }

/* ---- QAT: แถบเข้มบนสุด ---- */
function rvQatHtml(p,f,plan){
  var fid=state.floorId, canU=(PL_UNDO[fid]||[]).length>0, canR=(PL_REDO[fid]||[]).length>0;
  var dark=(document.documentElement.getAttribute("data-theme")==="dark");
  return '<div class="rv-qat">'
    +'<button class="rv-qb" data-act="back" title="กลับหน้าชั้น">'+rvIc('back',15)+'</button>'
    +'<span class="rv-qsep"></span>'
    +'<button class="rv-qb" data-act="saveNow" title="บันทึกเดี๋ยวนี้ (บันทึกอัตโนมัติอยู่แล้ว)">'+rvIc('save',14)+'</button>'
    +'<button class="rv-qb" data-act="planUndo" title="ย้อนกลับ  (Ctrl+Z)"'+(canU?'':' disabled')+'>'+rvIc('undo',14)+'</button>'
    +'<button class="rv-qb" data-act="planRedo" title="ทำซ้ำ  (Ctrl+Shift+Z)"'+(canR?'':' disabled')+'>'+rvIc('redo',14)+'</button>'
    +'<span class="rv-qtitle">RebarCheck — '+esc(p?p.name:"")+' · '+esc(f?f.name:"")+' · '+esc(plan?(plan.name||"แปลน"):"ยังไม่มีแปลน")+'</span>'
    +'<span class="sp"></span>'
    +'<label class="rv-qsearch" title="ค้นหาเบอร์  (Ctrl+F)">'+rvIc('search',13)+'<input id="planSearch" type="search" placeholder="ค้นหาเบอร์…" autocomplete="off" enterkeyhint="search"></label>'
    +'<button class="rv-qb" data-act="exportPdf" title="ออก PDF — แปลน + ไฮไลท์">'+rvIc('pdf',14)+'</button>'
    +'<button class="rv-qb" data-act="qatData" title="ข้อมูล / สำรอง">'+rvIc('data',14)+'</button>'
    +'<button class="rv-qb" data-act="qatTheme" title="สลับโหมดสว่าง/มืด">'+rvIc(dark?'sun':'moon',14)+'</button>'
    +'</div>';
}
/* ---- ริบบอน: แท็บ + เนื้อหาตามแท็บ ---- */
var RV_TABS=[["structure","โครงสร้าง"],["annot","หมายเหตุ"],["progress","อัพเดท"],["view","มุมมอง"]];
/** เมนู "ไฟล์" (ปุ่มซ้ายสุดของแถบแท็บ) — แปลน / นำออก / ไปที่ */
function rvFileMenuHtml(f, plan, plans){
  var it=function(act,attr,ic,label,dis){ return '<button class="rv-mi" data-act="'+act+'" '+(attr||'')+(dis?' disabled':'')+'>'+rvIc(ic,14)+'<span>'+esc(label)+'</span></button>'; };
  var h='<div class="rv-fmenu">';
  h+='<div class="rv-mh">แปลน</div>';
  h+=it("addPlan",'','plan','นำเข้าแปลนใหม่ (รูป / PDF)');
  h+='<button class="rv-mi" id="btnPickPlan"'+(plan?'':' disabled')+'>'+rvIc('img',14)+'<span>เปลี่ยนรูปของแปลนนี้</span></button>';
  h+=it("removePlan",'','trash','ลบแปลนนี้',!plan);
  h+='<div class="rv-msep"></div><div class="rv-mh">นำออก</div>';
  h+=it("exportPdf",'','pdf','ออก PDF — แปลน + ไฮไลท์');
  h+=it("exportProgressPdf",'','zone','ออก PDF — ความคืบหน้าเท');
  h+='<div class="rv-msep"></div>';
  h+=it("qatData",'','data','ข้อมูล / สำรอง');
  h+=it("back",'','back','กลับหน้าชั้น');
  return h+'</div>';
}
function rvRibbonHtml(type, f, plan, plans, selM){
  var prog=stageMode()==="progress";
  var rt=state.ribbonTab||"structure";
  if(rt==="modify" && !selM) rt=state.ribbonTab="structure";          // แท็บบริบทหายเมื่อเลิกเลือก
  if(rt==="file"||rt==="draw") rt=state.ribbonTab="structure";        // แท็บเก่าที่ยุบรวมแล้ว
  var isD=function(sh){ return state.tool==="draw" && (state.drawShape||"rect")===sh; };
  var dk=drawKind(type);
  var hasZone=!!(state.selZoneId&&getZone(state.selZoneId));
  var typeSel='<div class="rv-typesel"><span class="sel-dot" style="background:var(--t-'+TYPES[type].css+')"></span><select id="drawTypeSel" class="rv-sel" title="ชนิดที่วาด">'
    + TYPE_ORDER.map(function(t){ return '<option value="'+t+'"'+(t===type?" selected":"")+'>'+esc(TYPE_EN[t]||TYPES[t].label)+'</option>'; }).join("")+'<option value="__addtype">+ เพิ่มชนิด…</option></select></div>';
  var drawBtns = dk==="rect"
    ? rvBig(isD("rect"),"setShape",'data-shape="rect"','rect','สี่เหลี่ยม','วาดสี่เหลี่ยม  (R)')
      +rvBig(isD("poly"),"setShape",'data-shape="poly"','poly','หลายเหลี่ยม','วาดหลายเหลี่ยม  (P)')
      +rvBig(isD("oval"),"setShape",'data-shape="oval"','oval','วงรี','วาดวงรี  (O)')
    : rvBig(state.tool==="draw","setShape",'data-shape="rect"',dk==="point"?'point':'line',dk==="point"?'วางจุด':'วาดแนว','วาด  (R)');
  var selBtn=rvGrp('เลือก', rvBig(state.tool==="select"&&!state.marquee,"setTool",'data-tool="select"','sel','เลือก/ย้าย','เลือก/ย้าย  (V)')
    +rvBig(!!state.marquee,"toggleMarquee",'','box','ลากกรอบเลือก','ลากกรอบคลุมหลายชิ้นเพื่อเลือกพร้อมกัน — หรือกด Shift ค้างแล้วลากบนที่ว่าง · Shift+คลิก เพิ่ม/ลดทีละชิ้น  (M)'));
  var nSel=selIds().length;
  var body='';
  if(rt==="modify" && nSel>1){   // เลือกหลายชิ้น
    var allHidden=selIds().every(function(id){ var mm=getMember(id); return mm&&mm.hidden; });
    body+=rvGrp('ที่เลือก '+nSel+' ชิ้น', rvBig(false,"toggleHideSel",'',allHidden?'eye':'eyeOff',allHidden?'แสดงทั้งชุด':'ซ่อนทั้งชุด','ซ่อน/แสดงบนแปลนทุกชิ้นที่เลือก')
      +rvBig(false,"delSelected",'','trash','ลบทั้งชุด','ลบทุกชิ้นที่เลือก  (Delete)')
      +rvCol(rvSm(false,"zoomToSel",'','fit','ซูมไปหา')+rvSm(false,"clearSel",'','cross','เลิกเลือก','Esc')));
    body+=rvGrp('', '<div class="rv-hintbox">ลากที่ชิ้นใดก็ได้ในชุด = ย้ายทั้งชุด · Shift+คลิก เพิ่ม/ลดทีละชิ้น · Shift+ลากบนที่ว่าง เลือกเพิ่ม</div>');
  }else if(rt==="modify"){   // แท็บบริบท — โผล่เมื่อเลือกชิ้นส่วน (เหมือน Modify ของ Revit)
    var selT=memberTypeOf(selM), box=isBox(selM.plan);
    body+=rvGrp('ตรวจสอบ', rvBig(state.rightTab==="inspect","goInspect",'','check','ตรวจเหล็ก','เช็คลิสต์ตรวจเหล็กก่อนเท')+rvBig(false,"showDetails",'','img','รายละเอียด','ชีตรายละเอียด (รูป/ข้อความ/ตาราง)'));
    body+=rvGrp('แก้ไข', rvCol2(
       rvSm(false,"dupMember",'data-id="'+esc(selM.id)+'"','copy','ทำซ้ำ','ทำซ้ำชิ้นนี้')
      +rvSm(false,"toggleHide",'data-id="'+esc(selM.id)+'"',selM.hidden?'eyeOff':'eye',selM.hidden?'แสดง':'ซ่อน','ซ่อน/แสดงบนแปลน')
      +rvSm(false,"editMember",'','edit','แก้สเปก','แก้ไขข้อมูลเหล็ก')
      +rvSm(false,"delMember",'','trash','ลบ','ลบชิ้นนี้  (Delete)')));
    body+=rvGrp('ประเภท (รายละเอียดร่วม)',
       (selT ? rvBig(false,"typeSelect",'data-tid="'+esc(selT.id)+'"','link',selT.name,'ประเภท “'+selT.name+'” — ใช้ร่วมกัน '+typeMembers(selT.id).length+' ชิ้น · กดเพื่อจัดการ')
             : rvBig(false,"typeCreate",'','link','สร้างประเภท','สร้างประเภทจากชิ้นนี้ — แผ่นรายละเอียดจะใช้ร่วมกับชิ้นอื่นได้'))
      +rvCol(rvSm(false,"typeAssignSheet",'','wand',selT?'เปลี่ยนประเภท':'กำหนดประเภท','เลือกประเภทให้ชิ้นนี้')
        +(selT ? rvSm(false,"typeDetach",'','unlink','แยกออก','ถอดชิ้นนี้ออกจากประเภท') : rvSm(false,"assignSheet",'','wand','เทมเพลตเหล็ก','ใช้ข้อมูลเหล็กจากเทมเพลต'))));
    if(box) body+=rvGrp('สีกรอบ · '+selM.code,
      '<div class="rv-swatches">'+PRESET_COLORS.map(function(c){ var cur=(selM.plan.fill||"#f59e0b"); return '<button class="swatch'+(cur.toLowerCase()===c?" on":"")+'" data-swatch="'+c+'" title="'+c+'" style="background:'+c+'"></button>'; }).join("")+'</div>');
    body+=rvGrp('การเลือก', rvCol(rvSm(false,"zoomToSel",'','fit','ซูมไปหา','ซูมไปที่ชิ้นนี้')+rvSm(false,"clearSel",'','cross','เลิกเลือก','Esc')));
  }else if(rt==="annot"){
    var selA=state.selAnnotId?getAnnot(state.selAnnotId):null, selAr=(selA&&selA.kind==="area")?selA:null, sci=planScaleInfo();
    body+=selBtn;
    body+=rvGrp('เพิ่มหมายเหตุ', rvBig(state.tool==="drawCallout","drawCalloutStart",'','callout','กล่องข้อความ','ลากกรอบกล่อง แล้วพิมพ์ข้อความ  (C)')
      +rvBig(state.tool==="drawDim","drawDimStart",'','dim','เส้นบอกขนาด',sci.us>0?'ลากจากจุดหนึ่งไปอีกจุด — ตัวเลขคำนวณให้จากมาตราส่วน  (D)':'ลากจากจุดหนึ่งไปอีกจุด แล้วใส่ตัวเลข  (D)'));
    body+=rvGrp('มาตราส่วน · วัด', rvBig(state.tool==="setScale","setScaleStart",'','ruler','ตั้งมาตราส่วน', sci.src==="set"?'ตั้งใหม่ — ลาก 2 จุดที่รู้ระยะจริง (ตอนนี้ '+fmtScale(sci.us)+')':'ลาก 2 จุดที่รู้ระยะจริง (เช่น ศูนย์เสาถึงศูนย์เสา) แล้วใส่ตัวเลขเมตร — ตั้งครั้งเดียวต่อแปลน')
      +rvBig(state.tool==="drawArea","drawAreaStart",'','area','วัดพื้นที่','คลิกรอบพื้นที่ (ดับเบิลคลิกปิดรูป) หรือลากสี่เหลี่ยม — ได้ ตร.ม. และ ลบ.ม.  (A)')
      +rvCol('<div class="rv-seg"><button data-act="setAreaShape" data-shape="poly" aria-pressed="'+((state.areaShape||"poly")==="poly")+'" title="คลิกทีละมุม ดับเบิลคลิกเพื่อปิดรูป">คลิกเป็นรูปปิด</button><button data-act="setAreaShape" data-shape="rect" aria-pressed="'+(state.areaShape==="rect")+'" title="ลากสี่เหลี่ยมคลุมพื้นที่">ลากสี่เหลี่ยม</button></div>'
        +rvSm(state.tool==="drawHole","drawHoleStart",'','hole','หักช่องเปิด',selAr?'วาดช่องบันได/ช่องลิฟต์ทับ “'+selAr.name+'” เพื่อลบออกจากยอด':'เลือกพื้นที่ที่วัดไว้ก่อน แล้วค่อยวาดช่องที่จะหักออก',!selAr))
      +rvCol(rvSm(!!state.snap,"toggleSnap",'','snap','สแนบเส้น','ดูดเข้าเส้น/จุดตัดของแปลนตอนวัด  (S)')));
    body+=rvGrp('ปริมาณ', rvBig(false,"qtySummary",'','calc','สรุปปริมาณ','ตารางพื้นที่ × ความหนา = ลบ.ม. ของแปลนนี้ (ในพาเนลซ้าย)')
      +rvCol(rvSm(false,"areaToZone",'','zone','เก็บเป็นโซนเท',selAr?'สร้างโซนเทคอนกรีตรูปเดียวกับ “'+selAr.name+'”':'เลือกพื้นที่ที่วัดไว้ก่อน',!selAr)
        +rvSm(false,"areaCsv",'','data','ส่งออก CSV','ตารางพื้นที่ทั้งหมดของแปลนนี้เป็นไฟล์ CSV (เปิดใน Excel)')));
    if(selA) body+=rvGrp('หมายเหตุที่เลือก', rvCol(rvSm(false,"annotDup",'','copy','ทำซ้ำ','ทำซ้ำหมายเหตุที่เลือก')+rvSm(false,"annotDel",'','trash','ลบ','ลบหมายเหตุที่เลือก  (Delete)')));
    else if(!sci.src) body+=rvGrp('', '<div class="rv-hintbox">ยังไม่ตั้งมาตราส่วน — กด “ตั้งมาตราส่วน” แล้วลาก 2 จุดที่รู้ระยะ ตัวเลขพื้นที่/ระยะจึงจะคำนวณได้</div>');
    else body+=rvGrp('', '<div class="rv-hintbox">คลิกหมายเหตุ/พื้นที่บนแปลนเพื่อแก้ในแผงด้านขวา</div>');
  }else if(rt==="progress"){
    body+=selBtn;
    body+=rvGrp('วาดโซนเท', rvBig(state.tool==="drawZone"&&(state.zoneShape||"rect")==="rect","drawZoneStart",'data-shape="rect"','rect','สี่เหลี่ยม','วาดโซนสี่เหลี่ยม  (R)')
      +rvBig(state.tool==="drawZone"&&state.zoneShape==="poly","drawZoneStart",'data-shape="poly"','poly','หลายเหลี่ยม','วาดโซนหลายเหลี่ยม  (P)')
      +rvBig(state.tool==="drawZone"&&state.zoneShape==="oval","drawZoneStart",'data-shape="oval"','oval','วงรี','วาดโซนวงรี  (O)')
      +rvCol(rvSm(!!state.snap,"toggleSnap",'','snap','สแนบเส้น','ดูดเข้าเส้นแปลนตอนวาดโซน  (S)')));
    body+=rvGrp('โซน', rvCol((hasZone?rvSm(false,"deleteZone",'','trash','ลบโซนที่เลือก','ลบโซนที่เลือก'):'')+rvSm(false,"manageZoneStatus",'','gear','จัดการสถานะ + สี')));
    body+=rvGrp('นำออก', rvBig(false,"exportProgressPdf",'','pdf','PDF อัพเดท','นำออกความคืบหน้าเทคอนกรีต'));
  }else if(rt==="view"){
    body+=rvGrp('ลงสีตาม','<div class="rv-seg"><button data-act="colorMode" data-mode="status" aria-pressed="'+(state.colorMode==="status")+'">สถานะตรวจ</button><button data-act="colorMode" data-mode="plain" aria-pressed="'+(state.colorMode==="plain")+'">สีที่ตั้งเอง</button><button data-act="colorMode" data-mode="type" aria-pressed="'+(state.colorMode==="type")+'">ประเภท</button></div>');
    body+=rvGrp('ซูม', rvBig(false,"zoomFit",'','fit','พอดีจอ','ซูมพอดีจอ  (0)')+rvCol(rvSm(false,"zoomIn",'','zin','ซูมเข้า','(+)')+rvSm(false,"zoomOut",'','zout','ซูมออก','(−)')));
    body+=rvGrp('ค้นหา', rvBig(false,"focusSearch",'','search','ค้นหาเบอร์','Ctrl+F'));
    body+=rvGrp('พาเนล', rvCol(rvSm(!state.rpCollapsed,"toggleRp",'','panel','พาเนลซ้าย','แสดง/ซ่อนพาเนลซ้าย')+rvSm(false,"setPalette",'data-tab="tree"','folder','ผังโครงการ','เปิดแท็บผังโครงการในพาเนลซ้าย')));
    var _ls2=state.labelStyle||{};
    body+=rvGrp('แต่งป้ายเบอร์',
      '<div class="rv-labsty">'
      +'<label>สี<input type="color" id="labColor" value="'+esc(_ls2.color||"#1d2229")+'"><button class="lab-auto'+(_ls2.color?'':' on')+'" data-act="labelColorAuto" title="ใช้สีตัวอักษรอัตโนมัติ (ตามธีม)">อัตโนมัติ</button></label>'
      +'<label>ฟอนต์<select id="labFont" class="rv-in">'+ANNOT_FONTS.map(function(fn){ return '<option'+((_ls2.font||"JetBrains Mono")===fn?' selected':'')+'>'+esc(fn)+'</option>'; }).join("")+'</select></label>'
      +'<label>ขนาด<select id="labSize" class="rv-in">'+[16,18,20,22,26,30,36,44].map(function(nn){ return '<option value="'+nn+'"'+((+_ls2.size||22)==nn?' selected':'')+'>'+nn+'</option>'; }).join("")+'</select></label>'
      +'</div>');
    body+=rvGrp('แสดงบนแปลน', rvCol2(rvSm(!!state.showLabels,"toggleLabels",'','tag','ป้ายเบอร์','แสดง/ซ่อนป้ายเบอร์บนแปลน')+rvSm(!!state.showLegend,"toggleLegend",'','grid','ตารางสี')+rvSm(!!state.snap,"toggleSnap",'','snap','สแนบเส้น','(S)')+rvSm(!!state.showProgress,"toggleProgress",'','zone','โซนเท','แสดงโซนเทคอนกรีตบนแปลน')));
  }else{ // structure (หน้าแรก)
    body+=selBtn;
    body+=rvGrp('วาดชิ้นส่วน', drawBtns+rvCol(typeSel
      +'<div class="rv-seg"><button data-act="setPlanMode" data-mode="unified" aria-pressed="'+(state.unified)+'" title="แสดงทุกชนิดบนแปลน">รวมทุกชนิด</button><button data-act="setPlanMode" data-mode="focus" aria-pressed="'+(!state.unified)+'" title="แสดงเฉพาะชนิดที่เลือก">เฉพาะ '+esc(TYPE_EN[type]||TYPES[type].label)+'</button></div>'));
    if(!selM) body+=rvGrp('', '<div class="rv-hintbox">ลากบนแปลนเพื่อวาด · คลิกขวาที่ชิ้นเพื่อแก้ไข · ดับเบิลคลิก = ตรวจเหล็ก<br>สแนบ · เบอร์อัตโนมัติ · ป้ายเบอร์ · ตารางสี · โซนเท ย้ายไปแถบล่างแล้ว</div>');
  }
  var tabs='<button class="rv-tab rv-ftab'+(state.fileMenu?" on":"")+'" data-act="fileMenu" title="แปลน · นำออก · ข้อมูล">'+rvIc('folder',13)+'ไฟล์ ▾</button>'
    +(state.fileMenu?rvFileMenuHtml(f,plan,plans):'')
    +RV_TABS.map(function(t){ return '<button class="rv-tab'+(rt===t[0]?" on":"")+(t[0]==="progress"?" prog":"")+'" data-act="setRibbonTab" data-rtab="'+t[0]+'">'+esc(t[1])+'</button>'; }).join("")
    +(selM?'<button class="rv-tab ctx'+(rt==="modify"?" on":"")+'" data-act="setRibbonTab" data-rtab="modify" title="เครื่องมือของชิ้นที่เลือก">'+rvIc('edit',12)+(nSel>1?'แก้ไข · '+nSel+' ชิ้น':'แก้ไข · '+esc(selM.code))+'</button>':'');
  return '<div class="rv-tabs">'+tabs+'<span class="sp"></span><span class="rv-mode">'+(prog?'โหมด: เทคอนกรีต':'โหมด: ตรวจเหล็ก')+'</span></div><div class="rv-ribbon">'+body+'</div>';
}
/* ---- พาเนลคุณสมบัติ (ซ้ายบน) ---- */
function rvProw(k,v,mono){ return '<div class="rv-prow"><span>'+esc(k)+'</span><b'+(mono?' class="mono"':'')+'>'+v+'</b></div>'; }
function rvPh(t){ return '<div class="rv-ph">'+esc(t)+'</div>'; }
function rvStyleRows(sc,sa,sww,note){
  return (note?'<div class="rv-pnote">'+esc(note)+'</div>':'')
    +'<div class="rv-prow"><span>สีกรอบ</span><b><input type="color" id="drawColor" value="'+esc(sc)+'" class="rv-color"><span id="drawSwatch" class="rv-swpv" style="background:'+esc(sc)+';opacity:'+sa+'"></span><span class="mono">'+esc(sc)+'</span></b></div>'
    +'<div class="rv-prow"><span>ความเข้ม</span><b class="rv-range"><input type="range" id="drawAlpha" min="0" max="100" value="'+Math.round(sa*100)+'"><em data-for="drawAlpha">'+Math.round(sa*100)+'%</em></b></div>'
    +'<div class="rv-prow"><span>เส้นกรอบ</span><b class="rv-range"><input type="range" id="drawStroke" min="0" max="30" value="'+Math.round(sww)+'"><em data-for="drawStroke">'+Math.round(sww)+' px</em></b></div>'
    +'<div class="rv-prow"><span>สีใช้บ่อย</span><b><span class="rv-swatches">'+PRESET_COLORS.map(function(c){ return '<button class="swatch'+(sc.toLowerCase()===c?" on":"")+'" data-swatch="'+c+'" title="'+c+'" style="background:'+c+'"></button>'; }).join("")+'</span></b></div>';
}
function rvPaletteHtml(type, m, p, f, plans, plan){
  var prog=stageMode()==="progress";
  var view = state.rightTab==="tree" ? "tree" : (state.rightTab==="inspect" && !prog && m) ? "inspect" : "props";
  var h='<div class="rv-pal"><div class="rv-pal-h"><span>'+(view==="tree"?'ผังโครงการ':view==="inspect"?'ตรวจเหล็ก':'คุณสมบัติ')+'</span>'
    +'<span class="rv-pal-tabs"><button class="'+(view==="props"?"on":"")+'" data-act="setPalette" data-tab="props">คุณสมบัติ</button>'
    +(prog?'':'<button class="'+(view==="inspect"?"on":"")+'" data-act="setPalette" data-tab="inspect"'+(m?'':' disabled')+' title="'+(m?'เช็คลิสต์ตรวจเหล็กของชิ้นที่เลือก':'เลือกชิ้นส่วนก่อน')+'">ตรวจเหล็ก</button>')
    +'<button class="'+(view==="tree"?"on":"")+'" data-act="setPalette" data-tab="tree" title="แปลน · ชิ้นส่วน · ประเภท · โซน">ผัง</button></span>'
    +'</div><div class="rv-pal-b">';
  if(view==="tree"){
    h+=rvTreeHtml(type, p, f, plans, plan);
  }else if(view==="inspect"){
    h+='<div class="rv-type">'+rvIc('check',18)+'<div><b>ตรวจเหล็ก · '+esc(m.code)+'</b><small>'+esc(TYPES[m.type].label)+' · '+esc(shortSpec(m)||"")+'</small></div></div>';
    if(m.note) h+='<div class="note-warn" style="margin:8px 10px">'+esc(m.note)+'</div>';
    h+='<div class="rv-inspect">'+inspectionBlockHtml(m)+'</div>';
  }else if(prog){
    var _f=getFloor(state.floorId), _pid=curPlanId(), stList=zoneStatuses(_f.id,_pid);
    var z=state.selZoneId?getZone(state.selZoneId):null;
    if(z){
      var zs=stList.filter(function(s){return s.id===z.status;})[0]||{color:"#94a3b8",label:z.status||"—"};
      h+='<div class="rv-type"><span class="rv-zdot" style="background:'+zs.color+'"></span><div><b>โซนเท · '+esc(z.name)+'</b><small>'+esc(zs.label)+(z.date?' · '+esc(z.date):'')+'</small></div></div>';
      h+=rvPh('ข้อมูลโซน');
      h+='<div class="rv-prow"><span>ชื่อ</span><b><input type="text" id="zoneNameInput" value="'+esc(z.name)+'" class="rv-in"></b></div>';
      h+='<div class="rv-prow"><span>สถานะ</span><b><select id="zoneStatusSel" class="rv-in">'+stList.map(function(s){ return '<option value="'+esc(s.id)+'"'+(z.status===s.id?" selected":"")+'>'+esc(s.label)+'</option>'; }).join("")+'</select></b></div>';
      h+='<div class="rv-prow"><span>วันที่</span><b><input type="date" id="zoneDateInput" value="'+esc(z.date||"")+'" class="rv-in"></b></div>';
      h+=rvPh('การจัดการ');
      h+='<div class="rv-pacts"><button class="btn danger" data-act="deleteZone" data-zid="'+esc(z.id)+'">'+rvIc('trash',14)+' ลบโซน</button><button class="btn soft" data-act="manageZoneStatus">'+rvIc('gear',14)+' สถานะ + สี</button></div>';
    }else{
      var zones=zonesOfPlan(_f.id,_pid), cnt={}; zones.forEach(function(q){ cnt[q.status]=(cnt[q.status]||0)+1; });
      h+='<div class="rv-type">'+rvIc('zone',18)+'<div><b>เทคอนกรีต</b><small>'+zones.length+' โซนบนแปลนนี้</small></div></div>';
      h+=rvPh('สรุปโซน');
      stList.forEach(function(s){ h+='<div class="rv-prow"><span><i class="rv-zdot sm" style="background:'+s.color+'"></i>'+esc(s.label)+'</span><b>'+(cnt[s.id]||0)+'</b></div>'; });
      h+='<div class="rv-pnote">คลิกโซนบนแปลน หรือเลือกจากแท็บ “ผัง” เพื่อแก้ชื่อ / สถานะ / วันที่</div>';
    }
  }else if(!m && state.selTypeId && getType(state.selTypeId)){
    h+=typePaletteHtml(getType(state.selTypeId));
  }else if(m && selIds().length>1){
    var _ids=selIds(), _sm=summarize(_ids.map(getMember).filter(Boolean));
    h+='<div class="rv-type">'+rvIc('box',18)+'<div><b>เลือก '+_ids.length+' ชิ้น</b><small>ผ่าน '+_sm.pass+' · ไม่ผ่าน '+_sm.fail+' · รอตรวจ '+_sm.todo+'</small></div></div>';
    h+=rvPh('ชิ้นที่เลือก');
    h+='<div class="rv-pnote" style="display:flex;flex-wrap:wrap;gap:4px">'+_ids.map(function(id){ var x=getMember(id); return x?'<span class="pj-chip"><i style="background:var(--t-'+TYPES[x.type].css+')"></i>'+esc(x.code)+'</span>':''; }).join('')+'</div>';
    h+='<div class="rv-pnote">ลากที่ชิ้นใดก็ได้ = ย้ายทั้งชุด · Shift+คลิก เพิ่ม/ลด · ซ่อน/ลบทั้งชุดอยู่ในแท็บ “แก้ไข · '+_ids.length+' ชิ้น”</div>';
  }else if(m){
    var ins=lastInspection(m.id), st=memberStatus(m);
    var stTx = st==="pass"?'<span class="ok">● ผ่าน พร้อมเท</span>' : st==="fail"?'<span class="bad">● ต้องแก้ไข</span>' : '<span class="wait">● รอตรวจ</span>';
    h+='<div class="rv-type"><span class="rv-tdot" style="background:var(--t-'+TYPES[m.type].css+')"></span><div><b>'+esc(TYPES[m.type].label)+' · <button class="rv-editcode" data-act="renameMember" title="แก้ชื่อ/เบอร์ชิ้นส่วน">'+esc(m.code)+' '+rvIc("edit",12)+'</button></b></div></div>';
    h+=rvPh('สถานะการตรวจ');
    h+=rvProw('ผลตรวจ',stTx)+(ins?rvProw('ผู้ตรวจ',esc(ins.inspector||"—"))+rvProw('วันที่',esc(new Date(ins.ts).toLocaleDateString('th-TH',{year:'2-digit',month:'short',day:'numeric'})),1):'');
    if(m.note) h+=rvProw('หมายเหตุ',esc(m.note));
    h+=typePaletteRowHtml(m);
    if(isBox(m.plan)){ h+=rvPh('การแสดงผลบนแปลน'); h+=rvStyleRows(m.plan.fill||"#f59e0b",(m.plan.fillA!=null?m.plan.fillA:0.28),(m.plan.strokeW!=null?m.plan.strokeW:10),null);
      h+=rvPh('ป้ายเบอร์ (เฉพาะกล่องนี้)');
      var _bls=state.labelStyle||{}, _blc=m.plan.labelColor||_bls.color||"#1d2229", _blf=m.plan.labelFont||_bls.font||"JetBrains Mono";
      h+='<div class="rv-prow"><span>สีตัวเลข</span><b><input type="color" id="boxLabColor" value="'+esc(_blc)+'" class="rv-color">'+((m.plan.labelColor||m.plan.labelFont)?'<button class="lab-auto on" data-act="boxLabelReset" title="กลับไปใช้ค่าเริ่มต้น (ตามแท็บมุมมอง)">ค่าเริ่มต้น</button>':'<span class="mono" style="opacity:.55;font-size:10.5px">= ค่ารวม</span>')+'</b></div>';
      h+='<div class="rv-prow"><span>ฟอนต์</span><b><select id="boxLabFont" class="rv-in" style="width:150px">'+ANNOT_FONTS.map(function(fn){ return '<option'+(_blf===fn?' selected':'')+'>'+esc(fn)+'</option>'; }).join("")+'</select></b></div>';
      h+='<div class="rv-pnote">ปรับสี/ฟอนต์ของเลขกล่องนี้ · ตั้งค่ารวมทุกกล่องได้ที่แท็บ “มุมมอง”</div>';
    }
    h+='<div class="rv-pnote">ตรวจเหล็ก · รายละเอียด · ทำซ้ำ · ลบ อยู่ในแท็บริบบอน “แก้ไข · '+esc(m.code)+'” (หรือคลิกขวาที่ชิ้น)</div>';
  }else{
    var fl=getFloor(state.floorId), pl=fl?getFloorPlan(fl):null;
    h+='<div class="rv-type">'+rvIc('plan',18)+'<div><b>แปลน · '+esc(pl?(pl.name||"แปลน"):"ยังไม่มีแปลน")+'</b><small>'+esc(fl?fl.name:"")+(pl&&pl.w?' · '+pl.w+'×'+pl.h+' px':'')+'</small></div></div>';
    h+='<div class="rv-pnote">ยังไม่ได้เลือกอะไร — คลิกชิ้นส่วนบนแปลน หรือเปิดแท็บ “ผัง” เพื่อเลือกจากรายการ</div>';
    var _areas=pl?areasOfPlan(fl.id,curPlanId()):[];
    if(pl && (_areas.length || state.ribbonTab==="annot")) h+=qtySummaryHtml(fl,pl,_areas);
    if(drawKind(type)==="rect"){
      var _nbox=membersOfFloor(fl.id).filter(function(mm){ return mm.plan && isBox(mm.plan) && memberPlanId(mm)===curPlanId(); }).length;
      h+=rvPh(_nbox?'สีกรอบ · กล่องทั้งหมดในแปลนนี้ ('+_nbox+')':'สไตล์กรอบเริ่มต้น');
      h+=rvStyleRows(state.fillColor,state.fillAlpha,state.strokeW,_nbox?'ลากเพื่อปรับ '+_nbox+' กล่องพร้อมกันทันที · หรือคลิกเลือกกล่องเดียวเพื่อปรับเฉพาะตัว':'ใช้กับ'+TYPES[type].label+'ที่วาดใหม่');
    }
  }
  return h+'</div></div>';
}
/* ---- ประเภทชิ้นส่วน ในพาเนลคุณสมบัติ ---- */
/** ตัวเลือกใน dropdown ประเภท (ใช้ทั้งพาเนลคอมและแผงมือถือ) */
function typeSelOptionsHtml(m){
  var t=memberTypeOf(m), opts=typesOf(m.projectId,m.type);
  return '<option value=""'+(t?'':' selected')+'>— ไม่มี (รายละเอียดของตัวเอง) —</option>'
    +opts.map(function(x){ return '<option value="'+esc(x.id)+'"'+(t&&t.id===x.id?' selected':'')+'>'+esc(x.name)+' ('+typeMembers(x.id).length+')</option>'; }).join("")
    +'<option value="__new">＋ สร้างประเภทใหม่จากชิ้นนี้…</option>';
}
/** แถว "ประเภท" ของชิ้นที่เลือก — dropdown เลือก = ผูกทันที */
function typePaletteRowHtml(m){
  var t=memberTypeOf(m), opts=typesOf(m.projectId,m.type);
  var h=rvPh('ประเภท — แผ่นรายละเอียดใช้ร่วมกัน');
  h+='<div class="rv-prow"><span>ประเภท</span><b><select id="typeSel" class="rv-in" style="width:176px">'+typeSelOptionsHtml(m)+'</select></b></div>';
  if(t){
    var n=typeMembers(t.id).length;
    h+='<div class="rv-prow"><span><i class="rv-zdot sm" style="background:'+esc(t.color||"#2563eb")+'"></i>ใช้ร่วมกัน</span><b>'+n+' ชิ้น</b></div>';
    h+='<div class="rv-pnote">🔗 รูป/ข้อความ/ตาราง ในหน้ารายละเอียดของ “'+esc(t.name)+'” ใช้ร่วมกันทั้ง '+n+' ชิ้น — แก้ที่ชิ้นไหนก็เปลี่ยนทุกชิ้น</div>';
    h+='<div class="rv-pacts"><button class="btn soft" data-act="showDetails">'+rvIc('img',14)+' เปิดรายละเอียด</button><button class="btn soft" data-act="typeSelect" data-tid="'+esc(t.id)+'">'+rvIc('gear',14)+' จัดการประเภท</button></div>';
  }else{
    h+='<div class="rv-pnote">ยังไม่ผูกประเภท — เลือกจากรายการด้านบน หรือ “สร้างประเภทใหม่จากชิ้นนี้” เพื่อให้ชิ้นอื่นใช้รายละเอียดเดียวกัน</div>';
  }
  return h;
}
/** การ์ดประเภท (เมื่อกดประเภทในผังโครงการ) — ชื่อ / สี / รายชื่อชิ้นที่ใช้ / ลบ */
function typePaletteHtml(t){
  var ms=typeMembers(t.id).slice().sort(function(a,b){ return String(a.code).localeCompare(String(b.code)); });
  var h='<div class="rv-type"><span class="rv-tdot" style="background:'+esc(t.color||"#2563eb")+'"></span><div><b>ประเภท · '+esc(t.name)+'</b><small>'+esc((TYPES[t.mtype]||{}).label||t.mtype)+' · ใช้ร่วมกัน '+ms.length+' ชิ้น</small></div></div>';
  h+=rvPh('ข้อมูลประเภท');
  h+='<div class="rv-prow"><span>ชื่อ</span><b><input type="text" id="typeNameInput" value="'+esc(t.name)+'" class="rv-in"></b></div>';
  h+='<div class="rv-prow"><span>สี</span><b><span class="rv-swatches">'+TYPE_COLORS.map(function(c){ return '<button class="tswatch'+((t.color||"").toLowerCase()===c?" on":"")+'" data-act="typeColor" data-tid="'+esc(t.id)+'" data-c="'+c+'" style="background:'+c+'" title="'+c+'"></button>'; }).join("")+'</span></b></div>';
  h+='<div class="rv-pnote">🔗 แผ่นรายละเอียด '+typeDoc(t).els.length+' รายการ — ทุกชิ้นด้านล่างเห็นและแก้แผ่นเดียวกัน</div>';
  h+=rvPh('ชิ้นส่วนที่ใช้ประเภทนี้ ('+ms.length+')');
  if(ms.length){
    ms.forEach(function(x){ var fl=getFloor(x.floorId);
      h+='<button class="rv-mrow" data-act="typeGoMember" data-id="'+esc(x.id)+'"><i class="rv-dot '+memberStatus(x)+'"></i><span class="mono">'+esc(x.code)+'</span><em>'+esc(fl?fl.name:"")+(x.plan?'':' · ยังไม่วาง')+'</em></button>'; });
  }else h+='<div class="rv-pnote">ยังไม่มี — เลือกชิ้นบนแปลน แล้วเลือกประเภทนี้ในช่อง “ประเภท”</div>';
  h+=rvPh('การจัดการ');
  h+='<div class="rv-pacts"><button class="btn" data-act="typeOpenDetail" data-tid="'+esc(t.id)+'"'+(ms.length?'':' disabled')+'>'+rvIc('img',14)+' เปิดรายละเอียด</button>'
    +'<button class="btn danger" data-act="typeDeleteBtn" data-tid="'+esc(t.id)+'">'+rvIc('trash',14)+' ลบประเภท</button></div>';
  return h;
}
/* ---- ผังโครงการ (ซ้ายล่าง) ---- */
function rvBrowserHtml(type, p, f, plans, plan){
  var open=(state.browserOpen!==false);
  var h='<div class="rv-br'+(open?"":" closed")+'"><div class="rv-pal-h rv-br-h" data-act="toggleBrowser" title="ย่อ/ขยาย"><span class="rv-chev">'+rvIc('chev',12)+'</span><span>ผังโครงการ</span></div>';
  if(!open) return h+'</div>';
  return h+rvTreeHtml(type,p,f,plans,plan)+'</div>';
}
/** ต้นไม้ผังโครงการ — ใช้ทั้งแท็บ "ผัง" ของพาเนลคอม และแผง "เพิ่มเติม" ของมือถือ */
function rvTreeHtml(type, p, f, plans, plan){
  var _pid=curPlanId(), prog=stageMode()==="progress";
  var all=membersOfFloor(state.floorId).filter(function(x){ return memberPlanId(x)===_pid; });
  var zones=f?zonesOfPlan(f.id,_pid):[];
  var tps=typesOf(state.projectId);
  var others=plans.filter(function(pp){ return !f || pp.id!==f.activePlanId; });
  var to=state.treeOpen||(state.treeOpen={members:true,types:false,zones:false,plans:false});
  var zOpen=to.zones||prog;
  var sec=function(id,label,cnt,open,plusAct,plusTitle){
    return '<div class="tr-sec'+(open?' open':'')+'"><button class="tr-sech" data-act="treeToggle" data-sec="'+id+'"><span class="tr-chev">'+rvIc('chev',10)+'</span><span>'+esc(label)+'</span><span class="tr-cnt">'+cnt+'</span></button>'
      +(plusAct?'<button class="tr-plus" data-act="'+plusAct+'" title="'+esc(plusTitle||'')+'">'+rvIc('plus',12)+'</button>':'')+'</div>';
  };
  var h='<div class="rv-tree tr">';
  // แปลนที่กำลังดู
  h+='<div class="tr-plan">'+rvIc('plan',13)+'<span>'+esc(plan?(plan.name||"แปลน"):"ยังไม่มีแปลน")+'</span>'+(plan&&plan.w?'<small>'+plan.w+'×'+plan.h+'</small>':'')+'</div>';
  // ชิ้นส่วน — ชนิดเป็นเส้นคั่น
  h+=sec('members','ชิ้นส่วน',all.length,to.members,'addInCat','เพิ่ม'+TYPES[type].label+'ด้วยฟอร์ม');
  if(to.members){
    TYPE_ORDER.forEach(function(t){
      var list=all.filter(function(x){ return x.type===t; }); if(!list.length) return;
      var vis=!(state.hiddenTypes&&state.hiddenTypes[t]);
      h+='<div class="tr-lab'+(vis?'':' off')+'"><span class="rv-tsw" style="background:var(--t-'+TYPES[t].css+')"></span><span>'+esc(TYPES[t].label)+'</span><i></i>'
        +(state.unified?'<button class="rv-tbtn" data-act="toggleLayer" data-type="'+t+'" title="'+(vis?"ซ่อนเลเยอร์":"แสดงเลเยอร์")+'">'+rvIc(vis?'eye':'eyeOff',12)+'</button>':'')+'</div>';
      list.sort(function(a,b){ return String(a.code).localeCompare(String(b.code)); }).forEach(function(x){
        var st=memberStatus(x), tt=memberTypeOf(x);
        h+='<button class="tr-li'+(x.id===state.selMemberId?" on":"")+(x.hidden?" hid":"")+'" data-act="browserSelect" data-id="'+esc(x.id)+'" title="'+esc(shortSpec(x)||"")+'">'
          +'<i class="rv-dot '+st+'"></i><span class="mono">'+esc(x.code)+'</span>'
          +(tt?'<span class="tr-link" title="ประเภท '+esc(tt.name)+'">'+rvIc('link',10)+esc(tt.name)+'</span>':'')
          +(x.plan?'':'<span class="tr-link">ยังไม่วาง</span>')
          +'<span class="rv-tbtn" data-act="toggleHide" data-id="'+esc(x.id)+'" title="'+(x.hidden?"แสดงบนแปลน":"ซ่อนบนแปลน")+'">'+rvIc(x.hidden?'eyeOff':'eye',12)+'</span></button>';
      });
    });
    if(!all.length) h+='<div class="tr-muted">ยังไม่มี — วาดจากแท็บ “โครงสร้าง” หรือกด ＋ เพื่อเพิ่มด้วยฟอร์ม</div>';
  }
  // ประเภท (แผ่นรายละเอียดร่วม)
  h+=sec('types','ประเภทชิ้นส่วน',tps.length,to.types,'typeCreate','สร้างประเภทจากชิ้นที่เลือก');
  if(to.types){
    TYPE_ORDER.forEach(function(t){
      var tl=tps.filter(function(x){ return x.mtype===t; }); if(!tl.length) return;
      h+='<div class="tr-lab"><span class="rv-tsw" style="background:var(--t-'+TYPES[t].css+')"></span><span>'+esc(TYPES[t].label)+'</span><i></i></div>';
      tl.forEach(function(x){
        h+='<button class="tr-li'+(!state.selMemberId&&x.id===state.selTypeId?" on":"")+'" data-act="typeSelect" data-tid="'+esc(x.id)+'" title="'+esc(x.name)+'"><span class="rv-tsw" style="background:'+esc(x.color||"#2563eb")+'"></span><span class="mono">'+esc(x.name)+'</span><em>'+typeMembers(x.id).length+' ชิ้น</em></button>';
      });
    });
    if(!tps.length) h+='<div class="tr-muted">ยังไม่มี — เลือกชิ้นบนแปลน แล้วกด ＋ หรือ “สร้างประเภท” ในแท็บแก้ไข</div>';
  }
  // โซนเท
  h+=sec('zones','โซนเทคอนกรีต',zones.length,zOpen,null);
  if(zOpen){
    zones.forEach(function(z){
      var stz=(zoneStatuses(f.id,_pid).filter(function(q){return q.id===z.status;})[0]||{color:"#94a3b8"});
      h+='<button class="tr-li'+(prog&&z.id===state.selZoneId?" on":"")+'" data-act="selectZone" data-zid="'+esc(z.id)+'"><i class="rv-zdot sm" style="background:'+stz.color+'"></i><span>'+esc(z.name)+'</span><em>'+esc(z.date||"")+'</em></button>';
    });
    if(!zones.length) h+='<div class="tr-muted">ยังไม่มี — วาดจากแท็บ “เทคอนกรีต”</div>';
  }
  // แปลนอื่นในชั้นนี้
  h+=sec('plans','แปลนอื่นในชั้นนี้',others.length,to.plans,'addPlan','นำเข้าแปลนใหม่');
  if(to.plans){
    others.forEach(function(pp){ h+='<button class="tr-li" data-act="switchPlan" data-pid="'+esc(pp.id)+'">'+rvIc('plan',12)+'<span>'+esc(pp.name||"แปลน")+'</span></button>'; });
    if(!others.length) h+='<div class="tr-muted">มีแปลนเดียว — กด ＋ เพื่อนำเข้าเพิ่ม</div>';
  }
  return h+'</div>';
}
/* ---- แถบวิว (แท็บแปลน) + แถบสถานะ ---- */
function rvViewTabsHtml(f, plans){
  var h='<div class="rv-vtabs">';
  plans.forEach(function(pp){ h+='<button class="rv-vt'+(pp.id===f.activePlanId?" on":"")+'" data-act="switchPlan" data-pid="'+esc(pp.id)+'">'+rvIc('plan',12)+esc(pp.name||"แปลน")+'</button>'; });
  if(!plans.length) h+='<span class="rv-vt on">ยังไม่มีแปลน</span>';
  h+='<button class="rv-vt add" data-act="addPlan" title="นำเข้าแปลนใหม่">+</button>';
  h+='<span class="sp"></span><span class="rv-vinfo">'+(stageMode()==="progress"?'โหมด: เทคอนกรีต':'โหมดสี: '+(state.colorMode==="status"?'สถานะตรวจ':state.colorMode==="type"?'ประเภท':'สีที่ตั้งเอง'))+(state.unified?' · รวมทุกชนิด':' · เฉพาะ '+esc(TYPES[state.catType].label))+'</span>';
  return h+'</div>';
}
function rvStatusHtml(vm, selM){
  var prog=stageMode()==="progress";
  var _sa=state.selAnnotId?getAnnot(state.selAnnotId):null;
  var msg = state.tool==="draw" ? 'โหมดวาด — ลากบนแปลน'+(state.autoCode?' · เบอร์ถัดไป '+nextCode(state.catType)+' (อัตโนมัติ)':'')+' · Esc ยกเลิก'
          : state.tool==="drawZone" ? 'วาดโซนเท — ลากคลุมพื้นที่ · Esc ยกเลิก'
          : state.tool==="drawCallout" ? 'กล่องข้อความ — ลากกรอบบนแปลน · Esc ยกเลิก'
          : state.tool==="drawDim" ? 'เส้นบอกขนาด — ลากจากจุดถึงจุด · Esc ยกเลิก'
          : state.tool==="setScale" ? 'ตั้งมาตราส่วน — ลาก 2 จุดที่รู้ระยะจริง แล้วใส่ตัวเลขเมตร · Esc ยกเลิก'
          : state.tool==="drawArea" ? 'วัดพื้นที่ — '+(state.areaShape==="rect"?'ลากสี่เหลี่ยมคลุมพื้นที่':'คลิกทีละมุม · ดับเบิลคลิกหรือคลิกจุดแรกเพื่อปิดรูป')+' · Esc ยกเลิก'
          : state.tool==="drawHole" ? 'หักช่องเปิด — วาดช่องทับพื้นที่ที่เลือก · Esc ยกเลิก'
          : _sa ? 'เลือก '+(_sa.kind==="dim"?'เส้นบอกขนาด':_sa.kind==="area"?'พื้นที่ '+(_sa.name||''):'กล่องข้อความ')
          : state.marquee ? 'ลากกรอบเลือก — ลากคลุมชิ้นบนแปลน · Esc ยกเลิก'
          : selIds().length>1 ? 'เลือก '+selIds().length+' ชิ้น — ลากย้ายทั้งชุด · Shift+คลิก เพิ่ม/ลด'
          : selM ? 'เลือก '+selM.code+' ('+TYPES[selM.type].label+')'
          : (state.selZoneId&&getZone(state.selZoneId)) ? 'เลือกโซน '+getZone(state.selZoneId).name
          : 'พร้อม';
  var _sci=planScaleInfo();
  var h='<div class="rv-status"><span class="rv-smsg">'+esc(msg)+'</span><span class="sp"></span>'
    +(_sci.plan ? '<button class="rv-sc'+(_sci.src?'':' warn')+'" data-act="setScaleStart" title="'+(_sci.src?'มาตราส่วนของแปลนนี้'+(_sci.src==="dim"?' (เดาจากเส้นบอกขนาดเส้นแรก)':' (ตั้งเอง)')+' — กดเพื่อตั้งใหม่':'ยังไม่ตั้งมาตราส่วน — กดเพื่อลาก 2 จุดที่รู้ระยะ')+'"><b>'+(_sci.src?'สเกล':'!')+'</b> '+esc(_sci.src?fmtScale(_sci.us):'ยังไม่ตั้งสเกล')+'</button>' : '');
  if(!prog){
    var sm=summarize(vm), sf=state.statusFilter||null;
    var chip=function(id,lbl,n,cls){ return '<button class="rv-sc '+cls+((sf===id)||(id==="all"&&!sf)?" on":"")+'" data-act="statusFilter" data-st="'+id+'" title="กดเพื่อกรอง"><b>'+n+'</b> '+lbl+'</button>'; };
    h+=chip("all","ชิ้น",sm.total,"")+chip("pass","ผ่าน",sm.pass,"ok")+chip("fail","ไม่ผ่าน",sm.fail,"bad")+chip("todo","รอตรวจ",sm.todo,"wait");
    var _unp=membersOfFloor(state.floorId).filter(function(m){ return !m.plan; }).length;
    if(_unp) h+='<button class="rv-sc warn" data-act="warnUnplaced" title="มีชิ้นส่วนที่เพิ่มด้วยฟอร์มแต่ยังไม่ได้วาดตำแหน่งบนแปลน — กดเพื่อดูรายชื่อ">⚠ <b>'+_unp+'</b> ยังไม่วาง</button>';
  }else{
    var f=getFloor(state.floorId), zones=zonesOfPlan(f.id,curPlanId()), cnt={}; zones.forEach(function(z){ cnt[z.status]=(cnt[z.status]||0)+1; });
    h+='<span class="rv-sc static"><b>'+zones.length+'</b> โซน</span>';
    zoneStatuses(f.id,curPlanId()).forEach(function(s){ h+='<span class="rv-sc static"><i class="rv-zdot sm" style="background:'+s.color+'"></i><b>'+(cnt[s.id]||0)+'</b> '+esc(s.label)+'</span>'; });
  }
  h+='<span class="rv-ssep"></span>';
  var _stBtn=function(on,act,ic,lbl,tt){ return '<button class="rv-st'+(on?" on":"")+'" data-act="'+act+'" title="'+esc(tt||lbl)+'">'+rvIc(ic,13)+lbl+'</button>'; };
  h+=_stBtn(state.snap,"toggleSnap","snap","สแนบ","ดูดเข้าเส้น/จุดตัดของแปลน  (S)");
  if(!prog) h+=_stBtn(state.autoCode,"toggleAutoCode","wand","เบอร์อัตโนมัติ","วาดต่อเนื่อง ใส่เบอร์ถัดไปให้เอง — แก้ทีหลังได้");
  h+=_stBtn(state.showLabels,"toggleLabels","tag","ป้ายเบอร์","แสดง/ซ่อนป้ายเบอร์บนแปลน")
    +_stBtn(state.showLegend,"toggleLegend","grid","ตารางสี","แสดง/ซ่อนตารางสีบนแปลน")
    +_stBtn(state.showProgress,"toggleProgress","zone","โซนเท","แสดง/ซ่อนโซนเทคอนกรีตบนแปลน");
  h+='<span class="rv-ssep"></span><span class="rv-zoom"><button data-act="zoomOut" title="ซูมออก (−)">−</button><span id="zoomLabel">'+Math.round((state.zoom||1)*100)+'%</span><button data-act="zoomIn" title="ซูมเข้า (+)">+</button></span>';
  return h+'</div>';
}
/* ---- แผง "รูปแบบ" ทางขวา (แนว Foxit) — โผล่เมื่อเลือกหมายเหตุ ---- */
var ANNOT_FONTS=["Sarabun","Tahoma","Arial","Times New Roman","JetBrains Mono"];
var ANNOT_SIZES=[9,10,11,12,14,16,18,22,28];
var ANNOT_SWATCH=["#1d4ed8","#c2410c","#dc2626","#16a34a","#7c3aed","#0f172a"];
function fxArrowRow(which, cur){
  return '<div class="fx-arr">'+ANNOT_ARROWS.map(function(t){
    return '<button class="'+(cur===t[0]?"on":"")+'" data-act="annotArrow" data-which="'+which+'" data-v="'+t[0]+'" title="'+esc(t[2])+'">'+t[1]+'</button>';
  }).join("")+'</div>';
}
function fxKv(k,v){ return '<div class="fx-kv"><span>'+esc(k)+'</span><b>'+v+'</b></div>'; }
/** แผงด้านขวาของ "พื้นที่ที่วัด": ชื่อ · ความหนา · ตัวเลข (ตร.ม./รอบรูป/ลบ.ม.) · ช่องเปิด · สี · ทำเป็นโซนเท */
function areaFormatHtml(a){
  var mt=areaMetrics(a), col=(a.color||AREA_COL).toLowerCase();
  var h='<div class="fx" id="annotFormat"><div class="fx-h"><span>พื้นที่ที่วัด</span><button class="fx-x" data-act="annotClose" title="ปิด">✕</button></div><div class="fx-b">';
  h+='<div class="fx-s">ชื่อ</div><div class="fx-r"><input class="fx-in" id="annotText" style="flex:1" value="'+_hx(a.name||"")+'" placeholder="เช่น พื้น S1"></div>';
  h+='<div class="fx-s">ความหนา (ม.)</div><div class="fx-r"><input class="fx-in" id="areaThick" type="number" step="0.01" min="0" style="width:70px" value="'+_hx(a.thick!=null?a.thick:0.2)+'"><span class="fx-lb">× พื้นที่สุทธิ = ลบ.ม.</span></div>';
  h+='<div class="fx-s">ตัวเลข</div>';
  if(mt){
    h+=fxKv('พื้นที่รวม',fmtNum(mt.gross,2)+' ตร.ม.')
      +((a.holes||[]).length?fxKv('หักช่องเปิด ('+a.holes.length+')','− '+fmtNum(mt.hole,2)+' ตร.ม.'):'')
      +fxKv('สุทธิ','<b>'+fmtNum(mt.net,2)+' ตร.ม.</b>')
      +fxKv('เส้นรอบรูป',fmtNum(mt.perim,2)+' ม.')
      +fxKv('กว้าง × ยาว',fmtNum(mt.w,2)+' × '+fmtNum(mt.h,2)+' ม.')
      +fxKv('ปริมาตร','<b>'+fmtNum(mt.vol,2)+' ลบ.ม.</b>');
  }else h+='<div class="fx-note warn">ยังไม่ตั้งมาตราส่วนของแปลนนี้ — กด “ตั้งมาตราส่วน” ในริบบอน แล้วลาก 2 จุดที่รู้ระยะจริง</div>';
  h+='<div class="fx-s">ช่องเปิด (บันได / ลิฟต์)</div><div class="fx-r" style="flex-wrap:wrap"><button class="btn soft" data-act="drawHoleStart">'+rvIc('hole',13)+' หักช่องเปิด</button>'
    +((a.holes||[]).length?'<button class="btn soft" data-act="areaClearHoles">ล้างช่อง ('+a.holes.length+')</button>':'')+'</div>';
  h+='<div class="fx-s">สี</div><div class="fx-btns">'+ANNOT_SWATCH.map(function(c){ return '<button class="fx-sw'+(col===c?" on":"")+'" data-act="annotSwatch" data-c="'+c+'" style="background:'+c+'" title="'+c+'"></button>'; }).join("")+'</div>';
  h+='<div class="fx-acts"><button class="btn soft" data-act="areaToZone">'+rvIc('zone',14)+' เป็นโซนเท</button><button class="btn soft" data-act="annotDup">'+rvIc('copy',14)+' ทำซ้ำ</button><button class="btn danger" data-act="annotDel" style="grid-column:1/-1">'+rvIc('trash',14)+' ลบพื้นที่</button></div>';
  return h+'</div></div>';
}
/** ตารางสรุปปริมาณของแปลนนี้ (พาเนลซ้าย): พื้นที่สุทธิ × ความหนา = ลบ.ม. */
function qtySummaryHtml(f,pl,list){
  var sci=planScaleInfo(), h=rvPh('สรุปปริมาณ — พื้นที่ที่วัด');
  h+='<div class="rv-prow"><span>มาตราส่วน</span><b>'+(sci.src?esc(fmtScale(sci.us)):'<span class="bad">ยังไม่ตั้ง</span>')+'</b></div>';
  if(!list.length){ h+='<div class="rv-pnote">ยังไม่มีพื้นที่ — กด “วัดพื้นที่” ในแท็บหมายเหตุ แล้วคลิกรอบพื้นที่บนแปลน</div>'; return h; }
  var ta=0,tv=0,rows='';
  list.forEach(function(a){ var mt=areaMetrics(a,pl); if(mt){ ta+=mt.net; tv+=mt.vol; }
    rows+='<tr data-act="selectAnnot" data-aid="'+esc(a.id)+'" class="'+(a.id===state.selAnnotId?"on":"")+'"><td>'+esc(a.name||"—")+((a.holes||[]).length?' <small>−'+a.holes.length+' ช่อง</small>':'')+'</td><td>'+(mt?fmtNum(mt.net,2):"—")+'</td><td>'+(a.thick!=null?fmtNum(+a.thick,2):"—")+'</td><td>'+(mt?fmtNum(mt.vol,2):"—")+'</td></tr>'; });
  h+='<table class="qty-tbl"><thead><tr><th>พื้นที่</th><th>ตร.ม.</th><th>หนา</th><th>ลบ.ม.</th></tr></thead><tbody>'+rows+'</tbody>'
    +'<tfoot><tr><td>รวม '+list.length+' รายการ</td><td>'+fmtNum(ta,2)+'</td><td></td><td>'+fmtNum(tv,2)+'</td></tr></tfoot></table>';
  h+='<div class="rv-pnote">คลิกแถวเพื่อเลือกบนแปลน · รวมเฉพาะพื้นที่ที่วัดไว้ (ไม่รวมคาน/เสา)</div>';
  h+='<div class="rv-pacts"><button class="btn soft" data-act="areaCsv">'+rvIc('data',14)+' ส่งออก CSV</button></div>';
  return h;
}
function annotFormatHtml(){
  var a=state.selAnnotId?getAnnot(state.selAnnotId):null; if(!a) return "";
  if(a.kind==="area") return areaFormatHtml(a);
  var s=annotStyleOf(a), isDim=(a.kind==="dim");
  var prevTxt=isDim?(a.label||"0.00"):(String(a.text||"ตัวอย่าง").split("\n")[0]||"ตัวอย่าง");
  var h='<div class="fx" id="annotFormat"><div class="fx-h"><span>รูปแบบ</span><button class="fx-x" data-act="annotClose" title="ปิด">✕</button></div><div class="fx-b">';
  // ตัวอย่าง
  h+='<div class="fx-s">ตัวอย่าง</div><div class="fx-prev"><svg viewBox="0 0 170 50" style="width:100%;height:50px">'
    +(isDim
      ? '<line x1="14" y1="30" x2="60" y2="30" stroke="'+s.color+'" stroke-width="1.4"/><line x1="110" y1="30" x2="156" y2="30" stroke="'+s.color+'" stroke-width="1.4"/>'
        +'<path d="M20 26 14 30 20 34" fill="none" stroke="'+s.color+'" stroke-width="1.4"/><path d="M150 26 156 30 150 34" fill="none" stroke="'+s.color+'" stroke-width="1.4"/>'
        +'<text x="85" y="34" font-size="'+Math.min(15,s.size)+'" font-weight="'+(s.bold?700:400)+'" fill="'+s.color+'" text-anchor="middle" font-family="'+_hx(s.font)+', sans-serif">'+_hx(prevTxt)+'</text>'
      : '<line x1="16" y1="42" x2="62" y2="24" stroke="'+s.color+'" stroke-width="1.4"/><path d="M24 39 16 42 19 34" fill="none" stroke="'+s.color+'" stroke-width="1.4"/>'
        +'<rect x="62" y="9" width="96" height="30" rx="'+s.radius+'" fill="'+s.fill+'" fill-opacity="'+s.fillA+'" stroke="'+s.color+'" stroke-width="1.4"/>'
        +'<text x="70" y="29" font-size="'+Math.min(14,s.size)+'" font-weight="'+(s.bold?700:400)+'" fill="'+s.color+'" font-family="'+_hx(s.font)+', sans-serif">'+_hx(prevTxt.slice(0,16))+'</text>')
    +'</svg></div>';
  // ข้อความ
  h+='<div class="fx-s">'+(isDim?'ตัวเลข':'ข้อความ')+'</div>';
  h+='<div class="fx-r"><textarea class="fx-in fx-ta" id="annotText" rows="'+(isDim?1:3)+'" placeholder="'+(isDim?'เช่น 3.350':'พิมพ์ข้อความ…')+'">'+_hx(isDim?dimLabel(a):(a.text||""))+'</textarea></div>';
  if(isDim){
    var _dal=dimAutoLabel(a);
    if(a.auto && _dal!=null) h+='<div class="fx-note">คำนวณจากมาตราส่วนอัตโนมัติ — ลากปลายเส้นแล้วตัวเลขเปลี่ยนตาม · พิมพ์ทับเพื่อกำหนดเอง</div>';
    else if(_dal!=null) h+='<div class="fx-r" style="flex-wrap:wrap"><span class="fx-lb">ตามสเกล = '+_hx(_dal)+' ม.</span><button class="btn soft" data-act="dimAuto">'+rvIc('ruler',13)+' ใช้ค่าจากสเกล</button></div>';
    else h+='<div class="fx-note">ยังไม่ตั้งมาตราส่วน — พิมพ์ตัวเลขเอง หรือกด “ตั้งมาตราส่วน” แล้วเส้นจะคำนวณให้</div>';
  }
  h+='<div class="fx-s">ตัวอักษร</div>';
  h+='<div class="fx-r"><select class="fx-in" style="flex:1" data-act="annotFont">'+ANNOT_FONTS.map(function(f){ return '<option'+(s.font===f?' selected':'')+'>'+esc(f)+'</option>'; }).join("")+'</select>'
    +'<select class="fx-in" style="width:52px" data-act="annotSize">'+ANNOT_SIZES.map(function(n){ return '<option value="'+n+'"'+(s.size==n?' selected':'')+'>'+n+'</option>'; }).join("")+'</select>'
    +'<label class="fx-cl"><input type="color" data-act="annotColor" value="'+esc(s.color)+'"></label></div>';
  h+='<div class="fx-btns">'
    +'<button class="fx-tb'+(s.bold?" on":"")+'" data-act="annotBold" title="ตัวหนา"><b>B</b></button>'
    +'<button class="fx-tb'+(s.italic?" on":"")+'" data-act="annotItalic" title="ตัวเอียง"><i>I</i></button>'
    +'<button class="fx-tb'+(s.underline?" on":"")+'" data-act="annotUnder" title="ขีดเส้นใต้"><u>U</u></button>'
    +'<span class="fx-d"></span>'
    +ANNOT_SWATCH.map(function(c){ return '<button class="fx-sw'+(s.color.toLowerCase()===c?" on":"")+'" data-act="annotSwatch" data-c="'+c+'" style="background:'+c+'" title="'+c+'"></button>'; }).join("")
    +'</div>';
  // หัวเส้น
  h+='<div class="fx-s">หัวเส้น (ต้น)</div>'+fxArrowRow("a1",s.a1);
  h+='<div class="fx-s">หัวเส้น (ปลาย)</div>'+fxArrowRow("a2",s.a2);
  // กรอบ / เส้น
  h+='<div class="fx-s">'+(isDim?'เส้น':'กรอบ')+'</div>';
  h+='<div class="fx-r"><span class="fx-lb">สีเส้น</span><label class="fx-cl"><input type="color" data-act="annotColor" value="'+esc(s.color)+'"></label>'
    +'<span class="fx-lb" style="margin-left:6px">หนา</span><select class="fx-in" style="width:56px" data-act="annotSw">'+[0.8,1.2,1.6,2,2.5,3,4].map(function(n){ return '<option value="'+n+'"'+(s.sw==n?' selected':'')+'>'+n+'</option>'; }).join("")+'</select></div>';
  if(!isDim){
    h+='<div class="fx-r"><span class="fx-lb">สีพื้น</span><label class="fx-cl"><input type="color" data-act="annotFill" value="'+esc(s.fill)+'"></label>'
      +'<span class="fx-lb" style="margin-left:6px">ทึบ</span><select class="fx-in" style="width:62px" data-act="annotFillA">'+[["0","ไม่มี"],["0.15","จาง"],["0.5","ครึ่ง"],["1","ทึบ"]].map(function(o){ return '<option value="'+o[0]+'"'+(s.fillA==+o[0]?' selected':'')+'>'+o[1]+'</option>'; }).join("")+'</select></div>';
    h+='<div class="fx-r"><span class="fx-lb">มุม</span><span class="fx-seg">'
      +'<button class="'+(s.radius<=1?"on":"")+'" data-act="annotRadius" data-v="0">เหลี่ยม</button>'
      +'<button class="'+(s.radius>1&&s.radius<12?"on":"")+'" data-act="annotRadius" data-v="7">มน</button>'
      +'<button class="'+(s.radius>=12?"on":"")+'" data-act="annotRadius" data-v="16">มนมาก</button></span></div>';
  }
  h+='<div class="fx-acts"><button class="btn soft" data-act="annotDup">'+rvIc('copy',14)+' ทำซ้ำ</button><button class="btn danger" data-act="annotDel">'+rvIc('trash',14)+' ลบ</button></div>';
  return h+'</div></div>';
}
function viewPlanEditor(){
  var f=getFloor(state.floorId), type=state.catType, p=getProject(state.projectId);
  if(!f||!type) return emptyBox('<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',"ไม่พบหมวด","");
  var plan=getFloorPlan(f), plans=floorPlans(f);
  var _pidTB=curPlanId();
  var _vm=membersOfFloor(f.id).filter(function(m){ return m.plan && memberPlanId(m)===_pidTB && (state.unified ? !state.hiddenTypes[m.type] : m.type===type); });
  var selM=getMember(state.selMemberId); if(selM && !state.unified && selM.type!==type) selM=null;

  var hint='';
  if(state.tool==="drawCallout") hint='<div class="plan-tip">กล่องข้อความ: ลากกรอบขนาดกล่องบนแปลน แล้วพิมพ์ข้อความ · Esc ยกเลิก</div>';
  else if(state.tool==="drawDim") hint='<div class="plan-tip">เส้นบอกขนาด: ลากจากจุดเริ่มไปจุดปลาย'+(planScaleInfo().us>0?' — ตัวเลขคำนวณจากมาตราส่วนให้เอง':' แล้วใส่ตัวเลขระยะ')+' · Esc ยกเลิก</div>';
  else if(state.tool==="setScale") hint='<div class="plan-tip">ตั้งมาตราส่วน: ลากจากจุดหนึ่งไปอีกจุดที่รู้ระยะจริง (เช่น ศูนย์เสา→ศูนย์เสา) แล้วใส่ตัวเลขเมตร · Esc ยกเลิก</div>';
  else if(state.tool==="drawArea") hint='<div class="plan-tip">วัดพื้นที่: '+(state.areaShape==="rect"?'ลากสี่เหลี่ยมคลุมพื้นที่':'คลิกทีละมุมรอบพื้นที่ — ดับเบิลคลิกหรือคลิกจุดแรกเพื่อปิดรูป')+' · Esc ยกเลิก</div>';
  else if(state.tool==="drawHole") hint='<div class="plan-tip">หักช่องเปิด: '+(state.areaShape==="rect"?'ลากสี่เหลี่ยม':'คลิกทีละมุม')+'ทับช่องบันได/ช่องลิฟต์ในพื้นที่ที่เลือก · Esc ยกเลิก</div>';
  else if(state.tool==="drawZone") hint='<div class="plan-tip zone">วาดโซนเท: '+(state.zoneShape==="poly"?'คลิกทีละจุด — ดับเบิลคลิกเพื่อปิดรูป':'ลากคลุมพื้นที่บนแปลน')+' แล้วตั้งชื่อโซน · Esc ยกเลิก</div>';
  else if(state.tool==="draw") hint='<div class="plan-tip">'
    + (drawKind(type)==="point" ? 'แตะบนแปลนเพื่อวาง'+esc(TYPES[type].label)
      : drawKind(type)!=="rect" ? 'ลากบนแปลนเพื่อกำหนดแนว'+esc(TYPES[type].label)
      : state.drawShape==="poly" ? 'คลิกทีละจุด — ดับเบิลคลิกหรือคลิกจุดแรกเพื่อปิดรูป'
      : 'ลากบนแปลนเพื่อวาด'+(state.drawShape==="oval"?'วงรี':'สี่เหลี่ยม'))
    + (state.autoCode ? ' — ใส่เบอร์ '+esc(nextCode(type))+' ให้อัตโนมัติ · Esc ยกเลิก' : ' แล้วใส่เบอร์ · Esc ยกเลิก')+'</div>';

  if(isMobile()) return viewPlanEditorMobile(f,type,p,plan,plans,_vm,selM,hint);
  var side='<div class="rv-side rp-'+(state.rpSheet||"peek")+'"><button class="rp-handle" data-act="toggleSheet" title="เปิด/ย่อพาเนล"><span></span></button>'
    + rvPaletteHtml(type, selM, p, f, plans, plan) + '</div>';
  var main='<div class="rv-main">'+rvViewTabsHtml(f, plans)
    + '<div class="rv-view"><div class="plan-wrap">'+planStageHtml()+hint+'</div>'+annotFormatHtml()+'</div></div>';
  return '<div class="rv'+(state.rpCollapsed?" side-off":"")+'" id="editorGrid" style="--rp-w:'+(state.rpWidth||272)+'px">'
    + rvQatHtml(p,f,plan)
    + rvRibbonHtml(type, f, plan, plans, selM)
    + '<input type="file" id="planFile" accept="image/*,application/pdf,.pdf" hidden>'
    + '<div class="rv-body">'+side+'<div class="rp-splitter" id="rpSplitter" title="ลากเพื่อปรับความกว้างพาเนล"></div>'+main+'</div>'
    + rvStatusHtml(_vm, selM)
    + '</div>';
}

/* ===========================================================================
   มือถือ: เปลือกแบบแอป (แถบบนบาง · เนื้อหาเต็มจอ · ปุ่มลอย · แถบล่าง 5 ปุ่ม · แผงเลื่อนขึ้น)
   ใช้ตัวจัดการเหตุการณ์/ข้อมูลชุดเดียวกับคอม — เปลี่ยนแค่ "เปลือก"
   =========================================================================== */
function mTopHtml(title, sub, right){
  return '<div class="m-top"><button class="m-ib" data-act="back" title="กลับ">'+rvIc('back',20)+'</button><div class="m-tt"><b>'+title+'</b><small>'+sub+'</small></div><div class="m-tr">'+(right||'')+'</div></div>';
}
function mBarBtn(on,act,attr,ic,label,cls){ return '<button class="m-bb'+(on?" on":"")+(cls?' '+cls:'')+'" data-act="'+act+'" '+(attr||'')+'>'+rvIc(ic,22)+'<span>'+esc(label)+'</span></button>'; }
function mBarBtnDe(on,act,attr,ic,label,cls){ return '<button class="m-bb'+(on?" on":"")+(cls?' '+cls:'')+'" data-de="'+act+'" '+(attr||'')+'>'+rvIc(ic,22)+'<span>'+esc(label)+'</span></button>'; }
function mG(act,attr,ic,label,cls,dis,on){ return '<button class="m-g'+(cls?' '+cls:'')+(on?' on':'')+'" data-act="'+act+'" '+(attr||'')+(dis?' disabled':'')+'>'+rvIc(ic,22)+'<span>'+esc(label)+'</span></button>'; }
function mGd(act,attr,ic,label,cls,dis,on){ return '<button class="m-g'+(cls?' '+cls:'')+(on?' on':'')+'" data-de="'+act+'" '+(attr||'')+(dis?' disabled':'')+'>'+rvIc(ic,22)+'<span>'+esc(label)+'</span></button>'; }
/** โครงแผงเลื่อนขึ้น — de=true ใช้ data-de (หน้ารายละเอียด) · opts: dim(ฉากมืด) tall(สูง) min(ย่อ) cls */
function mSheetWrap(id, title, body, opts, de){
  opts=opts||{}; var A=de?'data-de':'data-act', C=de?'msheetclose':'mSheetClose', T=de?'msheettoggle':'mSheetToggle';
  return (opts.dim?'<div class="m-dim" '+A+'="'+C+'"></div>':'')
    +'<div class="m-sheet'+(opts.tall?' tall':'')+(opts.min?' min':'')+(opts.cls?' '+opts.cls:'')+'" data-msheet="'+id+'">'
    +'<div class="m-grab" '+A+'="'+T+'"><span></span></div>'
    +(title?'<div class="m-sh">'+title+'<button class="m-x" '+A+'="'+C+'" title="ปิด">✕</button></div>':'')
    +'<div class="m-sb">'+body+'</div></div>';
}
function mSeg(pairs){ return '<span class="rv-seg">'+pairs.map(function(p){ return '<button data-act="'+p[0]+'" '+(p[1]||'')+' aria-pressed="'+(!!p[3])+'">'+esc(p[2])+'</button>'; }).join('')+'</span>'; }
/* ---- หน้าแปลน (มือถือ) ---- */
function viewPlanEditorMobile(f,type,p,plan,plans,vm,selM,hint){
  var prog=stageMode()==="progress", sm=summarize(vm), fid=state.floorId;
  var canU=(PL_UNDO[fid]||[]).length>0, canR=(PL_REDO[fid]||[]).length>0;
  var sub=esc(p?p.name:"")+' · '+vm.length+' ชิ้น · ผ่าน '+sm.pass+(sm.fail?' · ไม่ผ่าน '+sm.fail:'')+(prog?' · โหมดเทคอนกรีต':'');
  var top=mTopHtml(esc(f.name)+' · '+esc(plan?(plan.name||"แปลน"):"ยังไม่มีแปลน"), sub,
    '<button class="m-ib" data-act="mSheet" data-sheet="search" title="ค้นหาเบอร์">'+rvIc('search',19)+'</button><button class="m-ib" data-act="mSheet" data-sheet="more" title="เพิ่มเติม">'+rvIc('more',19)+'</button>');
  var floats='<div class="m-fl"><button class="m-fb" data-act="planUndo" title="ย้อนกลับ"'+(canU?'':' disabled')+'>'+rvIc('undo',18)+'</button><button class="m-fb" data-act="planRedo" title="ทำซ้ำ"'+(canR?'':' disabled')+'>'+rvIc('redo',18)+'</button><button class="m-fb" data-act="zoomFit" title="พอดีจอ">'+rvIc('fit',18)+'</button></div>'
    +'<div class="m-ztag"><span id="zoomLabel">'+Math.round((state.zoom||1)*100)+'%</span></div>';
  var dk=drawKind(type);
  var bar='<div class="m-bar">'
    + mBarBtn(state.tool==="select"&&!state.mSheet,"mTool",'data-tool="select"','sel','เลือก')
    + mBarBtn(state.tool==="draw"||state.mSheet==="draw","mSheet",'data-sheet="draw"',dk==="point"?'point':dk==="line"?'line':'rect','วาด')
    + mBarBtn(state.tool==="drawCallout"||state.tool==="drawDim"||state.mSheet==="annot","mSheet",'data-sheet="annot"','callout','หมายเหตุ')
    + mBarBtn(prog,"mSheet",'data-sheet="zone"','zone','โซนเท')
    + mBarBtn(state.mSheet==="more","mSheet",'data-sheet="more"','more','เพิ่มเติม')+'</div>';
  return '<div class="rv mrv" id="editorGrid">'+top
    +'<input type="file" id="planFile" accept="image/*,application/pdf,.pdf" hidden>'
    +'<div class="m-body"><div class="rv-view"><div class="plan-wrap">'+planStageHtml()+hint+'</div></div>'+floats+mPlanSheetHtml(f,type,p,plan,plans,selM,prog)+'</div>'+bar+'</div>';
}
/** แผงเลื่อนขึ้นของหน้าแปลน — แผงเครื่องมือ (state.mSheet) มาก่อน แล้วค่อยแผงของสิ่งที่เลือก */
function mPlanSheetHtml(f,type,p,plan,plans,selM,prog){
  var sh=state.mSheet, _pid=curPlanId(), min=state.mSheetMin;
  var selA=state.selAnnotId?getAnnot(state.selAnnotId):null;
  var selZ=(prog&&state.selZoneId)?getZone(state.selZoneId):null;
  if(sh==="search"){
    return mSheetWrap('search','<b>ค้นหาเบอร์บนแปลน</b>',
      '<input id="planSearch" class="m-in" type="search" placeholder="พิมพ์เบอร์ เช่น B1 แล้วกด Enter" autocomplete="off" enterkeyhint="search" style="width:100%">'
      +'<div class="m-note">พบแล้วจะซูมไปหาและเปิดข้อมูลชิ้นนั้นให้</div>', {dim:true});
  }
  if(sh==="draw"){
    var isD=function(shp){ return state.tool==="draw" && (state.drawShape||"rect")===shp; }, dk=drawKind(type);
    var b='<div class="m-sec">ชนิดที่จะวาด</div><select id="drawTypeSel" class="m-in" style="width:100%">'
      + TYPE_ORDER.map(function(t){ return '<option value="'+t+'"'+(t===type?" selected":"")+'>'+esc(TYPES[t].label)+' ('+esc(TYPE_EN[t]||"")+')</option>'; }).join("")+'<option value="__addtype">+ เพิ่มชนิด…</option></select>';
    b+='<div class="m-sec">รูปทรง — เลือกแล้วลากบนแปลน</div><div class="m-grid">';
    if(dk==="rect") b+=mG("setShape",'data-shape="rect"','rect','สี่เหลี่ยม','',0,isD("rect"))+mG("setShape",'data-shape="poly"','poly','หลายเหลี่ยม','',0,isD("poly"))+mG("setShape",'data-shape="oval"','oval','วงรี','',0,isD("oval"));
    else b+=mG("setShape",'data-shape="rect"',dk==="point"?'point':'line',dk==="point"?'วางจุด':'วาดแนว','',0,state.tool==="draw");
    b+=mG("mTool",'data-tool="select"','sel','เลิกวาด (เลือก)','',0,state.tool==="select")+'</div>';
    b+='<div class="m-row"><span>สแนบเส้น</span>'+mSeg([["setSnap",'data-v="1"',"เปิด",state.snap],["setSnap",'data-v="0"',"ปิด",!state.snap]])+'</div>';
    b+='<div class="m-row"><span>ใส่เบอร์</span>'+mSeg([["setAutoCode",'data-v="0"',"ถามทุกครั้ง",!state.autoCode],["setAutoCode",'data-v="1"',"อัตโนมัติ "+nextCode(type),state.autoCode]])+'</div>';
    b+='<div class="m-row"><span>แสดง</span>'+mSeg([["setPlanMode",'data-mode="unified"',"รวมทุกชนิด",state.unified],["setPlanMode",'data-mode="focus"',"เฉพาะ"+TYPES[type].label,!state.unified]])+'</div>';
    b+='<div class="m-note">วาดเสร็จจะถามเบอร์ — ถ้าใส่เบอร์ซ้ำกับตัวที่มีอยู่ จะใช้ข้อมูลและประเภทเดียวกันให้อัตโนมัติ</div>';
    return mSheetWrap('draw','<b>วาดชิ้นส่วน</b>', b, {dim:true});
  }
  if(sh==="annot"){
    var _msc=planScaleInfo();
    var b2='<div class="m-grid">'+mG("drawCalloutStart",'','callout','กล่องข้อความ','',0,state.tool==="drawCallout")+mG("drawDimStart",'','dim','เส้นบอกขนาด','',0,state.tool==="drawDim")+mG("mTool",'data-tool="select"','sel','เลือก/ย้าย','',0,state.tool==="select")
      +mG("setScaleStart",'','ruler','ตั้งมาตราส่วน','',0,state.tool==="setScale")+mG("drawAreaStart",'data-shape="poly"','area','วัดพื้นที่','',0,state.tool==="drawArea")+mG("areaCsv",'','data','CSV พื้นที่')+'</div>'
      +'<div class="m-row"><span>มาตราส่วน</span><b>'+esc(_msc.src?fmtScale(_msc.us):'ยังไม่ตั้ง')+'</b></div>'
      +'<div class="m-note">กล่องข้อความ: ลากกรอบแล้วพิมพ์ · เส้นบอกขนาด: ลากจากจุดถึงจุด · ตั้งมาตราส่วน: ลาก 2 จุดที่รู้ระยะจริงแล้วใส่เมตร · วัดพื้นที่: แตะทีละมุม ดับเบิลแตะเพื่อปิดรูป</div>';
    return mSheetWrap('annot','<b>หมายเหตุ</b>', b2, {dim:true});
  }
  if(sh==="zone"){
    var zones=zonesOfPlan(f.id,_pid), cnt={}; zones.forEach(function(q){ cnt[q.status]=(cnt[q.status]||0)+1; });
    var b3='<div class="m-grid">'+mG("drawZoneStart",'data-shape="rect"','rect','โซนสี่เหลี่ยม','',0,state.tool==="drawZone"&&(state.zoneShape||"rect")==="rect")+mG("drawZoneStart",'data-shape="poly"','poly','โซนหลายเหลี่ยม','',0,state.tool==="drawZone"&&state.zoneShape==="poly")+mG("drawZoneStart",'data-shape="oval"','oval','โซนวงรี','',0,state.tool==="drawZone"&&state.zoneShape==="oval")
      +mG("manageZoneStatus",'','gear','สถานะ + สี')+mG("exportProgressPdf",'','pdf','PDF อัพเดท')+'</div>';
    b3+='<div class="m-sec">โซนบนแปลนนี้ ('+zones.length+')</div>';
    zoneStatuses(f.id,_pid).forEach(function(st){ b3+='<div class="m-row"><span><i class="rv-zdot sm" style="background:'+st.color+'"></i>'+esc(st.label)+'</span><b>'+(cnt[st.id]||0)+' โซน</b></div>'; });
    b3+='<div class="m-row"><span>แสดงโซน</span>'+mSeg([["setProgress",'data-v="1"',"แสดง",state.showProgress],["setProgress",'data-v="0"',"ซ่อน",!state.showProgress]])+'</div>';
    b3+='<div class="m-acts"><button class="btn soft" data-act="mExitProgress">‹ กลับโหมดตรวจเหล็ก</button></div>';
    return mSheetWrap('zone','<b>เทคอนกรีต</b><span class="m-note" style="padding:0 0 0 6px">แตะโซนบนแปลนเพื่อแก้ชื่อ/สถานะ</span>', b3, {dim:true});
  }
  if(sh==="more"){
    var b4='<div class="m-sec">แปลนในชั้นนี้</div><div class="m-list">';
    plans.forEach(function(pp){ b4+='<button class="m-li'+(pp.id===f.activePlanId?' on':'')+'" data-act="switchPlan" data-pid="'+esc(pp.id)+'">'+rvIc('plan',16)+'<span>'+esc(pp.name||"แปลน")+'</span></button>'; });
    b4+='</div><div class="m-grid" style="margin-top:8px">'+mG("addPlan",'','plan','นำเข้าแปลน')+'<button class="m-g" id="btnPickPlan"'+(plan?'':' disabled')+'>'+rvIc('img',22)+'<span>เปลี่ยนรูป</span></button>'+mG("removePlan",'','trash','ลบแปลน','danger',!plan)+mG("exportPdf",'','pdf','ออก PDF')+'</div>';
    b4+='<div class="m-sec">มุมมอง</div>';
    b4+='<div class="m-row"><span>ลงสีตาม</span>'+mSeg([["colorMode",'data-mode="status"',"สถานะ",state.colorMode==="status"],["colorMode",'data-mode="plain"',"ที่ตั้งเอง",state.colorMode==="plain"],["colorMode",'data-mode="type"',"ประเภท",state.colorMode==="type"]])+'</div>';
    b4+='<div class="m-row"><span>บนแปลน</span>'+mSeg([["toggleLabels","","ป้ายเบอร์",state.showLabels],["toggleLegend","","ตารางสี",state.showLegend],["toggleSnap","","สแนบ",state.snap]])+'</div>';
    var sf=state.statusFilter||null;
    b4+='<div class="m-row"><span>กรอง</span>'+mSeg([["statusFilter",'data-st="all"',"ทั้งหมด",!sf],["statusFilter",'data-st="pass"',"ผ่าน",sf==="pass"],["statusFilter",'data-st="fail"',"ไม่ผ่าน",sf==="fail"],["statusFilter",'data-st="todo"',"รอตรวจ",sf==="todo"]])+'</div>';
    b4+='<div class="m-sec">ผังโครงการ</div>'+rvBrowserHtml(type,p,f,plans,plan);
    b4+='<div class="m-sec">อื่น ๆ</div><div class="m-grid">'+mG("addInCat",'','plus','เพิ่มด้วยฟอร์ม')+mG("qatData",'','data','ข้อมูล/สำรอง')+mG("qatTheme",'',(document.documentElement.getAttribute("data-theme")==="dark")?'sun':'moon','สว่าง/มืด')+mG("back",'','back','กลับหน้าชั้น')+'</div>';
    return mSheetWrap('more','<b>เพิ่มเติม</b>', b4, {dim:true, tall:true});
  }
  if(sh==="style" && selM && isBox(selM.plan)){
    var pl=selM.plan;
    return mSheetWrap('style','<b>สี / กรอบ · '+esc(selM.code)+'</b>', '<div class="m-styles">'+rvStyleRows(pl.fill||"#f59e0b",(pl.fillA!=null?pl.fillA:0.28),(pl.strokeW!=null?pl.strokeW:10),null)+'</div>', {});
  }
  // ---- แผงของสิ่งที่เลือก ----
  if(selA) return mSheetWrap('annotfmt', null, annotFormatHtml(), {min:min});
  if(!selZ && !selM && state.selTypeId && getType(state.selTypeId)) return mSheetWrap('type','<b>ประเภทชิ้นส่วน</b>', typePaletteHtml(getType(state.selTypeId)), {min:min, tall:true});
  if(selZ){
    var stList=zoneStatuses(f.id,_pid), zs=stList.filter(function(q){return q.id===selZ.status;})[0]||{color:"#94a3b8",label:selZ.status||"—"};
    var bz='<div class="m-row"><span>ชื่อโซน</span><input type="text" id="zoneNameInput" value="'+esc(selZ.name)+'" class="m-in"></div>'
      +'<div class="m-row"><span>สถานะ</span><select id="zoneStatusSel" class="m-in">'+stList.map(function(q){ return '<option value="'+esc(q.id)+'"'+(selZ.status===q.id?" selected":"")+'>'+esc(q.label)+'</option>'; }).join("")+'</select></div>'
      +'<div class="m-row"><span>วันที่</span><input type="date" id="zoneDateInput" value="'+esc(selZ.date||"")+'" class="m-in"></div>'
      +'<div class="m-acts"><button class="btn soft" data-act="manageZoneStatus">'+rvIc('gear',14)+' สถานะ + สี</button><button class="btn danger" data-act="deleteZone" data-zid="'+esc(selZ.id)+'">'+rvIc('trash',14)+' ลบโซน</button></div>';
    return mSheetWrap('zone','<i class="rv-zdot sm" style="background:'+zs.color+'"></i><b>โซนเท · '+esc(selZ.name)+'</b><span class="m-st">'+esc(zs.label)+'</span>', bz, {min:min});
  }
  if(selM && !prog){
    var t=memberTypeOf(selM), st=memberStatus(selM), insp=(state.rightTab==="inspect"), ins=lastInspection(selM.id);
    var stTx = st==="pass"?'<span class="ok">● ผ่าน</span>' : st==="fail"?'<span class="bad">● ต้องแก้ไข</span>' : '<span class="wait">● รอตรวจ</span>';
    var head='<span class="rv-tdot" style="background:'+(t?esc(t.color||'#2563eb'):'var(--t-'+TYPES[selM.type].css+')')+'"></span><b>'+esc(TYPES[selM.type].label)+' · <button class="rv-editcode" data-act="renameMember" title="แก้ชื่อ/เบอร์">'+esc(selM.code)+' '+rvIc("edit",12)+'</button></b>'+(t?'<span class="type-pill" style="background:'+esc(t.color||'#2563eb')+'">🔗 '+esc(t.name)+'</span>':'')+'<span class="m-st">'+stTx+'</span>';
    var bm='';
    if(insp){
      bm+='<div class="m-backrow"><button class="btn soft" data-act="setPalette" data-tab="props">‹ ข้อมูลชิ้น</button><b>ตรวจเหล็ก · '+esc(selM.code)+'</b></div>';
      if(selM.note) bm+='<div class="note-warn" style="margin:0 0 8px">'+esc(selM.note)+'</div>';
      bm+='<div class="rv-inspect">'+inspectionBlockHtml(selM)+'</div>';
    }else{
      bm+='<div class="m-grid">'
        + mG("goInspect",'','check','ตรวจเหล็ก') + mG("showDetails",'','img','รายละเอียด') + mG("typeAssignSheet",'','link','ประเภท') + (isBox(selM.plan)?mG("mSheet",'data-sheet="style"','palette','สี / กรอบ'):mG("editMember",'','edit','แก้สเปก'))
        + mG("dupMember",'data-id="'+esc(selM.id)+'"','copy','ทำซ้ำ') + mG("toggleHide",'data-id="'+esc(selM.id)+'"',selM.hidden?'eyeOff':'eye',selM.hidden?'แสดง':'ซ่อน') + (isBox(selM.plan)?mG("editMember",'','edit','แก้สเปก'):mG("assignSheet",'','wand','เทมเพลต')) + mG("delMember",'','trash','ลบ','danger')
        +'</div>';
      bm+='<div class="m-row"><span>ประเภท</span><select id="typeSel" class="m-in">'+typeSelOptionsHtml(selM)+'</select></div>';
      if(t) bm+='<div class="m-note">🔗 หน้ารายละเอียดใช้ร่วมกัน '+typeMembers(t.id).length+' ชิ้น — แก้ที่ชิ้นไหนก็เปลี่ยนทุกชิ้น</div>';
      if(selM.note) bm+='<div class="note-warn" style="margin:6px 0 0">'+esc(selM.note)+'</div>';
      if(ins) bm+='<div class="m-note">ผลตรวจล่าสุด: '+(ins.status==="pass"?'ผ่าน':'ไม่ผ่าน')+' · '+esc(ins.inspector||"—")+' · '+esc(new Date(ins.ts).toLocaleDateString('th-TH',{year:'2-digit',month:'short',day:'numeric'}))+'</div>';
    }
    return mSheetWrap('member', head, bm, {min:min, tall:insp});
  }
  return '';
}
/* ---- หน้ารายละเอียด (มือถือ) ---- */
function viewMemberDetailMobile(m,p,f,t,sib){
  var mid=m.id, canU=(DE_UNDO[mid]||[]).length>0, canR=(DE_REDO[mid]||[]).length>0, doc=memberDoc(m);
  var top=mTopHtml('รายละเอียด '+esc(m.code), (t?'🔗 '+esc(t.name)+' · '+typeMembers(t.id).length+' ชิ้น':esc(TYPES[m.type].label))+' · '+esc(f?f.name:''),
    '<button class="m-ib" data-de="exportpdf" title="ออก PDF">'+rvIc('pdf',19)+'</button><button class="m-ib" data-de="msheet" data-sheet="more" title="เพิ่มเติม">'+rvIc('more',19)+'</button>');
  var floats='<div class="m-fl"><button class="m-fb" data-de="undo" title="ย้อนกลับ"'+(canU?'':' disabled')+'>'+rvIc('undo',18)+'</button><button class="m-fb" data-de="redo" title="ทำซ้ำ"'+(canR?'':' disabled')+'>'+rvIc('redo',18)+'</button><button class="m-fb" data-de="zoomfit" title="พอดีจอ">'+rvIc('fit',18)+'</button></div>'
    +'<div class="m-ztag"><span id="deZoomLabel">'+Math.round(deZ()*100)+'%</span></div>'
    +'<button class="m-fab" data-de="msheet" data-sheet="add" title="เพิ่ม">＋</button>';
  var tools={callout:'กล่องข้อความ — ลากกรอบบนแผ่น', dim:'เส้นบอกขนาด — ลากจากจุดถึงจุด', pen:'ปากกา — ลากวาดบนแผ่น', hilite:'ไฮไลต์ — ลากวาดบนแผ่น'};
  var pill = tools[state.deTool] ? '<div class="m-pill">'+tools[state.deTool]+' · แตะ “เลือก” เพื่อเลิก</div>' : (doc.els.length ? '' : '<div class="m-pill">กด ＋ เพื่อเพิ่มรูป / ไฟล์ / ข้อความ · นิ้วถ่างซูม</div>');
  var bar='<div class="m-bar">'
    + mBarBtnDe(state.deTool==="select"&&!state.mSheet,"tool",'data-tool="select"','sel','เลือก')
    + mBarBtnDe(state.mSheet==="annot"||state.deTool==="callout"||state.deTool==="dim"||state.deTool==="hilite","msheet",'data-sheet="annot"','callout','หมายเหตุ')
    + mBarBtnDe(state.deTool==="pen","tool",'data-tool="pen"','pen','ปากกา')
    + mBarBtnDe(false,"stamp",'data-sub="pass"','check','ผ่าน','ok')
    + mBarBtnDe(false,"stamp",'data-sub="fix"','cross','แก้ไข','bad')+'</div>';
  return '<div class="rv de-rv mrv" id="editorGrid">'+top
    + '<input type="file" id="deFile" accept="image/*,application/pdf,.pdf" multiple hidden><input type="file" id="deCam" accept="image/*" capture="environment" hidden>'
    + '<div class="m-body"><div class="de-vp" id="deVp">'+deSheetHtml(m)+'</div>'+floats+pill+mDetailSheetHtml(m,t,sib)+'</div>'+bar+'</div>';
}
function mDetailSheetHtml(m,t,sib){
  var sh=state.mSheet, doc=memberDoc(m), pgk=(doc.page&&doc.page.size)||"a4l";
  if(sh==="add"){
    var b='<div class="m-grid">'+mGd("cam",'','camera','ถ่ายรูป')+mGd("file",'','img','เพิ่มไฟล์')+mGd("addtext",'','text','ข้อความ')+mGd("addtable",'','grid','ตาราง')
      +mGd("msheet",'data-sheet="lib"','shapes','รูปทรง / เส้น')+mGd("stamp",'data-sub="recheck"','filter','รอตรวจซ้ำ')+mGd("stamp",'data-sub="name"','user','ชื่อผู้ตรวจ')+mGd("stamp",'data-sub="date"','calendar','วันที่วันนี้')+'</div>'
      +'<div class="m-note">รูป/ไฟล์ใหม่จะต่อท้ายด้านล่างของแผ่น · ตราประทับวางกลางจอ แล้วลากไปวางได้</div>';
    return mSheetWrap('add','<b>เพิ่มลงแผ่น</b>', b, {dim:true}, true);
  }
  if(sh==="lib"){
    var libCatId=state.deLibCat||'shapes', libCat=deLibCat(libCatId);
    var tabs=DE_LIB_CATS.map(function(c){ return '<button class="de-flytab'+(c.id===libCatId?' on':'')+'" data-de="libcat" data-cat="'+c.id+'">'+c.icon+' '+esc(c.label)+'</button>'; }).join('');
    var items=libCat.items.map(function(it){
      var preview;
      if(libCat.kind==='shape') preview=deShapeSvg({subtype:it.sub,w:it.w,h:it.h});
      else if(libCat.kind==='line') preview=deLineSvg({subtype:it.sub,w:it.w,h:it.h});
      else preview=deStickerSvg({subtype:it.sub,color:it.col,w:it.w,h:it.h});
      return '<button class="de-libitem" data-de="libadd" data-kind="'+libCat.kind+'" data-sub="'+it.sub+'" data-w="'+it.w+'" data-h="'+it.h+'"'+(it.col?' data-col="'+it.col+'"':'')+'><div class="de-libprev">'+preview+'</div><span class="de-liblbl">'+esc(it.label)+'</span></button>';
    }).join('');
    return mSheetWrap('lib','<b>รูปทรง / เส้น / สติกเกอร์</b>', '<div class="de-flyhead" style="background:none;border:none;padding:0 0 8px">'+tabs+'</div><div class="de-libgrid m-libgrid">'+items+'</div>', {dim:true}, true);
  }
  if(sh==="annot"){
    var tl=state.deTool;
    var b2='<div class="m-grid">'+mGd("tool",'data-tool="callout"','callout','กล่องข้อความ','',0,tl==="callout")+mGd("tool",'data-tool="dim"','dim','เส้นบอกขนาด','',0,tl==="dim")+mGd("tool",'data-tool="pen"','pen','ปากกา','',0,tl==="pen")+mGd("tool",'data-tool="hilite"','hilite','ไฮไลต์','',0,tl==="hilite")
      +mGd("stamp",'data-sub="pass"','check','ตราผ่าน','ok')+mGd("stamp",'data-sub="fix"','cross','ตราแก้ไข','bad')+mGd("stamp",'data-sub="recheck"','filter','รอตรวจซ้ำ')+mGd("tool",'data-tool="select"','sel','เลือก/ย้าย','',0,tl==="select")+'</div>'
      +'<div class="m-note">เลือกเครื่องมือแล้วลากบนแผ่น · แตะสิ่งที่วาดแล้วเพื่อแก้สี/ข้อความ</div>';
    return mSheetWrap('annot','<b>หมายเหตุ</b>', b2, {dim:true}, true);
  }
  if(sh==="more"){
    var b4='';
    if(sib.length>1){ b4+='<div class="m-sec">ชิ้นอื่นในประเภทเดียวกัน — แผ่นเดียวกัน</div><div class="m-chips">'+sib.map(function(x){ return '<button class="m-chip'+(x.id===m.id?' on':'')+'" data-de="switchmember" data-id="'+esc(x.id)+'">'+esc(x.code)+'</button>'; }).join('')+'</div>'; }
    b4+='<div class="m-sec">หน้ากระดาษ · '+dePageCount(doc)+' หน้า (อัตโนมัติ)</div><div class="m-row"><span>ขนาด</span><span class="rv-seg">'+Object.keys(DE_PAGES).map(function(k){ return '<button data-de="page" data-size="'+k+'" aria-pressed="'+(pgk===k)+'">'+esc(DE_PAGES[k].label)+'</button>'; }).join('')+'</span></div>';
    b4+='<div class="m-row"><span>หัวกระดาษ</span><span class="rv-seg"><button data-de="titletoggle" data-v="1" aria-pressed="'+deTitleOn(doc)+'">แสดง</button><button data-de="titletoggle" data-v="0" aria-pressed="'+(!deTitleOn(doc))+'">ซ่อน</button></span></div>';
    b4+='<div class="m-sec">ไกด์อัจฉริยะ — ลากแล้วสแนปเข้าแนวชิ้นอื่น</div>';
    b4+='<div class="m-row"><span>ไกด์</span><span class="rv-seg"><button data-de="guides" data-v="1" aria-pressed="'+deGuidesOn()+'">เปิด</button><button data-de="guides" data-v="0" aria-pressed="'+(!deGuidesOn())+'">ปิด</button></span></div>';
    b4+='<div class="m-row"><span>สแนปกริด</span><span class="rv-seg"><button data-de="snapgrid" data-v="1" aria-pressed="'+!!DE_GUIDES.grid+'">เปิด</button><button data-de="snapgrid" data-v="0" aria-pressed="'+!DE_GUIDES.grid+'">ปิด</button></span></div>';
    b4+='<div class="m-sec">ชิ้นส่วนนี้</div><div class="m-grid">'+mGd("inspect",'','check','ตรวจเหล็ก')+mGd("exportpdf",'','pdf','ออก PDF')
      +(t?mG("typeManage",'','gear','จัดการประเภท')+mG("typeDetach",'','unlink','แยกออก'):mG("back",'','back','กลับหน้าแปลน'))+'</div>';
    if(t) b4+='<div class="m-note">🔗 '+esc(t.name)+' · ใช้ร่วมกัน '+typeMembers(t.id).length+' ชิ้น — แก้ที่นี่ = เปลี่ยนทุกชิ้น</div>';
    b4+='<div class="m-grid" style="margin-top:8px">'+mG("saveNow",'','save','บันทึก')+mG("qatTheme",'',(document.documentElement.getAttribute("data-theme")==="dark")?'sun':'moon','สว่าง/มืด')+mG("back",'','back','กลับหน้าแปลน')+'</div>';
    return mSheetWrap('more','<b>เพิ่มเติม</b>', b4, {dim:true, tall:true}, true);
  }
  // แผงคุณสมบัติของสิ่งที่เลือก — อยู่ใน DOM เสมอ (เปิด/ปิดด้วย class ตอนเลือกโดยไม่ต้อง render)
  var sel=deSelEl();
  var bp='<div class="de-props de-props-side on" id="deProps"></div>'
    +'<div class="m-grid m-grid3" style="margin-top:6px">'+mGd("dup",'','copy','ทำซ้ำ')+mGd("front",'','front','ยกขึ้นบน')+mGd("back",'','backz','ส่งลงล่าง')+mGd("delsel",'','trash','ลบ','danger')+'</div>';
  return mSheetWrap('props','<b>'+esc(sel?deTypeLabel(sel):'สิ่งที่เลือก')+'</b>', bp, {cls:'props'+(sel&&!sh?' open':''), min:state.mSheetMin}, true);
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
/** ขนาด "แผ่นแปลน" ที่พอดีในกรอบ (zoom 1) — กรอบ = viewport เต็มพื้นที่, แผ่น = รูปแปลนคงสัดส่วน อยู่ข้างใน
    คืน {w,h}=แผ่น, {W,H}=กรอบ · ทุกพิกัด 0..1 ของชิ้นส่วนอ้างอิงแผ่น ไม่ใช่กรอบ */
function _sheetWH(){
  var sz=_stageWH(); if(!sz||!sz.w||!sz.h) return null;
  var st=$("#planStage"), ar=parseFloat(st&&st.style.getPropertyValue("--plan-ar"))||1.4;
  var w=sz.w, h=w/ar; if(h>sz.h){ h=sz.h; w=h*ar; }
  return {w:w, h:h, W:sz.w, H:sz.h};
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
  var sh=_sheetWH(), ov=$("#planOverlay");
  if(sh){ c.style.width=sh.w+"px"; c.style.height=sh.h+"px"; if(ov){ ov.style.width=sh.w+"px"; ov.style.height=sh.h+"px"; } }   // แผ่นแปลนคงสัดส่วนในกรอบ
  var t="translate("+state.panX+"px,"+state.panY+"px) scale("+state.zoom+")";
  c.style.transformOrigin="0 0"; c.style.transform=t;
  if(ov){ ov.style.transformOrigin="0 0"; ov.style.transform=t; }   // ไฮไลท์ (เวกเตอร์) ซูมตามได้ คมเสมอ
  positionDetail();      // เลเยอร์ภาพคม (screen-space) วางตามตำแหน่งจริงบนจอ
  updateLabelScale();
}
/** วางเลเยอร์ภาพคม (#planDetail) ในพิกัดจอจริง — คมบน iOS เพราะไม่อยู่ใน transform ที่ถูกซูม */
function positionDetail(){
  var det=$("#planDetail"); if(!det || det.style.display==="none") return;
  var doc=PLAN_DOCS[planSourceKey()], sz=_sheetWH();
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
  var s=_sheetWH(); if(!s) return;
  var z=state.zoom||1, cw=s.w*z, ch=s.h*z;
  // แผ่นเล็กกว่ากรอบ → วางกลาง · ใหญ่กว่า → เลื่อนได้แต่ไม่หลุดขอบ
  state.panX = cw<=s.W ? (s.W-cw)/2 : Math.min(0, Math.max(s.W-cw, state.panX));
  state.panY = ch<=s.H ? (s.H-ch)/2 : Math.min(0, Math.max(s.H-ch, state.panY));
}
/** ซูมสูงสุด: PDF เรนเดอร์ใหม่ได้ → ซูมลึก; รูปภาพ → ไม่เกินความละเอียดจริง (ไม่เบลอ) */
function planMaxZoom(){
  var sz=_sheetWH(); if(!sz||!sz.w) return 8;
  var doc=PLAN_DOCS[planSourceKey()];
  if(doc && doc.kind==="pdf") return 24;                          // เวกเตอร์ เรนเดอร์ใหม่ตามซูม
  var natW = doc&&doc.natW ? doc.natW : (currentPlan()?currentPlan().w:0);
  if(natW) return Math.max(6, Math.min(24, natW/sz.w*3));         // รูปภาพ: ยอมเกินความละเอียดจริง 3 เท่า (เบลอบ้างแต่จับจุดได้)
  return 12;
}
/** ซูมโดยคงจุดใต้เคอร์เซอร์ (cx,cy = พิกัดเทียบมุมซ้ายบนของกรอบ) */
function planZoomBy(f, cx, cy){
  var s1=state.zoom, s2=Math.max(1, Math.min(planMaxZoom(), s1*f));
  if(s2===s1){ scheduleEnsure(); return; }   // สุดซูมแล้ว (คลิกต่อ) → ยังสั่งเรนเดอร์ส่วนคมให้
  state.panX = cx - (cx-state.panX)*(s2/s1);
  state.panY = cy - (cy-state.panY)*(s2/s1);
  state.zoom = s2;
  planClampPan(); planApplyTransform();
  scheduleEnsure();   // เรนเดอร์ส่วนคม "หลังหยุดซูม" เท่านั้น (กันกระตุกระหว่างซูม)
}
function planFit(){ state.zoom=1; state.panX=0; state.panY=0; planClampPan(); planApplyTransform(); scheduleEnsure(); }

function bindPlanEditor(){
  // นำเข้าแปลน (รูป / PDF)
  var pf=$("#planFile");
  if(pf) pf.addEventListener("change",function(e){
    var file=e.target.files && e.target.files[0];
    if(!file){ state.pendingPlanId=null; planLog("ไม่ได้เลือกไฟล์ (ยกเลิก)"); return; }
    planLog("เลือกไฟล์: "+file.name+" · "+(file.type||"ไม่ทราบชนิด")+" · "+Math.round(file.size/1024)+" KB");
    importPlan(file);
    e.target.value="";
  });
  // ปุ่มนำเข้า: เปิดหน้าต่างเลือกไฟล์ + log ให้รู้ว่าคลิกติด
  var pb=$("#btnPickPlan");
  if(pb) pb.addEventListener("click",function(){ state.pendingPlanId=null; planLog("กดปุ่มนำเข้าแปลน — เปิดหน้าต่างเลือกไฟล์"); if(pf) pf.click(); });   // เปลี่ยนรูปของแปลนเดิม (ไม่ใช่แปลนใหม่)
  if(pf) pf.addEventListener("cancel",function(){ state.pendingPlanId=null; });

  // เส้นแบ่งลากได้ — ปรับความกว้างพาเนลขวา (ลากซ้าย=พาเนลกว้างขึ้น, ลากขวา=แปลนกว้างขึ้น)
  var sp=$("#rpSplitter"), grid=$("#editorGrid");
  if(sp && grid) sp.addEventListener("pointerdown",function(ev){
    ev.preventDefault();
    var startX=ev.clientX, startW=state.rpWidth||380;
    try{ sp.setPointerCapture(ev.pointerId); }catch(x){}
    function mv(e){
      var w=Math.max(220, Math.min(560, startW + (e.clientX-startX)));   // พาเนลอยู่ซ้าย → ลากไปขวา = กว้างขึ้น
      state.rpWidth=w; grid.style.setProperty("--rp-w", w+"px");
    }
    function up(){
      sp.removeEventListener("pointermove",mv); sp.removeEventListener("pointerup",up);
      try{ localStorage.setItem("rebarcheck.rpw", String(state.rpWidth)); }catch(e){}
    }
    sp.addEventListener("pointermove",mv); sp.addEventListener("pointerup",up);
  });

  // ผูกอินพุตแก้ไขโซน
  // แผง "รูปแบบ" ของหมายเหตุ — พิมพ์/เลือกแล้วเห็นผลบนแปลนทันที
  var fxp=$("#annotFormat");
  if(fxp){
    var _fxPushed=false;
    function fxA(){ return state.selAnnotId?getAnnot(state.selAnnotId):null; }
    function fxPush(){ if(!_fxPushed){ plPushUndo(); _fxPushed=true; } }
    fxp.addEventListener("pointerdown",function(){ _fxPushed=false; });
    var ta=$("#annotText");
    if(ta){
      ta.addEventListener("focus",function(){ _fxPushed=false; fxPush(); });
      ta.addEventListener("input",function(){
        var a=fxA(); if(!a) return;
        if(a.kind==="dim"){ a.label=ta.value.trim(); a.auto=false; } else if(a.kind==="area") a.name=ta.value; else a.text=ta.value;
        repaintPlanShapes();
      });
      ta.addEventListener("blur",function(){ saveDB(); render(); });
      ta.addEventListener("keydown",function(e){ if(e.key==="Enter" && ta.tagName!=="TEXTAREA"){ e.preventDefault(); ta.blur(); } });
    }
    var tk=$("#areaThick");
    if(tk){
      var _tkApply=function(){ var a=fxA(); if(!a||a.kind!=="area") return; var v=parseFloat(tk.value); v=(v>=0?v:0); if(v===a.thick) return; fxPush(); a.thick=v; if(v>0) state.areaThick=v; saveDB(); render(); };
      tk.addEventListener("change",_tkApply);
      tk.addEventListener("keydown",function(e){ if(e.key==="Enter"){ e.preventDefault(); tk.blur(); } });
    }
    fxp.addEventListener("change",function(e){
      var t=e.target, act=t.getAttribute&&t.getAttribute("data-act"); if(!act) return;
      var a=fxA(); if(!a) return; fxPush();
      if(act==="annotFont") a.font=t.value;
      else if(act==="annotSize") a.size=+t.value;
      else if(act==="annotSw") a.sw=+t.value;
      else if(act==="annotFillA") a.fillA=+t.value;
      else if(act==="annotColor") a.color=t.value;
      else if(act==="annotFill") a.fill=t.value;
      else return;
      annotRemember(a); saveDB(); render();
    });
    fxp.addEventListener("input",function(e){   // ลากแถบสี = เห็นผลสด (บันทึกตอน change)
      var t=e.target, act=t.getAttribute&&t.getAttribute("data-act"); if(!act) return;
      var a=fxA(); if(!a) return;
      if(act==="annotColor"){ fxPush(); a.color=t.value; repaintPlanShapes(); }
      else if(act==="annotFill"){ fxPush(); a.fill=t.value; repaintPlanShapes(); }
    });
  }
  // ประเภทชิ้นส่วน — dropdown ในพาเนล = ผูกทันที · ชื่อประเภทแก้สด
  var tsel=$("#typeSel");
  if(tsel) tsel.addEventListener("change",function(){
    var m0=getMember(state.selMemberId); if(!m0) return;
    var v=tsel.value;
    if(v==="__new"){ typeCreateAct(); return; }
    typeAssign(m0, v?getType(v):null);
  });
  var tni=$("#typeNameInput");
  if(tni) tni.addEventListener("change",function(){ var t0=getType(state.selTypeId); if(t0){ var nv=tni.value.trim(); if(nv && nv!==t0.name){ t0.name=nv; saveDB(); render(); toast("เปลี่ยนชื่อประเภทแล้ว"); } } });
  var zni=$("#zoneNameInput"), zsi=$("#zoneStatusSel"), zdi=$("#zoneDateInput");
  [zni,zsi,zdi].forEach(function(inp){ if(inp) inp.addEventListener("focus",function(){ plPushUndo(); }); });
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
  // เมนู "ไฟล์": คลิกที่ไหนก็ปิด (ไม่ต้อง render ถ้าคลิกนอกเมนู) · กดปุ่มไฟล์ซ้ำ = ปิดอย่างเดียว
  if(state.fileMenu){
    var _fmH=function(e){
      document.removeEventListener("click",_fmH,true);
      state.fileMenu=false;
      var onBtn=!!e.target.closest(".rv-ftab");
      setTimeout(function(){ var mn=$(".rv-fmenu"); if(mn&&mn.parentNode) mn.parentNode.removeChild(mn); var fb=$(".rv-ftab"); if(fb) fb.classList.remove("on"); },0);
      if(onBtn){ e.stopImmediatePropagation(); e.preventDefault(); }
    };
    setTimeout(function(){ document.addEventListener("click",_fmH,true); },0);
  }
  // ค้นหาเบอร์บนแปลน (Enter / กดปุ่ม)
  var psq=$("#planSearch");
  if(psq) psq.addEventListener("keydown",function(e){ if(e.key==="Enter"){ e.preventDefault(); planSearch(psq.value); } });
  // มือถือ: ปุ่มในแผงเครื่องมือที่ "เลือกแล้วไปทำต่อบนแปลน" → ปิดแผงก่อนให้ act ทำงาน (capture มาก่อน dispatcher ที่ document)
  var MCLOSE={setShape:1,drawCalloutStart:1,drawDimStart:1,drawZoneStart:1,setScaleStart:1,drawAreaStart:1,drawHoleStart:1,areaCsv:1,switchPlan:1,browserSelect:1,selectZone:1,typeSelect:1,goInspect:1,showDetails:1,editMember:1,addInCat:1,qatData:1,back:1,exportPdf:1,exportProgressPdf:1,addPlan:1,removePlan:1,manageZoneStatus:1,typeAssignSheet:1,assignSheet:1,dupMember:1,delMember:1,typeManage:1,typeOpenDetail:1,deleteZone:1,mExitProgress:1};
  var MDRAW={setShape:1,drawCalloutStart:1,drawDimStart:1,drawZoneStart:1,setScaleStart:1,drawAreaStart:1};   // เริ่มเครื่องมือวาด → เลิกเลือกของเดิมด้วย (ไม่งั้นแผงของชิ้นที่เลือกเด้งกลับมาทับแปลน)
  $$(".m-sheet").forEach(function(ms){ ms.addEventListener("click",function(e){
    var a=e.target.closest("[data-act]"); if(!a||a.disabled) return; var ac=a.getAttribute("data-act");
    if(!MCLOSE[ac] || !state.mSheet) return;
    state.mSheet=null; state.mSheetMin=false;
    if(MDRAW[ac]){ state.selMemberId=null; state.selZoneId=null; state.selAnnotId=null; state.selTypeId=null; }
    var seq=_renderSeq;   // ถ้า act ไม่ได้ render เอง (ยกเลิก confirm / เปิดหน้าต่างเลือกไฟล์ / ออก PDF) → render ให้ เพื่อปิดแผง
    setTimeout(function(){ if(state.screen==="planEditor" && _renderSeq===seq) render(); },0);
  },true); });
  if(state.mSheet==="search" && psq) setTimeout(function(){ try{ psq.focus(); }catch(e){} },60);
  var pbm=$(".m-sheet #btnPickPlan"); if(pbm) pbm.addEventListener("click",function(){ state.mSheet=null; setTimeout(function(){ if(state.screen==="planEditor") render(); },0); });
  // คีย์ลัดแบบโปรแกรม — ผูกที่ document จึงต้องถอดตัวเก่าก่อน ไม่งั้นซ้อนทุกครั้งที่ render
  if(_plKeyHandler) document.removeEventListener("keydown",_plKeyHandler);
  _plKeyHandler=function(e){
    if(state.screen!=="planEditor") return;
    var t=e.target, tag=(t&&t.tagName||"").toLowerCase();
    var typing = tag==="input"||tag==="textarea"||tag==="select"||(t&&t.isContentEditable);
    var k=(e.key||""), kl=k.toLowerCase(), mod=(e.ctrlKey||e.metaKey);
    if(mod && kl==="z"){ e.preventDefault(); if(e.shiftKey) plRedo(); else plUndo(); return; }
    if(mod && kl==="y"){ e.preventDefault(); plRedo(); return; }
    if(mod && kl==="f"){ var q=$("#planSearch"); if(q){ e.preventDefault(); q.focus(); q.select(); } return; }
    if(k==="Escape"){
      if(typing){ t.blur(); return; }
      if(state.tool!=="select"){ state.tool="select"; render(); return; }
      if(state.marquee){ state.marquee=false; render(); return; }
      if(state.selMemberId||state.selZoneId||state.selAnnotId){ state.selMemberId=null; state.selMulti=[]; state.selZoneId=null; state.selAnnotId=null; render(); }
      return;
    }
    if(typing || mod || e.altKey) return;
    var prog=stageMode()==="progress";
    if(kl==="c"){ state.tool="drawCallout"; state.ribbonTab="annot"; state.selAnnotId=null; render(); }
    else if(kl==="d"){ state.tool="drawDim"; state.ribbonTab="annot"; state.selAnnotId=null; render(); }
    else if(kl==="a" && !prog){ state.tool="drawArea"; state.ribbonTab="annot"; state.selAnnotId=null; state.selMemberId=null; state.selMulti=[]; state.marquee=false; render(); }
    else if(kl==="v"){ state.tool="select"; state.marquee=false; render(); }
    else if(kl==="m" && !isMobile()){ state.marquee=!state.marquee; state.tool="select"; render(); }
    else if(kl==="r"){ if(prog){ state.zoneShape="rect"; state.tool="drawZone"; } else { state.tool="draw"; state.drawShape="rect"; } render(); }
    else if(kl==="p"){ if(prog){ state.zoneShape="poly"; state.tool="drawZone"; } else if(drawKind(state.catType)==="rect"){ state.tool="draw"; state.drawShape="poly"; } render(); }
    else if(kl==="o"){ if(prog){ state.zoneShape="oval"; state.tool="drawZone"; render(); } else if(drawKind(state.catType)==="rect"){ state.tool="draw"; state.drawShape="oval"; render(); } }
    else if(kl==="s"){ state.snap=!state.snap; render(); }
    else if(k==="0"){ planFit(); }
    else if(k==="+"||k==="="||k==="-"){ var st=$("#planStage"); if(st){ var r=st.getBoundingClientRect(); planZoomBy(k==="-"?1/1.35:1.35, r.width/2, r.height/2); } }
    else if(k==="Delete"||k==="Backspace"){
      if(state.selAnnotId){ e.preventDefault(); var ab=document.querySelector('[data-act="annotDel"]'); if(ab) ab.click(); return; }
      if(prog && state.selZoneId){ e.preventDefault(); var zb=document.querySelector('[data-act="deleteZone"]'); if(zb) zb.click(); else { if(confirm("ลบโซนนี้?")){ plPushUndo(); DB.zones=DB.zones.filter(function(z){return z.id!==state.selZoneId;}); state.selZoneId=null; saveDB(); render(); } } }
      else if(!prog && selIds().length>1){ e.preventDefault(); delSelectedMembers(); }
      else if(!prog && state.selMemberId){ e.preventDefault(); var db=document.querySelector('[data-act="delMember"]'); if(db) db.click(); }
    }
  };
  document.addEventListener("keydown",_plKeyHandler);
  // แต่งป้ายเบอร์ (สี/ฟอนต์/ขนาด) — เก็บใน localStorage
  function _saveLabelStyle(){ try{ localStorage.setItem("rebarcheck.labelStyle",JSON.stringify(state.labelStyle)); }catch(e){} }
  var _lc=$("#labColor"), _lf=$("#labFont"), _lsz=$("#labSize");
  if(_lc){ _lc.addEventListener("input",function(){ state.labelStyle.color=_lc.value; repaintPlanShapes(); }); _lc.addEventListener("change",function(){ state.labelStyle.color=_lc.value; _saveLabelStyle(); render(); }); }
  if(_lf){ _lf.addEventListener("change",function(){ state.labelStyle.font=_lf.value; _saveLabelStyle(); render(); }); }
  if(_lsz){ _lsz.addEventListener("change",function(){ state.labelStyle.size=+_lsz.value; _saveLabelStyle(); render(); }); }
  // ป้ายเบอร์เฉพาะกล่องที่เลือก (สี/ฟอนต์) — ทับค่ารวม
  var _bxc=$("#boxLabColor"), _bxf=$("#boxLabFont");
  if(_bxc){ _bxc.addEventListener("input",function(){ var mm=getMember(state.selMemberId); if(mm&&mm.plan){ mm.plan.labelColor=_bxc.value; repaintPlanShapes(); } });
    _bxc.addEventListener("change",function(){ var mm=getMember(state.selMemberId); if(mm&&mm.plan){ mm.plan.labelColor=_bxc.value; saveDB(); render(); } }); }
  if(_bxf){ _bxf.addEventListener("change",function(){ var mm=getMember(state.selMemberId); if(mm&&mm.plan){ mm.plan.labelFont=_bxf.value; saveDB(); render(); } }); }
  // ดรอปดาวน์เลือกชนิดที่กำลังวาด
  $$("#drawTypeSel").forEach(function(dts){ dts.addEventListener("change",function(){
    if(dts.value==="__addtype"){
      var nm=prompt("ชื่อชนิดใหม่ (เช่น เสาเอ็น, ทับหลัง, ครีบกันแดด)");
      var k=nm?addCustomType(nm):null;
      if(k){ state.catType=k; if(state.hiddenTypes) delete state.hiddenTypes[k]; }
      render(); return;
    }
    state.catType=dts.value; if(state.hiddenTypes) delete state.hiddenTypes[dts.value]; render();
  }); });
  // ดรอปดาวน์กรองชนิดในแท็บรายการ
  var lfs=$("#listFilterSel");
  if(lfs) lfs.addEventListener("change",function(){ state.listFilter=lfs.value; render(); });

  // สี/ความเข้ม/ความหนาเส้น (แท็บสไตล์/ลาย) — ถ้าเลือกคานอยู่ ปรับคานนั้นทันที; ถ้าไม่ ตั้งเป็นค่าเริ่มของคานที่จะวาดใหม่
  var dc=$("#drawColor"), da=$("#drawAlpha"), ds=$("#drawStroke"), dsw=$("#drawSwatch");
  function applyStyle(colOverride){
    var col=colOverride||(dc?dc.value:state.fillColor), a=da?(+da.value)/100:state.fillAlpha, ww=ds?+ds.value:state.strokeW;
    var _ael=document.querySelector('.rv-range em[data-for="drawAlpha"]'); if(_ael) _ael.textContent=Math.round(a*100)+'%';
    var _sel=document.querySelector('.rv-range em[data-for="drawStroke"]'); if(_sel) _sel.textContent=ww+' px';
    if(dsw){ dsw.style.background=col; dsw.style.opacity=a; }
    var mm=getMember(state.selMemberId);
    if(mm && isBox(mm.plan)){    // มีคานเลือกอยู่ → ปรับคานนั้น
      mm.plan.fill=col; mm.plan.fillA=a; mm.plan.strokeW=ww;
      var r=$("#planOverlay").querySelector('[data-mid="'+mm.id+'"]');   // rect/ellipse/polygon
      if(r){
        r.setAttribute("fill",col); r.setAttribute("fill-opacity",a);
        if(ww>0){ r.setAttribute("stroke",col); r.setAttribute("stroke-width",ww); } else r.setAttribute("stroke","none");
      }
    }else{                                          // ไม่ได้เลือกกล่อง → ปรับ "ทุกกล่อง" ในแปลนนี้ทันที + ตั้งเป็นค่าเริ่มของกล่องใหม่
      state.fillColor=col; state.fillAlpha=a; state.strokeW=ww;
      var _f=getFloor(state.floorId), _pid=curPlanId(), _n=0;
      membersOfFloor(_f.id).forEach(function(mm){ if(mm.plan && isBox(mm.plan) && memberPlanId(mm)===_pid){ mm.plan.fill=col; mm.plan.fillA=a; mm.plan.strokeW=ww; _n++; } });
      if(_n) repaintPlanShapes();
    }
  }
  function saveStyle(){ applyStyle(); saveDB(); }
  [dc,da,ds].forEach(function(inp){ if(inp) inp.addEventListener("pointerdown",function(){ plPushUndo(); }); });   // เก็บสภาพก่อนปรับ ครั้งเดียวต่อการลาก
  if(dc){ dc.addEventListener("input",function(){ applyStyle(); }); dc.addEventListener("change",saveStyle); }
  if(da){ da.addEventListener("input",function(){ applyStyle(); }); da.addEventListener("change",saveStyle); }
  if(ds){ ds.addEventListener("input",function(){ applyStyle(); }); ds.addEventListener("change",saveStyle); }
  // จานสีใช้บ่อย — กดเลือกแล้วใช้ทันที
  $$(".swatch").forEach(function(b){ b.addEventListener("click",function(){
    if(getMember(state.selMemberId)) plPushUndo();
    var _c=b.getAttribute("data-swatch"); if(dc) dc.value=_c;
    applyStyle(_c); if(getMember(state.selMemberId)) saveDB();
    $$(".swatch").forEach(function(x){ x.classList.toggle("on", x===b); });
  }); });

  // โหลด pdf.js ไว้ล่วงหน้าแบบเบื้องหลัง เพื่อให้ตอนกดนำเข้า PDF ขึ้นไว (ไม่ต้องรอโหลด CDN)
  if(!window.pdfjsLib && !_pdfjsPromise){ try{ loadPdfJs(); }catch(e){} }

  var overlay=$("#planOverlay"), stage=$("#planStage");
  if(!overlay) return;
  _szCache=null; planClampPan(); planApplyTransform();   // คงระดับซูม/ตำแหน่งเดิมหลังเรนเดอร์ใหม่ (จัดแผ่นให้อยู่กลาง/ในกรอบ)
  applyBestImage();       // แสดงภาพคมที่สุด (โหลดต้นฉบับจาก IDB ถ้าจำเป็น)

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
    var X=pt.x*VW, Y=pt.y*VH, m=8*unit;   // กรอบสแนบ ~16px คงที่ทุกซูม (ไม่มีวงเป้ารอบนอก)
    var col=pt.type==="end"?"#e00000":(pt.type==="cross"?"#0a9e0a":"#0a5fe0");
    var body = (pt.type==="cross")
      ? '<line x1="'+(X-m)+'" y1="'+(Y-m)+'" x2="'+(X+m)+'" y2="'+(Y+m)+'"/><line x1="'+(X-m)+'" y1="'+(Y+m)+'" x2="'+(X+m)+'" y2="'+(Y-m)+'"/>'
      : '<rect x="'+(X-m)+'" y="'+(Y-m)+'" width="'+(2*m)+'" height="'+(2*m)+'"/>';
    var target=body;
    // ฮาโลขาวหนา + เส้นสีหนา → เห็นชัดแม้ซูมสุดบนแบบที่เส้นเยอะ (ไม่มีวงกลมใด ๆ)
    snapEl.innerHTML='<g fill="none" stroke="#fff" stroke-width="'+(7*unit)+'" stroke-linecap="round" opacity="0.95">'+target+'</g>'
      +'<g fill="none" stroke="'+col+'" stroke-width="'+(3.6*unit)+'" stroke-linecap="round">'+target+'</g>';
  }
  function snapAt(ev){
    var p=norm(ev), r=overlay.getBoundingClientRect();
    var sp=(state.tool==="draw"||state.tool==="drawZone"||state.tool==="drawArea"||state.tool==="drawHole"||state.tool==="setScale"||state.tool==="drawDim") ? snapNorm(p.x,p.y,r.width,r.height) : null;
    if(sp){ showSnap(sp,r); return {x:sp.x,y:sp.y}; }
    showSnap(null); return p;
  }
  // ---- ลาก/วาดจนชิดขอบกรอบ → เลื่อนแปลนตามอัตโนมัติ (ยิ่งชิดยิ่งเร็ว) แล้วเรียกตัวจัดการลากซ้ำให้ชิ้นตามไปด้วย ----
  var _ep={raf:0, ev:null, fn:null};
  function edgePan(ev, fn){ _ep.ev=ev; _ep.fn=fn; if(!_ep.raf) _ep.raf=requestAnimationFrame(_epTick); }
  function edgePanStop(){ if(_ep.raf) cancelAnimationFrame(_ep.raf); _ep.raf=0; _ep.ev=null; _ep.fn=null; }
  function _epTick(){
    _ep.raf=0;
    var ev=_ep.ev; if(!ev || !stage || window.__planPinch) return;
    var r=stage.getBoundingClientRect(); if(!r.width || !r.height) return;
    var M=Math.min(36, r.width/8, r.height/8), MAX=16;
    function v(d){ return d>=M ? 0 : (M-Math.max(0,d))/M*MAX; }   // ระยะจากขอบ → ความเร็ว (นอกกรอบ = เร็วสุด)
    var vx=v(ev.clientX-r.left)-v(r.right-ev.clientX), vy=v(ev.clientY-r.top)-v(r.bottom-ev.clientY);
    if(!vx && !vy) return;
    var px=state.panX, py=state.panY;
    state.panX+=vx; state.panY+=vy; planClampPan();
    if(state.panX===px && state.panY===py) return;   // สุดขอบแปลนแล้ว
    planApplyTransform();
    if(_ep.fn) _ep.fn(ev);                            // ชิ้น/เส้นร่างตามเคอร์เซอร์ (ตำแหน่งจอเดิม แต่แปลนเลื่อน)
    if(!_ep.raf) _ep.raf=requestAnimationFrame(_epTick);
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
    var ps=null, moved=false, mid=null, tf=null, mv=null, ml=null, lsz=null, ztf=null, zmv=null, atf=null, amv=null, mq=null;
    function mqBox(){ var d=document.getElementById("planMarquee"); if(!d){ d=document.createElement("div"); d.id="planMarquee"; d.className="plan-marquee"; document.body.appendChild(d); } return d; }
    function mqRemove(){ var d=document.getElementById("planMarquee"); if(d&&d.parentNode) d.parentNode.removeChild(d); }
    function repaintShapes(){ overlay.innerHTML=planShapesSVG(VW,VH); updateLabelScale(); }
    function clampGeo(pl){   // กันชิ้นส่วนหลุดออกนอกแปลน
      ["x1","x2","y1","y2","x","y"].forEach(function(k){ if(pl[k]!=null) pl[k]=Math.max(0,Math.min(1,pl[k])); });
    }
    function lblAnchor(pl){ if(pl.kind==="point") return {x:pl.x,y:pl.y}; return {x:(pl.x1+pl.x2)/2,y:(pl.y1+pl.y2)/2}; }
    function lblCenterClient(m){ var a=lblAnchor(m.plan), r=overlay.getBoundingClientRect();
      return { x:r.left+(a.x+(m.plan.labelDx||0))*r.width, y:r.top+(a.y+(m.plan.labelDy||0))*r.height }; }
    // คลิกขวาที่ชิ้นส่วน → เมนูลัด (คอม) · ดับเบิลคลิกชิ้นส่วน → ตรวจเหล็กทันที
    overlay.addEventListener("contextmenu",function(ev){
      if(isMobile()) return;
      var me=ev.target.closest("[data-mid]"); if(!me){ closeCtxMenu(); return; }
      var cm=getMember(me.getAttribute("data-mid")); if(!cm) return;
      ev.preventDefault();
      if(state.selMemberId!==cm.id){ state.selMemberId=cm.id; state.memberId=cm.id; state.selZoneId=null; state.selAnnotId=null; state.selTypeId=null; if(state.rightTab!=="inspect") state.rightTab="props"; state.ribbonTab="modify"; render(); }
      planCtxMenu(cm, ev.clientX, ev.clientY);
    });
    overlay.addEventListener("dblclick",function(ev){
      if(isMobile() || state.tool!=="select" || ev.target.closest("[data-lbl]")) return;
      var me=ev.target.closest("[data-mid]"); if(!me) return;
      var dm=getMember(me.getAttribute("data-mid")); if(!dm) return;
      ev.preventDefault(); closeCtxMenu();
      state.selMemberId=dm.id; state.memberId=dm.id; state.rpCollapsed=false; state.ribbonTab="modify";
      go("planEditor",{rightTab:"inspect"});
    });
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
      _plPend=plSnap();   // เก็บสภาพก่อนลาก — ยืนยันเข้าสแตกตอนปล่อยเฉพาะเมื่อมีการเปลี่ยนจริง
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
      var ahEl=ev.target.closest("[data-ahandle]");
      if(ahEl){       // จับจุดจับหมายเหตุ → ย้ายปลายลูกศร / ย่อ-ขยายกล่อง / ย้ายปลายเส้นวัด
        var ah=getAnnot(ahEl.getAttribute("data-aid"));
        if(ah){ atf={ aid:ah.id, handle:ahEl.getAttribute("data-ahandle"), geo:JSON.parse(JSON.stringify(ah)) };
          try{ overlay.setPointerCapture(ev.pointerId); }catch(x){} ev.preventDefault(); return; }
      }
      var aEl=ev.target.closest("[data-aid]");
      if(aEl){        // กดที่หมายเหตุ → เตรียมย้าย/เลือก
        var aa=getAnnot(aEl.getAttribute("data-aid"));
        if(aa){ amv={ aid:aa.id, start:norm(ev), geo:JSON.parse(JSON.stringify(aa)), moved:false };
          try{ overlay.setPointerCapture(ev.pointerId); }catch(x){} return; }
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
      if(sEl){        // กดที่ตัวชิ้นส่วน → เตรียมย้าย/เลือก (ถ้าอยู่ในชุดที่เลือก → ย้ายทั้งชุด)
        var m=getMember(sEl.getAttribute("data-mid")); var p0=norm(ev);
        mv={ mid:sEl.getAttribute("data-mid"), start:p0, geo:JSON.parse(JSON.stringify(m.plan)), moved:false, shift:!!ev.shiftKey };
        var _gids=selIds(); if(_gids.length>1 && _gids.indexOf(mv.mid)>=0) mv.grp=_gids.map(function(id){ var g=getMember(id); return g&&g.plan?{m:g, geo:JSON.parse(JSON.stringify(g.plan))}:null; }).filter(Boolean);
        try{ overlay.setPointerCapture(ev.pointerId); }catch(x){}
        return;
      }
      if(!isMobile() && (state.marquee || ev.shiftKey)){   // ลากกรอบเลือกบนที่ว่าง (เครื่องมือ หรือ Shift+ลาก)
        mq={x0:ev.clientX, y0:ev.clientY, add:!!ev.shiftKey && !state.marquee};
        var mb=mqBox(); mb.style.left=ev.clientX+"px"; mb.style.top=ev.clientY+"px"; mb.style.width="0px"; mb.style.height="0px";
        try{ overlay.setPointerCapture(ev.pointerId); }catch(x){} ev.preventDefault(); return;
      }
      ps={x:ev.clientX,y:ev.clientY,px:state.panX,py:state.panY}; moved=false; mid=null;
      try{ overlay.setPointerCapture(ev.pointerId); }catch(x){}
    });
    function selMove(ev){
      if(window.__planPinch) return;   // สองนิ้วซูมอยู่ → หยุดลาก/เลื่อน
      if(lsz||ml||tf||atf||amv||ztf||zmv||mv) edgePan(ev, selMove);   // ลากชิดขอบกรอบ → เลื่อนแปลนตาม
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
      if(atf){       // ลากจุดจับหมายเหตุ
        var at=getAnnot(atf.aid); if(!at) return;
        var pa=norm(ev), cx2=Math.max(0,Math.min(1,pa.x)), cy2=Math.max(0,Math.min(1,pa.y)), hh2=atf.handle, g0=atf.geo;
        if(at.kind==="dim" && hh2!=="off" && state.snap){ var _rs=overlay.getBoundingClientRect(), _sp=snapNorm(cx2,cy2,_rs.width,_rs.height); if(_sp){ cx2=_sp.x; cy2=_sp.y; showSnap(_sp,_rs); } else showSnap(null); }   // ปลายเส้นบอกขนาดดูดเข้าเส้นแบบ
        if(at.kind==="area"){
          var hm=hh2.match(/^v(\d+)$/), hm2=hh2.match(/^h(\d+)_(\d+)$/);
          if(hm && at.pts[+hm[1]]) at.pts[+hm[1]]={x:cx2,y:cy2};
          else if(hm2 && at.holes && at.holes[+hm2[1]] && at.holes[+hm2[1]][+hm2[2]]) at.holes[+hm2[1]][+hm2[2]]={x:cx2,y:cy2};
        }else if(at.kind==="dim"){
          if(hh2==="off"){   // เลื่อนเส้นบอกขนาดตั้งฉากกับแนวที่วัด (ระยะจากจุดวัด → เคอร์เซอร์)
            var _vw=+overlay.getAttribute("data-vw")||1000, _vh=+overlay.getAttribute("data-vh")||1000;
            var _ax=at.p1.x*_vw, _ay=at.p1.y*_vh, _bx=at.p2.x*_vw, _by=at.p2.y*_vh, _L=Math.hypot(_bx-_ax,_by-_ay)||1;
            var _npx=-(_by-_ay)/_L, _npy=(_bx-_ax)/_L;
            at.off=((cx2*_vw-_ax)*_npx+(cy2*_vh-_ay)*_npy)/_vw;
          }
          else if(hh2==="p1"){ at.p1.x=cx2; at.p1.y=cy2; } else { at.p2.x=cx2; at.p2.y=cy2; }
        }else if(hh2==="tip"){ at.tip.x=cx2; at.tip.y=cy2; }
        else{
          var bx1=Math.min(g0.box.x1,g0.box.x2), bx2=Math.max(g0.box.x1,g0.box.x2);
          var by1=Math.min(g0.box.y1,g0.box.y2), by2=Math.max(g0.box.y1,g0.box.y2), MINB=0.02;
          if(hh2.indexOf("w")>=0) bx1=Math.min(cx2, bx2-MINB); else bx2=Math.max(cx2, bx1+MINB);
          if(hh2.indexOf("n")>=0) by1=Math.min(cy2, by2-MINB); else by2=Math.max(cy2, by1+MINB);
          at.box={x1:bx1,y1:by1,x2:bx2,y2:by2};
        }
        repaintShapes(); return;
      }
      if(amv){       // ย้ายหมายเหตุทั้งชิ้น (กล่อง+ลูกศร / เส้นวัดทั้งเส้น)
        var am=getAnnot(amv.aid); if(!am) return;
        var pm=norm(ev), ddx=pm.x-amv.start.x, ddy=pm.y-amv.start.y;
        if(!amv.moved && Math.abs(ddx)+Math.abs(ddy)>0.004){ amv.moved=true; state.selAnnotId=amv.aid; }
        if(amv.moved){
          var g1=amv.geo;
          var _mv=function(pt){ return {x:pt.x+ddx,y:pt.y+ddy}; };
          if(am.kind==="area"){ am.pts=(g1.pts||[]).map(_mv); am.holes=(g1.holes||[]).map(function(hh){ return hh.map(_mv); }); }
          else if(am.kind==="dim"){ am.p1={x:g1.p1.x+ddx,y:g1.p1.y+ddy}; am.p2={x:g1.p2.x+ddx,y:g1.p2.y+ddy}; }
          else{ am.box={x1:g1.box.x1+ddx,y1:g1.box.y1+ddy,x2:g1.box.x2+ddx,y2:g1.box.y2+ddy};
                am.tip={x:g1.tip.x+ddx,y:g1.tip.y+ddy}; }
          repaintShapes();
        }
        return;
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
      if(mq){        // ลากกรอบเลือก
        var mb2=mqBox(); mb2.style.left=Math.min(mq.x0,ev.clientX)+"px"; mb2.style.top=Math.min(mq.y0,ev.clientY)+"px";
        mb2.style.width=Math.abs(ev.clientX-mq.x0)+"px"; mb2.style.height=Math.abs(ev.clientY-mq.y0)+"px"; return;
      }
      if(mv){        // ย้ายตำแหน่งชิ้นส่วน (หรือทั้งชุด)
        var m2=getMember(mv.mid); if(!m2) return;
        var p2=norm(ev), dxN=p2.x-mv.start.x, dyN=p2.y-mv.start.y;
        if(!mv.moved && Math.abs(dxN)+Math.abs(dyN)>0.004){ mv.moved=true; if(!mv.grp) state.selMemberId=mv.mid; }
        if(mv.moved){
          var _apply=function(pl,g){ if(pl.kind==="point"){ pl.x=g.x+dxN; pl.y=g.y+dyN; } else { pl.x1=g.x1+dxN; pl.x2=g.x2+dxN; pl.y1=g.y1+dyN; pl.y2=g.y2+dyN; } clampGeo(pl); };
          if(mv.grp) mv.grp.forEach(function(e){ _apply(e.m.plan, e.geo); });
          else _apply(m2.plan, mv.geo);
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
      edgePanStop();
      window.removeEventListener("pointermove",selMove,true);
      window.removeEventListener("pointerup",selUp,true);
      window.removeEventListener("pointercancel",selUp,true);
      if(atf){ var _atA=getAnnot(atf.aid); atf=null; showSnap(null); plCommitPend(); saveDB(); if(_atA && (_atA.kind==="area" || (_atA.kind==="dim"&&_atA.auto))) render(); return; }   // ตัวเลขในแผงต้องตามรูปที่ลาก
      if(amv){
        var wasA=amv.moved, aid=amv.aid; amv=null;
        if(wasA){ plCommitPend(); saveDB(); return; }
        state.selAnnotId=aid; state.selMemberId=null; state.selZoneId=null; state.ribbonTab="annot"; state.mSheet=null; state.mSheetMin=false; render();   // แค่แตะ → เลือก + เปิดแผงรูปแบบ
        return;
      }
      if(lsz){ lsz=null; plCommitPend(); saveDB(); return; }
      if(ml){ ml=null; plCommitPend(); saveDB(); return; }
      if(tf){ tf=null; plCommitPend(); saveDB(); return; }
      if(ztf){ ztf=null; plCommitPend(); saveDB(); return; }
      if(zmv){
        var wasZ=zmv.moved, zid=zmv.zid; zmv=null;
        if(wasZ){ plCommitPend(); saveDB(); return; }        // ลากย้ายเสร็จ → บันทึก
        state.selZoneId=zid; state.selMemberId=null; state.rightTab="props"; state.mSheet=null; state.mSheetMin=false; render();   // แค่แตะ → เลือก
        return;
      }
      if(mq){        // ปล่อยกรอบเลือก → เลือกทุกชิ้นที่กรอบทับ
        var q=mq; mq=null; mqRemove();
        var qx1=Math.min(q.x0,ev.clientX), qy1=Math.min(q.y0,ev.clientY), qx2=Math.max(q.x0,ev.clientX), qy2=Math.max(q.y0,ev.clientY);
        if(qx2-qx1<4 && qy2-qy1<4){ state.marquee=false; if(!q.add){ state.selMemberId=null; state.selMulti=[]; } render(); return; }   // แค่คลิก
        var rr=overlay.getBoundingClientRect(), nx1=(qx1-rr.left)/rr.width, ny1=(qy1-rr.top)/rr.height, nx2=(qx2-rr.left)/rr.width, ny2=(qy2-rr.top)/rr.height;
        var hit=[]; overlay.querySelectorAll("[data-mid]").forEach(function(el){ var id=el.getAttribute("data-mid"); if(hit.indexOf(id)>=0) return; var mm=getMember(id); var b=mm&&memberBBox(mm); if(!b||mm.hidden) return; if(b.x1<=nx2 && b.x2>=nx1 && b.y1<=ny2 && b.y2>=ny1) hit.push(id); });
        var ids=q.add ? selIds().concat(hit.filter(function(id){ return selIds().indexOf(id)<0; })) : hit;
        setMulti(ids); state.marquee=false; if(ids.length && !isMobile()) state.ribbonTab="modify"; if(state.rightTab!=="inspect") state.rightTab="props";
        render(); if(!ids.length) toast("ไม่มีชิ้นส่วนในกรอบ"); return;
      }
      if(mv){
        var wasMove=mv.moved, id=mv.mid, wasShift=mv.shift; mv=null;
        if(wasMove){ plCommitPend(); saveDB(); return; }        // ลากย้ายเสร็จ → บันทึก
        if(wasShift && !isMobile()){   // Shift+คลิก → เพิ่ม/ลดจากชุดที่เลือก
          var cur=selIds(), ix=cur.indexOf(id); if(ix>=0) cur.splice(ix,1); else cur.push(id);
          setMulti(cur); if(cur.length) state.ribbonTab="modify"; if(state.rightTab!=="inspect") state.rightTab="props"; render(); return;
        }
        state.selMulti=[];
        state.selMemberId=id; state.memberId=id; state.selZoneId=null; state.mSheet=null; state.mSheetMin=false; if(!isMobile()) state.ribbonTab="modify";  // แค่แตะ → เลือก (คอม: เปิดแท็บแก้ไข)
        if(state.rightTab!=="inspect") state.rightTab="props";   // เหมือน Inspector: เลือกแล้วโชว์คุณสมบัติ (ถ้ากำลังตรวจอยู่ คงแท็บตรวจ)
        render();   // คำตอบตรวจผูกกับชิ้น (ansMid) — เปลี่ยนชิ้นแล้วล้างเองใน bindInspectionInputs
        return;
      }
      if(!ps) return;
      var wasMoved=moved; ps=null;
      if(wasMoved){ scheduleEnsure(); return; }    // ลากที่ว่าง = เลื่อนภาพ → เรนเดอร์ส่วนที่เห็นใหม่ให้คม
      if(state.selMemberId||state.selZoneId||state.selAnnotId){ state.selMemberId=null; state.selMulti=[]; state.selZoneId=null; state.selAnnotId=null; state.mSheet=null; state.mSheetMin=false; render(); }   // แตะที่ว่าง = เลิกเลือก
    }
    return;
  }

  /* ---------- โหมดเพิ่มหมายเหตุ: กล่องข้อความ / เส้นบอกขนาด ---------- */
  if(state.tool==="drawCallout" || state.tool==="drawDim"){
    var isDimTool=(state.tool==="drawDim"), ACOL=(state.annotStyle&&state.annotStyle.color)||"#1d4ed8";
    var aStart=null, aTemp=null;
    function aEnd(ev2){
      window.removeEventListener("pointermove",aMove,true);
      window.removeEventListener("pointerup",aEnd,true);
      window.removeEventListener("pointercancel",aEnd,true);
      edgePanStop();
      if(!aStart) return;
      var p=snapAt(ev2), s0=aStart; aStart=null; showSnap(null);
      if(aTemp){ aTemp.remove(); aTemp=null; }
      var rb=overlay.getBoundingClientRect();
      if(Math.abs(p.x-s0.x)*rb.width<6 && Math.abs(p.y-s0.y)*rb.height<6) return;   // ลากสั้นเกิน = ยกเลิก
      if(isDimTool) finishDrawDim(s0,p); else finishDrawCallout(s0,p);
    }
    function aMove(ev2){
      if(!aStart||!aTemp) return;
      if(ev2.cancelable) ev2.preventDefault();
      edgePan(ev2, aMove);
      var p=snapAt(ev2), z=state.zoom||1;
      if(isDimTool){
        aTemp.setAttribute("x1",s0x()*VW); aTemp.setAttribute("y1",s0y()*VH);
        aTemp.setAttribute("x2",p.x*VW);   aTemp.setAttribute("y2",p.y*VH);
      }else{
        aTemp.setAttribute("x",Math.min(aStart.x,p.x)*VW); aTemp.setAttribute("y",Math.min(aStart.y,p.y)*VH);
        aTemp.setAttribute("width",Math.abs(p.x-aStart.x)*VW); aTemp.setAttribute("height",Math.abs(p.y-aStart.y)*VH);
      }
    }
    function s0x(){ return aStart?aStart.x:0; } function s0y(){ return aStart?aStart.y:0; }
    overlay.addEventListener("pointermove",function(ev){ if(!aStart) snapAt(ev); });
    overlay.addEventListener("pointerleave",function(){ if(!aStart) showSnap(null); });
    overlay.addEventListener("pointerdown",function(ev){
      if(window.__planPinch) return;
      if(ev.button!=null && ev.button!==0) return;
      ev.preventDefault();
      aStart=snapAt(ev);
      var z=state.zoom||1;
      aTemp=document.createElementNS(NS, isDimTool?"line":"rect");
      aTemp.setAttribute("stroke",ACOL); aTemp.setAttribute("stroke-width",(2/z));
      aTemp.setAttribute("stroke-dasharray",(6/z)+" "+(4/z));
      if(isDimTool){ aTemp.setAttribute("x1",aStart.x*VW); aTemp.setAttribute("y1",aStart.y*VH); aTemp.setAttribute("x2",aStart.x*VW); aTemp.setAttribute("y2",aStart.y*VH); }
      else{ aTemp.setAttribute("fill",ACOL); aTemp.setAttribute("fill-opacity","0.06"); aTemp.setAttribute("rx",(6/z)); }
      overlay.appendChild(aTemp);
      window.addEventListener("pointermove",aMove,true);
      window.addEventListener("pointerup",aEnd,true);
      window.addEventListener("pointercancel",aEnd,true);
    });
    return;
  }

  /* ---------- ตั้งมาตราส่วน: ลาก 2 จุดที่รู้ระยะจริง แล้วใส่ตัวเลขเมตร ---------- */
  if(state.tool==="setScale"){
    var scStart=null, scTemp=null, SCOL="#dc2626";
    function scEnd(ev2){
      window.removeEventListener("pointermove",scMove,true); window.removeEventListener("pointerup",scEnd,true); window.removeEventListener("pointercancel",scEnd,true); edgePanStop();
      if(!scStart) return;
      var p=snapAt(ev2), s0=scStart; scStart=null; showSnap(null);
      if(scTemp){ scTemp.remove(); scTemp=null; }
      var rb=overlay.getBoundingClientRect();
      if(Math.hypot((p.x-s0.x)*rb.width,(p.y-s0.y)*rb.height)<8) return;
      finishSetScale(s0,p);
    }
    function scMove(ev2){ if(!scStart||!scTemp) return; if(ev2.cancelable) ev2.preventDefault(); edgePan(ev2, scMove); var p=snapAt(ev2); scTemp.setAttribute("x2",p.x*VW); scTemp.setAttribute("y2",p.y*VH); }
    overlay.addEventListener("pointermove",function(ev){ if(!scStart) snapAt(ev); });
    overlay.addEventListener("pointerleave",function(){ if(!scStart) showSnap(null); });
    overlay.addEventListener("pointerdown",function(ev){
      if(window.__planPinch) return;
      if(ev.button!=null && ev.button!==0) return;
      ev.preventDefault();
      scStart=snapAt(ev); var z=state.zoom||1;
      scTemp=document.createElementNS(NS,"line");
      scTemp.setAttribute("stroke",SCOL); scTemp.setAttribute("stroke-width",(2.5/z)); scTemp.setAttribute("stroke-dasharray",(7/z)+" "+(4/z)); scTemp.setAttribute("stroke-linecap","round");
      scTemp.setAttribute("x1",scStart.x*VW); scTemp.setAttribute("y1",scStart.y*VH); scTemp.setAttribute("x2",scStart.x*VW); scTemp.setAttribute("y2",scStart.y*VH);
      overlay.appendChild(scTemp);
      window.addEventListener("pointermove",scMove,true); window.addEventListener("pointerup",scEnd,true); window.addEventListener("pointercancel",scEnd,true);
    });
    return;
  }

  /* ---------- วัดพื้นที่ / หักช่องเปิด: คลิกทีละมุม (ดับเบิลคลิกปิดรูป) หรือ ลากสี่เหลี่ยม ---------- */
  if(state.tool==="drawArea" || state.tool==="drawHole"){
    var isHole=(state.tool==="drawHole"), ARC=isHole?"#dc2626":AREA_COL;
    var arDone=function(pts){ if(isHole) finishDrawHole(pts); else finishDrawArea(pts); };
    if((state.areaShape||"poly")==="poly"){
      var apts=[], ag=document.createElementNS(NS,"g"); ag.setAttribute("id","areaPolyTemp"); overlay.appendChild(ag);
      function aredraw(cur){
        var z=state.zoom||1, arr=apts.slice(); if(cur) arr.push(cur);
        var out="";
        if(arr.length){
          var dd=arr.map(function(p){ return (p.x*VW).toFixed(1)+","+(p.y*VH).toFixed(1); }).join(" ");
          out+='<polyline points="'+dd+'" fill="'+ARC+'" fill-opacity="'+(apts.length>=2?0.1:0)+'" stroke="'+ARC+'" stroke-width="'+(2.4/z)+'" stroke-dasharray="'+(7/z)+' '+(5/z)+'" stroke-linecap="round" stroke-linejoin="round"/>';
          apts.forEach(function(p){ out+='<circle cx="'+(p.x*VW)+'" cy="'+(p.y*VH)+'" r="'+(5/z)+'" fill="#fff" stroke="'+ARC+'" stroke-width="'+(2/z)+'"/>'; });
          if(apts.length>=1 && cur){   // ระยะของด้านที่กำลังลาก (ถ้ามีสเกล)
            var sci=planScaleInfo(); if(sci.us>0){ var q=apts[apts.length-1], pw=sci.plan.w||1000, ph=sci.plan.h||700, L=Math.hypot((cur.x-q.x)*pw,(cur.y-q.y)*ph)*sci.us;
              out+='<text x="'+((cur.x+q.x)/2*VW)+'" y="'+((cur.y+q.y)/2*VH-8/z)+'" font-size="'+(13/z)+'" font-weight="700" fill="'+ARC+'" text-anchor="middle" font-family="Sarabun, sans-serif" style="paint-order:stroke;stroke:#fff;stroke-width:'+(3/z)+'px">'+fmtNum(L,2)+' ม.</text>'; }
          }
        }
        ag.innerHTML=out;
      }
      function afinish(){ var pts=apts.slice(); ag.remove(); showSnap(null); if(pts.length<3){ state.tool="select"; render(); return; } arDone(pts); }
      overlay.addEventListener("pointermove",function(ev){ aredraw(snapAt(ev)); });
      overlay.addEventListener("click",function(ev){
        var p=snapAt(ev);
        if(apts.length>=3){ var fpt=apts[0], r=overlay.getBoundingClientRect();
          if(Math.hypot((p.x-fpt.x)*r.width,(p.y-fpt.y)*r.height)<12){ afinish(); return; } }
        apts.push(p); aredraw(p);
      });
      overlay.addEventListener("dblclick",function(ev){ ev.preventDefault(); if(apts.length) apts.pop(); afinish(); });
      return;
    }
    var arStart=null, arTemp=null;
    function arMove(ev2){
      if(!arStart||!arTemp) return;
      if(ev2.cancelable) ev2.preventDefault();
      edgePan(ev2, arMove);
      var p=snapAt(ev2);
      arTemp.setAttribute("x",Math.min(arStart.x,p.x)*VW); arTemp.setAttribute("y",Math.min(arStart.y,p.y)*VH);
      arTemp.setAttribute("width",Math.abs(p.x-arStart.x)*VW); arTemp.setAttribute("height",Math.abs(p.y-arStart.y)*VH);
    }
    function arEnd(ev2){
      window.removeEventListener("pointermove",arMove,true); window.removeEventListener("pointerup",arEnd,true); window.removeEventListener("pointercancel",arEnd,true); edgePanStop();
      if(!arStart) return;
      var p=snapAt(ev2), s=arStart; arStart=null; showSnap(null);
      if(arTemp){ arTemp.remove(); arTemp=null; }
      var rb=overlay.getBoundingClientRect();
      if(Math.abs(p.x-s.x)*rb.width<5 || Math.abs(p.y-s.y)*rb.height<5) return;
      var x1=Math.min(s.x,p.x), x2=Math.max(s.x,p.x), y1=Math.min(s.y,p.y), y2=Math.max(s.y,p.y);
      arDone([{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2}]);
    }
    overlay.addEventListener("pointermove",function(ev){ if(!arStart) snapAt(ev); });
    overlay.addEventListener("pointerleave",function(){ if(!arStart) showSnap(null); });
    overlay.addEventListener("pointerdown",function(ev){
      if(window.__planPinch) return;
      if(ev.button!=null && ev.button!==0) return;
      ev.preventDefault();
      arStart=snapAt(ev);
      arTemp=document.createElementNS(NS,"rect");
      var z=state.zoom||1;
      arTemp.setAttribute("stroke",ARC); arTemp.setAttribute("stroke-width",(2.4/z)); arTemp.setAttribute("stroke-dasharray",(7/z)+" "+(5/z));
      arTemp.setAttribute("fill",ARC); arTemp.setAttribute("fill-opacity","0.1");
      overlay.appendChild(arTemp);
      window.addEventListener("pointermove",arMove,true); window.addEventListener("pointerup",arEnd,true); window.addEventListener("pointercancel",arEnd,true);
    });
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
    var zStart=null, zTemp=null, zIsOval=(state.zoneShape==="oval");
    function zDrawMove(ev2){
      if(!zStart||!zTemp) return;
      if(ev2.cancelable) ev2.preventDefault();
      edgePan(ev2, zDrawMove);
      var p=snapAt(ev2);
      if(zIsOval){
        zTemp.setAttribute("cx",(zStart.x+p.x)/2*VW); zTemp.setAttribute("cy",(zStart.y+p.y)/2*VH);
        zTemp.setAttribute("rx",Math.abs(p.x-zStart.x)/2*VW); zTemp.setAttribute("ry",Math.abs(p.y-zStart.y)/2*VH);
      }else{
        zTemp.setAttribute("x",Math.min(zStart.x,p.x)*VW); zTemp.setAttribute("y",Math.min(zStart.y,p.y)*VH);
        zTemp.setAttribute("width",Math.abs(p.x-zStart.x)*VW); zTemp.setAttribute("height",Math.abs(p.y-zStart.y)*VH);
      }
    }
    function zDrawEnd(ev2){
      window.removeEventListener("pointermove",zDrawMove,true);
      window.removeEventListener("pointerup",zDrawEnd,true);
      window.removeEventListener("pointercancel",zDrawEnd,true);
      edgePanStop();
      if(!zStart) return;
      var p=snapAt(ev2), s=zStart; zStart=null; showSnap(null);
      if(zTemp){ zTemp.remove(); zTemp=null; }
      var rb=overlay.getBoundingClientRect();
      if(Math.abs(p.x-s.x)*rb.width<5 && Math.abs(p.y-s.y)*rb.height<5) return;
      finishDrawZone({kind:(zIsOval?"oval":"rect"), x1:s.x, y1:s.y, x2:p.x, y2:p.y});
    }
    overlay.addEventListener("pointermove",function(ev){ if(!zStart) snapAt(ev); });
    overlay.addEventListener("pointerleave",function(){ if(!zStart) showSnap(null); });
    overlay.addEventListener("pointerdown",function(ev){
      if(window.__planPinch) return;
      if(ev.button!=null && ev.button!==0) return;
      ev.preventDefault();
      zStart=snapAt(ev);
      zTemp=document.createElementNS(NS, zIsOval?"ellipse":"rect");
      var z=state.zoom||1;
      zTemp.setAttribute("stroke",ZCOL); zTemp.setAttribute("stroke-width",(2.4/z));
      zTemp.setAttribute("stroke-dasharray",(7/z)+" "+(5/z));
      zTemp.setAttribute("fill",ZCOL); zTemp.setAttribute("fill-opacity","0.08");
      if(!zIsOval) zTemp.setAttribute("rx","4");
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
    edgePan(ev, drawMove);
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
    edgePanStop();
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

/* ---- ประเภทชิ้นส่วน: การกระทำ (เรียกจากปุ่ม data-act และจาก dropdown ในพาเนล) ---- */
/** ผูกชิ้นกับประเภท (t=null → ถอดออก) */
function typeAssign(m, t){
  if(t && t.mtype!==m.type){ toast("ประเภทนี้เป็น"+TYPES[t.mtype].label+" ใช้กับ"+TYPES[m.type].label+"ไม่ได้",true); render(); return false; }
  if(!t){ typeDetachAct(m); return true; }
  if(m.typeId===t.id) return true;
  var own=(!m.typeId && m.doc && Array.isArray(m.doc.els)) ? m.doc.els.length : 0;
  if(own && !confirm(m.code+" มีรายละเอียดของตัวเองอยู่ "+own+" รายการ\nเมื่อผูกกับ “"+t.name+"” จะใช้หน้ารายละเอียดของประเภทแทน (ของเดิมเก็บไว้ จะกลับมาเมื่อแยกออก)\nดำเนินการต่อ?")){ render(); return false; }
  plPushUndo();
  m.typeId=t.id; saveDB(); render();
  toast("ผูก "+m.code+" กับประเภท “"+t.name+"” แล้ว — ใช้รายละเอียดร่วมกัน "+typeMembers(t.id).length+" ชิ้น");
  return true;
}
/** สร้างประเภทจากชิ้นที่เลือก (ถามชื่อ) */
function typeCreateAct(){
  var tm=getMember(activeMemberId()); if(!tm){ toast("เลือกชิ้นส่วนบนแปลนก่อน แล้วกดสร้างประเภท",true); return; }
  if(memberTypeOf(tm)){ toast(tm.code+" ผูกประเภทอยู่แล้ว — แยกออกก่อนถ้าจะสร้างประเภทใหม่",true); render(); return; }
  var sp=shortSpec(tm)||"";
  var tnm=window.prompt("ตั้งชื่อประเภท (ชิ้นอื่นจะเลือกชื่อนี้เพื่อใช้รายละเอียดร่วมกัน):", tm.code+(sp?" — "+sp:""));
  if(tnm===null){ render(); return; }
  tnm=tnm.trim(); if(!tnm) tnm=tm.code;
  plPushUndo();
  var nt=typeCreateFrom(tm, tnm); saveDB(); render();
  toast("สร้างประเภท “"+nt.name+"” แล้ว — เลือกชิ้นอื่นแล้วกำหนดประเภทนี้ได้จากช่อง “ประเภท” ในพาเนล");
}
/** ถอดชิ้นออกจากประเภท — ถ้าชิ้นมีแผ่นของตัวเองเก็บไว้ → ใช้ของเดิม, ถ้าไม่มี → ได้สำเนาของประเภทไปแก้แยก */
function typeDetachAct(m){
  m=m||getMember(activeMemberId()); var t=m?memberTypeOf(m):null;
  if(!t){ toast("ชิ้นนี้ไม่ได้ผูกประเภท",true); render(); return; }
  var own=(m.doc && Array.isArray(m.doc.els)) ? m.doc.els.length : 0;
  var msg = own ? ("แยก "+m.code+" ออกจากประเภท “"+t.name+"”?\nชิ้นนี้จะกลับไปใช้รายละเอียดของตัวเอง ("+own+" รายการที่เก็บไว้)")
                : ("แยก "+m.code+" ออกจากประเภท “"+t.name+"”?\nชิ้นนี้จะได้สำเนาของรายละเอียดไว้แก้แยก — ไม่กระทบชิ้นอื่น");
  if(!confirm(msg)){ render(); return; }
  plPushUndo();
  typeDetach(m, !own); saveDB(); render();
  toast("แยก "+m.code+" ออกจากประเภทแล้ว");
}
/** สร้างชิ้นส่วนใหม่จากรูปที่วาด: ถามเบอร์ → บันทึก → เลือก */
function finishDraw(geom){
  var type=state.catType;
  plPushUndo();
  var suggest=nextCode(type), code;
  if(state.autoCode){ code=suggest; }          // วาดต่อเนื่อง: ไม่ถาม ใช้เบอร์ถัดไป
  else{
    code=window.prompt("ใส่เบอร์"+TYPES[type].label+" (Mark):", suggest);
    if(code===null) { render(); return; }        // ยกเลิก
    code=code.trim(); if(!code) code=suggest;
  }
  // เบอร์เดิมที่ "ยังไม่ได้วางบนแปลน" (เพิ่มด้วยฟอร์ม) → วางชิ้นนั้นเลย ไม่สร้างซ้ำ
  var unplaced=membersOfFloor(state.floorId).filter(function(x){ return x.type===type && x.code===code && !x.plan; })[0];
  if(unplaced){
    unplaced.plan=geom; unplaced.planId=curPlanId();
    if(!saveDB()){ delete unplaced.plan; delete unplaced.planId; render(); return; }
    state.selMemberId=unplaced.id; if(!isMobile()) state.ribbonTab="modify";
    render(); toast("วาง "+code+" บนแปลนแล้ว (ข้อมูลเหล็กเดิม)");
    return;
  }
  // ถ้ามีเบอร์เดียวกันในชั้นนี้อยู่แล้ว → ก็อปข้อมูลเดิมมาให้เลย ไม่ต้องกรอกใหม่
  var twin=membersOfFloor(state.floorId).filter(function(x){ return x.type===type && x.code===code; })[0];
  if(twin){
    var m=JSON.parse(JSON.stringify(twin));       // สำเนาสเปกทั้งหมด (รวมสถานีเหล็ก)
    m.id=uid("m"); m.projectId=state.projectId; m.floorId=state.floorId; m.plan=geom; m.planId=curPlanId();
    if(twin.typeId) m.doc={els:[]}; else delete m.doc;   // ผูกประเภทเดียวกับตัวเดิม (แผ่นรายละเอียดร่วม) — ไม่ก็อป element id ซ้ำ
    DB.members.push(m);
    if(!saveDB()){ DB.members.pop(); render(); return; }
    state.selMemberId=m.id;   // เลือกไว้ อยู่หน้าแปลนต่อ (ไม่เด้งไปหน้าอื่น)
    render();
    toast("เพิ่ม "+code+" — ใช้ข้อมูลเดิมของ "+code+" อัตโนมัติ"+(twin.typeId?" (ประเภท "+(memberTypeOf(twin)||{}).name+")":""));
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
/** สร้างกล่องข้อความ (callout) จากกรอบที่ลาก — ปลายลูกศรเริ่มที่มุมล่างซ้ายเยื้องออกมา ลากปรับได้ทีหลัง */
function finishDrawCallout(s, p){
  var txt=window.prompt("ข้อความในกล่อง (ขึ้นบรรทัดใหม่ได้ด้วย \\n):","");
  if(txt===null){ state.tool="select"; render(); return; }
  var x1=Math.min(s.x,p.x), x2=Math.max(s.x,p.x), y1=Math.min(s.y,p.y), y2=Math.max(s.y,p.y);
  var d=state.annotStyle||{};
  var a={ id:uid("an"), projectId:state.projectId, floorId:state.floorId, planId:curPlanId(), kind:"callout",
    box:{x1:x1,y1:y1,x2:x2,y2:y2},
    tip:{ x:Math.max(0,x1-(x2-x1)*0.35), y:Math.min(1,y2+(y2-y1)*0.9) },
    text:String(txt).replace(/\\n/g,"\n"),
    color:d.color, fill:d.fill, fillA:1, sw:d.sw, radius:d.radius,
    font:d.font, size:d.size, bold:d.bold, italic:d.italic, underline:d.underline, a1:d.a1||"open", a2:d.a2||"none" };
  if(!DB.annots) DB.annots=[];
  plPushUndo();
  DB.annots.push(a);
  if(!saveDB()){ DB.annots.pop(); render(); return; }
  state.tool="select"; state.selAnnotId=a.id; state.selMemberId=null; state.selZoneId=null; state.ribbonTab="annot";
  render();
  toast("เพิ่มกล่องข้อความแล้ว — ลากสี่เหลี่ยมแดงเพื่อย้ายปลายลูกศร");
}
/** สร้างเส้นบอกขนาดจากจุดที่ลาก — เดาค่าจากมาตราส่วนที่เคยตั้งไว้ (ถ้ามี) */
function finishDrawDim(s, p){
  var f=getFloor(state.floorId), pid=curPlanId(), plan=getFloorPlan(f);
  var pw=(plan&&plan.w)||1000, ph=(plan&&plan.h)||700;
  var pxLen=Math.hypot((p.x-s.x)*pw,(p.y-s.y)*ph);
  var us=planUnitScale(f.id,pid,plan);
  var lbl = us>0 ? (pxLen*us).toFixed(3)   // มีมาตราส่วนแล้ว → คำนวณให้เลย ไม่ถาม (auto)
                 : window.prompt("ใส่ระยะจริงของเส้นนี้ (เช่น 3.350)\nยังไม่ได้ตั้งมาตราส่วน — เส้นแรกที่ใส่ตัวเลขจะใช้เป็นมาตราส่วนชั่วคราวของแปลนนี้:", "");
  if(lbl===null){ state.tool="select"; render(); return; }
  var d=state.annotStyle||{};
  var a={ id:uid("an"), projectId:state.projectId, floorId:state.floorId, planId:pid, kind:"dim",
    p1:{x:s.x,y:s.y}, p2:{x:p.x,y:p.y}, label:String(lbl).trim(), auto:(us>0),
    color:d.color, sw:d.sw, font:d.font, size:d.size, bold:d.bold, italic:d.italic, underline:d.underline,
    a1:"solid", a2:"solid" };
  if(!DB.annots) DB.annots=[];
  plPushUndo();
  DB.annots.push(a);
  if(!saveDB()){ DB.annots.pop(); render(); return; }
  state.tool="select"; state.selAnnotId=a.id; state.selMemberId=null; state.selZoneId=null; state.ribbonTab="annot";
  render();
  toast(us>0?"เส้นบอกขนาด "+lbl+" ม. (คำนวณจากมาตราส่วน — ลากปลายเส้นได้ ตัวเลขจะเปลี่ยนตาม)":"ใช้เส้นนี้เป็นมาตราส่วนชั่วคราวแล้ว — แนะนำกด “ตั้งมาตราส่วน” เพื่อความแม่นยำ");
}
/** ตั้งมาตราส่วนของแปลนจาก 2 จุดที่ลาก + ระยะจริงที่พิมพ์ (เก็บที่รายการแปลน → ซิงก์ขึ้นคลาวด์ด้วย) */
function finishSetScale(s,p){
  var f=getFloor(state.floorId), plan=getFloorPlan(f); if(!plan){ state.tool="select"; render(); return; }
  var pw=plan.w||1000, ph=plan.h||700, px=Math.hypot((p.x-s.x)*pw,(p.y-s.y)*ph);
  var old=planUnitScale(f.id,curPlanId(),plan), sug=old>0?(px*old).toFixed(3):"";
  var v=window.prompt("ระยะจริงของเส้นนี้ (เมตร)\nวัดบนรูปได้ "+Math.round(px)+" px"+(old>0?"\nสเกลเดิม: "+fmtScale(old):""), sug);
  if(v===null){ state.tool="select"; render(); return; }
  var m=parseFloat(String(v).replace(/,/g,""));
  if(!(m>0)){ toast("ใส่ตัวเลขระยะเป็นเมตร เช่น 4.00",true); state.tool="select"; render(); return; }
  plan.scale={px:Math.round(px*100)/100, m:m, ts:Date.now()};
  var nAuto=0; (DB.annots||[]).forEach(function(x){ if(x.kind==="dim"&&x.auto&&x.floorId===f.id&&x.planId===curPlanId()){ dimLabel(x); nAuto++; } });
  if(!saveDB()){ delete plan.scale; render(); return; }
  state.tool="select"; render();
  toast("ตั้งมาตราส่วนแล้ว — "+fmtScale(m/px)+(nAuto?" · เส้นบอกขนาดอัตโนมัติ "+nAuto+" เส้นคำนวณใหม่แล้ว":" · เส้นบอกขนาดที่ลากใหม่จะคำนวณให้เอง"));
}
/** สร้างพื้นที่ที่วัดจากจุดที่คลิก/ลาก */
function finishDrawArea(pts){
  if(!pts||pts.length<3){ state.tool="select"; render(); return; }
  var f=getFloor(state.floorId), pid=curPlanId(), plan=getFloorPlan(f);
  var n=areasOfPlan(f.id,pid).length, sug="พื้นที่ "+(n+1);
  var name=window.prompt("ชื่อพื้นที่ (เช่น พื้น S1):", sug);
  if(name===null){ state.tool="select"; render(); return; }
  name=name.trim()||sug;
  var a={ id:uid("an"), projectId:state.projectId, floorId:state.floorId, planId:pid, kind:"area", name:name, pts:pts, holes:[], thick:(state.areaThick>0?state.areaThick:0.2), color:AREA_COL };
  if(!DB.annots) DB.annots=[];
  plPushUndo();
  DB.annots.push(a);
  if(!saveDB()){ DB.annots.pop(); render(); return; }
  state.tool="select"; state.selAnnotId=a.id; state.selMemberId=null; state.selZoneId=null; state.ribbonTab="annot";
  render();
  var mt=areaMetrics(a,plan);
  toast(mt ? name+" = "+fmtNum(mt.net,2)+" ตร.ม." : "เพิ่ม "+name+" แล้ว — ตั้งมาตราส่วนก่อนจึงจะเห็นตัวเลข");
}
/** หักช่องเปิด (บันได/ลิฟต์) ออกจากพื้นที่ที่เลือก */
function finishDrawHole(pts){
  var a=getAnnot(state.selAnnotId); state.tool="select";
  if(!a||a.kind!=="area"||!pts||pts.length<3){ render(); return; }
  plPushUndo(); if(!a.holes) a.holes=[]; a.holes.push(pts); saveDB(); render();
  var mt=areaMetrics(a);
  toast(mt ? "หักช่องเปิดแล้ว — สุทธิ "+fmtNum(mt.net,2)+" ตร.ม." : "หักช่องเปิดแล้ว");
}
/** เปลี่ยนพื้นที่ที่วัด → โซนเทคอนกรีต (รูปเดิม ชื่อเดิม) */
function areaToZone(a){
  var pts=a.pts||[]; if(pts.length<3) return;
  var xs=pts.map(function(p){return p.x;}), ys=pts.map(function(p){return p.y;});
  var x1=Math.min.apply(null,xs), x2=Math.max.apply(null,xs), y1=Math.min.apply(null,ys), y2=Math.max.apply(null,ys);
  var w=Math.max(1e-4,x2-x1), hgt=Math.max(1e-4,y2-y1);
  var _stL=zoneStatuses(a.floorId,a.planId), _st0=(_stL[_stL.length-1]||_stL[0]||{id:"pending"}).id;
  var z={ id:uid("z"), projectId:a.projectId, floorId:a.floorId, planId:a.planId, name:a.name||"Zone", status:_st0, date:null,
    plan:{kind:"poly", x1:x1,y1:y1,x2:x2,y2:y2, pts:pts.map(function(p){ return [(p.x-x1)/w,(p.y-y1)/hgt]; })} };
  if(!DB.zones) DB.zones=[];
  plPushUndo(); DB.zones.push(z); saveDB();
  state.showProgress=true; render();
  toast("สร้างโซนเท “"+z.name+"” จากพื้นที่นี้แล้ว — ดูในแท็บอัพเดท");
}
/** ส่งออกตารางพื้นที่ของแปลนนี้เป็น CSV (เปิดใน Excel ได้ — ใส่ BOM ให้ภาษาไทยไม่เพี้ยน) */
function exportAreaCsv(){
  var f=getFloor(state.floorId), pid=curPlanId(), plan=getFloorPlan(f), list=areasOfPlan(f.id,pid);
  if(!list.length){ toast("ยังไม่มีพื้นที่ที่วัดบนแปลนนี้",true); return; }
  var rows=[["ชื่อ","พื้นที่รวม (ตร.ม.)","หักช่องเปิด (ตร.ม.)","สุทธิ (ตร.ม.)","เส้นรอบรูป (ม.)","ความหนา (ม.)","ปริมาตร (ลบ.ม.)"]], tv=0, ta=0;
  list.forEach(function(a){ var mt=areaMetrics(a,plan);
    if(!mt){ rows.push([a.name,"","","","",a.thick!=null?a.thick:"",""]); return; }
    rows.push([a.name, mt.gross.toFixed(2), mt.hole.toFixed(2), mt.net.toFixed(2), mt.perim.toFixed(2), mt.thick.toFixed(2), mt.vol.toFixed(2)]); tv+=mt.vol; ta+=mt.net; });
  rows.push(["รวม","","",ta.toFixed(2),"","",tv.toFixed(2)]);
  var csv="\ufeff"+rows.map(function(r){ return r.map(function(c){ return '"'+String(c==null?"":c).split('"').join('""')+'"'; }).join(","); }).join("\r\n");
  try{
    var blob=new Blob([csv],{type:"text/csv;charset=utf-8"}), url=URL.createObjectURL(blob), el=document.createElement("a");
    el.href=url; el.download="พื้นที่-"+(f.name||"ชั้น")+"-"+((plan&&plan.name)||"แปลน")+".csv";
    document.body.appendChild(el); el.click(); document.body.removeChild(el);
    setTimeout(function(){ URL.revokeObjectURL(url); },1000);
    toast("ส่งออก CSV แล้ว");
  }catch(e){ toast("ส่งออกไม่สำเร็จ",true); }
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
  plPushUndo();
  DB.zones.push(z);
  saveDB();
  state.tool="select"; state.selZoneId=z.id; state.rightTab="props";
  render();
  toast("เพิ่มโซน "+name+" แล้ว");
}
/** เดาเบอร์ถัดไป เช่น B1,B2,... ตามจำนวนที่มีในชั้น */
function nextCode(type){
  var ab=TYPES[type].ab, list=membersOfFloor(state.floorId).filter(function(m){ return m.type===type; });
  var max=0;
  list.forEach(function(m){
    var mt=String(m.code).match(new RegExp("^"+String(ab).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"(\\d+)"));
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
/** key สำหรับ "ไฟล์ที่กำลังนำเข้า" — ถ้ากำลังเพิ่มแปลนใหม่ (pendingPlanId) ต้องใช้ id ใหม่ ไม่ใช่แปลนที่เปิดอยู่ ไม่งั้นไฟล์ใหม่จะไปทับแปลนเดิม */
function planImportKey(){
  var f=getFloor(state.floorId), a=state.pendingPlanId||(f&&f.activePlanId);
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

/** ห่อหลายหน้าเป็น PDF — 1 หน้า = 1 ภาพเต็มหน้า (ใช้กับชีตรายละเอียดที่ยาวเกิน A4) */
function _pdfFromPages(pw, ph, pages){
  var chunks=[], offsets=[], pos=0;
  function put(s){ var a=new Uint8Array(s.length); for(var i=0;i<s.length;i++) a[i]=s.charCodeAt(i)&0xff; chunks.push(a); pos+=a.length; }
  function putBytes(u8){ chunks.push(u8); pos+=u8.length; }
  function mark(n){ offsets[n]=pos; }
  pw=Math.round(pw*100)/100; ph=Math.round(ph*100)/100;
  var N=pages.length, kids=[];
  for(var i=0;i<N;i++) kids.push((3+i*3)+" 0 R");
  put("%PDF-1.3\n%\xE2\xE3\xCF\xD3\n");
  mark(1); put("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  mark(2); put("2 0 obj\n<< /Type /Pages /Kids ["+kids.join(" ")+"] /Count "+N+" >>\nendobj\n");
  pages.forEach(function(pg,i){
    var pgO=3+i*3, cO=pgO+1, iO=pgO+2;
    mark(pgO); put(pgO+" 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "+pw+" "+ph+"] /Resources << /XObject << /Im0 "+iO+" 0 R >> >> /Contents "+cO+" 0 R >>\nendobj\n");
    var content="q\n"+pw+" 0 0 "+ph+" 0 0 cm\n/Im0 Do\nQ\n";
    mark(cO); put(cO+" 0 obj\n<< /Length "+content.length+" >>\nstream\n"+content+"endstream\nendobj\n");
    mark(iO); put(iO+" 0 obj\n<< /Type /XObject /Subtype /Image /Width "+pg.iw+" /Height "+pg.ih+" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length "+pg.u8.length+" >>\nstream\n");
    putBytes(pg.u8); put("\nendstream\nendobj\n");
  });
  var totalObjs=2+N*3, xrefPos=pos, xref="xref\n0 "+(totalObjs+1)+"\n0000000000 65535 f \n";
  for(var k=1;k<=totalObjs;k++) xref+=("0000000000"+(offsets[k]||0)).slice(-10)+" 00000 n \n";
  put(xref); put("trailer\n<< /Size "+(totalObjs+1)+" /Root 1 0 R >>\nstartxref\n"+xrefPos+"\n%%EOF");
  var total=chunks.reduce(function(a,c){return a+c.length;},0), outU=new Uint8Array(total), off=0;
  chunks.forEach(function(c){ outU.set(c,off); off+=c.length; });
  return new Blob([outU],{type:"application/pdf"});
}
/* ---- นำออกชีตรายละเอียดเป็น PDF ---- */
/** innerHTML ของกล่องข้อความ → บรรทัดข้อความล้วน */
function _deTextLines(html){
  var t=String(html||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(div|p|li|h[1-6])>/gi,'\n').replace(/<[^>]+>/g,'');
  var d=document.createElement('textarea'); d.innerHTML=t;
  return d.value.replace(/\n{3,}/g,'\n\n').split('\n');
}
/** ตัดบรรทัดให้พอดีความกว้าง — ลองเว้นวรรคก่อน ถ้าไม่มี (เช่นภาษาไทย) ค่อยตัดทีละตัวอักษร */
function _deWrap(ctx, line, maxW){
  if(!line) return [''];
  if(ctx.measureText(line).width<=maxW) return [line];
  var out=[], cur='';
  var parts=line.split(/(\s+)/);
  parts.forEach(function(p){
    if(ctx.measureText(cur+p).width<=maxW){ cur+=p; return; }
    if(cur){ out.push(cur); cur=''; }
    if(ctx.measureText(p).width<=maxW){ cur=p; return; }
    for(var i=0;i<p.length;i++){                       // คำยาวกว่าบรรทัด → ตัดทีละตัว
      if(ctx.measureText(cur+p[i]).width>maxW){ out.push(cur); cur=''; }
      cur+=p[i];
    }
  });
  if(cur) out.push(cur);
  return out.length?out:[''];
}
/** วัดความสูงจริงของ text/table ด้วย CSS ตัวเดียวกับในหน้าจอ (ไม่ขึ้นกับขนาดจอ) */
function _deMeasureH(elm){
  if(elm.h>0 && elm.type!=='table') return elm.h;
  var host=document.createElement('div');
  host.style.cssText='position:absolute;left:-99999px;top:0;visibility:hidden;width:'+(elm.w||300)+'px';
  if(elm.type==='text'){
    var ts=''; if(elm.color)ts+='color:'+elm.color+';'; if(elm.font)ts+='font-family:'+elm.font+';';
    if(elm.size)ts+='font-size:'+elm.size+'px;'; if(elm.weight)ts+='font-weight:'+elm.weight+';';
    host.innerHTML='<div class="de-txt" style="'+ts+'">'+(elm.html||'&nbsp;')+'</div>';
  }else if(elm.type==='table'){
    host.innerHTML='<div class="de-tablewrap">'+deTableHtml(elm)+'</div>';
  }else return elm.h||120;
  document.body.appendChild(host);
  var h=host.offsetHeight||elm.h||120;
  document.body.removeChild(host);
  return h;
}
/** SVG string → Image (สำหรับวาดลงแคนวาส) */
function _deSvgImg(svg, w, h){
  var s=svg.replace('width="100%" height="100%"','width="'+Math.round(w)+'" height="'+Math.round(h)+'"');
  return new Promise(function(res,rej){
    var im=new Image();
    im.onload=function(){ res(im); }; im.onerror=function(){ rej(new Error('svg')); };
    im.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(s);
  });
}
function _deLoadImg(src){
  return new Promise(function(res,rej){
    var im=new Image(); im.onload=function(){ res(im); }; im.onerror=function(){ rej(new Error('img')); }; im.src=src;
  });
}
/** นำออกหน้ารายละเอียด (รูป/PDF/ข้อความ/ตาราง/รูปทรง) เป็น PDF A4 — ยาวเกินหน้าเดียวจะตัดเป็นหลายหน้า */
function deExportPDF(){
  var m=getMember(activeMemberId()); if(!m){ toast('ไม่พบข้อมูลชิ้นส่วน',true); return; }
  var doc=memberDoc(m), els=doc.els.slice();
  if(!els.length){ toast('ยังไม่มีเนื้อหาให้นำออก',true); return; }
  toast('กำลังสร้าง PDF…');
  var S=2.0, pg=dePageOf(doc), nP=dePageCount(doc), titleOn=deTitleOn(doc);
  var cv=document.createElement('canvas'); cv.width=Math.round(pg.w*S); cv.height=Math.round(pg.h*nP*S);
  var ctx=cv.getContext('2d'); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,cv.width,cv.height);
  var proj=getProject(m.projectId);
  function ox(v){ return v*S; } function oy(v){ return v*S; }
  var jobs=els.map(function(el){
    var w=el.w||300, h=(el.type==='text'||el.type==='table')?_deMeasureH(el):(el.h||w*0.7);
    var X=ox(el.x||0), Y=oy(el.y||0), W=w*S, H=h*S, rot=(+el.rot||0)*Math.PI/180;
    function withRot(fn){ if(!rot){ fn(X,Y); return; } ctx.save(); ctx.translate(X+W/2,Y+H/2); ctx.rotate(rot); fn(-W/2,-H/2); ctx.restore(); }
    if(el.type==='image'||el.type==='pdf'){
      var src=DE_IMG[el.id] || (DE_PDF[el.id]&&DE_PDF[el.id].raster&&DE_PDF[el.id].raster.url);
      if(!src) return Promise.resolve();
      var srcP = deAdjActive(el) ? deAdjustedUrl(el, 2200).catch(function(){ return src; }) : Promise.resolve(src);
      return srcP.then(_deLoadImg).then(function(im){ withRot(function(x,y){ ctx.drawImage(im, x, y, W, H); if(el.frame&&el.frame.w>0){ ctx.strokeStyle=el.frame.color||'#1f2937'; ctx.lineWidth=el.frame.w*S; ctx.strokeRect(x,y,W,H); } }); }).catch(function(){});
    }
    if(el.type==='shape'||el.type==='line'||el.type==='sticker'||el.type==='stamp'||el.type==='callout'||el.type==='dim'||el.type==='ink'){
      var svg = el.type==='line'?deLineSvg(el) : el.type==='sticker'?deStickerSvg(el) : el.type==='stamp'?deStampSvg(el) : (el.type==='callout'||el.type==='dim'||el.type==='ink')?deAnnotElSvg(el,true) : deShapeSvg(el);
      var pad=(el.type==='callout'||el.type==='dim')?deAnnotPad(el):0;   // หมายเหตุวาดล้นกรอบได้ (ลูกศร) → ขยายพื้นที่วาด
      return _deSvgImg(svg, W+pad*2*S, H+pad*2*S).then(function(im){ withRot(function(x,y){ ctx.drawImage(im, x-pad*S, y-pad*S, W+pad*2*S, H+pad*2*S); }); }).catch(function(){});
    }
    if(el.type==='text'){
      var size=(el.size||16)*S, padT=12*S, lh=size*1.65;
      ctx.font=(el.weight==700?'700 ':'')+size+'px '+(el.font||'Sarabun, sans-serif');
      ctx.fillStyle=el.color||'#1f2937'; ctx.textBaseline='top';
      var cy=Y+padT;
      _deTextLines(el.html).forEach(function(line){ _deWrap(ctx, line, W-padT*2).forEach(function(seg){ ctx.fillText(seg, X+padT, cy); cy+=lh; }); });
      return Promise.resolve();
    }
    if(el.type==='table'){
      var rows=el.rows||[], ncol=(rows[0]||[]).length||1, tot=0, colW=[];
      for(var i=0;i<ncol;i++){ var c=(el.colW&&el.colW[i])||(w/ncol); colW.push(c); tot+=c; }
      var k=w/(tot||1); colW=colW.map(function(c){ return c*k*S; });
      var fs=13*S, rh=Math.max(fs*2.2, 30*S), cy2=Y;
      ctx.textBaseline='middle';
      rows.forEach(function(r,ri){
        var cx=X;
        r.forEach(function(cell,ci){
          var w2=colW[ci]||0;
          ctx.fillStyle=ri===0?'#f1f5f9':'#ffffff'; ctx.fillRect(cx,cy2,w2,rh);
          ctx.strokeStyle='#cbd5e1'; ctx.lineWidth=1*S; ctx.strokeRect(cx,cy2,w2,rh);
          ctx.fillStyle='#1f2937'; ctx.font=(ri===0?'700 ':'')+fs+'px Sarabun, sans-serif';
          var txt=String(cell||''); while(txt && ctx.measureText(txt).width>w2-12*S) txt=txt.slice(0,-1);
          ctx.fillText(txt, cx+7*S, cy2+rh/2); cx+=w2;
        });
        cy2+=rh;
      });
      ctx.textBaseline='top';
      return Promise.resolve();
    }
    return Promise.resolve();
  });
  Promise.all(jobs).then(function(){
    // หัวกระดาษทุกหน้า (วาดทับล่างสุดของแต่ละหน้า)
    if(titleOn){
      var data=deTitleData(m), fr=[2,2.2,1,1.4,1.2,0.7], frT=fr.reduce(function(a,b){return a+b;},0), TH=44*S;
      for(var p=0;p<nP;p++){
        var y0=(pg.h*(p+1))*S-TH, x=0;
        ctx.fillStyle='#ffffff'; ctx.fillRect(0,y0,cv.width,TH);
        ctx.strokeStyle='#1d2229'; ctx.lineWidth=1.5*S; ctx.beginPath(); ctx.moveTo(0,y0); ctx.lineTo(cv.width,y0); ctx.stroke();
        var cells=data.concat([["หน้า",(p+1)+" / "+nP]]);
        cells.forEach(function(cell,i){
          var cw=cv.width*fr[i]/frT;
          if(i<cells.length-1){ ctx.lineWidth=1*S; ctx.beginPath(); ctx.moveTo(x+cw,y0); ctx.lineTo(x+cw,y0+TH); ctx.stroke(); }
          ctx.textBaseline='top'; ctx.fillStyle='#6b7684'; ctx.font=(8.5*S)+'px Sarabun, sans-serif'; ctx.fillText(cell[0], x+6*S, y0+4*S);
          ctx.fillStyle='#0f172a'; ctx.font='700 '+(11*S)+'px Sarabun, sans-serif';
          var tx=String(cell[1]||''); while(tx && ctx.measureText(tx).width>cw-12*S) tx=tx.slice(0,-1);
          ctx.fillText(tx, x+6*S, y0+18*S); x+=cw;
        });
      }
    }
    var Wpt=pg.pt[0], Hpt=pg.pt[1], pageH=Math.round(pg.h*S), pages=[];
    for(var q=0;q<nP;q++){
      var pc=document.createElement('canvas'); pc.width=cv.width; pc.height=pageH;
      var pctx=pc.getContext('2d'); pctx.fillStyle='#ffffff'; pctx.fillRect(0,0,pc.width,pc.height);
      pctx.drawImage(cv, 0, q*pageH, cv.width, pageH, 0, 0, cv.width, pageH);
      pages.push({u8:_jpegBytes(pc,0.92), iw:pc.width, ih:pc.height});
    }
    var blob=_pdfFromPages(Wpt, Hpt, pages);
    _downloadBlob(blob, 'RebarCheck-'+_safeName(proj&&proj.name)+'-'+_safeName(m.code)+'.pdf');
    toast('บันทึก PDF แล้ว ✓ ('+pg.label+(nP>1?' · '+nP+' หน้า':'')+')');
  }).catch(function(e){ toast('สร้าง PDF ไม่สำเร็จ: '+(e&&e.message||e),true); });
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
  var _sh=_sheetWH(); if(!_sh){ _planDbg("stage 0px"); return; }
  var sw=_sh.w, sh=_sh.h, VWp=_sh.W, VHp=_sh.H, z=state.zoom, px=state.panX, py=state.panY;   // sw/sh = แผ่นแปลน · VWp/VHp = กรอบที่มองเห็น
  if(!sw||!sh){ _planDbg("stage 0px"); return; }
  var _mob=(window.innerWidth||1024)<760;
  // มือถือ: เรนเดอร์ส่วนที่เห็นเสมอ (แม้ยังไม่ซูม) เพราะภาพเต็มหน้าความละเอียดสูงเกินลิมิต iOS แล้วเบลอ · เดสก์ท็อป: ซูมต่ำใช้ภาพฐานพอ
  if(z<=1.05 && !_mob){ det.style.display="none"; _planDbg("desktop z ต่ำ (ใช้ภาพฐาน)"); return; }
  var rx1=Math.max(0,(0-px)/(sw*z)), ry1=Math.max(0,(0-py)/(sh*z));
  var rx2=Math.min(1,(VWp-px)/(sw*z)), ry2=Math.min(1,(VHp-py)/(sh*z));
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
  var id=state.pendingPlanId||f.activePlanId||"_main"; state.pendingPlanId=null; f.activePlanId=id;
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
      var key=planImportKey();
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
          var key=planImportKey();
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
/* ===== ชนิดชิ้นส่วน "กำหนดเอง" — เพิ่มเองได้ ระบบใส่สีให้อัตโนมัติ (เก็บใน localStorage) ===== */
var CUSTOM_TYPE_PALETTE=["#c2410c","#0e7490","#6d28d9","#be123c","#15803d","#a16207","#0f766e","#4338ca","#9d174d","#3f6212"];
var CUSTOM_TYPES=[];   // [{key,label,color,ab}]
function _loadCustomTypes(){
  try{ var a=JSON.parse(localStorage.getItem("rebarcheck.customTypes")||"[]"); if(Array.isArray(a)) CUSTOM_TYPES=a; }catch(e){}
  // รวมนิยามจากฐานข้อมูลกลาง (DB.ctypes) — ชื่อจริงแทนตัวชั่วคราวที่ใช้ key เป็นชื่อ
  (DB.ctypes||[]).forEach(function(d){
    if(!d||!d.key) return;
    var ex=CUSTOM_TYPES.filter(function(c){ return c.key===d.key; })[0];
    if(!ex) CUSTOM_TYPES.push({key:d.key,label:d.label||d.key,color:d.color,ab:d.ab});
    else if(!ex.label||ex.label===ex.key){ ex.label=d.label||ex.label; if(d.color) ex.color=d.color; if(d.ab) ex.ab=d.ab; }
  });
  // นิยามที่มีแค่ในเครื่อง → ใส่ DB.ctypes ให้ซิงก์ต่อ (ไม่รวมตัวชั่วคราว label===key)
  if(!Array.isArray(DB.ctypes)) DB.ctypes=[];
  CUSTOM_TYPES.forEach(function(c){ if(c.label && c.label!==c.key && !DB.ctypes.some(function(d){ return d&&d.key===c.key; })) DB.ctypes.push({id:c.key,key:c.key,label:c.label,color:c.color,ab:c.ab}); });
}
function _saveCustomTypes(){ try{ localStorage.setItem("rebarcheck.customTypes",JSON.stringify(CUSTOM_TYPES)); }catch(e){} }
function _ctAb(name){ name=(name||"").trim(); if(!name) return "X"; var m=name.match(/[A-Za-z]+/); return m ? m[0].slice(0,2).toUpperCase() : name.slice(0,2); }
/** ลงทะเบียนชนิดกำหนดเองเข้า TYPES/TYPE_ORDER/TYPE_EN + ฉีดตัวแปรสี CSS (เรียกซ้ำได้) */
function registerCustomTypes(){
  _loadCustomTypes();
  // กันพัง: ชิ้นส่วนที่ใช้ชนิดซึ่งยังไม่รู้จัก (เช่น ซิงก์มาจากเครื่องอื่น) → ลงทะเบียนให้ทันที
  (DB.members||[]).forEach(function(m){
    if(m && m.type && !TYPES[m.type] && !CUSTOM_TYPES.some(function(c){ return c.key===m.type; }))
      CUSTOM_TYPES.push({ key:m.type, label:m.type, color:CUSTOM_TYPE_PALETTE[CUSTOM_TYPES.length%CUSTOM_TYPE_PALETTE.length] });
  });
  var css="";
  CUSTOM_TYPES.forEach(function(c,i){
    var col=c.color||CUSTOM_TYPE_PALETTE[i%CUSTOM_TYPE_PALETTE.length];
    TYPES[c.key]={ label:c.label, ab:(c.ab||_ctAb(c.label)), css:c.key, hint:"ชนิดกำหนดเอง", custom:true, color:col };
    if(TYPE_ORDER.indexOf(c.key)<0) TYPE_ORDER.push(c.key);
    TYPE_EN[c.key]=c.label;
    css+=":root{--t-"+c.key+":"+col+";--t-"+c.key+"-bg:"+col+"22}\n";
  });
  var st=document.getElementById("ctVars"); if(!st){ st=document.createElement("style"); st.id="ctVars"; document.head.appendChild(st); }
  st.textContent=css;
}
/** เพิ่มชนิดใหม่จากชื่อ → คืน key (ระบบเลือกสีให้เอง) */
function addCustomType(name){
  name=(name||"").trim(); if(!name) return null;
  var dup=CUSTOM_TYPES.filter(function(c){ return c.label===name; })[0]; if(dup) return dup.key;
  var key="ct"+Date.now().toString(36);
  CUSTOM_TYPES.push({ key:key, label:name, ab:_ctAb(name), color:CUSTOM_TYPE_PALETTE[CUSTOM_TYPES.length%CUSTOM_TYPE_PALETTE.length] });
  _saveCustomTypes(); registerCustomTypes(); saveDB(); return key;
}

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
var CLOUD_COLLS=["projects","floors","members","inspections","types","zones","annots","headMarks","ctypes"];
function _emptySyncBase(){ var b={}; CLOUD_COLLS.forEach(function(c){ b[c]={}; }); return b; }
var _syncBase=_emptySyncBase();
var _deferSnap={}, _bigWarned={};   // snapshot ที่ถูกเลื่อน (กำลังพิมพ์/อัปโหลดอยู่) — ลองใหม่ภายหลัง

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
  _syncBase=_emptySyncBase(); _deferSnap={}; }

function startCloudSession(user){
  renderLoading();
  var got={};
  CLOUD_COLLS.forEach(function(c){
    var un=fbDb.collection(c).onSnapshot(function handler(snap){
      var pending=snap.metadata && snap.metadata.hasPendingWrites;
      var editing=_isEditing();
      // เก็บ syncBase "เก่า" ไว้เทียบก่อน — ใช้ตัดสินว่า item ไหนถูกแก้ local (unsynced) หรือแค่ไม่เปลี่ยน
      var oldBase=_syncBase[c]||{};
      var newBase={};
      snap.docs.forEach(function(d){ newBase[d.id]=d.data().data; });
      if(!_fbLoaded){ _syncBase[c]=newBase;
        DB[c]=snap.docs.map(function(d){ try{ return JSON.parse(d.data().data); }catch(e){ return null; } }).filter(Boolean);
        got[c]=true;
        if(CLOUD_COLLS.every(function(x){return got[x];})){
          _fbLoaded=true;
          DB.inspector = user.email||"";
          try{ normalizePlanShapes(); normalizeFloorPlans(); registerCustomTypes(); }catch(e){}
          document.body.classList.remove("auth-mode");
          if(!state.screen || state.screen==="login" || state.screen==="loading") state.screen="home";
          render();
          setTimeout(offerLocalMigration, 400);   // เสนออัปข้อมูลเดิมในเครื่อง (ถ้ามี)
        }
        return;
      }
      // เพิกเฉย snapshot ทั้งก้อนถ้าอยู่ในช่วงเสี่ยง (upload กำลังไปหรือค้าง / พิมพ์อยู่)
      // ข้าม snapshot นี้ไว้ก่อน — ห้ามขยับ _syncBase (ไม่งั้นรอบซิงก์ถัดไปจะลบ/ย้อนงานของคนอื่น) แล้วลองใหม่ภายหลัง
      if(pending || editing || _syncT || _syncing>0){ _deferSnap[c]=snap; setTimeout(function(){ if(_deferSnap[c]===snap){ _deferSnap[c]=null; handler(snap); } },900); return; }
      _deferSnap[c]=null; _syncBase[c]=newBase;
      DB[c]=DB[c]||[];
      var incomingIds={};
      // LOCK: ถ้าผู้ใช้กำลังเปิดหน้าแก้ไข member ใดอยู่ (memberDetail / memberForm /
      // planEditor / progress) — ไม่ให้ snapshot ทับ member นั้นเด็ดขาด. รอจนกว่า
      // ผู้ใช้ออกจากหน้า, แล้วรอบถัดไปค่อยรับข้อมูล remote
      function _isLockedMember(id){
        if(c!=='members') return false;
        var lockScreens={memberDetail:1, memberForm:1, planEditor:1, progress:1};
        if(!lockScreens[state.screen]) return false;
        return id===state.memberId || id===state.selMemberId;
      }
      // 🔒 ประเภท: กำลังเปิดแผ่นรายละเอียดของประเภทนั้นอยู่ (หน้า memberDetail) → อย่าให้ snapshot ทับ
      function _isLockedType(id){
        if(c!=="types" || state.screen!=="memberDetail") return false;
        var am=getMember(state.memberId||state.selMemberId); return !!(am && am.typeId===id);
      }
      // ADD / UPDATE ทีละ item
      snap.docs.forEach(function(d){
        var incomingJson; try{ incomingJson=d.data().data; }catch(e){ return; }
        var incoming; try{ incoming=JSON.parse(incomingJson); }catch(e){ return; }
        if(!incoming || !incoming.id) return;
        incomingIds[incoming.id]=1;
        if(_isLockedMember(incoming.id) || _isLockedType(incoming.id)){ if(oldBase[incoming.id]!=null) newBase[incoming.id]=oldBase[incoming.id]; else delete newBase[incoming.id]; return; }   // 🔒 กำลังเปิดหน้าแก้ไขอยู่ — อย่าแตะ (คงฐานเดิม)
        var ex=DB[c].filter(function(x){return x&&x.id===incoming.id;})[0];
        if(!ex){ DB[c].push(incoming); return; }
        // 🔒🔒 HARD LOCK สำหรับ members: ห้าม cloud snapshot เขียนทับ .doc ของ member ที่มีอยู่แล้ว
        //   ในเครื่องเด็ดขาด (รูป/ข้อความ/ตำแหน่งเป็นของเครื่องนี้ล้วน ๆ) — อัปเดตแค่ metadata อื่น
        if(c==='members'){
          var preservedDoc=ex.doc;
          var localJson0; try{ localJson0=JSON.stringify(_forCloud(c, ex)); }catch(e){ localJson0=null; }
          var lastSynced0=oldBase[incoming.id];
          if(localJson0!=null && lastSynced0!=null && localJson0!==lastSynced0) return;   // มีงาน local ค้าง → เก็บ local
          // local ตรงกับที่ซิงก์ล่าสุด = ไม่มีงานค้าง → รับทั้งก้อนรวม doc (ชิ้นที่เปิดแก้อยู่ถูกล็อกไว้แล้วข้างบน)
          Object.keys(ex).forEach(function(k){ delete ex[k]; });
          Object.assign(ex, incoming);
          if(ex.doc===undefined && preservedDoc!==undefined && lastSynced0==null) ex.doc=preservedDoc;
          return;
        }
        // collections อื่น (projects/floors/inspections) — merge in-place ตามปกติ
        var localJson; try{ localJson=JSON.stringify(_forCloud(c, ex)); }catch(e){ localJson=null; }
        var lastSynced=oldBase[incoming.id];
        if(localJson!=null && lastSynced!=null && localJson!==lastSynced) return;
        Object.keys(ex).forEach(function(k){ delete ex[k]; });
        Object.assign(ex, incoming);
      });
      // DELETE เฉพาะกรณี item "เคยอยู่ใน syncBase" (คือเคย sync แล้ว) และ local ยังตรงกับ syncBase
      //   (คือไม่ได้แก้ local ค้างไว้) → แสดงว่าถูกลบจากอีก device จริง
      for(var i=DB[c].length-1;i>=0;i--){
        var it=DB[c][i]; if(!it){ DB[c].splice(i,1); continue; }
        if(incomingIds[it.id]) continue;
        if(_isLockedMember(it.id) || _isLockedType(it.id)){ if(oldBase[it.id]!=null) newBase[it.id]=oldBase[it.id]; continue; }   // 🔒 กำลังเปิดหน้าแก้ไขอยู่ — อย่าลบ (คงฐานเดิม)
        var wasSynced=oldBase[it.id];
        if(!wasSynced) continue;   // เพิ่ง add local ยังไม่ sync → เก็บไว้ (จะ sync รอบถัดไป)
        var localJson2; try{ localJson2=JSON.stringify(_forCloud(c,it)); }catch(e){ continue; }
        if(localJson2===wasSynced) DB[c].splice(i,1);   // ตรงกับ base เดิม = ไม่ได้แก้ → ลบตาม remote
        // ถ้า localJson2 !== wasSynced = แก้ local ค้างไว้ + remote ลบ → ข้อพิพาท, เก็บ local ไว้
      }
      if(c==="members"||c==="ctypes"){ try{ registerCustomTypes(); }catch(e){} }   // ชนิดกำหนดเองที่มากับการซิงก์ — กันหน้าพัง
      render();
    }, function(err){
      console.warn("Firestore listen error ["+c+"]", err); toast("เชื่อมต่อฐานข้อมูลมีปัญหา: "+(err&&err.code||err),true);
      // อย่าค้างหน้าโหลด: นับคอลเลกชันที่ error ว่า "โหลดแล้ว (ว่าง)" แล้วไปต่อ
      if(!_fbLoaded && !got[c]){ got[c]=true; DB[c]=DB[c]||[];
        if(CLOUD_COLLS.every(function(x){return got[x];})){ _fbLoaded=true; DB.inspector=user.email||"";
          try{ normalizePlanShapes(); normalizeFloorPlans(); registerCustomTypes(); }catch(e){}
          document.body.classList.remove("auth-mode"); if(!state.screen||state.screen==="login"||state.screen==="loading") state.screen="home"; render(); } }
    });
    _fbUnsub.push(un);
  });
}

/** ซิงค์ข้อมูลขึ้น Firestore แบบเทียบส่วนต่าง (เขียนเฉพาะที่เปลี่ยน/ลบที่หายไป) */
var _syncing=0;   // จำนวน batch commit ที่ยัง in-flight — ใช้กันสวมข้อมูลระหว่างอัป
function scheduleCloudSync(){ clearTimeout(_syncT); _syncT=setTimeout(function(){ _syncT=null; cloudSyncNow(); }, 450); }
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
    if(json.length>950000){   // กัน doc เกินลิมิต — คงของเดิมบนคลาวด์ไว้ (ไม่ลบ) และแจ้งเตือน
      console.warn("ข้าม (ใหญ่เกิน 1MB): "+coll+"/"+it.id);
      if(base[it.id]!=null) next[it.id]=base[it.id];
      if(!_bigWarned[coll+"/"+it.id]){ _bigWarned[coll+"/"+it.id]=1; toast(coll==="inspections"?"ผลตรวจมีรูปมากเกินจะซิงก์ขึ้นคลาวด์ได้ — ลดจำนวนรูปแล้วบันทึกใหม่":"ข้อมูลรายการหนึ่งใหญ่เกินจะซิงก์ขึ้นคลาวด์ ("+coll+")",true); }
      return;
    }
    next[it.id]=json;
    if(base[it.id]!==json){ batch.set(fbDb.collection(coll).doc(it.id), {id:it.id, data:json}); writes++; }
  });
  Object.keys(base).forEach(function(id){ if(!(id in next)){ batch.delete(fbDb.collection(coll).doc(id)); writes++; } });
  _syncBase[coll]=next;
  if(writes){
    _syncing++;
    batch.commit()
      .catch(function(e){ console.warn("sync "+coll+" fail",e); toast("ซิงค์ข้อมูลไม่สำเร็จ: "+(e&&e.code||e),true); })
      .then(function(){ _syncing=Math.max(0,_syncing-1); });
  }
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
  }).then(function(){ try{ setPlanBusy(null); planLog("อัปแปลนขึ้นคลาวด์แล้ว ("+n+" ชิ้น)"); }catch(e){} return true; })
    .catch(function(e){ try{ setPlanBusy(null); }catch(x){} console.warn("cloudUploadPlan",e); toast("อัปแปลนขึ้นคลาวด์ไม่สำเร็จ: "+(e&&e.code||e),true); return false; });
}
var CLOUD_FETCH_ERR={};   // key -> error ล่าสุดของ cloudFetchPlan (null/ไม่มี = ไม่มีไฟล์เฉย ๆ)
/** ดึงไฟล์แปลนจากคลาวด์ → คืน rec {kind,bytes,pageNo} (ตั้งพรีวิวให้ด้วย) */
function cloudFetchPlan(key){
  if(!CLOUD) return Promise.resolve(null);
  var pf=fbDb.collection("planfiles").doc(_pfKey(key));
  delete CLOUD_FETCH_ERR[key];
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
  }).catch(function(e){ console.warn("cloudFetchPlan",e); CLOUD_FETCH_ERR[key]=e||true; return null; });
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
  DB.projects=local.projects||[]; DB.floors=local.floors||[]; DB.members=local.members||[]; DB.inspections=local.inspections||[]; DB.types=local.types||[];
  DB.zones=local.zones||[]; DB.annots=local.annots||[]; DB.headMarks=local.headMarks||[]; DB.ctypes=local.ctypes||[];
  try{ normalizePlanShapes(); normalizeFloorPlans(); registerCustomTypes(); }catch(e){}
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
    registerCustomTypes();   // ชนิดกำหนดเอง
  }else{
    try{ registerCustomTypes(); }catch(e){}
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
  // กรอบแปลนเป็น viewport เต็มพื้นที่ → ขนาดจอเปลี่ยนต้องจัดแผ่นแปลนใหม่ (คงซูม/ตำแหน่งให้อยู่ในกรอบ)
  // ข้ามเกณฑ์มือถือ↔คอม (หมุนจอ / ย่อหน้าต่าง) → วาดเปลือกใหม่ให้ตรงขนาดจอ
  var _wasMob=isMobile(), _mbT=null;
  window.addEventListener("resize",function(){
    clearTimeout(_mbT); _mbT=setTimeout(function(){ var nm=isMobile(); if(nm===_wasMob) return; _wasMob=nm;
      if(state.screen==="planEditor"||state.screen==="memberDetail"){ state.deZoom=null; state.mSheet=null; state.mSheetMin=false; render(); } },120);
  });
  var _rsT=null;
  window.addEventListener("resize",function(){
    if(state.screen!=="planEditor") return;
    clearTimeout(_rsT); _rsT=setTimeout(function(){ _szCache=null; planClampPan(); planApplyTransform(); scheduleEnsure(); },80);
  });
  document.addEventListener("keydown",function(e){
    if(e.key==="Escape"){ $("#lightbox").classList.remove("open"); closeSheet(); }
    // (หน้า login ใช้ <form> จริงแล้ว → Enter จะ submit เอง ไม่ต้องดักที่นี่)
    // Ctrl/Cmd+S = บันทึกฟอร์มชิ้นส่วน
    if((e.ctrlKey||e.metaKey) && (e.key==="s"||e.key==="S") && state.screen==="memberForm"){
      e.preventDefault(); saveMemberForm(false);
    }
  });

  function _flushCloud(){ try{ if(CLOUD && _fbUser && _fbLoaded && _syncT){ clearTimeout(_syncT); _syncT=null; cloudSyncNow(); } }catch(e){} }
  window.addEventListener("pagehide", _flushCloud);
  document.addEventListener("visibilitychange", function(){ if(document.visibilityState==="hidden") _flushCloud(); });

  if(CLOUD){ cloudBoot(); } else { render(); }
}

init();
