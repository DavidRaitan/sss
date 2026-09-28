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

const DEFAULTS = { view: "daf", depth: "daf", language: "en", voice: "natural",
  hearing: "api", speak: true, pause: "normal", nudges: true, checks: true, translate: false, stops: false,
  speakers: false, rate: 1, favor: {}, voices: 3, open: "last", mine: [],
  sites: ["halachayomit.co.il", "he.wikisource.org"], sites_halacha: true };
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
  fillMasechtot();
  fillDapim();
  // A tractate opens where you left it, not at its first page.
  $("mas").onchange = () => {
    const back = recall("pos." + $("mas").value);
    if (back) return turnTo(back);
    fillDapim(); turnTo(pickedRef());
  };
  $("today").onclick = openToday;
  $("daf").onchange = () => turnTo(pickedRef());
  $("am-a").onclick = () => { setAmud("a"); turnTo(pickedRef()); };
  $("am-b").onclick = () => { setAmud("b"); turnTo(pickedRef()); };
  $("prev").onclick = () => flip(-1);
  $("next").onclick = () => flip(1);
}

// The tractates you are learning first, then all of Shas by seder.
function fillMasechtot() {
  const mas = $("mas"), keep = mas.value;
  const option = (m) => { const o = el("option", null, m.he); o.value = m.name; return o; };
  const groups = [];
  const mine = S.masechtot.filter((m) => (S.settings.mine || []).includes(m.name));
  if (mine.length) { const g = el("optgroup"); g.label = "שלי"; g.append(...mine.map(option)); groups.push(g); }
  for (const seder of [...new Set(S.masechtot.map((m) => m.seder))]) {
    const g = el("optgroup"); g.label = "סדר " + seder;
    g.append(...S.masechtot.filter((m) => m.seder === seder).map(option));
    groups.push(g);
  }
  mas.replaceChildren(...groups);
  if (keep) mas.value = keep;
}

// Coming back after a day or more: say where you were, and offer a review.
async function lastTime() {
  try {
    const { sittings } = await (await fetch("/api/history")).json();
    const todayIso = new Date().toLocaleDateString("sv");   // YYYY-MM-DD, local
    const last = (sittings || []).find((s) => s.date < todayIso);
    if (!last || (sittings[0] && sittings[0].date === todayIso)) return;
    const he = S.settings.language === "he";
    const where = last.refs.slice(-1).map(runnerText)[0];
    showReply("בפעם הקודמת (" + last.date.split("-").reverse().join(".") + ") למדת עד " + where + ".", { hint: true });
    const again = el("button", "chip", "↺ חזרה על מה שלמדנו");
    again.onclick = () => onUtterance({ text: he ? "תזכיר לי מה למדנו בפעם הקודמת" : "Remind me what we learned last time" });
    const test = el("button", "chip", "❓ שאלות חזרה");
    test.onclick = () => onUtterance({ text: he ? "תבחן אותי על מה שלמדנו בפעם הקודמת" : "Test me on what we learned last time" });
    $("chips").append(again, test);
  } catch (e) {}
}

// Today's daf, from Sefaria's calendar.
async function today() {
  if (S.today && S.today.date === new Date().toLocaleDateString("sv")) return S.today;
  try {
    const r = await fetch("/api/today");
    if (r.ok) S.today = await r.json();
  } catch (e) {}
  if (S.today) $("today-label").textContent = S.today.he;
  return S.today;
}
async function openToday() {
  const t = await today();
  if (t && t.amudim && t.amudim.length) return turnTo(t.amudim[0]);
  const box = $("loading"); box.hidden = false;
  box.textContent = t ? "הדף היומי היום (" + t.he + ") לא נמצא בספריא." : "לא הצלחתי לברר מה הדף היומי.";
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
  $("am-a").disabled = !!(m && +$("daf").value === m.first && m.first_amud === "b");   // Tamid opens on 25b
}
const pickedAmud = () => ($("am-b").getAttribute("aria-pressed") === "true" ? "b" : "a");

function pickedRef() {
  const m = masechta(); if (!m) return null;
  let amud = pickedAmud();
  if (+$("daf").value === m.last && m.last_amud === "a") amud = "a";
  if (+$("daf").value === m.first && m.first_amud === "b") amud = "b";
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
    remember("pos." + data.masechta, ref);
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
  const opens = {};
  for (const sec of pack.sections || []) if (sec.label) opens[sec.from] = sec;
  for (const seg of pack.segments) {
    const sec = opens[seg.n];
    if (sec) {
      const mark = el("button", "unit", sec.label);
      mark.title = "שורות " + sec.from + "–" + sec.to;
      mark.onclick = (e) => { e.stopPropagation(); selectUnit(sec); };
      g.append(mark, document.createTextNode(" "));
    }
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
  const sec = sectionOf(S.line);
  $("where").textContent = "שורה " + S.line + " מתוך " + max +
    (sec && sec.label ? " · " + sec.label + " (" + sec.from + "–" + sec.to + ")" : "");

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

function sectionOf(n) {
  return ((S.pack && S.pack.sections) || []).find((s) => s.from <= n && n <= s.to) || null;
}

// A whole unit -- "let's finish this piece" -- lit at once.
function selectUnit(sec) {
  selectLine(sec.from, { scroll: "side" });
  for (const node of document.querySelectorAll(".seg"))
    if (+node.dataset.n >= sec.from && +node.dataset.n <= sec.to) node.classList.add("on");
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
  else if (/^Mishnah Berurah/.test(ref)) label = "משנה ברורה · " + ref.replace(/^Mishnah Berurah\s*/, "");
  else if (/^Rabbeinu Yonah/.test(ref)) label = "רבינו יונה";
  return { label, go: () => openText(ref) };
}

// A reply as it should look: «quotes» set in the page's type, [[refs]] as
// small buttons where they stand in the sentence (lifting them out left
// "we need the text at and and"), and a pipe table drawn as a table.
// Returns the refs cited.
function renderRich(box, text) {
  const refs = [];
  const inline = (parent, t) => {
    for (const part of t.split(/(«[^»]+»|\[\[[^\]]+\]\])/)) {
      if (!part) continue;
      if (/^«.*»$/.test(part)) parent.append(el("q", null, part.slice(1, -1)));
      else if (/^\[\[.*\]\]$/.test(part)) {
        const ref = part.slice(2, -2).trim();
        if (!refs.includes(ref)) refs.push(ref);
        const c = chipFor(ref), b = el("button", "chip inline", c.label);
        b.title = ref; b.onclick = c.go; parent.append(b);
      } else parent.append(document.createTextNode(part.replace(/\s+([,.;:?!])/g, "$1")));
    }
  };
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++].trim());
      i--;
      const table = el("table", "positions"); table.dir = "auto";
      rows.filter((r) => !/^\|[\s:|-]+\|$/.test(r)).forEach((r, k) => {
        const tr = el("tr");
        for (const cell of r.replace(/^\||\|$/g, "").split("|")) {
          const td = el(k === 0 ? "th" : "td"); td.dir = "auto"; inline(td, cell.trim()); tr.append(td);
        }
        table.append(tr);
      });
      box.append(table);
    } else if (lines[i].trim()) {
      const p = el("div", "para"); p.dir = "auto"; inline(p, lines[i]); box.append(p);
    }
  }
  return refs;
}

function showReply(text, opts) {
  opts = opts || {};
  const r = $("reply"), chips = $("chips");
  r.hidden = !text; r.replaceChildren(); chips.replaceChildren();
  r.classList.toggle("hint", !!opts.hint);
  if (!text) return;
  renderRich(r, text);
  if (!opts.hint) {
    // Cut off by your own reading, or missed: hear it again.
    const again = el("button", "chip again", "🔊");
    again.title = "להשמיע שוב"; again.onclick = () => say(text);
    chips.append(again);
  }
  if (opts.grounded === false) chips.append(el("span", "chip warn", "לא נמצא מקור — אל תסמוך על זה"));
}

/* ---------------------------------------------------------------- speaking */

let player = null, speakingDone = null;

// The same rules as the server's speakable(): quotes are spoken, a table is
// read row by row, and a citation is dropped where it follows its name.
function speakable(text) {
  const out = [], lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|")) { out.push(lines[i]); continue; }
    const rows = [];
    while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++].trim());
    i--;
    const sep = (r) => /^\|[\s:|-]+\|$/.test(r);
    let body = rows.filter((r) => !sep(r));
    if (body.length > 1 && rows.some(sep)) body = body.slice(1);
    out.push(body.map((r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.replace(/\[\[[^\]]+\]\]/g, "").trim())
      .filter(Boolean).join(", ") + ".").join(" "));
  }
  return out.join("\n")
    .replace(/\[\[([^\]]+)\]\]/g, (m, ref, at, all) => {
      const name = ref.split(/ on |,/)[0].replace(/ \d.*$/, "");
      return all.slice(Math.max(0, at - 60), at).toLowerCase().includes(name.split(" ")[0].toLowerCase()) ||
        /[א-ת]["'״׳]?[א-ת]*\s*$/.test(all.slice(Math.max(0, at - 20), at)) ? "" : name;
    })
    .replace(/«([^»]*)»/g, "$1")
    .replace(/\s+([,.;:?!])/g, "$1").replace(/(\s*…\s*){2,}/g, " … ").replace(/\s{2,}/g, " ").trim();
}

// One voice at a time, and it can be paused. Everything the partner says goes
// through one queue (speechQ), so two answers never talk over each other, and nothing
// is said into the middle of the learner's own sentence.
let paused = false;

// What is waiting to be said, in order. Each item belongs to a turn (one thing
// the learner asked), so a whole answer can be skipped at once. The next item's
// audio is fetched while the current one plays, so sentence follows sentence
// without a gap.
const speechQ = [];
let saying = null;          // the item being said now

function stopSpeaking() {
  paused = false;
  if (player) { try { player.pause(); player.removeAttribute("src"); } catch (e) {} player = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (speakingDone) { const d = speakingDone; speakingDone = null; d(); }
  showHold();
}

const rate = () => +S.settings.rate || 1;

// ⏸ / ▶ -- stopping it without having to talk over it.
function pauseSpeaking() {
  if (!speakingDone) return;
  paused = !paused;
  if (player) { if (paused) player.pause(); else player.play().catch(() => {}); }
  if (window.speechSynthesis) { if (paused) speechSynthesis.pause(); else speechSynthesis.resume(); }
  showHold();
  setMode(paused ? "paused" : "speaking", paused ? "עצרתי — ▶ כדי להמשיך, או פשוט דבר." : "מדבר…");
}

function showHold() {
  const b = $("hold");
  b.hidden = !speakingDone;
  b.textContent = paused ? "▶" : "⏸";
  b.title = paused ? "להמשיך (רווח)" : "לעצור (רווח)";
}

// Ask the server to make an item's voice, and start fetching the audio, before
// it is its turn -- so it is ready the moment the one before it ends.
function prepare(item) {
  if (item.ready) return item.ready;
  item.ready = (async () => {
    const r = await fetch("/api/voice", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: item.text, ref: S.pack && S.pack.ref, whole: !!(item.turn && item.turn.whole) }) });
    if (!r.ok) throw new Error("voice_" + r.status);
    const { id } = await r.json();
    const audio = new Audio("/api/voice/" + id);
    audio.preload = "auto";
    return audio;
  })();
  item.ready.catch(() => {});
  return item.ready;
}

async function speak(text, item) {
  if (!S.settings.speak || !text) return;
  stopSpeaking();
  let mine;
  const done = new Promise((resolve) => { mine = resolve; speakingDone = resolve; });
  showHold();
  // One voice, always. The browser's own voices are used only when chosen in
  // settings or when there is no OpenAI voice at all -- never as a quiet
  // stand-in when the natural voice hiccups or is interrupted. In use that
  // swapped voices mid-conversation, and the browser reads Hebrew and English
  // in two different voices besides.
  const h = S.health;
  const natural = S.settings.voice === "natural" && !(h && (h.key === false || h.can_speak === false));
  if (!natural) { browserSpeak(speakable(text)); return done; }
  const current = () => speakingDone === mine;
  item = item || { text };
  for (let attempt = 0; attempt < 2 && current(); attempt++) {
    try {
      // Prepared, then streamed: playback starts while the voice is still
      // being made, and a reply heard before comes straight from disk.
      if (attempt) item.ready = null;
      const audio = await prepare(item);
      if (!current()) return done;                           // stopped while it was being made
      player = audio;
      player.playbackRate = rate();
      player.preservesPitch = true;
      player.onended = () => stopSpeaking();
      player.onerror = () => { logVoiceTrouble("playback"); stopSpeaking(); };
      if (!paused) await player.play();                      // ⏸ pressed before the first word
      return done;
    } catch (e) {
      if (!current() || (e && e.name === "AbortError")) return done;   // stopped on purpose
      if (e && e.name === "NotAllowedError") {
        setMode(S.listening ? "listening" : "idle", "הדפדפן חוסם קול — לחץ פעם אחת על הדף.", true);
        break;
      }
      await sleep(400);
    }
  }
  // It could not be said in its own voice: the words stay on the screen.
  if (current()) { logVoiceTrouble("voice"); stopSpeaking(); }
  return done;
}

function logVoiceTrouble(stage) {
  const last = S.log[S.log.length - 1];
  if (last && last.error && last.stage === stage) return;   // one line, not a hundred
  logPush({ me: false, error: true, stage, text: "לא הצלחתי להשמיע — התשובה על המסך.", detail: "voice " + stage,
    ms: 0, at: new Date().toLocaleTimeString() });
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
    u.rate = 1.02 * rate();
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
    const rec = this.rec, chunks = this.chunks, began = performance.now();
    this.overlap = false;   // set if it was talking during this recording
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      // A scrap is not an utterance. In use, recorders stopped moments after
      // they started (its own voice through the speakers, heard as speech)
      // and hundreds of fragments too short to decode went out, each an error.
      const long = performance.now() - began >= 500;
      const keep = !this.discard && chunks.length && long;
      const blob = keep ? new Blob(chunks, { type: rec.mimeType || this.mime || "audio/webm" }) : null;
      const spoke = this.lastSpeech || 0, overlap = this.overlap;
      this.lastSpeech = 0;
      if (this.active) this.record();
      if (blob && blob.size > 3000 && spoke >= 350) this.onUtterance({ blob, overlap });
    };
    rec.start();
    this.recAt = began;
  }
  stopRec() {
    try { if (this.rec && this.rec.state === "recording") this.rec.stop(); } catch (e) {}
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
    // `loud` is how long they have been audibly speaking just now. Capped, and
    // cleared when an utterance ends and when the partner starts to talk: in
    // use it was never cleared, so after a long question it was still "loud"
    // when the answer began, counted as the learner talking over it, and cut
    // the answer off after 20 ms -- until 🔊 was pressed.
    if (this.guard && !this.wasGuard) this.loud = 0;
    this.wasGuard = this.guard;
    if (rms > threshold) { this.loud = Math.min(1500, this.loud + 40); this.quiet = 0; }
    else { this.quiet += 40; this.loud = Math.max(0, this.loud - 20); }

    // Speaker mode (no earbuds): while it talks, and a moment after, it does
    // not listen -- its own voice would be heard as the learner's. ⏸ stops it.
    const deaf = S.settings.speakers && (this.guard || now - (this.spokeAt || 0) < 700);
    if (this.guard) this.spokeAt = now;
    if (now - (this.spokeAt || 0) < 1500) this.overlap = true;
    if (deaf) {
      this.loud = 0;
      if (this.talking) { this.talking = false; this.discard = true; this.lastSpeech = 0; this.stopRec(); }
    }
    // Only while a recorder is running: speech noticed in the gap between two
    // recordings would be sent without its beginning.
    const live = this.rec && this.rec.state === "recording";
    if (!deaf && live && !this.talking && this.loud >= (this.guard ? 500 : 140)) {
      this.talking = true; this.startedAt = now - this.loud;
      if (this.guard) this.onBarge();
      setMode("capturing", "שומע אותך…");
    }
    const pause = PAUSES[S.settings.pause] || 1500;
    if (this.talking && (this.quiet >= pause || now - this.startedAt > 45000)) {
      this.talking = false; this.lastSpeech = now - this.startedAt - this.quiet;
      this.loud = 0;
      this.stopRec();
    } else if (!this.talking && this.quiet >= 600 && now - this.recAt > 4000 && live) {
      // Nothing said for a few seconds: start a fresh recording, so what is
      // sent to be heard is the speech and not the silence before it.
      this.discard = true; this.lastSpeech = 0; this.stopRec();
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
// Three things run side by side, so none waits on another: hearing (in order,
// so the page follows the reading), answering (one at a time, so the
// conversation stays in order on the server), and speaking (speechQ).
// In use, one queue for all three meant a reading waited behind the last
// answer's voice, and answers arrived after the learner had moved on.
let hearChain = Promise.resolve();
const asks = [];           // what is waiting for an answer
let answering = false;
let current = null;        // the question being thought about now
S.gen = 0;                 // bumped on mic-off: everything older is dropped
const aborts = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function idleMode(text) {
  if (speakingDone) return;
  setMode(S.listening ? "listening" : "idle", text || (S.listening ? "מקשיב…" : "המיקרופון כבוי — לחץ כדי לדבר."));
}

async function startListening() {
  if (S.starting) return;          // a double click must not open two microphones
  S.starting = true;
  try {
    if (ears) { ears.stop(); ears = null; }
    const useApi = S.settings.hearing === "api" && S.health && S.health.can_hear;
    const next = useApi ? new Ears(onUtterance, onBarge) : new BrowserEars(onUtterance, onBarge);
    try {
      await next.start();
    } catch (e) {
      if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) return micDenied();
      return setMode("idle", "לא הצלחתי לפתוח את המיקרופון.", true);
    }
    ears = next;
    S.listening = true;
    setMode("listening", "מקשיב… קרא מהדף, או תגיד מה אתה חושב שכתוב.");
  } finally { S.starting = false; }
}

// Mic off is a clean stop: nothing half-heard, nothing waiting, nothing talking.
function stopListening() {
  S.gen++;
  S.listening = false;
  if (ears) ears.stop();
  ears = null;
  for (const c of aborts) c.abort();
  aborts.clear();
  asks.length = 0;
  answering = false;
  stopSpeaking();
  for (const item of speechQ.splice(0)) item.resolve();
  for (const t of S.turns) if (open(t)) t.status = "skipped";
  renderBar();
  hearChain = Promise.resolve();
  showMine("");
  setMode("idle", "המיקרופון כבוי. לחץ כדי להמשיך.");
}

function micDenied() {
  S.listening = false;
  setMode("idle", "צריך אישור למיקרופון — לחץ על סמל המנעול בשורת הכתובת ואפשר מיקרופון.", true);
}

// Talking over it stops it (and what they say is heard); so does talking
// while it is paused -- they have moved on.
function onBarge() { stopSpeaking(); }

function onUtterance(u) {
  const g = S.gen, t0 = performance.now();
  hearChain = hearChain.then(() => hearOne(u, g, t0)).catch((e) => console.warn(e));
}

function logPush(entry) {
  S.log.push(entry);
  if (S.panel === "log") renderTurns();
  return entry;
}

async function post(path, body, raw, signal) {
  const r = await fetch(path, raw ? { method: "POST", headers: { "Content-Type": raw }, body, signal }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  let data = {};
  try { data = await r.json(); } catch (e) {}
  if (!r.ok) throw Object.assign(new Error(data.error || "http_" + r.status), { code: data.error });
  return data;
}

// /api/say answers in lines of JSON: sometimes a "let me pull up the Tur" line
// while Sefaria is asked, then the answer. onLine sees each one as it lands.
async function postStream(path, body, onLine, signal) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ stream: true }, body)), signal });
  if (!r.ok) {
    let data = {};
    try { data = await r.json(); } catch (e) {}
    throw Object.assign(new Error(data.error || "http_" + r.status), { code: data.error });
  }
  if (!/ndjson/.test(r.headers.get("Content-Type") || "")) return r.json();
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "", last = null;
  const take = (line) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    if (msg.error) throw Object.assign(new Error(msg.error), { code: msg.error });
    if (msg.mode === "interim" || msg.mode === "part" || msg.mode === "read") onLine(msg); else last = msg;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let k;
    while ((k = buf.indexOf("\n")) >= 0) { take(buf.slice(0, k)); buf = buf.slice(k + 1); }
  }
  take(buf);
  return last;
}

// A failure is shown, and kept in the transcript with how long it took, so
// the export says what went wrong instead of leaving a gap.
function failed(err, stage, since) {
  logPush({ me: false, error: true, stage, text: explain(err), detail: (err && (err.code || err.message)) || "",
    ms: Math.round(performance.now() - since), at: new Date().toLocaleTimeString() });
  if (!speakingDone) setMode(S.listening ? "listening" : "idle", explain(err), true);
}

function explain(err) {
  const code = (err && (err.code || err.message)) || "";
  if (/OPENAI_API_KEY|api key|401/i.test(code)) return "המפתח ל-OpenAI לא עובד — בדוק את .env.";
  if (/sefaria/.test(code)) return "לא הצלחתי להגיע לספריא.";
  if (/model/.test(code)) return "המודל לא ענה. נסה שוב בעוד רגע.";
  return "משהו השתבש — נסה שוב.";
}

// One thing the learner said, from sound to answer.
// One thing the learner said: follow it, and if it wants an answer, ask for one.
async function hearOne(u, g, t0) {
  if (!S.pack || g !== S.gen) return;
  if (!speakingDone) setMode("hearing", "שומע…");
  let heard;
  const ctl = new AbortController(); aborts.add(ctl);
  try {
    const q = "ref=" + encodeURIComponent(S.pack.ref) + "&line=" + S.line + "&session=" + S.session +
      "&language=" + S.settings.language + "&checks=" + (S.settings.checks ? 1 : 0) +
      "&overlap=" + (u.overlap ? 1 : 0);
    heard = u.blob ? await post("/api/hear?" + q, u.blob, u.blob.type || "audio/webm", ctl.signal)
      : await post("/api/heard", { ref: S.pack.ref, line: S.line, session: S.session,
          language: S.settings.language, said: u.text, checks: S.settings.checks }, null, ctl.signal);
  } catch (e) { if (g === S.gen) failed(e, "hear", t0); return; }
  finally { aborts.delete(ctl); }
  if (g !== S.gen) return;
  if (!heard.said || heard.mode === "silence") return idleMode();
  if (heard.mode === "echo") {
    // It heard its own voice through the speakers. Twice, and it stops
    // listening while it talks (speaker mode); ⏸ is how to stop it then.
    S.echoes = (S.echoes || 0) + 1;
    if (S.echoes >= 2 && !S.settings.speakers) {
      S.settings.speakers = true; saveSettings();
      showReply("נשמע שאין אוזניות — שמעתי את עצמי. מעכשיו, בזמן שאני מדבר אני לא מקשיב; לעצור אותי: ⏸ או רווח.", { hint: true });
      logPush({ me: false, error: true, stage: "echo", text: "עברתי למצב רמקול (בלי אוזניות).", detail: "heard itself twice",
        ms: 0, at: new Date().toLocaleTimeString() });
    }
    return idleMode();
  }

  logPush({ me: true, text: heard.said, mode: heard.mode, ref: S.pack.ref, line: heard.line || S.line,
    heard: heard.heard, ms_hear: Math.round(performance.now() - t0), at: new Date().toLocaleTimeString() });
  if (heard.line) selectLine(heard.line, { scroll: "side" });
  markRead(heard.heard);
  if (heard.ignore) return idleMode();   // "um", "okay": nothing to answer

  if (heard.skip) {
    // "Enough" / "skip" -- talking already stopped the voice; drop the rest.
    skipCurrent();
    const t = S.turns.find(open);
    if (t && t.status !== "thinking" && t.status !== "waiting") dropTurn(t);
    renderBar();
    return idleMode();
  }
  if (heard.rate) {
    // "Talk a bit faster" / "slower".
    const text = setRate(heard.rate);
    answered(heard.said, text, { kind: "speed" });
    return;
  }
  if (heard.again) {
    // "What?" / "I didn't hear you": say the last answer again.
    const last = S.lastSaid || (S.settings.language === "he" ? "עוד לא אמרתי כלום." : "I haven't said anything yet.");
    answered(heard.said, last, { kind: "said again" });
    return;
  }
  if (heard.quick) {
    // "Hey", "can you hear me?", "go ahead": answered at once, no thinking.
    answered(heard.said, heard.quick, { kind: "small talk" });
    return;
  }
  if (heard.mode === "reading") {
    showMine("📖 " + heard.said);
    if (heard.respond) return ask({ heard, extra: { about_reading: true }, line: heard.line });
    idleMode("עוקב אחרי הקריאה — שורה " + heard.line + ".");
    if (heard.nudge && S.settings.nudges) {
      // The end of a unit that holds a machlokes.
      flashComment(heard.nudge_ref);
      answered("", heard.nudge + (heard.nudge_ref ? " [[" + heard.nudge_ref + "]]" : ""), { kind: "nudge" });
    }
    return;
  }
  showMine("");
  ask({ heard, line: S.line });
}

/* ------------------------------------------------------------------ turns */

// A turn is one thing the learner asked and what came back. The bar shows the
// turn being answered -- its question and its answer, growing as it is spoken
// -- and the ones waiting behind it as a queue, with ⏭ to skip the current
// answer and ⏩ to go straight to the latest question. In use, the bar showed
// the next question while the answer to the one before was still being said.
S.turns = [];
let turnSeq = 0;

function newTurn(asked, status) {
  const t = { id: ++turnSeq, asked: asked || "", status: status || "waiting", text: "", interim: "" };
  S.turns.push(t);
  if (S.turns.length > 40) S.turns.shift();
  renderBar();
  return t;
}
const open = (t) => t && !["done", "skipped"].includes(t.status);

// Something with its answer already in hand: a greeting, a speed change, a nudge.
function answered(asked, text, trace) {
  const t = newTurn(asked, "answering");
  t.text = text; t.complete = true;
  if (trace && trace.kind === "nudge") t.nudge = true;
  logPush({ me: false, text, trace: Object.assign({ quick: true }, trace), ms_answer: 0 });
  S.lastSaid = text;
  say(text, t);
  renderBar();
}

// The turn in the bar: the one being said, or else the oldest still coming.
function shownTurn() {
  if (saying && saying.turn) return saying.turn;
  return S.turns.find(open) || S.turns[S.turns.length - 1];
}

function renderBar() {
  const t = shownTurn();
  const asked = $("asked");
  asked.hidden = !(t && t.asked);
  asked.textContent = t && t.asked ? t.asked : "";
  if (t) {
    if (t.text) showReply(t.text, { grounded: t.grounded });
    else if (t.interim) showReply(t.interim, { hint: true });
    else if (open(t)) showReply(S.settings.language === "he" ? "חושב…" : "Thinking…", { hint: true });
  }
  const waiting = S.turns.filter((x) => open(x) && x !== t);
  const q = $("queue");
  q.replaceChildren();
  q.hidden = !waiting.length && !(saying && saying.turn);
  if (q.hidden) return;
  if (waiting.length) q.append(el("span", "qlabel", "בתור (" + waiting.length + "):"));
  for (const w of waiting) {
    const icon = w.text ? "✓" : "⏳";
    const chip = el("span", "qitem", icon + " " + (w.asked || "הערה").slice(0, 48) + (w.asked.length > 48 ? "…" : ""));
    chip.dir = "auto";
    chip.title = w.text ? "התשובה מוכנה, מחכה לתורה" : "עוד חושב";
    q.append(chip);
  }
  const skip = el("button", "btn qbtn", "⏭");
  skip.title = "לדלג על התשובה הזאת"; skip.onclick = skipCurrent;
  q.append(skip);
  if (waiting.length) {
    const last = el("button", "btn qbtn", "⏩");
    last.title = "ישר לשאלה האחרונה"; last.onclick = toLatest;
    q.append(last);
  }
}

function finishTurns() {
  for (const t of S.turns) {
    if (t.complete && open(t) && !speechQ.some((i) => i.turn === t) && !(saying && saying.turn === t))
      t.status = "done";
  }
}

function dropTurn(t) {
  t.status = "skipped";
  for (let i = speechQ.length - 1; i >= 0; i--) if (speechQ[i].turn === t) speechQ.splice(i, 1)[0].resolve();
}

// ⏭ -- enough of this answer; on to the next.
function skipCurrent() {
  const t = saying && saying.turn;
  if (t) dropTurn(t);
  stopSpeaking();
  renderBar();
}

// ⏩ -- straight to the last thing asked; everything before it is dropped.
function toLatest() {
  const live = S.turns.filter(open);
  const latest = live[live.length - 1];
  for (const t of live) if (t !== latest) dropTurn(t);
  if (saying && saying.turn !== latest) stopSpeaking();
  renderBar();
}

// Speed, from settings or by voice ("a bit faster").
const RATES = [0.85, 1, 1.15, 1.3, 1.5, 1.75];
function setRate(step) {
  const now = rate();
  let i = RATES.findIndex((r) => r >= now - 0.01);
  if (i < 0) i = 1;
  i = Math.max(0, Math.min(RATES.length - 1, i + step));
  S.settings.rate = RATES[i]; saveSettings();
  if (player) player.playbackRate = RATES[i];
  const he = S.settings.language === "he";
  if (step > 0) return i === RATES.length - 1 ? (he ? "זה הכי מהר שלי." : "That's as fast as I go.") : (he ? "בסדר, יותר מהר." : "Sure — faster.");
  return i === 0 ? (he ? "זה הכי לאט שלי." : "That's as slow as I go.") : (he ? "בסדר, יותר לאט." : "Sure — slower.");
}

function ask(q) {
  q.turn = newTurn(q.heard.said, "waiting");
  // Said while the last question is still being thought about, with nothing
  // of its answer out yet: ask again, both together. In use, a question and
  // its follow-up five seconds later got two answers, the second repeating
  // the first.
  const c = current;
  if (c && !c.merged && c.turn.status === "thinking" && !c.turn.text && !c.turn.interim &&
      !q.extra && !c.batch.some((x) => x.extra)) {
    c.merged = true;
    c.ctl.abort();
    asks.unshift(...c.batch);
  }
  asks.push(q);
  if (!answering) runAnswers(S.gen);
}

async function runAnswers(g) {
  answering = true;
  while (asks.length && g === S.gen) {
    // Whatever was said while the last answer was being made is answered
    // together, once -- not one stale answer after another.
    await respond(asks.splice(0), g);
  }
  if (g === S.gen) answering = false;
}

// Ask the partner and say what comes back -- sentence by sentence, as it is
// written, rather than waiting for the whole answer.
async function respond(batch, g) {
  const last = batch[batch.length - 1];
  const turn = batch[0].turn;
  if (batch.length > 1) {
    // Asked while the last answer was being made: answered together, as one turn.
    turn.asked = batch.map((q) => q.turn.asked).join("  ·  ");
    for (const q of batch.slice(1)) S.turns.splice(S.turns.indexOf(q.turn), 1);
  }
  if (turn.status !== "skipped") turn.status = "thinking";
  renderBar();
  const said = batch.length === 1 ? last.heard.said
    : batch.map((q, i) => (i < batch.length - 1 ? "(a moment earlier) " : "(and then) ") + q.heard.said).join("\n");
  const extra = batch.length === 1 ? last.extra || {} : {};
  if (!speakingDone) setMode("thinking", "חושב…");
  const t1 = performance.now();
  // They read on while it thought: say what this answers before answering it.
  const moved = Math.abs(S.line - (batch[0].line || S.line)) >= 2;
  let lead = !moved ? "" : S.settings.language === "he" ? "לגבי מה ששאלת קודם — " : "Back to what you asked — ";
  let first = null;
  const ctl = new AbortController(); aborts.add(ctl);
  const mine = current = { batch, ctl, turn, merged: false };
  let answer;
  try {
    answer = await postStream("/api/say", Object.assign({ ref: S.pack.ref, line: last.line || S.line, session: S.session,
      said, heard: last.heard.heard, depth: S.settings.depth, language: S.settings.language,
      favor: S.settings.favor, voices: S.settings.voices,
      sites: S.settings.sites, sites_halacha: S.settings.sites_halacha }, extra),
      (msg) => {
        if (g !== S.gen) return;
        if (msg.mode === "read") {
          // "Can you read it for me?" -- the page's words are spoken whole.
          turn.whole = true;
          return;
        }
        if (msg.mode === "interim") {
          // "Let me pull up the Tur" -- said while Sefaria is asked.
          turn.interim = msg.text;
          logPush({ me: false, text: msg.text, interim: true });
          say(msg.text, turn);
        } else {
          // A sentence of the answer, said while the rest is written.
          first = first || performance.now();
          turn.text += (turn.text ? (msg.text.startsWith("|") ? "\n" : " ") : "") + msg.text;
          if (turn.status !== "skipped") turn.status = "answering";
          say(lead + msg.text, turn);
          lead = "";
        }
        renderBar();
      }, ctl.signal);
  } catch (e) {
    if (mine.merged) return;     // asked again, together with what came after
    if (g === S.gen) { dropTurn(turn); failed(e, "answer", t1); }
    return;
  } finally { aborts.delete(ctl); if (current === mine) current = null; }
  if (g !== S.gen || mine.merged) return;
  if (!answer) { dropTurn(turn); return failed(null, "answer", t1); }
  if (answer.mode === "navigate") {
    turn.complete = true; turn.text = "עובר ל" + runnerText(answer.ref) + ".";
    finishTurns(); renderBar();
    turnTo(answer.ref);
    return idleMode();
  }
  const tr = answer.trace || {};
  const said_ = tr.streamed && !tr.retried;
  turn.text = answer.text; turn.grounded = answer.grounded; turn.complete = true;
  markQuotes(answer.text);
  const entry = logPush({ me: false, text: answer.text, trace: tr, grounded: answer.grounded,
    ms_answer: Math.round(performance.now() - t1), ms_first: first ? Math.round(first - t1) : null });
  S.lastSaid = answer.text;
  const t2 = performance.now();
  // Already said sentence by sentence -- except what was held back, or the
  // whole thing if the answer had to be written again.
  const rest = said_ ? tr.unsaid : lead + answer.text;
  const spoken = rest ? say(rest, turn) : Promise.resolve();
  spoken.then(() => { entry.ms_spoken = Math.round(performance.now() - t2); });
  finishTurns();
  renderBar();
}

// Queue something to be said. It waits for the learner to finish their
// sentence (never talks into the middle of it), then speaks; talking over it
// stops it, ⏸ pauses it, ⏭ skips the rest of the answer, and 🔊 says it again.
function say(text, turn) {
  if (!text || (turn && turn.status === "skipped")) return Promise.resolve();
  const item = { text, turn, g: S.gen };
  item.done = new Promise((r) => { item.resolve = r; });
  speechQ.push(item);
  pump();
  return item.done;
}

const naturalVoice = () => S.settings.voice === "natural" &&
  !(S.health && (S.health.key === false || S.health.can_speak === false));

async function pump() {
  if (saying || !speechQ.length) return;
  const item = speechQ.shift();
  saying = item;
  const live = () => item.g === S.gen && !(item.turn && item.turn.status === "skipped");
  const since = performance.now();
  while (live() && ears && ears.talking && performance.now() - since < 30000) await sleep(120);
  if (live()) {
    renderBar();
    setMode("speaking", "מדבר… (⏸ לעצור · ⏭ לדלג)");
    if (ears) ears.guard = true;
    // The next sentence's voice is made while this one plays.
    if (naturalVoice() && speechQ[0] && S.settings.speak) prepare(speechQ[0]);
    await speak(item.text, item);
    if (ears) ears.guard = false;
  }
  saying = null;
  item.resolve();
  finishTurns();
  renderBar();
  idleMode();
  pump();
}

$("mic").onclick = () => (S.listening ? stopListening() : startListening());
$("hold").onclick = pauseSpeaking;

/* ------------------------------------------------------------- panels */

// Panels sit beside the page, not over it: the gemara stays in view while
// you read Rashi, ask, or look at the transcript.
function openPanel(build, kind) {
  const panel = $("panel"); panel.replaceChildren();
  build(panel);
  panel.scrollTop = 0;
  S.panel = kind || "other";
  $("over").classList.add("open");
  document.body.classList.add("docked");
}
function closePanel() {
  S.panel = null;
  $("over").classList.remove("open");
  document.body.classList.remove("docked");
}
// ✕ sits outside the scrolling panel, so it is always in reach.
$("close-panel").onclick = closePanel;

// Drag the panel's edge to give it more or less of the screen; remembered.
// Beside the page it is a width, on a phone (a sheet from below) a height.
(function sizePanel() {
  const narrow = () => window.matchMedia("(max-width: 760px)").matches;
  const apply = (px) => {
    const root = document.documentElement.style;
    if (narrow()) root.setProperty("--sheet", Math.round(Math.min(Math.max(px, 160), innerHeight * 0.9)) + "px");
    else root.setProperty("--side", Math.round(Math.min(Math.max(px, 260), innerWidth * 0.75)) + "px");
  };
  const saved = +(recall(narrow() ? "sheet" : "side") || 0);
  if (saved) apply(saved);
  const grip = $("grip");
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    const rtl = getComputedStyle(document.body).direction === "rtl";
    const move = (ev) => {
      const px = narrow() ? innerHeight - ev.clientY : rtl ? innerWidth - ev.clientX : ev.clientX;
      apply(px);
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      document.body.classList.remove("resizing");
      const v = getComputedStyle(document.documentElement).getPropertyValue(narrow() ? "--sheet" : "--side");
      remember(narrow() ? "sheet" : "side", parseInt(v, 10) || "");
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up, { once: true });
    grip.addEventListener("pointercancel", up, { once: true });
  });
})();

function tier(name) {
  const w = (S.pack.weights || {})[name] || 20;
  if (["Rashi", "Tosafot", "Rabbeinu Chananel", "Rashbam", "Steinsaltz"].includes(name)) return "על הדף";
  if (w >= 55) return "ראשונים";
  if (w >= 30) return "אחרונים";
  return "עוד";
}

// Works whose comments argue (a reading, a question on it, an answer): their
// shape is worth drawing. Remez, derush and running explanation are not --
// "קושיא ← קושיא" over a gematria only misleads.
const ARGUED = new Set(["Tosafot", "Tosafot HaRosh", "Tosafot Rid", "Rashba", "Ritva", "Ramban", "Ran",
  "Meiri", "Rosh", "Shita Mekubetzet", "Ra'ah", "Maharsha", "Penei Yehoshua", "Tzelach", "Rashash",
  "Chiddushei Rabbi Akiva Eiger", "Reshimot Shiurim"]);

// "Meiri on Berakhot 2a:10" after 2a:9, not after 2a:1.
function refKey(ref) {
  return (ref.match(/\d+/g) || []).map(Number);
}
function byRef(a, b) {
  const x = refKey(a), y = refKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  }
  return a.localeCompare(b);
}

// A Tosafot as its moves, with who is speaking and repeats counted:
// פירוש רש״י ← קושיא ×4 ← ר״ת ← קושיא ← תירוץ ← … ← ר״י ← מסקנה
function drawShape(moves) {
  const shape = el("div", "shape"), runs = [];
  for (const m of moves) {
    const label = m.by && m.kind !== "conclusion" ? (m.kind === "position" ? "פירוש " + m.by : m.by)
      : (MOVES[m.kind] || m.kind);
    const last = runs[runs.length - 1];
    if (last && last.label === label && !m.by) last.n++;
    else runs.push({ label, n: 1, m });
  }
  runs.forEach((r, i) => {
    if (i) shape.append(el("span", "arrow", "←"));
    const t = el("span", "mv " + r.m.kind + (r.m.by ? " by" : ""), r.label + (r.n > 1 ? " ×" + r.n : ""));
    t.title = r.m.marker + " — " + r.m.text.slice(0, 120);
    shape.append(t);
  });
  return shape;
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
    const weight = (name) => (S.pack.weights || {})[name] || 0;
    for (const g of ["על הדף", "ראשונים", "אחרונים", "עוד"]) {
      const rows = (groups[g] || []).sort((a, b) => weight(b[0]) - weight(a[0]) || a[0].localeCompare(b[0]) || byRef(a[1].ref, b[1].ref));
      if (!rows.length) continue;
      panel.append(el("div", "grp", g));
      for (const [name, e] of rows) {
        const box = el("div", "src");
        const who = el("div", "who", heName(name));
        if (e.dibur) who.append(el("span", "dib", e.dibur));
        box.append(who, el("div", "body", e.he));
        const moves = (e.structure && e.structure.moves) || [];
        if (ARGUED.has(name) && moves.length >= 2) box.append(drawShape(moves));
        const meta = el("div", "meta");
        const more = el("button", "more", "הכל");
        more.onclick = () => { box.classList.toggle("open"); more.textContent = box.classList.contains("open") ? "פחות" : "הכל"; };
        const link = el("a", "lnk", e.ref); link.href = sefariaUrl(e.ref); link.target = "_blank"; link.rel = "noopener";
        meta.append(more, link); box.append(meta);
        if (e.ref === focus) { target = box; box.classList.add("open", "flash"); more.textContent = "פחות"; }
        panel.append(box);
      }
    }
    // The Rishonim on this amud that Sefaria hangs on other lines -- the Rosh
    // on this mishna sits on line 12. One tap takes you to them.
    const here = new Set(Object.keys(seg.commentaries));
    const elsewhere = {};
    for (const other of S.pack.segments) {
      if (other.n === seg.n) continue;
      for (const name of Object.keys(other.commentaries))
        if (!here.has(name) && tier(name) === "ראשונים") (elsewhere[name] = elsewhere[name] || []).push(other.n);
    }
    const names = Object.keys(elsewhere).sort((a, b) => weight(b) - weight(a));
    if (names.length) {
      panel.append(el("div", "grp", "ראשונים בשורות אחרות בעמוד"));
      const box = el("div", "others");
      for (const name of names) {
        for (const ln of elsewhere[name].slice(0, 3)) {
          const b = el("button", "chip", heName(name) + " · שורה " + ln);
          b.onclick = () => { selectLine(ln); openSources(ln); };
          box.append(b);
        }
      }
      panel.append(box);
    }
    const related = Object.assign({}, seg.related || {});
    if (seg.halacha && seg.halacha.length) related.Halakhah = [...new Set(seg.halacha.concat(related.Halakhah || []))];
    for (const cat of Object.keys(RELATED_HE)) {
      const refs = related[cat]; if (!refs || !refs.length) continue;
      panel.append(el("div", "grp", RELATED_HE[cat]));
      const box = el("div", "rel");
      for (const r of refs) box.append(textLink(r));
      panel.append(box);
    }
    if (target) setTimeout(() => target.scrollIntoView({ block: "center" }), 60);
  });
}

// A reference that opens its text right here, fetched from Sefaria through the
// server, with Sefaria itself one more tap away.
function textLink(ref) {
  const wrap = el("div", "tl");
  const a = el("button", "tref", ref);
  const body = el("div", "body"); body.hidden = true; body.dir = "rtl";
  a.onclick = async () => {
    if (!body.hidden) { body.hidden = true; return; }
    body.hidden = false;
    if (body.dataset.done) return;
    body.textContent = "פותח…";
    try {
      const r = await fetch("/api/text?ref=" + encodeURIComponent(ref));
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      body.textContent = data.he;
      body.dataset.done = "1";
      // A page of a trusted site links back to the site itself.
      const go = el("a", "lnk", data.url ? "באתר המקור ↗" : "בספריא ↗");
      go.href = data.url || sefariaUrl(ref); go.target = "_blank"; go.rel = "noopener";
      body.append(el("br"), go);
    } catch (e) { body.textContent = "לא הצלחתי להביא את זה מספריא."; }
  };
  wrap.append(a, body);
  return wrap;
}

// A source off the page, opened in the panel -- the Tur the partner cited.
function openText(ref) {
  openPanel((panel) => {
    panel.append(el("h2", null, chipFor(ref).label || ref), el("div", "sub", ref));
    const link = textLink(ref);
    panel.append(link);
    link.querySelector(".tref").click();
  });
}

function openLog() {
  openPanel((panel) => {
    panel.append(el("h2", null, "תמליל"), el("div", "sub", "מה שנאמר בשיחה הזאת"));
    const turns = el("div"); turns.id = "turns";
    panel.append(turns);
    const copy = el("button", "btn", "📋 העתק את כל השיחה");
    copy.onclick = async () => {
      const text = sessionReport();
      try { await navigator.clipboard.writeText(text); copy.textContent = "✓ הועתק — הדבק ל-Claude"; }
      catch (e) { const ta = el("textarea"); ta.value = text; ta.style.width = "100%"; ta.rows = 10;
        panel.append(ta); ta.select(); copy.textContent = "סמן והעתק מהתיבה"; }
    };
    // For a quiet room: say it by typing. The panel stays open and the turn
    // appears here; the answer still comes aloud.
    panel.append(el("div", "grp", "להקליד במקום לדבר"));
    const form = el("form"); form.style.display = "flex"; form.style.gap = "6px";
    const input = el("input"); input.style.flex = "1"; input.className = "btn"; input.placeholder = "מה אתה חושב שכתוב כאן?";
    input.dir = "auto";
    const go = el("button", "btn", "שלח"); go.type = "submit";
    form.append(input, go);
    form.onsubmit = (e) => {
      e.preventDefault();
      const t = input.value.trim(); if (!t) return;
      input.value = "";
      onUtterance({ text: t });
    };
    panel.append(form, el("div", "grp", "לשתף"), copy);
    renderTurns();
    setTimeout(() => input.focus(), 30);
  }, "log");
}

function renderTurns() {
  const box = $("turns"); if (!box) return;
  box.replaceChildren();
  if (!S.log.length) box.append(el("div", "sub", "עוד לא דיברתם."));
  for (const t of S.log) {
    const row = el("div", "turn" + (t.me ? " me" : "") + (t.error ? " err" : ""));
    row.dir = "auto";
    if (t.me) row.textContent = (t.mode === "reading" ? "📖 " : "") + t.text;
    else if (t.error) row.textContent = "⚠ " + t.text;
    else renderRich(row, t.text);
    if (t.trace) row.append(el("span", "trace", "routed: " + t.trace.kind + (t.trace.claim ? " · claim" : "") +
      (t.trace.opened && t.trace.opened.length ? " · opened: " + t.trace.opened.join(", ") : "") +
      (t.trace.fetched && t.trace.fetched.length ? " · fetched: " + t.trace.fetched.join(", ") : "") +
      (t.trace.elsewhere && t.trace.elsewhere.length ? " · elsewhere: " + t.trace.elsewhere.join(", ") : "")));
    box.append(row);
  }
  box.scrollIntoView({ block: "end" });
  const panel = $("panel"); panel.scrollTo({ top: panel.scrollHeight });
}

// The whole sitting as plain text: what was heard, how it was read, what came
// back, which sources it opened, how long each step took. Made to be pasted
// back into a conversation about improving the partner.
function sessionReport() {
  const h = S.health || {};
  const lines = ["# Chavruta session — " + new Date().toLocaleString(),
    "models: " + (h.heavy || "?") + " / " + (h.cheap || "?"),
    "settings: " + JSON.stringify(S.settings), ""];
  for (const t of S.log) {
    if (t.me) {
      const hd = t.heard || {};
      lines.push("## " + (t.at || "") + " · " + (t.ref || "") + " line " + (t.line || "") +
        " · heard as " + (t.mode || "?") + (t.ms_hear ? " (" + t.ms_hear + " ms)" : ""));
      lines.push("ME: " + t.text);
      if (hd.mode && hd.mode !== "talking")
        lines.push("   [aligned: lines " + (hd.from_line || "?") + "-" + (hd.line || "?") + ", coverage " + hd.coverage +
          (hd.stopped_mid_clause ? ", stopped mid-clause, " + hd.words_left_in_clause + " words left" : "") +
          (hd.slips ? ", differs from the page: " + JSON.stringify(hd.slips) : "") + "]");
    } else {
      if (t.interim) { lines.push("CHAVRUTA (while fetching): " + t.text, ""); continue; }
      if (t.error) { lines.push("ERROR at " + t.stage + " after " + t.ms + " ms (" + t.at + "): " + t.detail, ""); continue; }
      lines.push("CHAVRUTA" + (t.ms_answer ? " (" + t.ms_answer + " ms to answer" +
        (t.ms_spoken ? ", " + t.ms_spoken + " ms speaking" : "") + ")" : "") + ":");
      lines.push(t.text);
      const tr = t.trace || {};
      if (tr.kind) lines.push("   [routed: " + tr.kind + (tr.claim ? ", claim" : "") +
        (tr.names && tr.names.length ? ", named " + tr.names.join("/") : "") +
        (tr.quick ? " · quick reply" : "") +
        (tr.opened && tr.opened.length ? " · opened " + tr.opened.join(", ") : "") +
        (tr.fetched && tr.fetched.length ? " · fetched " + tr.fetched.join(", ") + " in " + tr.fetch_seconds + "s" : "") +
        (tr.missed && tr.missed.length ? " · could not fetch " + tr.missed.join(", ") : "") +
        (tr.elsewhere && tr.elsewhere.length ? " · elsewhere " + tr.elsewhere.join(", ") : "") +
        (t.grounded === false ? " · UNGROUNDED" : "") + "]");
      if (tr.first_try) lines.push("   [first try was rejected: " + tr.first_try.problem + "]\n   " + tr.first_try.text);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// What you are learning: your tractates (first in the picker), and each one
// prepared ahead -- every page built in the background -- so it opens at once.
function learningBox() {
  const box = el("div", "set learning");
  box.append(el("div", "lbl", "המסכתות שלי"));
  box.append(el("div", "help", "בחר מה אתה לומד — הן יופיעו ראשונות, וכל מסכת נפתחת איפה שהפסקת. " +
    "״להכין מראש״ בונה את כל הדפים ברקע (כמה דקות למסכת), ואז כל דף נפתח מיד."));
  const row = el("div", "opts");
  const prep = el("div", "prep");
  const drawPrep = async () => {
    prep.replaceChildren();
    for (const name of S.settings.mine) {
      const m = S.masechtot.find((x) => x.name === name); if (!m) continue;
      const line = el("div", "prepline");
      const label = el("span", null, m.he + ": …");
      line.append(label);
      prep.append(line);
      try {
        const s = await (await fetch("/api/prepare?masechta=" + encodeURIComponent(name))).json();
        const ready = s.done >= s.total;
        label.textContent = m.he + ": " + (ready ? "מוכנה ✓" : s.done + " / " + s.total + " דפים" + (s.running ? " — מכין…" : ""));
        if (!ready && !s.running) {
          const go = el("button", "btn", "להכין מראש");
          go.onclick = async () => {
            await fetch("/api/prepare", { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ masechta: name }) });
            drawPrep();
          };
          line.append(go);
        }
        if (s.running) setTimeout(() => { if (S.panel === "settings") drawPrep(); }, 4000);
      } catch (e) { label.textContent = m.he; }
    }
  };
  for (const m of S.masechtot) {
    const b = el("button", "btn", m.he);
    b.dataset.masechta = m.name;
    b.setAttribute("aria-pressed", String(S.settings.mine.includes(m.name)));
    b.onclick = () => {
      const on = !S.settings.mine.includes(m.name);
      S.settings.mine = on ? [...S.settings.mine, m.name] : S.settings.mine.filter((x) => x !== m.name);
      saveSettings();
      b.setAttribute("aria-pressed", String(on));
      fillMasechtot();
      drawPrep();
    };
    row.append(b);
  }
  box.append(row, prep);
  drawPrep();
  return box;
}

// Sites you trust for what Sefaria does not have: read, quoted briefly, cited
// with their address.
function sitesBox() {
  const box = el("div", "set sites");
  box.append(el("div", "lbl", "אתרים מהימנים"));
  box.append(el("div", "help", "למה שאין בספריא: הלכה יומית (פסקי הרב עובדיה), ויקיטקסט (שער הציון, ברכי יוסף, המרדכי). " +
    "הוא בודק שם כשתזכיר אותם (״מה אומר הרב עובדיה?״) או כשתגיד ״תבדוק באתרים״, מצטט משפט ונותן קישור."));
  const list = el("div", "opts");
  const draw = () => {
    list.replaceChildren();
    for (const site of S.settings.sites) {
      const b = el("button", "btn", site + " ✕");
      b.title = "להסיר"; b.dataset.site = site;
      b.onclick = () => { S.settings.sites = S.settings.sites.filter((x) => x !== site); saveSettings(); draw(); };
      list.append(b);
    }
  };
  draw();
  const form = el("form"); form.className = "addsite";
  const input = el("input"); input.className = "btn"; input.placeholder = "example.org"; input.dir = "ltr";
  const add = el("button", "btn", "הוסף"); add.type = "submit";
  form.append(input, add);
  form.onsubmit = (e) => {
    e.preventDefault();
    const site = input.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(site) && !S.settings.sites.includes(site)) {
      S.settings.sites = [...S.settings.sites, site]; saveSettings(); draw();
    }
    input.value = "";
  };
  box.append(list, form);
  return box;
}

// Who sits at the table: tap a name once to always want him (★), again to
// leave him out (⊘), again for neither. Rashi and Tosafot are the page itself.
function seatsBox() {
  const box = el("div", "set seats");
  box.append(el("div", "lbl", "מי ליד השולחן"));
  box.append(el("div", "help", "לחיצה: ★ תמיד כשיש לו מה לומר כאן · ⊘ רק כשאני מבקש · שוב — רגיל. " +
    "רש״י ותוספות תמיד."));
  const mark = { 1: "★ ", "-1": "⊘ " };
  const draw = (b, name, he) => {
    const v = S.settings.favor[name] || 0;
    b.textContent = (mark[v] || "") + he;
    b.dataset.v = v;
    b.setAttribute("aria-pressed", String(v === 1));
  };
  fetch("/api/table").then((r) => r.json()).then(({ table }) => {
    for (const { group, names } of table) {
      box.append(el("div", "sub", group));
      const row = el("div", "opts");
      for (const { name, he } of names) {
        const b = el("button", "btn seat");
        b.title = name;
        draw(b, name, he);
        b.onclick = () => {
          const v = S.settings.favor[name] || 0;
          const next = v === 0 ? 1 : v === 1 ? -1 : 0;
          S.settings.favor = Object.assign({}, S.settings.favor);
          if (next) S.settings.favor[name] = next; else delete S.settings.favor[name];
          saveSettings();
          draw(b, name, he);
        };
        row.append(b);
      }
      box.append(row);
    }
    const reset = el("button", "btn", "לאפס");
    reset.onclick = () => { S.settings.favor = {}; saveSettings(); openSettings(); };
    box.append(reset);
  }).catch(() => box.append(el("div", "help", "לא הצלחתי לטעון את הרשימה.")));
  return box;
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
        if (key === "rate" && player) player.playbackRate = rate();
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
      choice("open", "בפתיחה", [["last", "איפה שהפסקתי"], ["today", "הדף היומי"]],
        "📅 למעלה תמיד מביא לדף היומי. הוא נבנה מראש כל בוקר (וגם של מחר) כל עוד האפליקציה פתוחה."),
      learningBox(),
      choice("depth", "עומק", [["daf", "הדף — רש״י ותוספות"], ["rishonim", "+ ראשונים"], ["acharonim", "+ אחרונים"]],
        "מה החברותא מביא בעצמו. אם תשאל על מפרש מסוים, הוא יביא אותו בכל מקרה."),
      choice("voices", "כמה קולות בתשובה", [[1, "אחד"], [2, "שניים"], [3, "שלושה"], [5, "רחב"]],
        "כמה מפרשים מעבר לרש״י ותוספות הוא פותח בעצמו לכל שאלה (בהלכה — קצת יותר, בשביל השרשרת)."),
      seatsBox(),
      sitesBox(),
      choice("sites_halacha", "בכל שאלת הלכה — לבדוק גם בהלכה יומית", [[true, "כן"], [false, "רק כשאני מבקש"]],
        "מוסיף כמה שניות וכמה אגורות לשאלה."),
      choice("language", "שפת התשובה", [["en", "English"], ["he", "עברית"], ["auto", "כמוני"]],
        "באנגלית הוא מצטט את הגמרא בעברית, בתוך המשפט — כמו שמדברים בבית המדרש."),
      choice("view", "תצוגת הדף", [["daf", "צורת הדף"], ["lin", "שטיינזלץ, מנוקד"]]),
      choice("translate", "תרגום (בתצוגת שטיינזלץ)", [[false, "בלי"], [true, "עם תרגום"]]),
      choice("stops", "לסמן עצירות", [[false, "לא"], [true, "כן"]], "איפה המשפט נגמר. כבוי כברירת מחדל — זה חלק מהלימוד."),
      choice("pause", "כמה לחכות לפני שאני עונה", [["short", "קצר"], ["normal", "רגיל"], ["long", "ארוך"]],
        "אם הוא קוטע אותך באמצע מחשבה — בחר ארוך."),
      choice("nudges", "הערות יזומות", [[true, "כן"], [false, "לא"]], "בסוף יחידה (משנה, ברייתא), כשיש בה מחלוקת מפרשים."),
      choice("checks", "לשאול על מילה שיצאה אחרת", [[true, "כן"], [false, "לא"]],
        "כשאמרת מילה אחרת מהכתוב (מעשר במקום תרומה) — לא על מבטא או הגייה."),
      choice("speak", "שיענה בקול", [[true, "כן"], [false, "לא"]]),
      choice("rate", "מהירות הדיבור", [[0.85, "לאט"], [1, "רגיל"], [1.15, "קצת מהר"], [1.3, "מהר"], [1.5, "מהר מאוד"]],
        "אפשר גם להגיד לו: ״תדבר יותר מהר״ / ״a bit slower״."),
      choice("voice", "קול", [["natural", "טבעי (OpenAI) — תמיד אותו קול"], ["browser", "הדפדפן (חינם, רובוטי)"]]),
      choice("speakers", "שמע", [[false, "אוזניות"], [true, "רמקול"]],
        "ברמקול, בזמן שאני מדבר אני לא מקשיב (אחרת אני שומע את עצמי). לעצור: ⏸ או רווח."),
      choice("hearing", "זיהוי דיבור", [["api", "מדויק, עברית ואנגלית יחד"], ["browser", "הדפדפן (חינם, שפה אחת)"]]),
    );
    const k = el("div", "set"); k.append(el("div", "lbl", "מקשים"));
    const keys = el("div", "kbd");
    keys.innerHTML = "<kbd>רווח</kbd> מיקרופון · <kbd>←</kbd> <kbd>→</kbd> עמוד הבא / הקודם · " +
      "<kbd>↑</kbd> <kbd>↓</kbd> שורה · <kbd>Esc</kbd> סגור";
    k.append(keys); panel.append(k);
  }, "settings");
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
  if (e.key === "Escape") return speakingDone ? stopSpeaking() : closePanel();
  if (e.key === " ") { e.preventDefault(); return speakingDone ? pauseSpeaking() : $("mic").click(); }
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
  today();                // the 📅 button shows today's daf by name
  lastTime();             // "last time you learned ... -- a quick review?"
  if (S.settings.open === "today" && (await today())) return openToday();
  turnTo(valid ? last : pickedRef());
})();
