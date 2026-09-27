"use strict";
/* חברותא — turn to a page, read it aloud, talk about it.

   The page is the centre. The conversation happens out loud; the screen is a
   companion you glance at: where you are, what it heard you read, the words it
   is pointing at, the sources it cites. */

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

/* ---------------------------------------------------------------- settings */

const DEFAULTS = { view: "daf", depth: "daf", language: "auto", voice: "natural",
  hearing: "api", speak: true, pause: "normal", nudges: true, translate: false, stops: false };
const PAUSES = { short: 1000, normal: 1500, long: 2400 };
function loadSettings() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem("chavruta.settings") || "{}")); }
  catch (e) { return Object.assign({}, DEFAULTS); }
}
function saveSettings() {
  try { localStorage.setItem("chavruta.settings", JSON.stringify(S.settings)); } catch (e) {}
}
function remember(key, value) { try { localStorage.setItem("chavruta." + key, value); } catch (e) {} }
function recall(key) { try { return localStorage.getItem("chavruta." + key); } catch (e) { return null; } }

const S = {
  settings: loadSettings(), masechtot: [], pack: null, line: 1, health: null,
  log: [], listening: false, session: null,
};
S.session = (() => {
  try {
    let id = sessionStorage.getItem("chavruta.session");
    if (!id) { id = Math.random().toString(36).slice(2); sessionStorage.setItem("chavruta.session", id); }
    return id;
  } catch (e) { return Math.random().toString(36).slice(2); }
})();

/* ------------------------------------------------------------ hebrew text */

const NIKUD = /[֑-ׇ]/g;
const FINALS = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
// A word reduced to its letters -- the same reduction the server uses, so a
// word's place in the line is counted identically on both sides.
const norm = (w) => w.replace(NIKUD, "").replace(/[^א-ת]/g, "").replace(/[ךםןףץ]/g, (c) => FINALS[c]);
// A word as a printed daf shows it: no nikud, no modern punctuation.
function printed(w) {
  return w.replace(NIKUD, "").replace(/^[״"“”'(\[]+/, "").replace(/[.,:;?!״"”)\]—–]+$/, "");
}
const ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
const TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
function hebNum(n) {
  if (n === 15) return "טו";
  if (n === 16) return "טז";
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10;
  return (["", "ק", "ר", "ש", "ת"][h] || "") + TENS[t] + ONES[o];
}
const geresh = (s) => (s.length > 1 ? s.slice(0, -1) + "״" + s.slice(-1) : s + "׳");
const amudHe = (a) => (a === "a" ? "א׳" : "ב׳");

const HE = { Rashi: "רש״י", Tosafot: "תוספות", Steinsaltz: "שטיינזלץ", "Rabbeinu Chananel": "רבינו חננאל",
  Rif: "רי״ף", Rosh: "רא״ש", Ramban: "רמב״ן", Rashba: "רשב״א", Ritva: "ריטב״א", Ran: "ר״ן",
  Meiri: "מאירי", Rashbam: "רשב״ם", "Tosafot HaRosh": "תוספות הרא״ש", "Shita Mekubetzet": "שיטה מקובצת",
  Maharsha: "מהרש״א", "Penei Yehoshua": "פני יהושע", Rashash: "רש״ש", "Chiddushei Rabbi Akiva Eiger": "רע״א",
  Tzelach: "צל״ח", "Gilyon HaShas": "גליון הש״ס", "Ra'ah": "רא״ה", HaMaor: "המאור", "Ben Yehoyada": "בן יהוידע",
  "Petach Einayim": "פתח עינים", "Reshimot Shiurim": "רשימות שיעורים", "Piskei Tosafot": "פסקי תוספות",
  "Marit HaAyin": "מראית העין", "Abraham Cohen": "A. Cohen (English)" };
const RELATED_HE = { Halakhah: "הלכה", Talmud: "תלמוד", Tanakh: "תנ״ך", Mishnah: "משנה", Midrash: "מדרש",
  Responsa: "שו״ת", "Jewish Thought": "מחשבה", Chasidut: "חסידות", Musar: "מוסר", Reference: "מילונים" };
const heName = (n) => HE[n] || n;
const MOVES = { position: "פירוש", difficulty: "קושיא", answer: "תירוץ",
  alternative: "פירוש אחר", conclusion: "מסקנה" };
const sefariaUrl = (ref) => "https://www.sefaria.org/" + encodeURIComponent(ref.replace(/ /g, "_")) + "?lang=he";

function parseRef(ref) {
  const m = /^(.*) (\d+)([ab])$/.exec(ref || "");
  return m ? { masechta: m[1], daf: +m[2], amud: m[3] } : null;
}

/* ---------------------------------------------------------------- status */

function setStatus(kind, text, title) {
  $("dot").className = "dot " + kind;
  $("statustext").textContent = text;
  $("status").title = title || "";
}

async function checkHealth() {
  try {
    const r = await fetch("/api/health");
    S.health = await r.json();
  } catch (e) {
    S.health = null;
    setStatus("bad", "השרת לא עונה", "הפעל מחדש את ./run.sh");
    return;
  }
  const h = S.health;
  if (!h.key) setStatus("warn", "אין מפתח", "הוסף OPENAI_API_KEY לקובץ .env והפעל מחדש");
  else if (h.sefaria === false) setStatus("warn", "ספריא לא זמינה", "דפים שכבר נפתחו עדיין עובדים");
  else setStatus("ok", "מוכן", h.heavy + " · " + h.cheap);
}

/* ------------------------------------------------------------- the picker */

async function buildPickers() {
  try {
    const r = await fetch("/api/masechtot");
    S.masechtot = (await r.json()).masechtot || [];
  } catch (e) { S.masechtot = []; }
  const mas = $("mas");
  mas.replaceChildren(...S.masechtot.map((m) => { const o = el("option", null, m.he); o.value = m.name; return o; }));
  fillDapim();
  mas.onchange = () => { fillDapim(); turnTo(pickedRef()); };
  $("daf").onchange = () => turnTo(pickedRef());
  $("am-a").onclick = () => { setAmud("a"); turnTo(pickedRef()); };
  $("am-b").onclick = () => { setAmud("b"); turnTo(pickedRef()); };
  $("prev").onclick = () => flip(-1);
  $("next").onclick = () => flip(1);
}

function masechta() { return S.masechtot.find((m) => m.name === $("mas").value) || S.masechtot[0]; }

function fillDapim() {
  const m = masechta(); if (!m) return;
  const daf = $("daf"), keep = +daf.value;
  daf.replaceChildren();
  for (let n = m.first; n <= m.last; n++) {
    const o = el("option", null, geresh(hebNum(n))); o.value = n; daf.append(o);
  }
  daf.value = keep >= m.first && keep <= m.last ? keep : m.first;
}

function setAmud(a) {
  $("am-a").setAttribute("aria-pressed", String(a === "a"));
  $("am-b").setAttribute("aria-pressed", String(a === "b"));
  const m = masechta(), last = m && +$("daf").value === m.last && m.last_amud === "a";
  $("am-b").disabled = !!last;
}
const pickedAmud = () => ($("am-b").getAttribute("aria-pressed") === "true" ? "b" : "a");

function pickedRef() {
  const m = masechta(); if (!m) return null;
  let amud = pickedAmud();
  if (+$("daf").value === m.last && m.last_amud === "a") amud = "a";
  return m.name + " " + $("daf").value + amud;
}

function showRefInPicker(ref) {
  const p = parseRef(ref); if (!p) return;
  $("mas").value = p.masechta; fillDapim();
  $("daf").value = p.daf; setAmud(p.amud);
}

function flip(dir) {
  if (!S.pack) return;
  const target = dir > 0 ? S.pack.next : S.pack.prev;
  if (target && parseRef(target) && +parseRef(target).daf <= (masechta() || {}).last) turnTo(target);
}

/* --------------------------------------------------------------- the page */

let opening = 0;
async function turnTo(ref, line) {
  if (!ref) return;
  const token = ++opening;
  showRefInPicker(ref);
  $("loading").hidden = false; $("loading").textContent = "פותח את הדף…";
  $("page").hidden = true; $("linear").hidden = true;
  $("runner").textContent = runnerText(ref);
  try {
    const r = await fetch("/api/daf?ref=" + encodeURIComponent(ref));
    const data = await r.json();
    if (token !== opening) return;               // the reader already turned again
    if (!r.ok) return pageError(ref, data.error);
    S.pack = data;
    remember("ref", ref);
    render();
    selectLine(line || 1, { scroll: "top" });
  } catch (e) {
    if (token === opening) pageError(ref, "network");
  }
}

function pageError(ref, code) {
  const box = $("loading");
  box.hidden = false; box.replaceChildren();
  const msg = { sefaria_unreachable: "לא הצלחתי להגיע לספריא. בדוק את החיבור לאינטרנט.",
    not_available: "הדף הזה עוד לא זמין.", network: "השרת לא עונה — האם ./run.sh עדיין רץ?" }[code]
    || "משהו השתבש בפתיחת הדף.";
  box.append(el("div", null, msg));
  const again = el("button", "btn", "נסה שוב"); again.style.marginTop = "14px";
  again.onclick = () => turnTo(ref); box.append(again);
}

function runnerText(ref) {
  const p = parseRef(ref), m = S.masechtot.find((x) => p && x.name === p.masechta);
  return p ? (m ? m.he : p.masechta) + " · דף " + geresh(hebNum(p.daf)) + " · עמוד " + amudHe(p.amud) : ref;
}

function render() {
  const view = S.settings.view;
  $("v-daf").setAttribute("aria-pressed", String(view === "daf"));
  $("v-lin").setAttribute("aria-pressed", String(view === "lin"));
  $("loading").hidden = true;
  $("runner").textContent = runnerText(S.pack.ref);
  // Only one view exists at a time. A hidden copy of the page would still take
  // reading marks and quote highlights, and scroll to words nobody can see.
  if (view === "daf") {
    $("linear").replaceChildren(); $("linear").hidden = true; renderDaf();
  } else {
    $("gtext").replaceChildren(); $("col-inner").replaceChildren(); $("col-outer").replaceChildren();
    $("page").hidden = true; renderLinear();
  }
  applyToggles();
  markRead(null);
}

// A line as word spans. data-i counts only real words -- tokens that reduce to
// letters -- which is how the server counts, so "you read up to word 3" lands
// on the same word here.
function words(text, n, vocalized) {
  const frag = document.createDocumentFragment();
  let i = 0;
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    const key = norm(token);
    const shown = vocalized ? token : printed(token);
    if (!shown || (!key && !vocalized)) continue;
    const w = el("span", "w", shown);
    w.dataset.n = n;
    if (key) { w.dataset.i = i++; w.dataset.k = key; }
    if (/[.?!:]["״”)]?$/.test(token)) w.classList.add("clause-end");
    if (i === 1 && (key === "גמ" || key === "מתני")) w.classList.add("head");
    frag.append(w, document.createTextNode(" "));
  }
  return frag;
}

function sides() {
  const m = S.pack.masechta;
  const inner = ["Rashi", "Rashbam"].concat(m === "Nedarim" ? ["Ran"] : []);
  const outer = ["Tosafot", "Rabbeinu Chananel"];
  return { inner, outer };
}

function renderDaf() {
  const pack = S.pack, p = parseRef(pack.ref);
  const box = $("page");
  box.hidden = false;
  // Rashi sits toward the binding: on the right of an amud aleph, the left of a bet.
  box.className = "daf " + (p && p.amud === "b" ? "bet" : "aleph");
  const g = $("gtext"); g.replaceChildren();
  for (const seg of pack.segments) {
    const s = el("span", "seg"); s.dataset.n = seg.n;
    s.append(words(seg.he, seg.n, false));
    s.onclick = () => selectLine(seg.n, { scroll: "side" });
    g.append(s);
  }
  const { inner, outer } = sides();
  fillColumn($("col-inner"), inner);
  fillColumn($("col-outer"), outer);
}

function fillColumn(col, names) {
  col.replaceChildren();
  const present = names.filter((n) => S.pack.segments.some((s) => (s.commentaries[n] || []).length));
  col.append(el("div", "colname", present.map(heName).join(" · ") || heName(names[0])));
  let any = false;
  for (const seg of S.pack.segments) {
    for (const name of names) {
      for (const e of seg.commentaries[name] || []) {
        any = true;
        const c = el("div", "c"); c.dataset.n = seg.n; c.dataset.ref = e.ref;
        const body = e.he || "";
        let rest = body;
        if (e.dibur) {
          const at = body.indexOf(e.dibur);
          if (at >= 0 && at < 12) rest = body.slice(at + e.dibur.length).replace(/^[\s.:–—-]+/, "");
          c.append(el("span", "dib", e.dibur), document.createTextNode(" – "));
        }
        const t = el("span", "ctext", rest); c.append(t);
        c.onclick = () => { selectLine(seg.n, { scroll: "gemara" }); openSources(seg.n, e.ref); };
        col.append(c);
      }
    }
  }
  if (!any) col.append(el("div", "empty", "אין כאן"));
}

function renderLinear() {
  const box = $("linear");
  box.hidden = false; box.replaceChildren();
  for (const seg of S.pack.segments) {
    const line = el("div", "line"); line.dataset.n = seg.n;
    const he = el("div", "he"); he.append(words(seg.he, seg.n, true));
    const en = el("div", "en");
    for (const s of seg.en || []) en.append(el("span", s.kind === "daf" ? "" : "add", s.text + " "));
    line.append(he, en);
    line.onclick = () => selectLine(seg.n);
    box.append(line);
  }
}

function applyToggles() {
  const lin = $("linear"), daf = $("page");
  lin.classList.toggle("showen", S.settings.translate);
  lin.classList.toggle("stops", S.settings.stops);
  daf.classList.toggle("stops", S.settings.stops);
}

function visible(node, container) {
  const a = node.getBoundingClientRect(), b = container.getBoundingClientRect();
  return a.top >= b.top + 20 && a.bottom <= b.bottom - 20;
}

function selectLine(n, opts) {
  if (!S.pack) return;
  opts = opts || {};
  const max = S.pack.segments.length;
  S.line = Math.min(Math.max(1, n), max);
  for (const node of document.querySelectorAll(".seg, .line, .c"))
    node.classList.toggle("on", +node.dataset.n === S.line);
  $("where").textContent = "שורה " + S.line + " מתוך " + max;

  const main = S.settings.view === "daf" ? $("col-gemara") : $("linear");
  const node = main.querySelector('[data-n="' + S.line + '"]');
  if (opts.scroll === "top") main.scrollTop = 0;
  else if (node && opts.scroll !== "side" && !visible(node, main))
    node.scrollIntoView({ block: "center", behavior: "smooth" });

  if (S.settings.view === "daf") {
    for (const col of [$("col-inner"), $("col-outer")]) {
      const cs = [...col.querySelectorAll(".c")];
      const target = cs.find((c) => +c.dataset.n === S.line) || cs.filter((c) => +c.dataset.n < S.line).pop();
      if (target && !visible(target, col)) col.scrollTo({ top: target.offsetTop - 40, behavior: "smooth" });
    }
  }
}

// How far it followed the reading: position, never a verdict on the words.
function markRead(heard) {
  for (const w of document.querySelectorAll(".w.read, .w.here")) w.classList.remove("read", "here");
  if (!heard || !heard.line) return;
  const from = [heard.from_line || heard.line, heard.from_word || 0], to = [heard.line, heard.word || 0];
  let last = null;
  for (const w of document.querySelectorAll(".w[data-i]")) {
    const at = [+w.dataset.n, +w.dataset.i];
    const after = at[0] > from[0] || (at[0] === from[0] && at[1] >= from[1]);
    const before = at[0] < to[0] || (at[0] === to[0] && at[1] <= to[1]);
    if (after && before) { w.classList.add("read"); last = w; }
  }
  if (last) last.classList.add("here");
}

// The words the chavruta is pointing at, lit on the page itself.
function markQuotes(text) {
  for (const n of document.querySelectorAll(".quoted")) n.classList.remove("quoted");
  const quotes = [...(text || "").matchAll(/«([^»]+)»/g)].map((m) => m[1].split(/\s+/).map(norm).filter(Boolean));
  const all = [...document.querySelectorAll(".w[data-k]")];
  let first = null;
  for (const q of quotes) {
    if (!q.length) continue;
    for (let i = 0; i + q.length <= all.length; i++) {
      if (q.every((k, j) => all[i + j].dataset.k === k)) {
        for (let j = 0; j < q.length; j++) all[i + j].classList.add("quoted");
        first = first || all[i];
        break;
      }
    }
  }
  if (first) {
    const main = S.settings.view === "daf" ? $("col-gemara") : $("linear");
    if (!visible(first, main)) first.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

// Draw the eye to one comment in the margin, the way a finger would.
function flashComment(ref) {
  const c = ref && document.querySelector('.c[data-ref="' + CSS.escape(ref) + '"]');
  if (!c) return;
  const col = c.closest(".col");
  if (col && !visible(c, col)) col.scrollTo({ top: c.offsetTop - 40, behavior: "smooth" });
  c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash");
}

/* ---------------------------------------------------- the conversation bar */

function setMode(mode, text, isError) {
  $("mic").dataset.state = mode;
  if (text !== undefined) {
    $("state").textContent = text;
    $("state").classList.toggle("err", !!isError);
  }
}

function showMine(text, interim) {
  const m = $("mine");
  m.hidden = !text; m.textContent = text || "";
  m.classList.toggle("interim", !!interim);
}

function findEntry(ref) {
  if (!S.pack) return null;
  for (const seg of S.pack.segments)
    for (const [name, list] of Object.entries(seg.commentaries))
      for (const e of list) if (e.ref === ref) return { seg, name, e };
  return null;
}

function chipFor(ref) {
  const hit = findEntry(ref);
  if (hit) {
    const d = hit.e.dibur ? " ד״ה " + hit.e.dibur.split(/\s+/).slice(0, 3).join(" ") : "";
    return { label: heName(hit.name) + d, go: () => { selectLine(hit.seg.n); openSources(hit.seg.n, ref); } };
  }
  const line = S.pack && S.pack.segments.find((s) => s.ref === ref);
  if (line) return { label: "שורה " + line.n, go: () => selectLine(line.n) };
  let label = ref;
  if (/^Mishneh Torah/.test(ref)) label = "רמב״ם · " + ref.replace(/^Mishneh Torah,\s*/, "");
  else if (/^Shulchan Arukh/.test(ref)) label = "שו״ע · " + ref.replace(/^Shulchan Arukh,\s*/, "");
  else if (/^Tur,/.test(ref)) label = "טור · " + ref.replace(/^Tur,\s*/, "");
  return { label, go: () => window.open(sefariaUrl(ref), "_blank", "noopener") };
}

function showReply(text, opts) {
  opts = opts || {};
  const r = $("reply"), chips = $("chips");
  r.hidden = !text; r.replaceChildren(); chips.replaceChildren();
  r.classList.toggle("hint", !!opts.hint);
  if (!text) return;
  const refs = [];
  const clean = text.replace(/\[\[([^\]]+)\]\]/g, (_, ref) => { if (!refs.includes(ref)) refs.push(ref); return ""; });
  for (const part of clean.split(/(«[^»]+»)/)) {
    if (/^«.*»$/.test(part)) r.append(el("q", null, part.slice(1, -1)));
    else r.append(document.createTextNode(part.replace(/\s+([,.;:?!])/g, "$1")));
  }
  for (const ref of refs) {
    const c = chipFor(ref), b = el("button", "chip", c.label);
    b.title = ref; b.onclick = c.go; chips.append(b);
  }
  if (opts.grounded === false) chips.append(el("span", "chip warn", "לא נמצא מקור — אל תסמוך על זה"));
}

/* ---------------------------------------------------------------- speaking */

let player = null, speakingDone = null;

function speakable(text) {
  return text.replace(/\[\[[^\]]+\]\]/g, "").replace(/«[^»]*»/g, " … ")
    .replace(/\s+([,.;:?!])/g, "$1").replace(/(\s*…\s*){2,}/g, " … ").replace(/\s{2,}/g, " ").trim();
}

function stopSpeaking() {
  if (player) { try { player.pause(); } catch (e) {} player = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (speakingDone) { const d = speakingDone; speakingDone = null; d(); }
}

async function speak(text) {
  if (!S.settings.speak || !text) return;
  stopSpeaking();
  const done = new Promise((resolve) => { speakingDone = resolve; });
  const natural = S.settings.voice === "natural" && S.health && S.health.can_speak;
  let played = false;
  if (natural) {
    try {
      const r = await fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, ref: S.pack && S.pack.ref }) });
      if (r.ok) {
        const url = URL.createObjectURL(await r.blob());
        player = new Audio(url);
        player.onended = player.onerror = () => { URL.revokeObjectURL(url); stopSpeaking(); };
        await player.play();
        played = true;
      }
    } catch (e) { played = false; }
  }
  if (!played) browserSpeak(speakable(text));
  return done;
}

// The browser's voices speak one language each, so a bilingual reply is read
// as a relay: Hebrew runs to a Hebrew voice, the rest to an English one.
function browserSpeak(text) {
  if (!window.speechSynthesis || !text) return stopSpeaking();
  const runs = [];
  for (const token of text.split(/\s+/)) {
    const he = /[א-ת]/.test(token);
    const last = runs[runs.length - 1];
    if (last && last.he === he) last.text += " " + token; else runs.push({ he, text: token });
  }
  const voices = speechSynthesis.getVoices();
  const heVoice = voices.find((v) => /^he/i.test(v.lang)), enVoice = voices.find((v) => /^en/i.test(v.lang));
  runs.forEach((run, i) => {
    const u = new SpeechSynthesisUtterance(run.text);
    u.lang = run.he ? "he-IL" : "en-US";
    const v = run.he ? heVoice : enVoice; if (v) u.voice = v;
    u.rate = 1.02;
    if (i === runs.length - 1) u.onend = u.onerror = () => stopSpeaking();
    speechSynthesis.speak(u);
  });
}

/* --------------------------------------------------------------- listening */

// Ears: an open microphone that finds where you start and stop talking.
// Silence ends a turn, the way it does between two people.
class Ears {
  constructor(onUtterance, onBarge) {
    this.onUtterance = onUtterance; this.onBarge = onBarge;
    this.guard = false; this.active = false;
  }
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.an = this.ctx.createAnalyser(); this.an.fftSize = 1024;
    src.connect(this.an);
    this.buf = new Float32Array(this.an.fftSize);
    this.mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]
      .find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
    this.floor = 0.006; this.loud = 0; this.quiet = 0; this.talking = false;
    this.active = true;
    this.record();
    this.timer = setInterval(() => this.tick(), 40);
  }
  record() {
    this.chunks = []; this.discard = false;
    this.rec = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined);
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.onstop = () => {
      const keep = !this.discard && this.chunks.length;
      const blob = keep ? new Blob(this.chunks, { type: this.rec.mimeType || this.mime || "audio/webm" }) : null;
      const spoke = this.lastSpeech || 0;
      if (this.active) this.record();
      if (blob && spoke >= 350) this.onUtterance({ blob });
    };
    this.rec.start();
    this.recAt = performance.now();
  }
  tick() {
    if (!this.active) return;
    this.an.getFloatTimeDomainData(this.buf);
    let sum = 0; for (const x of this.buf) sum += x * x;
    const rms = Math.sqrt(sum / this.buf.length), now = performance.now();
    if (!this.talking) this.floor = this.floor * 0.97 + Math.min(rms, this.floor * 3) * 0.03;
    // While it is talking, only a clearly louder voice counts as the learner.
    const threshold = Math.max(0.012, this.floor * 3) * (this.guard ? 2.6 : 1);
    level(Math.min(1, rms / (threshold * 3)));
    if (rms > threshold) { this.loud += 40; this.quiet = 0; } else { this.quiet += 40; this.loud = Math.max(0, this.loud - 20); }

    if (!this.talking && this.loud >= (this.guard ? 320 : 140)) {
      this.talking = true; this.startedAt = now - this.loud;
      if (this.guard) this.onBarge();
      setMode("capturing", "שומע אותך…");
    }
    const pause = PAUSES[S.settings.pause] || 1500;
    if (this.talking && (this.quiet >= pause || now - this.startedAt > 45000)) {
      this.talking = false; this.lastSpeech = now - this.startedAt - this.quiet;
      this.rec.stop();
    } else if (!this.talking && now - this.recAt > 9000 && this.rec.state === "recording") {
      // Nothing said for a while: start a fresh recording so the next one is short.
      this.discard = true; this.lastSpeech = 0; this.rec.stop();
    }
  }
  stop() {
    this.active = false;
    clearInterval(this.timer);
    try { if (this.rec && this.rec.state !== "inactive") { this.discard = true; this.rec.stop(); } } catch (e) {}
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close();
    level(0);
  }
}

// The free path: the browser's own recogniser. One language at a time, so it
// is the fallback, not the default -- a sentence that starts in English and
// lands in Aramaic is exactly what it handles worst.
class BrowserEars {
  constructor(onUtterance, onBarge) { this.onUtterance = onUtterance; this.onBarge = onBarge; this.active = false; this.guard = false; }
  async start() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) throw new Error("no_recogniser");
    this.rec = new Rec(); this.rec.lang = "he-IL"; this.rec.continuous = true; this.rec.interimResults = true;
    this.buffer = ""; this.active = true;
    this.rec.onresult = (ev) => {
      if (this.guard) { this.onBarge(); }
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) this.buffer += r[0].transcript + " "; else interim += r[0].transcript;
      }
      showMine((this.buffer + interim).trim(), true);
      setMode("capturing", "שומע אותך…");
      clearTimeout(this.quiet);
      this.quiet = setTimeout(() => {
        const text = this.buffer.trim(); this.buffer = "";
        if (text) this.onUtterance({ text });
      }, PAUSES[S.settings.pause] || 1500);
    };
    this.rec.onerror = (ev) => { if (ev.error === "not-allowed") { this.active = false; micDenied(); } };
    this.rec.onend = () => { if (this.active) { try { this.rec.start(); } catch (e) {} } };
    this.rec.start();
  }
  stop() { this.active = false; clearTimeout(this.quiet); try { this.rec.stop(); } catch (e) {} }
}

function level(x) {
  const ring = $("level");
  ring.style.opacity = x > 0.05 ? String(0.25 + x * 0.6) : "0";
  ring.style.transform = "scale(" + (1 + x * 0.18) + ")";
}

/* ------------------------------------------------------------ the loop */

let ears = null;
const queue = [];
let working = false;

async function startListening() {
  const useApi = S.settings.hearing === "api" && S.health && S.health.can_hear;
  ears = useApi ? new Ears(onUtterance, onBarge) : new BrowserEars(onUtterance, onBarge);
  try {
    await ears.start();
  } catch (e) {
    ears = null;
    if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) return micDenied();
    return setMode("idle", "לא הצלחתי לפתוח את המיקרופון.", true);
  }
  S.listening = true;
  setMode("listening", "מקשיב… קרא מהדף, או תגיד מה אתה חושב שכתוב.");
}

function stopListening() {
  S.listening = false;
  if (ears) ears.stop();
  ears = null;
  stopSpeaking();
  setMode("idle", "המיקרופון כבוי. לחץ כדי להמשיך.");
}

function micDenied() {
  S.listening = false;
  setMode("idle", "צריך אישור למיקרופון — לחץ על סמל המנעול בשורת הכתובת ואפשר מיקרופון.", true);
}

function onBarge() { stopSpeaking(); }

function onUtterance(u) {
  queue.push(u);
  if (!working) drain();
}

async function drain() {
  working = true;
  while (queue.length) {
    try { await handle(queue.shift()); }
    catch (e) { setMode(S.listening ? "listening" : "idle", "משהו השתבש — נסה שוב.", true); console.warn(e); }
  }
  working = false;
  if (S.listening && $("mic").dataset.state !== "capturing") setMode("listening", $("state").textContent);
}

async function post(path, body, raw) {
  const r = await fetch(path, raw ? { method: "POST", headers: { "Content-Type": raw }, body }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data = {};
  try { data = await r.json(); } catch (e) {}
  if (!r.ok) throw Object.assign(new Error(data.error || "http_" + r.status), { code: data.error });
  return data;
}

function explain(err) {
  const code = (err && (err.code || err.message)) || "";
  if (/OPENAI_API_KEY|api key|401/i.test(code)) return "המפתח ל-OpenAI לא עובד — בדוק את .env.";
  if (/sefaria/.test(code)) return "לא הצלחתי להגיע לספריא.";
  if (/model/.test(code)) return "המודל לא ענה. נסה שוב בעוד רגע.";
  return "משהו השתבש — נסה שוב.";
}

// One thing the learner said, from sound to answer.
async function handle(u) {
  if (!S.pack) return;
  if (ears) ears.guard = false;
  setMode("hearing", "מקשיב למה שאמרת…");
  let heard;
  try {
    const q = "ref=" + encodeURIComponent(S.pack.ref) + "&line=" + S.line + "&session=" + S.session +
      "&language=" + S.settings.language;
    heard = u.blob ? await post("/api/hear?" + q, u.blob, u.blob.type || "audio/webm")
      : await post("/api/heard", { ref: S.pack.ref, line: S.line, session: S.session,
          language: S.settings.language, said: u.text });
  } catch (e) { return setMode(S.listening ? "listening" : "idle", explain(e), true); }
  if (!heard.said || heard.mode === "silence") return setMode(S.listening ? "listening" : "idle", "לא שמעתי מילים — נסה שוב.");

  showMine(heard.said);
  S.log.push({ me: true, text: heard.said, mode: heard.mode });
  if (heard.line) selectLine(heard.line, { scroll: "side" });
  markRead(heard.heard);

  if (heard.mode === "reading") {
    // Reading: follow along, say nothing -- unless this is the hinge of a machlokes.
    setMode("listening", "עוקב אחרי הקריאה — שורה " + heard.line + ".");
    if (heard.nudge && S.settings.nudges) {
      showReply(heard.nudge + (heard.nudge_ref ? " [[" + heard.nudge_ref + "]]" : ""));
      flashComment(heard.nudge_ref);
      S.log.push({ me: false, text: heard.nudge });
      await say(heard.nudge);
    }
    return;
  }

  setMode("thinking", "חושב…");
  let answer;
  try {
    answer = await post("/api/say", { ref: S.pack.ref, line: S.line, session: S.session, said: heard.said,
      heard: heard.heard, depth: S.settings.depth, language: S.settings.language });
  } catch (e) { return setMode(S.listening ? "listening" : "idle", explain(e), true); }

  if (answer.mode === "navigate") {
    showReply("עובר ל" + runnerText(answer.ref) + ".", { hint: true });
    turnTo(answer.ref);
    return setMode(S.listening ? "listening" : "idle", "מקשיב…");
  }
  showReply(answer.text, { grounded: answer.grounded });
  markQuotes(answer.text);
  S.log.push({ me: false, text: answer.text, trace: answer.trace });
  await say(answer.text);
}

async function say(text) {
  setMode("speaking", "מדבר… (דבר כדי לעצור אותי)");
  if (ears) ears.guard = true;
  await speak(text);
  if (ears) ears.guard = false;
  if (S.listening) setMode("listening", "מקשיב…");
  else setMode("idle", "לחץ על המיקרופון כדי להמשיך.");
}

$("mic").onclick = () => (S.listening ? stopListening() : startListening());

/* ------------------------------------------------------------- panels */

function openPanel(build) {
  const panel = $("panel"); panel.replaceChildren();
  const x = el("button", "btn x", "✕"); x.setAttribute("aria-label", "סגור"); x.onclick = closePanel;
  panel.append(x); build(panel);
  $("over").classList.add("open");
}
function closePanel() { $("over").classList.remove("open"); }
$("over").onclick = (e) => { if (e.target === $("over")) closePanel(); };

function tier(name) {
  const w = (S.pack.weights || {})[name] || 20;
  if (["Rashi", "Tosafot", "Rabbeinu Chananel", "Rashbam", "Steinsaltz"].includes(name)) return "על הדף";
  if (w >= 55) return "ראשונים";
  if (w >= 30) return "אחרונים";
  return "עוד";
}

function openSources(n, focus) {
  if (!S.pack) return;
  const seg = S.pack.segments.find((s) => s.n === n) || S.pack.segments[0];
  openPanel((panel) => {
    panel.append(el("h2", null, "מפרשים · שורה " + seg.n), el("div", "sub", seg.he.split(/\s+/).slice(0, 8).join(" ") + "…"));
    const groups = {};
    for (const [name, list] of Object.entries(seg.commentaries))
      for (const e of list) (groups[tier(name)] = groups[tier(name)] || []).push([name, e]);
    let target = null;
    for (const g of ["על הדף", "ראשונים", "אחרונים", "עוד"]) {
      const rows = (groups[g] || []).sort((a, b) => ((S.pack.weights || {})[b[0]] || 0) - ((S.pack.weights || {})[a[0]] || 0));
      if (!rows.length) continue;
      panel.append(el("div", "grp", g));
      for (const [name, e] of rows) {
        const box = el("div", "src");
        const who = el("div", "who", heName(name));
        if (e.dibur) who.append(el("span", "dib", e.dibur));
        box.append(who, el("div", "body", e.he));
        if (e.structure && e.structure.moves && e.structure.moves.length) {
          // The argument the comment states about itself, as its shape:
          // פירוש → קושיא → קושיא → פירוש אחר → תירוץ → מסקנה.
          const shape = el("div", "shape");
          e.structure.moves.forEach((m, i) => {
            if (i) shape.append(el("span", "arrow", "←"));
            const t = el("span", "mv " + m.kind, MOVES[m.kind] || m.kind);
            t.title = m.marker + " — " + m.text.slice(0, 120);
            shape.append(t);
          });
          box.append(shape);
        }
        const meta = el("div", "meta");
        const more = el("button", "more", "הכל");
        more.onclick = () => { box.classList.toggle("open"); more.textContent = box.classList.contains("open") ? "פחות" : "הכל"; };
        const link = el("a", "lnk", e.ref); link.href = sefariaUrl(e.ref); link.target = "_blank"; link.rel = "noopener";
        meta.append(more, link); box.append(meta);
        if (e.ref === focus) { target = box; box.classList.add("open", "flash"); more.textContent = "פחות"; }
        panel.append(box);
      }
    }
    const related = Object.assign({}, seg.related || {});
    if (seg.halacha && seg.halacha.length) related.Halakhah = [...new Set(seg.halacha.concat(related.Halakhah || []))];
    for (const cat of Object.keys(RELATED_HE)) {
      const refs = related[cat]; if (!refs || !refs.length) continue;
      panel.append(el("div", "grp", RELATED_HE[cat]));
      const box = el("div", "rel");
      for (const r of refs) { const a = el("a", null, r); a.href = sefariaUrl(r); a.target = "_blank"; a.rel = "noopener"; box.append(a); }
      panel.append(box);
    }
    if (target) setTimeout(() => target.scrollIntoView({ block: "center" }), 60);
  });
}

function openLog() {
  openPanel((panel) => {
    panel.append(el("h2", null, "תמליל"), el("div", "sub", "מה שנאמר בשיחה הזאת"));
    if (!S.log.length) panel.append(el("div", "sub", "עוד לא דיברתם."));
    for (const t of S.log) {
      const row = el("div", "turn" + (t.me ? " me" : ""),
        (t.me && t.mode === "reading" ? "📖 " : "") + t.text.replace(/\[\[([^\]]+)\]\]/g, "($1)"));
      row.dir = "auto";
      if (t.trace) row.append(el("span", "trace", "routed: " + t.trace.kind + (t.trace.claim ? " · claim" : "") +
        (t.trace.opened && t.trace.opened.length ? " · opened: " + t.trace.opened.join(", ") : "")));
      panel.append(row);
    }
    // For a quiet room: say it by typing. Not a chat -- the answer still comes aloud.
    panel.append(el("div", "grp", "להקליד במקום לדבר"));
    const form = el("form"); form.style.display = "flex"; form.style.gap = "6px";
    const input = el("input"); input.style.flex = "1"; input.className = "btn"; input.placeholder = "מה אתה חושב שכתוב כאן?";
    const go = el("button", "btn", "שלח"); go.type = "submit";
    form.append(input, go);
    form.onsubmit = (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; closePanel(); onUtterance({ text: t }); };
    panel.append(form);
    setTimeout(() => panel.scrollTo({ top: panel.scrollHeight }), 30);
  });
}

function openSettings() {
  const choice = (key, label, options, help) => {
    const box = el("div", "set");
    box.append(el("div", "lbl", label));
    const row = el("div", "opts");
    for (const [value, text] of options) {
      const b = el("button", "btn", text);
      b.setAttribute("aria-pressed", String(S.settings[key] === value));
      b.onclick = () => {
        S.settings[key] = value; saveSettings();
        for (const x of row.children) x.setAttribute("aria-pressed", String(x === b));
        if (key === "view") render(), selectLine(S.line);
        if (["translate", "stops"].includes(key)) applyToggles();
        if (key === "hearing" && S.listening) { stopListening(); startListening(); }
      };
      row.append(b);
    }
    box.append(row);
    if (help) box.append(el("div", "help", help));
    return box;
  };
  openPanel((panel) => {
    panel.append(el("h2", null, "הגדרות"), el("div", "sub", "נשמר בדפדפן הזה"));
    panel.append(
      choice("depth", "עומק", [["daf", "הדף — רש״י ותוספות"], ["rishonim", "+ ראשונים"], ["acharonim", "+ אחרונים"]],
        "מה החברותא מביא בעצמו. אם תשאל על מפרש מסוים, הוא יביא אותו בכל מקרה."),
      choice("language", "שפת התשובה", [["auto", "כמוני"], ["he", "עברית"], ["en", "English"]]),
      choice("view", "תצוגת הדף", [["daf", "צורת הדף"], ["lin", "שטיינזלץ, מנוקד"]]),
      choice("translate", "תרגום (בתצוגת שטיינזלץ)", [[false, "בלי"], [true, "עם תרגום"]]),
      choice("stops", "לסמן עצירות", [[false, "לא"], [true, "כן"]], "איפה המשפט נגמר. כבוי כברירת מחדל — זה חלק מהלימוד."),
      choice("pause", "כמה לחכות לפני שאני עונה", [["short", "קצר"], ["normal", "רגיל"], ["long", "ארוך"]],
        "אם הוא קוטע אותך באמצע מחשבה — בחר ארוך."),
      choice("nudges", "הערות יזומות", [[true, "כן"], [false, "לא"]], "רק כשמגיעים לנקודה שבה המפרשים נחלקים."),
      choice("speak", "שיענה בקול", [[true, "כן"], [false, "לא"]]),
      choice("voice", "קול", [["natural", "טבעי (OpenAI)"], ["browser", "הדפדפן (חינם)"]]),
      choice("hearing", "זיהוי דיבור", [["api", "מדויק, עברית ואנגלית יחד"], ["browser", "הדפדפן (חינם, שפה אחת)"]]),
    );
    const k = el("div", "set"); k.append(el("div", "lbl", "מקשים"));
    const keys = el("div", "kbd");
    keys.innerHTML = "<kbd>רווח</kbd> מיקרופון · <kbd>←</kbd> <kbd>→</kbd> עמוד הבא / הקודם · " +
      "<kbd>↑</kbd> <kbd>↓</kbd> שורה · <kbd>Esc</kbd> סגור";
    k.append(keys); panel.append(k);
  });
}

$("open-sources").onclick = () => openSources(S.line);
$("open-log").onclick = openLog;
$("open-settings").onclick = openSettings;
$("v-daf").onclick = () => { S.settings.view = "daf"; saveSettings(); if (S.pack) { render(); selectLine(S.line); } };
$("v-lin").onclick = () => { S.settings.view = "lin"; saveSettings(); if (S.pack) { render(); selectLine(S.line); } };

/* ----------------------------------------------------------- keys & touch */

document.addEventListener("keydown", (e) => {
  const tag = (document.activeElement || {}).tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if (e.key === "Escape") return closePanel();
  if ($("over").classList.contains("open")) return;
  if (e.key === " ") { e.preventDefault(); $("mic").click(); }
  else if (e.key === "ArrowLeft") flip(1);             // right to left: left is forward
  else if (e.key === "ArrowRight") flip(-1);
  else if (e.key === "ArrowDown") { e.preventDefault(); selectLine(S.line + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); selectLine(S.line - 1); }
});

let touch = null;
$("page").addEventListener("touchstart", (e) => { touch = e.touches[0]; }, { passive: true });
$("linear").addEventListener("touchstart", (e) => { touch = e.touches[0]; }, { passive: true });
document.addEventListener("touchend", (e) => {
  if (!touch) return;
  const t = e.changedTouches[0], dx = t.clientX - touch.clientX, dy = t.clientY - touch.clientY;
  touch = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) flip(dx < 0 ? 1 : -1);
});

/* ------------------------------------------------------------------ start */

(async function start() {
  checkHealth();          // not awaited: a slow Sefaria must not hold up a cached page
  await buildPickers();
  setInterval(checkHealth, 60000);
  const last = recall("ref");
  const valid = last && parseRef(last) && S.masechtot.some((m) => m.name === parseRef(last).masechta);
  turnTo(valid ? last : pickedRef());
})();
