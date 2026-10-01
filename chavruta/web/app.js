"use strict";
/* חברותא — turn to a page, read it aloud, talk about it.

   The page is the centre. The conversation happens out loud; the screen is a
   companion you glance at: where you are, what it heard you read, the words it
   is pointing at, the sources it cites. */

const $ = (id) => document.getElementById(id);
// One set of line icons (the sprite in index.html), sized and coloured like the text around them.
function icon(name, cls) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ic" + (cls ? " " + cls : ""));
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#i-" + name);
  svg.append(use);
  return svg;
}
// A button: an icon, and words when there is room for them.
function ibtn(cls, name, text, title) {
  const b = el("button", cls);
  b.append(icon(name));
  if (text) b.append(el("span", null, text));
  if (title) { b.title = title; b.setAttribute("aria-label", title); }
  return b;
}
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

/* ---------------------------------------------------------------- settings */

const DEFAULTS = { view: "daf", depth: "daf", language: "en", voice: "natural",
  hearing: "api", speak: true, pause: "normal", nudges: true, checks: true, translate: false, stops: false,
  speakers: false, rate: 1, favor: {}, voices: 3, open: "last", mine: [], explain: "stz", script: "plain", voice_name: "cedar",
  sites: ["halachayomit.co.il", "he.wikisource.org", "dafyomi.co.il"], sites_halacha: true };
const PAUSES = { short: 1000, normal: 1500, long: 2400 };
function loadSettings() {
  let s;
  try { s = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem("chavruta.settings") || "{}")); }
  catch (e) { s = Object.assign({}, DEFAULTS); }
  // Sites added to the defaults after a list was saved join it once.
  if (!s.sites_seen) { s.sites = [...new Set([...s.sites, ...DEFAULTS.sites])]; s.sites_seen = 1; }
  if (!["cedar", "verse"].includes(s.voice_name)) s.voice_name = "cedar";   // the voices on offer
  return s;
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
  else if (h.sefaria === false) setStatus("warn", "הספרייה לא זמינה", "דפים שכבר נפתחו עדיין עובדים");
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
    if (back) return turnTo(back, +recall("line." + back) || 1);
    fillDapim(); turnTo(pickedRef());
  };
  $("today").onclick = openToday;
  $("daf").onchange = () => turnTo(pickedRef());
  $("am-a").onclick = () => { setAmud("a"); turnTo(pickedRef()); };
  $("am-b").onclick = () => { setAmud("b"); turnTo(pickedRef()); };
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
    const again = el("button", "chip", "חזרה על מה שלמדנו");
    again.onclick = () => onUtterance({ text: he ? "תזכיר לי מה למדנו בפעם הקודמת" : "Remind me what we learned last time" });
    const test = el("button", "chip", "שאלות חזרה");
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
  fetch("/api/progress").then((r) => r.json()).then((p) => {
    if (p.daf_yomi && p.daf_yomi.done) $("today-label").textContent = (S.today ? S.today.he : "") + " ✓";
    if (p.streak > 1) $("today").title = "הדף היומי · " + p.streak + " ימים ברצף";
  }).catch(() => {});
  return S.today;
}
async function openToday() {
  const t = await today();
  if (t && t.amudim && t.amudim.length) return turnTo(t.amudim[0]);
  const box = $("loading"); box.hidden = false;
  box.textContent = t ? "הדף היומי היום (" + t.he + ") לא נמצא בספרייה." : "לא הצלחתי לברר מה הדף היומי.";
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
    selectLine(line || 1, { scroll: line > 1 ? "line" : "top" });   // back where you were
  } catch (e) {
    if (token === opening) pageError(ref, "network");
  }
}

function pageError(ref, code) {
  const box = $("loading");
  box.hidden = false; box.replaceChildren();
  const msg = { sefaria_unreachable: "לא הצלחתי להגיע לספרייה. בדוק את החיבור לאינטרנט.",
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
  drawNotes();
  if (DESK.page === undefined) {         // the first page: the ★ layout, if there is one
    const auto = layouts().find((l) => l.auto);
    if (auto) applyLayout(auto);
  }
  if (DESK.page !== S.pack.ref) {        // the same commentators, on the new page
    DESK.page = S.pack.ref;
    for (const c of DESK.cards) delete c.scroll;
  }
  renderDesk();
}

// Your notes: a note mark on the line each belongs to; tap to read it.
async function drawNotes(fresh) {
  if (!S.pack) return;
  const ref = S.pack.ref;
  if (!fresh) {
    try { S.notes = (await (await fetch("/api/notes?ref=" + encodeURIComponent(ref))).json()).notes || []; }
    catch (e) { S.notes = []; }
    if (!S.pack || S.pack.ref !== ref) return;
  }
  document.querySelectorAll(".note-mark").forEach((m) => m.remove());
  const main = S.settings.view === "daf" ? $("gtext") : $("linear");
  const byLine = {};
  for (const n of S.notes || []) (byLine[n.line] = byLine[n.line] || []).push(n);
  for (const [line, list] of Object.entries(byLine)) {
    const node = main && main.querySelector('[data-n="' + line + '"]');
    if (!node) continue;
    const mark = el("button", "note-mark");
    mark.append(icon("note"));
    mark.title = list.map((n) => n.text).join("\n—\n");
    mark.setAttribute("aria-label", "ההערה שלך");
    mark.onclick = (e) => { e.stopPropagation(); showReply(list.map((n) => "הערה: " + n.text).join("\n\n"), { hint: true }); };
    node.append(mark);
  }
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
  // The column carries its own commentator's name; another work printed in
  // the same margin (Rabbeinu Chananel beside Tosafot) is named on each of
  // its comments -- they are two commentaries, not one.
  col.append(el("div", "colname", heName(present[0] || names[0])));
  let any = false;
  for (const seg of S.pack.segments) {
    for (const name of names) {
      for (const e of seg.commentaries[name] || []) {
        any = true;
        const c = el("div", "c"); c.dataset.n = seg.n; c.dataset.ref = e.ref;
        if (name !== (present[0] || names[0])) { c.classList.add("other"); c.append(el("span", "who", heName(name))); }
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

// The Steinsaltz view, as Sefaria shows him (and as learners know him): one
// paragraph a line, the daf's own words bold, his words plain in the same
// ink. His translations of the Aramaic (Sefaria's [brackets]) are set without
// the brackets, smaller and in another face -- a quiet gloss under the voice
// of the text; a verse reference is small print. Which words are the daf's
// comes from Sefaria's own bold, kept when the page is built. Those words are
// the same word-spans as everywhere, so reading along and quotes still find
// them. Above: Steinsaltz / the pointed daf alone.
const CITE_LIKE = /^[^()]{0,24}[א-ת]{1,3}["׳״']?[א-ת]?\s*,\s*[א-ת]{1,3}["׳״']?[א-ת]?$|^[א-ת]{1,4}["״][א-ת]{1,2}$/;
function stzText(box, text) {
  for (const piece of text.split(/(\([^)]*\))/)) {
    if (!piece) continue;
    const m = piece.match(/^\((.*)\)$/);
    if (!m) { box.append(document.createTextNode(piece)); continue; }
    box.append(el("span", CITE_LIKE.test(m[1].trim()) ? "cite" : "tr", m[1].trim()));
  }
}
function steinsaltz(seg) {
  const parts = (seg.commentaries.Steinsaltz || []).flatMap((e) => e.parts || []);
  if (!parts.length) return null;
  const gem = [...words(seg.he, seg.n, false).childNodes].filter((x) => x.classList && x.classList.contains("w"));
  const box = el("div", "stz");
  box.dir = "rtl";
  const daf = [];
  for (const p of parts) {
    if (p.kind === "head") {
      const label = p.text.replace(/^\s*[א-ת]{1,2}(?=\s|$)/, "").trim();      // his paragraph letter
      if (label) box.append(el("span", "stz-head", label), document.createTextNode(" "));
    } else if (p.kind === "tr") {
      const t = p.text.replace(/[\[\]]/g, "");
      if (t.trim()) box.append(el("span", "tr", t));
    } else if (p.kind === "text") {
      stzText(box, p.text);
    } else {
      for (const tok of p.text.split(/(\s+)/)) {
        if (!tok) continue;
        if (/^\s+$/.test(tok)) { box.append(document.createTextNode(tok)); continue; }
        const d = el("b", "d", tok);
        box.append(d); daf.push(d);
      }
    }
  }
  // Each bold word takes the place of its word on the daf (so reading along
  // finds it); a daf word he split ("ו" + "לא") or skipped stays, unseen.
  let gi = 0;
  for (let i = 0; i < daf.length; i++) {
    const k = norm(daf[i].textContent);
    if (!k) continue;
    let hit = -1, joined = false;
    for (let d = 0; d < 4 && gi + d < gem.length && hit < 0; d++) {
      if (gem[gi + d].dataset.k === k) hit = gi + d;
      else if (k.length <= 2 && daf[i + 1] && gem[gi + d].dataset.k === k + norm(daf[i + 1].textContent)) { hit = gi + d; joined = true; }
    }
    if (hit < 0) continue;
    const at = joined ? daf[++i] : daf[i];
    for (; gi < hit; gi++) { gem[gi].classList.add("ghost"); at.before(gem[gi]); }
    const w = gem[gi++];
    w.textContent = at.textContent; w.classList.add("d");
    at.replaceWith(w);
  }
  for (; gi < gem.length; gi++) { gem[gi].classList.add("ghost"); box.append(gem[gi]); }
  return box;
}

function renderLinear() {
  const box = $("linear");
  box.hidden = false; box.replaceChildren();
  // Steinsaltz, or the pointed daf alone.
  const bar = el("div", "ex-bar");
  const seg2 = el("span", "seg2 small");
  for (const [v, label] of [["stz", "שטיינזלץ"], ["off", "גמרא מנוקדת"]]) {
    const b = el("button", "btn", label);
    b.setAttribute("aria-pressed", String((S.settings.explain === "off" ? "off" : "stz") === v));
    b.onclick = (e) => { e.stopPropagation(); S.settings.explain = v; saveSettings(); render(); selectLine(S.line); };
    seg2.append(b);
  }
  bar.append(seg2);
  box.append(bar);
  const woven = S.settings.explain !== "off";
  for (const seg of S.pack.segments) {
    const line = el("div", "line"); line.dataset.n = seg.n;
    const stz = woven ? steinsaltz(seg) : null;
    if (stz) { line.classList.add("stzline"); line.append(stz); }
    else { const he = el("div", "he"); he.append(words(seg.he, seg.n, true)); line.append(he); }
    const en = el("div", "en");
    for (const s of seg.en || []) en.append(el("span", s.kind === "daf" ? "" : "add", s.text + " "));
    line.append(en);
    line.onclick = () => selectLine(seg.n);
    box.append(line);
  }
  applyToggles();
}

// Rashi script, or plain letters: for the commentaries on the page only, for
// every commentary, or (the default) for none.
function applyScript() {
  document.body.classList.toggle("rashi-page", S.settings.script === "page");
  document.body.classList.toggle("rashi-all", S.settings.script === "all");
}

function applyToggles() {
  const lin = $("linear"), daf = $("page");
  lin.classList.toggle("showen", S.settings.translate);
  lin.dataset.explain = S.settings.explain || "stz";
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
  remember("line." + S.pack.ref, S.line);        // to pick up at this line next time
  for (const node of document.querySelectorAll(".seg, .line, .c"))
    node.classList.toggle("on", +node.dataset.n === S.line);
  const sec = sectionOf(S.line);
  $("where").textContent = "שורה " + S.line + " מתוך " + max +
    (sec && sec.label ? " · " + sec.label + " (" + sec.from + "–" + sec.to + ")" : "");

  const main = S.settings.view === "daf" ? $("col-gemara") : $("linear");
  const node = main.querySelector('[data-n="' + S.line + '"]');
  if (S.settings.view === "lin" && node && opts.scroll !== "top")
    // Its explanation opens below it: once it has, keep both in view.
    setTimeout(() => { if (!visible(node, main)) node.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 320);
  if (opts.scroll === "top") main.scrollTop = 0;
  else if (node && opts.scroll !== "side" && !visible(node, main))
    node.scrollIntoView({ block: "center", behavior: "smooth" });

  deskHere();
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

function showMine(text, interim, reading) {
  const m = $("mine");
  m.hidden = !text; m.textContent = text || "";
  m.classList.toggle("interim", !!interim);
  if (text && reading) m.prepend(icon("book"));      // read from the page, not said to it
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
  if (!opts.hint) wordify(r);
  if (!opts.hint) {
    // Cut off by your own reading, or missed: hear it again.
    const again = ibtn("chip again", "sound", "שוב", "להשמיע שוב");
    again.onclick = () => say(text);
    chips.append(again);
  }
  if (opts.grounded === false) chips.append(el("span", "chip warn", "לא נמצא מקור — אל תסמוך על זה"));
}

/* ------------------------------------------------------- following along */

// While it speaks, the words follow the voice: the sentence being said is in
// full ink, the rest a shade softer, and a soft mark moves word by word -- and
// the conversation scrolls itself to keep that word in view (unless you have
// just scrolled it yourself). In use a long answer ran on below the fold.
const WORDY = /[\p{L}\p{N}]/u;
function wordify(box) {
  const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest("button") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const nodes = [];
  while (walk.nextNode()) nodes.push(walk.currentNode);
  for (const node of nodes) {
    const frag = document.createDocumentFragment();
    for (const tok of node.textContent.split(/(\s+)/)) {
      if (!tok) continue;
      if (WORDY.test(tok)) frag.append(el("span", "sw", tok)); else frag.append(document.createTextNode(tok));
    }
    node.replaceWith(frag);
  }
}
const wordsIn = (text) => (text || "").replace(/\[\[[^\]]+\]\]/g, " ").split(/[\s|«»]+/).filter((w) => WORDY.test(w)).length;

let followAt = null;
function follow() {
  const r = $("reply"), now = S.now, t = shownTurn();
  const on = !!(now && t && now.turn === t && now.idx !== undefined && t.parts && t.parts[now.idx] !== undefined);
  r.classList.toggle("speaking", on);
  const ws = r.querySelectorAll(".sw");
  if (!on) { for (const w of r.querySelectorAll(".sw.in, .sw.cur")) w.classList.remove("in", "cur"); followAt = null; return; }
  const counts = t.parts.map(wordsIn);
  const start = counts.slice(0, now.idx).reduce((a, b) => a + b, 0), n = counts[now.idx] || 0;
  const cur = now.frac === null ? -1 : start + Math.min(Math.max(n - 1, 0), Math.floor(now.frac * n));
  const key = start + ":" + cur + ":" + ws.length;
  if (key === followAt) return;
  followAt = key;
  ws.forEach((w, k) => { w.classList.toggle("in", k >= start && k < start + n); w.classList.toggle("cur", k === cur); });
  const target = ws[cur >= 0 ? cur : start];
  const talk = $("talk");
  if (target && Date.now() - (S.userScrolled || 0) > 3500) {
    const a = target.getBoundingClientRect(), b = talk.getBoundingClientRect();
    if (a.bottom > b.bottom - 6 || a.top < b.top + 2)
      talk.scrollBy({ top: a.top - b.top - talk.clientHeight * 0.3, behavior: "smooth" });
  }
}
// Where the voice is in the sentence it is saying.
setInterval(() => {
  const now = S.now;
  if (!now || now.frac === null || !player || !player._syl) return;
  const d = isFinite(player.duration) && player.duration > 0 ? player.duration
    : player._syl / ((usualPace() || 3.4) * (player.playbackRate || 1));
  now.frac = Math.min(0.999, player.currentTime / d);
  follow();
}, 120);
for (const ev of ["wheel", "touchmove"]) $("talk").addEventListener(ev, () => { S.userScrolled = Date.now(); }, { passive: true });

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

// One pace for every sentence, Hebrew or English. Each sentence is voiced on
// its own, and the voice's natural pace differs from one to the next -- in use
// Hebrew often came out slower than English at the same setting. So each
// clip's pace is measured (syllables a second, counted the same way for both
// languages), and it plays at the usual pace times the chosen speed; the
// correction is kept within bounds so a voice never sounds pulled.
const PACES = [];                     // natural paces heard so far, syllables/second
function syllables(text) {
  let n = 0;
  for (const w of speakable(text).split(/\s+/)) {
    const he = w.replace(/[^\u05d0-\u05ea]/g, ""), en = w.toLowerCase().replace(/[^a-z]/g, "");
    if (he) n += Math.max(1, Math.round(he.length / 1.8));
    else if (en) n += Math.max(1, (en.match(/[aeiouy]+/g) || []).length - (/[^aeiouy]e$/.test(en) ? 1 : 0));
    else if (/\d/.test(w)) n += 2;
  }
  return n;
}
function usualPace() {
  if (PACES.length < 3) return null;
  const sorted = [...PACES].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
function pace(audio) {
  if (!audio) return;
  const d = audio.duration, syl = audio._syl || 0;
  const natural = isFinite(d) && d > 0.4 && syl ? syl / d : null, usual = usualPace();
  const fix = natural && usual ? Math.min(1.3, Math.max(0.8, usual / natural)) : 1;
  audio.playbackRate = rate() * fix;
  audio._fix = fix;
}
function heardPace(audio) {
  const d = audio && audio.duration, syl = audio && audio._syl;
  if (isFinite(d) && d > 0.8 && syl >= 4) { PACES.push(syl / d); if (PACES.length > 30) PACES.shift(); }
}

// ⏸ / ▶ -- stopping it without having to talk over it.
function pauseSpeaking() {
  if (!speakingDone) return;
  paused = !paused;
  if (player) { if (paused) player.pause(); else player.play().catch(() => {}); }
  if (window.speechSynthesis) { if (paused) speechSynthesis.pause(); else speechSynthesis.resume(); }
  showHold();
  setMode(paused ? "paused" : "speaking", paused ? "עצרתי — רווח כדי להמשיך, או פשוט דבר." : "מדבר…");
}

function showHold() {
  const b = $("hold");
  b.hidden = !speakingDone;
  b.replaceChildren(icon(paused ? "play" : "pause", paused ? "solid" : ""));
  b.title = paused ? "להמשיך (רווח)" : "לעצור (רווח)";
  b.setAttribute("aria-label", paused ? "להמשיך" : "לעצור");
}

// Ask the server to make an item's voice, and start fetching the audio, before
// it is its turn -- so it is ready the moment the one before it ends.
function prepare(item) {
  if (item.ready) return item.ready;
  item.ready = (async () => {
    const r = await fetch("/api/voice", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: item.text, ref: S.pack && S.pack.ref, whole: !!(item.turn && item.turn.whole),
        voice_name: S.settings.voice_name }) });
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
      player._syl = syllables(text);
      player.preservesPitch = true;
      pace(player);
      // The length is known only once the voice is all here: set the pace then.
      player.ondurationchange = () => pace(audio);
      player.onended = () => { heardPace(audio); stopSpeaking(); };
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
    syncMic();
    // Opened while it talks: it listens, and goes on talking.
    if (speakingDone) $("state").textContent = "מקשיב · אפשר לדבר מעליי";
    else setMode("listening", "מקשיב… קרא מהדף, או תגיד מה אתה חושב שכתוב.");
  } finally { S.starting = false; }
}

// The mic closed, and only the mic: the answer being said goes on.
function muteMic() {
  S.listening = false;
  if (ears) ears.stop();
  ears = null;
  syncMic();
  if (speakingDone) $("state").textContent = "המיקרופון סגור · ממשיך לדבר";
  else setMode("idle", "המיקרופון סגור — לחיצה פותחת.");
}
function syncMic() {
  const m = $("mic");
  m.classList.toggle("muted", !S.listening);
  m.setAttribute("aria-pressed", String(!!S.listening));
  const use = m.querySelector("use");
  if (use) use.setAttribute("href", S.listening ? "#i-mic" : "#i-mic-off");
}

// A long press: a clean stop -- nothing half-heard, nothing waiting, nothing talking.
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
  for (const t of S.turns) if (open(t)) dropTurn(t);
  renderBar();
  hearChain = Promise.resolve();
  showMine("");
  syncMic();
  setMode("idle", "המיקרופון כבוי. לחץ כדי להמשיך.");
}

function micDenied() {
  S.listening = false;
  syncMic();
  setMode("idle", "צריך אישור למיקרופון — לחץ על סמל המנעול בשורת הכתובת ואפשר מיקרופון.", true);
}

// Talking over it stops it at once -- and holds its place. What they said
// decides what happens next (see "cutting in", below): an "um" or a cough
// and it says that sentence again and goes on.
function onBarge() {
  if (saying && saying.turn && open(saying.turn) && !saying.turn.held) holdTurn(saying.turn, "barge");
  else stopSpeaking();
}

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
    if (["interim", "part", "read", "cut_in"].includes(msg.mode)) onLine(msg); else last = msg;
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
  if (/sefaria/.test(code)) return "לא הצלחתי להגיע לספרייה.";
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
  } catch (e) { if (g === S.gen) { failed(e, "hear", t0); goOn(); } return; }
  finally { aborts.delete(ctl); }
  if (g !== S.gen) return;
  if (!heard.said || heard.mode === "silence") { goOn(); return idleMode(); }
  if (heard.mode === "echo") {
    // It heard its own voice through the speakers. Twice, and it stops
    // listening while it talks (speaker mode); ⏸ is how to stop it then.
    S.echoes = (S.echoes || 0) + 1;
    if (S.echoes >= 2 && !S.settings.speakers) {
      S.settings.speakers = true; saveSettings();
      showReply("נשמע שאין אוזניות — שמעתי את עצמי. מעכשיו, בזמן שאני מדבר אני לא מקשיב; לעצור אותי: כפתור העצירה או רווח.", { hint: true });
      logPush({ me: false, error: true, stage: "echo", text: "עברתי למצב רמקול (בלי אוזניות).", detail: "heard itself twice",
        ms: 0, at: new Date().toLocaleTimeString() });
    }
    goOn();
    return idleMode();
  }

  // Read on past the last line into the next amud: the page turns with you.
  if (heard.turn && (!S.pack || S.pack.ref !== heard.turn)) await turnTo(heard.turn, heard.line);
  logPush({ me: true, text: heard.said, mode: heard.mode, ref: S.pack.ref, line: heard.line || S.line,
    heard: heard.heard, ms_hear: Math.round(performance.now() - t0), at: new Date().toLocaleTimeString() });
  if (heard.line) selectLine(heard.line, { scroll: "side" });
  markRead(heard.heard);
  // "Go back to what you were saying" -- the answer that was held.
  const offered = S.offerResume; S.offerResume = null;
  if (heard.mode === "talking" && (RESUME.test(heard.said) || (offered && offered.held && YES.test(heard.said)))) {
    const t = (offered && offered.held) ? offered : S.turns.filter((x) => x.held && open(x)).pop();
    if (t) { resumeTurn(t, true); return; }
  }
  // "I'm still waiting" while it gathers: a word back at once, and it keeps
  // working. In use it was taken as a new question and the work was lost.
  const busy = S.turns.find((t) => open(t) && !t.text && ["thinking", "answering"].includes(t.status));
  if (heard.mode === "talking" && busy && STILL.test(heard.said)) {
    const he = S.settings.language === "he" || (S.settings.language === "auto" && /[א-ת]/.test(heard.said));
    answered(heard.said, he ? "עוד רגע — אני עדיין אוסף את זה." : "Still on it — almost there.", { kind: "still working" });
    return;
  }
  if (S.pendingSettings && heard.mode === "talking") {
    // The answer to "turn my voice off?"
    const changes = S.pendingSettings; S.pendingSettings = null;
    const he = S.settings.language === "he";
    if (/^\W*(yes|yeah|yep|sure|ok(ay)?|confirm|do it|כן|בטח|אישור|תכבה)\b/i.test(heard.said)) {
      answered(heard.said, applySettings(changes, he), { kind: "settings" });
      return goOn();
    }
    if (/^\W*(no|nope|cancel|don'?t|never mind|לא|עזוב|בטל)\b/i.test(heard.said)) {
      answered(heard.said, he ? "בסדר, משאיר את הקול." : "OK, I'll keep talking.", { kind: "settings" });
      return goOn();
    }
  }
  // "Never mind" / "I wasn't talking to you": the last thing asked is taken back.
  if (heard.mode === "talking" && DISCARD.test(heard.said)) {
    const t = S.turns.filter((x) => x.asked && !x.discarded && x.status !== "skipped" && !x.quickly).pop();
    if (t) {
      discardTurn(t);
      const he = S.settings.language === "he" || (S.settings.language === "auto" && /[א-ת]/.test(heard.said));
      answered(heard.said, he ? "בסדר, עזבתי." : "OK — dropped it.", { kind: "discarded" });
      return;
    }
  }
  if (heard.ignore) { goOn(); return idleMode(); }   // "um", "okay": nothing to answer

  if (heard.skip) {
    // "Enough" / "skip" -- talking already stopped the voice; drop the rest.
    skipCurrent();
    for (const h of S.turns.filter((x) => x.held === "barge")) dropTurn(h);
    const t = S.turns.find(open);
    if (t && t.status !== "thinking" && t.status !== "waiting") dropTurn(t);
    renderBar();
    return idleMode();
  }
  if (heard.rate) {
    // "Talk a bit faster" / "slower".
    const text = setRate(heard.rate);
    answered(heard.said, text, { kind: "speed" });
    return goOn();
  }
  if (heard.again) {
    // "What?" / "I didn't hear you": say the last answer again.
    const last = S.lastSaid || (S.settings.language === "he" ? "עוד לא אמרתי כלום." : "I haven't said anything yet.");
    answered(heard.said, last, { kind: "said again" });
    return goOn();
  }
  if (heard.note) { (S.notes = S.notes || []).push(heard.note); drawNotes(true); }
  if (heard.quick) {
    // "Hey", "can you hear me?", "go ahead": answered at once, no thinking.
    answered(heard.said, heard.quick, { kind: "small talk" });
    return goOn();
  }
  if (heard.mode === "reading") {
    // Reading on over it: they have moved on. The answer waits in the queue.
    for (const h of S.turns.filter((x) => x.held === "barge")) h.held = "park";
    renderBar();
    showMine(heard.said, false, "reading");
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

/* ------------------------------------------------------------ cutting in */

// Speaking over an answer that is still being said. It stops at once and
// holds its place; what was said is then judged, with the answer it cut into
// (the router does it, in the same quick call that sorts every question):
//   aside  -- "wait, what's chatzot?": answered in a breath, then "as I was
//             saying" and on from the sentence it stopped in;
//   merge  -- "no, I mean in the Rambam": the rest is dropped, and the question
//             as it now stands is answered, carrying on from what was heard;
//   new    -- another question: answered now; the unfinished answer waits in
//             the queue ("go back" / "תמשיך במה שאמרת", or tap it);
//   later  -- "let's come back to that": kept in the queue, and on it goes.
// In use a clarifying question waited behind the whole of a long answer.
const RESUME = /\b(go back|where were we|back to (it|that|what you were saying)|(continue|finish) (what you were saying|your answer|that)|as you were saying)\b|תמשיך (במה|את מה|מאיפה) ש|תחזור ל(מה ש|זה)|איפה היינו|נחזור למה ש|תסיים את מה ש/i;
const STILL = /^\W*((i'?m |i am )?still waiting|(hello|hey)\W*$|are you (still )?(there|with me)|what'?s taking (so long|you)|is it (coming|working)|anything yet|any news|נו|אני (עדיין )?מחכה|עדיין מחכה|אתה (עדיין )?(שם|איתי)|הלו|מה קורה עם זה)\b/i;
const DISCARD = /^\W*(never ?mind|forget (it|that|about (it|that)|what i (just )?said)|ignore (that|it|what i (just )?said)|scratch that|cancel (that|it|the question)|(i was )?not (talking|speaking) to you|(i )?wasn'?t (talking|speaking) to you|disregard( that)?|לא משנה|עזוב|תעזוב|תתעלם( מזה)?|בטל|תבטל|לא דיברתי אליך|לא אליך|תשכח מזה|לא חשוב)\W*$/i;
const YES = /^\W*(yes|yeah|yep|sure|ok(ay)?|please|go ahead|go on|continue|כן|בטח|יאללה|סבבה|תמשיך|קדימה)\b/i;
S.later = [];

// Is this turn still being said -- now, next, or still being written?
function unsaid(t) {
  return open(t) && t.held !== "park" && (t.held || (saying && saying.turn === t) ||
    speechQ.some((i) => i.turn === t) || ((t.status === "answering" || t.status === "thinking") && !t.complete));
}

// Stop it where it is and keep the rest, the interrupted sentence first.
function holdTurn(t, why) {
  t.held = why || "cut";
  t.parked = t.parked || [];
  for (let i = 0; i < speechQ.length; i++)
    if (speechQ[i].turn === t) { t.parked.push(speechQ.splice(i, 1)[0]); i--; }
  if (saying && saying.turn === t) { saying.cut = true; stopSpeaking(); }
  renderBar();
}

// Pick it up again: from the sentence it stopped in, with a word of bridge.
function resumeTurn(t, bridge) {
  if (!t || !t.held) return;
  t.held = false;
  const items = t.parked || [];
  t.parked = [];
  if (bridge && items.length) {
    const he = S.settings.language === "he" || (S.settings.language === "auto" && /[א-ת]/.test(t.text));
    const b = { text: he ? "אז, כמו שאמרתי —" : "So, as I was saying —", turn: t, g: S.gen, bridge: true };
    b.done = new Promise((r) => { b.resolve = r; });
    items.unshift(b);
  }
  speechQ.push(...items);
  if (!items.length) finishTurns();
  renderBar();
  pump();
}

// After a barge that turned out to be nothing to answer: go on.
function goOn() {
  for (const t of S.turns.filter((x) => x.held === "barge")) resumeTurn(t, false);
}

// "Want me to go back to what I was saying?" -- after a new question.
function offerResume(t) {
  if (!t || !t.held) return;
  const he = S.settings.language === "he" || (S.settings.language === "auto" && /[א-ת]/.test(t.text));
  S.offerResume = t;
  say(he ? "רוצה שאחזור למה שאמרתי קודם?" : "Want me to go back to what I was saying?");
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
function goOnFrom(t) { if (t && t.held) resumeTurn(t, true); }

// Taken back -- by "never mind", or the ✕ beside it: not answered (or no
// longer), gone from the queue, and forgotten by the partner, as if it had
// not been said. An answer it had cut into goes on.
function discardTurn(t) {
  if (!t || t.discarded) return;
  t.discarded = true; t.replaced = true;
  if (t.ctl) t.ctl.abort();
  for (let i = asks.length - 1; i >= 0; i--) if (asks[i].turn === t) asks.splice(i, 1);
  if (saying && saying.turn === t) stopSpeaking();
  dropTurn(t);
  for (const e of S.log) if (e.me && e.text === t.asked) e.discarded = true;
  logPush({ me: false, text: "(" + t.asked.slice(0, 60) + " — בוטל)", trace: { kind: "discarded", quick: true } });
  fetch("/api/forget", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: S.session, said: t.asked }) }).catch(() => {});
  if (t.cutInto && t.cutInto.held) resumeTurn(t.cutInto, true);
  renderBar();
  idleMode();
}

function answered(asked, text, trace) {
  const t = newTurn(asked, "answering");
  t.text = text; t.complete = true; t.parts = [text]; t.quickly = true;
  if (trace && trace.kind === "nudge") t.nudge = true;
  logPush({ me: false, text, trace: Object.assign({ quick: true }, trace), ms_answer: 0 });
  S.lastSaid = text;
  say(text, t, 0);
  renderBar();
}

// The turn in the bar: the one being said, or else the oldest still coming.
function shownTurn() {
  if (saying && saying.turn) return saying.turn;
  return S.turns.find((t) => open(t) && !t.held) || S.turns.find(open) || S.turns[S.turns.length - 1];
}

function renderBar() {
  const t = shownTurn();
  const asked = $("asked");
  asked.hidden = !(t && t.asked);
  asked.replaceChildren();
  if (t && t.asked) {
    const q = el("span", "asked-text", t.asked); q.dir = "auto";
    asked.append(q);
    if (open(t) && !t.quickly) {
      const x = ibtn("asked-x", "close", null, "לבטל את מה שאמרתי");
      x.onclick = () => discardTurn(t);
      asked.append(x);
    }
  }
  if (t) {
    if (t.text) showReply(t.text, { grounded: t.grounded });
    else if (t.interim) showReply(t.interim, { hint: true });
    else if (open(t)) showReply(S.settings.language === "he" ? "חושב…" : "Thinking…", { hint: true });
  }
  follow();
  const waiting = S.turns.filter((x) => open(x) && x !== t && !x.held);
  const held = S.turns.filter((x) => open(x) && x !== t && x.held);
  const q = $("queue");
  q.replaceChildren();
  q.hidden = !waiting.length && !held.length && !S.later.length && !(saying && saying.turn);
  if (q.hidden) return;
  const items = el("div", "qitems");
  // An answer that was cut into: tap to hear the rest.
  // The label in Hebrew, the question in its own direction: mixed in one run they scrambled.
  const labelled = (cls, name, label, text, title) => {
    const chip = el("button", cls);
    chip.title = title; chip.setAttribute("aria-label", label + " " + text);
    const q = el("span", "qtext", text.slice(0, 40) + (text.length > 40 ? "…" : ""));
    q.dir = "auto";
    chip.append(icon(name), el("b", null, label), q);
    return chip;
  };
  for (const h of held) {
    const chip = labelled("qitem held", "play", "להמשיך", h.asked || "", "להמשיך את התשובה מאיפה שעצרתי");
    chip.onclick = () => { if (saying && saying.turn && saying.turn !== h) holdTurn(saying.turn, "park"); resumeTurn(h, true); };
    items.append(chip);
  }
  // Kept for later: tap to ask it now.
  for (const [i, k] of S.later.entries()) {
    const chip = labelled("qitem later", "note", "לאחר כך", k, "לשאול את זה עכשיו");
    chip.onclick = () => { S.later.splice(i, 1); renderBar(); onUtterance({ text: k }); };
    items.append(chip);
  }
  if (waiting.length) items.append(el("span", "qlabel", "בתור · " + waiting.length));
  for (const w of waiting) {
    const chip = el("span", "qitem" + (w.text ? " ready" : ""));
    chip.append(icon(w.text ? "check" : "wait"), el("span", null, (w.asked || "הערה").slice(0, 48) + (w.asked.length > 48 ? "…" : "")));
    const x = ibtn("qx", "close", null, "לבטל את השאלה הזאת");
    x.onclick = () => discardTurn(w);
    chip.append(x);
    chip.dir = "auto";
    chip.title = w.text ? "התשובה מוכנה, מחכה לתורה" : "עוד חושב";
    items.append(chip);
  }
  const acts = el("div", "qacts");
  if (saying && saying.turn) {
    const skip = ibtn("qbtn", "skip", "דלג", "לדלג על התשובה הזאת");
    skip.onclick = skipCurrent;
    acts.append(skip);
  }
  if (waiting.length) {
    const last = ibtn("qbtn", "latest", "לשאלה האחרונה", "ישר לשאלה האחרונה");
    last.onclick = toLatest;
    acts.append(last);
  }
  q.append(items, acts);
}

function finishTurns() {
  for (const t of S.turns) {
    if (t.complete && open(t) && !t.held && !speechQ.some((i) => i.turn === t) && !(saying && saying.turn === t))
      t.status = "done";
  }
}

function dropTurn(t) {
  t.status = "skipped";
  t.held = false;
  for (const i of (t.parked || []).splice(0)) i.resolve();
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

// Settings changed by voice. Each change is applied as if tapped in ⚙, and
// answered in a few words.
const SAID = {
  language: { en: ["Sure, English from now on.", "בסדר, מעכשיו באנגלית."], he: ["Sure, Hebrew from now on.", "בסדר, מעכשיו בעברית."],
              auto: ["I'll answer in whatever language you use.", "אענה בשפה שבה תדבר."] },
  depth: { daf: ["Just the page from now on.", "מעכשיו רק מה שעל הדף."], rishonim: ["I'll bring the Rishonim in too.", "אביא גם ראשונים."],
           acharonim: ["I'll bring the Acharonim in too.", "אביא גם אחרונים."] },
  nudges: { true: ["I'll speak up at the end of a unit.", "אעיר בסוף יחידה."], false: ["I'll stay quiet unless you ask.", "לא אעיר אם לא תשאל."] },
  checks: { true: ["I'll ask when a word comes out different.", "אשאל כשמילה יוצאת אחרת."], false: ["I won't stop you over words.", "לא אעצור אותך על מילים."] },
  pause: { short: ["I'll come in sooner.", "אענה מהר יותר."], normal: ["Back to the usual pause.", "חוזר להמתנה הרגילה."],
           long: ["I'll wait longer before I answer.", "אחכה יותר לפני שאני עונה."] },
  speak: { true: ["I'll answer out loud.", "אענה בקול."], false: ["Answers on screen only.", "התשובות רק על המסך."] },
  view: { daf: ["The page as it's printed.", "צורת הדף."], lin: ["The Steinsaltz view.", "תצוגת שטיינזלץ."] },
  translate: { true: ["Translation on.", "תרגום מופעל."], false: ["Translation off.", "בלי תרגום."] },
  stops: { true: ["Marking where sentences stop.", "מסמן עצירות."], false: ["Not marking the stops.", "בלי סימון עצירות."] },
  speakers: { true: ["Speaker mode — I won't listen while I talk.", "מצב רמקול — בזמן שאני מדבר אני לא מקשיב."],
              false: ["Earbuds mode.", "מצב אוזניות."] },
  sites_halacha: { true: ["I'll check Halacha Yomit on halacha questions.", "אבדוק גם בהלכה יומית בשאלות הלכה."],
                   false: ["Only when you ask.", "רק כשתבקש."] },
  open: { today: ["I'll open on the daf yomi.", "אפתח על הדף היומי."], last: ["I'll open where you stopped.", "אפתח איפה שהפסקת."] },
};
function applySettings(changes, he) {
  const said = [];
  for (const { name, value } of changes) {
    if (name === "rate") { said.push(setRate(value === "faster" ? 1 : -1)); continue; }
    if (name === "voices") {
      S.settings.voices = value;
      said.push(he ? "עד " + value + " קולות בתשובה." : "Up to " + value + " voices an answer."); continue;
    }
    if (name === "favor") {
      const f = Object.assign({}, S.settings.favor);
      if (value.value) f[value.name] = value.value; else delete f[value.name];
      S.settings.favor = f;
      said.push(value.value === 1 ? (he ? value.name + " ליד השולחן." : value.name + " is at the table.")
        : value.value === -1 ? (he ? value.name + " בחוץ, אלא אם תבקש." : value.name + " stays out unless you ask.")
        : (he ? value.name + " חזר לרגיל." : value.name + " is back to normal."));
      continue;
    }
    if (name === "mine") {
      const m = S.masechtot.find((x) => x.name === value.masechta);
      S.settings.mine = value.add ? [...new Set([...S.settings.mine, value.masechta])]
        : S.settings.mine.filter((x) => x !== value.masechta);
      fillMasechtot();
      said.push((m ? m.he : value.masechta) + (value.add ? (he ? " נוספה למסכתות שלך." : " is in your tractates.")
        : (he ? " הוסרה מהמסכתות שלך." : " is out of your tractates.")));
      continue;
    }
    S.settings[name] = value;
    const line = (SAID[name] || {})[String(value)];
    said.push(line ? line[he ? 1 : 0] : (he ? "בסדר." : "Done."));
    if (name === "view" && S.pack) { render(); selectLine(S.line); }
    if (["translate", "stops"].includes(name)) applyToggles();
    if (name === "speak" && !value) stopSpeaking();
  }
  saveSettings();
  if (S.panel === "settings") openSettings();
  return said.join(" ");
}

// Speed, from settings or by voice ("a bit faster").
const RATES = [0.85, 1, 1.15, 1.3, 1.5, 1.75];
function setRate(step) {
  const now = rate();
  let i = RATES.findIndex((r) => r >= now - 0.01);
  if (i < 0) i = 1;
  i = Math.max(0, Math.min(RATES.length - 1, i + step));
  S.settings.rate = RATES[i]; saveSettings();
  pace(player);                        // live: the sentence being said speeds up now
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
  let merged = false;
  if (c && !c.merged && c.turn.status === "thinking" && !c.turn.text && !c.turn.interim &&
      !q.extra && !c.batch.some((x) => x.extra)) {
    c.merged = merged = true;
    c.ctl.abort();
    asks.unshift(...c.batch);
    if (!answering) { asks.push(q); runAnswers(S.gen); return; }   // it was a cut-in's own answer
  }
  // Spoken over an answer still being said: judged against it, and answered
  // now -- not after the rest of it.
  const into = q.extra || merged ? null : S.turns.filter((t) => t !== q.turn && unsaid(t)).pop();
  if (into) {
    if (!into.held) holdTurn(into, "cut");
    else if (into.held === "barge") into.held = "cut";
    q.cut = { turn: into, asked: into.asked, said: into.said || "",
      unsaid: (into.parked || []).filter((i) => !i.bridge).map((i) => i.text).join(" ") };
    respond([q], S.gen);
    return;
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
  turn.ctl = ctl;
  const into = last.cut && last.cut.turn;
  turn.cutInto = into;
  let answer;
  try {
    answer = await postStream("/api/say", Object.assign({ ref: S.pack.ref, line: last.line || S.line, session: S.session,
      said, heard: last.heard.heard, depth: S.settings.depth, language: S.settings.language,
      favor: S.settings.favor, voices: S.settings.voices,
      sites: S.settings.sites, sites_halacha: S.settings.sites_halacha,
      cut_in: last.cut ? { asked: last.cut.asked, said: last.cut.said, unsaid: last.cut.unsaid } : undefined }, extra),
      (msg) => {
        if (g !== S.gen) return;
        if (msg.mode === "read") {
          // "Can you read it for me?" -- the page's words are spoken whole.
          // Reading a comment together: it opens on the desk to read along.
          turn.whole = true;
          for (const d of msg.desk || []) deskAdd({ name: d.name }, d.ref);
          return;
        }
        if (msg.mode === "cut_in") {
          turn.cutKind = msg.kind;
          if (msg.kind === "merge" && into) {
            // The question as it now stands replaces the answer it cut into.
            into.replaced = true;
            if (into.ctl) into.ctl.abort();
            dropTurn(into);
            turn.asked = into.asked + "  ·  " + turn.asked;
          } else if (msg.kind === "new" && into) into.held = "park";
          renderBar();
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
          (turn.parts = turn.parts || []).push(msg.text);
          say(lead + msg.text, turn, turn.parts.length - 1);
          markDesk(msg.text);
          lead = "";
        }
        renderBar();
      }, ctl.signal);
  } catch (e) {
    if (mine.merged || turn.replaced) return;     // asked again, together with what came after
    if (g === S.gen) { dropTurn(turn); failed(e, "answer", t1); }
    return;
  } finally { aborts.delete(ctl); if (current === mine) current = null; }
  if (g !== S.gen || mine.merged || turn.replaced || turn.discarded) return;
  if (!answer) { dropTurn(turn); goOnFrom(into); return failed(null, "answer", t1); }
  if (answer.mode === "later") {
    // "Let's come back to that": kept in the queue, and on from where it was.
    S.later.push(answer.keep);
    turn.complete = true; turn.text = answer.text;
    logPush({ me: false, text: answer.text, trace: { kind: "later", quick: true } });
    say(answer.text, turn).then(() => resumeTurn(into, true));
    finishTurns(); renderBar();
    return;
  }
  if (answer.mode === "settings") {
    // "Talk faster", "answer in Hebrew": done at once, and said in a word.
    // Turning the voice off is asked first.
    // Said in the language just chosen, if that is the change.
    const lang = (answer.changes.find((c) => c.name === "language") || {}).value;
    const he = lang ? lang === "he" : (answer.language || S.settings.language) === "he";
    turn.complete = true;
    if (answer.confirm) {
      S.pendingSettings = answer.changes;
      turn.text = he ? "לכבות את הקול? התשובות יהיו רק על המסך. תגיד ״כן״ לאישור."
        : "Turn my voice off? Answers would be on screen only. Say yes to confirm.";
    } else {
      turn.text = applySettings(answer.changes, he);
    }
    logPush({ me: false, text: turn.text, trace: { kind: "settings", quick: true } });
    say(turn.text, turn).then(() => resumeTurn(into, false));
    finishTurns(); renderBar();
    return;
  }
  if (answer.mode === "desk") {
    // "Put the Rashba on the side" -- done, and said in a word.
    if (answer.close) deskClose();
    for (const name of answer.add || []) deskAdd({ name });
    turn.complete = true; turn.text = answer.text;
    logPush({ me: false, text: turn.text, trace: { kind: "desk", quick: true } });
    say(turn.text, turn).then(() => resumeTurn(into, false));
    finishTurns(); renderBar();
    return;
  }
  if (answer.mode === "navigate") {
    if (into && into.held) into.held = "park";
    turn.complete = true; turn.text = "עובר ל" + runnerText(answer.ref) + ".";
    finishTurns(); renderBar();
    turnTo(answer.ref);
    return idleMode();
  }
  const tr = answer.trace || {};
  const said_ = tr.streamed && !tr.retried;
  turn.text = answer.text; turn.grounded = answer.grounded; turn.complete = true;
  markQuotes(answer.text);
  markDesk(answer.text);
  const entry = logPush({ me: false, text: answer.text, trace: tr, grounded: answer.grounded,
    ms_answer: Math.round(performance.now() - t1), ms_first: first ? Math.round(first - t1) : null });
  S.lastSaid = answer.text;
  const t2 = performance.now();
  // Already said sentence by sentence -- except what was held back, or the
  // whole thing if the answer had to be written again.
  const rest = said_ ? tr.unsaid : lead + answer.text;
  if (!said_) turn.parts = [answer.text];
  const spoken = rest ? say(rest, turn, said_ ? undefined : 0) : Promise.resolve();
  spoken.then(() => {
    entry.ms_spoken = Math.round(performance.now() - t2);
    if (g !== S.gen || !into || !into.held) return;
    // An aside is a breath: back to the answer it cut into. A new question
    // leaves that answer waiting, and asks.
    if (turn.cutKind === "new") offerResume(into); else resumeTurn(into, true);
  });
  finishTurns();
  renderBar();
}

// Queue something to be said. It waits for the learner to finish their
// sentence (never talks into the middle of it), then speaks; talking over it
// stops it, ⏸ pauses it, ⏭ skips the rest of the answer, and 🔊 says it again.
function say(text, turn, idx) {
  if (!text || (turn && turn.status === "skipped")) return Promise.resolve();
  const item = { text, turn, g: S.gen, idx };
  item.done = new Promise((r) => { item.resolve = r; });
  if (turn && turn.held) { turn.parked.push(item); return item.done; }   // written while it waits
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
    setMode("speaking", "מדבר… · רווח לעצור");
    if (ears) ears.guard = true;
    // The next sentence's voice is made while this one plays.
    if (naturalVoice() && speechQ[0] && S.settings.speak) prepare(speechQ[0]);
    S.now = { item, turn: item.turn, idx: item.idx, frac: naturalVoice() ? 0 : null };
    follow();
    await speak(item.text, item);
    S.now = null;
    follow();
    if (ears) ears.guard = false;
  }
  saying = null;
  if (item.cut && item.turn && item.turn.held && live()) {
    // Stopped mid-sentence: that sentence is said again, whole, when it goes on.
    item.cut = false; item.ready = null;
    item.turn.parked.unshift(item);
    renderBar();
    pump();                      // whatever else is waiting (the aside's answer) goes on
    return;
  }
  if (live() && item.turn && !item.bridge) item.turn.said = ((item.turn.said || "") + " " + item.text).trim();
  item.resolve();
  finishTurns();
  renderBar();
  idleMode();
  pump();
}

// The mic button is the mic, as in any voice assistant: a tap closes it or
// opens it, and nothing else -- what is being said goes on (⏸, Esc, or just
// talking over it stop that). Held down, it stops everything. In use a tap
// meant to mute, so as to talk to someone in the room, cut the answer off.
let micHeld = null, micLong = false;
$("mic").addEventListener("pointerdown", () => {
  micLong = false;
  micHeld = setTimeout(() => { micLong = true; stopListening(); if (navigator.vibrate) navigator.vibrate(12); }, 650);
});
for (const ev of ["pointerup", "pointerleave", "pointercancel"]) $("mic").addEventListener(ev, () => clearTimeout(micHeld));
$("mic").onclick = () => {
  if (micLong) { micLong = false; return; }
  if (S.listening) muteMic(); else startListening();
};
$("hold").onclick = pauseSpeaking;

/* ------------------------------------------------------------- panels */

// Panels sit beside the page, not over it: the gemara stays in view while
// you read Rashi, ask, or look at the transcript.
// Dragging an edge: it follows the pointer only while the button is down, and
// lets go the moment it is released -- wherever that happens. In use the
// panel's edge kept following the mouse after the button was let go, because
// the release landed somewhere the edge never heard it.
function onDrag(grip, cls, move, end) {
  grip.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch (x) {}
    document.body.classList.add(cls);
    let done = false;
    const mv = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      if (ev.pointerType === "mouse" && ev.buttons === 0) return up();    // let go where we did not hear it
      move(ev);
    };
    const up = () => {
      if (done) return;
      done = true;
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
      grip.removeEventListener("lostpointercapture", up);
      document.body.classList.remove(cls);
      if (end) end();
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
    grip.addEventListener("lostpointercapture", up);
  });
}

function openPanel(build, kind) {
  const panel = $("panel"); panel.replaceChildren();
  build(panel);
  panel.scrollTop = 0;
  S.panel = kind || "other";
  $("over").classList.add("open");
  document.body.classList.add("docked");
  syncTabs();
}
function closePanel() {
  S.panel = null;
  $("over").classList.remove("open");
  document.body.classList.remove("docked");
  syncTabs();
}
// The tabs under the conversation show what is open; a second tap closes it.
function syncTabs() {
  $("open-sources").setAttribute("aria-pressed", String(S.panel === "sources"));
  $("open-log").setAttribute("aria-pressed", String(S.panel === "log"));
}

// The conversation area: drag its top edge for more or less of it. Kept.
(function sizeTalk() {
  const grip = $("foot-grip"), root = document.documentElement.style;
  const apply = (px) => root.setProperty("--talk-h", Math.round(Math.min(Math.max(px, 70), innerHeight * 0.7)) + "px");
  const saved = +(recall("talk") || 0);
  if (saved) apply(saved);
  let startY = 0, startH = 0;
  grip.addEventListener("pointerdown", (e) => { startY = e.clientY; startH = $("talk").getBoundingClientRect().height; });
  onDrag(grip, "resizing-v", (ev) => apply(startH + (startY - ev.clientY)), () =>
    remember("talk", parseInt(getComputedStyle(document.documentElement).getPropertyValue("--talk-h"), 10) || ""));
  grip.addEventListener("dblclick", () => { root.removeProperty("--talk-h"); remember("talk", ""); });
})();
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
  onDrag($("grip"), "resizing", (ev) => {
    const rtl = getComputedStyle(document.body).direction === "rtl";
    apply(narrow() ? innerHeight - ev.clientY : rtl ? innerWidth - ev.clientX : ev.clientX);
  }, () => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(narrow() ? "--sheet" : "--side");
    remember(narrow() ? "sheet" : "side", parseInt(v, 10) || "");
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
        const pin = ibtn("more", "desk", "לשולחן", "לפתוח את " + heName(name) + " לצד הדף");
        pin.onclick = () => deskAdd({ name }, e.ref);
        meta.append(more, pin, link); box.append(meta);
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
  }, "sources");
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
      const go = el("a", "lnk", data.url ? "באתר המקור ↗" : "הטקסט המלא ↗");
      go.href = data.url || sefariaUrl(ref); go.target = "_blank"; go.rel = "noopener";
      body.append(el("br"), go);
    } catch (e) { body.textContent = "לא הצלחתי להביא את זה מהספרייה."; }
  };
  wrap.append(a, body);
  return wrap;
}

// A source off the page, opened in the panel -- the Tur the partner cited.
function openText(ref) {
  openPanel((panel) => {
    panel.append(el("h2", null, chipFor(ref).label || ref), el("div", "sub", ref));
    const link = textLink(ref);
    const pin = ibtn("btn", "desk", "לשולחן");
    pin.onclick = () => { deskAdd({ ref }); closePanel(); };
    panel.append(link, pin);
    link.querySelector(".tref").click();
  });
}

/* ------------------------------------------- the desk: commentaries to read */

// Commentaries laid out beside the page, to read with the partner or alone.
// Add whom you like, drag them into the order you like, wide or narrow; the
// desk beside the page, under it, or on its own. Only for this sitting:
// nothing here is saved, and a reload clears it.
const DESK = { open: false, place: "side", swap: false, size: 16, cards: [], focus: null };

const deskKey = (c) => (c.name ? "n:" + c.name : "r:" + c.ref);
function deskAdd(card, focus) {
  if (!DESK.cards.some((x) => deskKey(x) === deskKey(card))) DESK.cards.push(card);
  if (focus) { DESK.focus = focus; DESK.toFocus = true; }
  DESK.open = true;
  renderDesk();
}
function deskClose() { DESK.open = false; DESK.shown = null; $("desk-pick").hidden = true; renderDesk(); }

function deskLayout() {
  const main = document.querySelector("main");
  $("desk").hidden = !DESK.open;
  main.classList.toggle("with-desk", DESK.open);
  main.classList.toggle("swap", DESK.swap);
  main.dataset.place = DESK.place;
  $("desk").style.setProperty("--desk-font", DESK.size + "px");
  for (const p of ["side", "below", "full"]) $("desk-" + p).setAttribute("aria-pressed", String(DESK.place === p));
  $("open-desk").setAttribute("aria-pressed", String(DESK.open));
}

// A work's comments on this amud, in the book's own order.
function commentsOf(name) {
  const out = [];
  for (const seg of S.pack.segments) for (const e of seg.commentaries[name] || []) out.push({ seg, e });
  return out.sort((a, b) => byRef(a.e.ref, b.e.ref));
}

// The words as spans, so what the partner quotes can be lit as it is read.
function deskWords(text) {
  const box = el("div", "dc-text");
  for (const w of text.split(/(\s+)/)) {
    if (!w) continue;
    if (/^\s+$/.test(w)) { box.append(w); continue; }
    const k = norm(w), s = el("span", "dw", w);
    if (k) s.dataset.k = k;
    box.append(s);
  }
  return box;
}

// Cards glide to their new places instead of jumping: measure where each is
// now (mid-flight included), change the desk, and animate each from there.
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
function deskFlip(change) {
  const before = new Map();
  for (const card of $("desk-cards").querySelectorAll(".dc"))
    before.set(card.dataset.key, card.getBoundingClientRect());
  change();
  if (REDUCED.matches) return;
  for (const card of $("desk-cards").querySelectorAll(".dc")) {
    const was = before.get(card.dataset.key);
    if (!was || card.classList.contains("lifted")) continue;
    const now = card.getBoundingClientRect();
    const dx = was.left - now.left, dy = was.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    for (const a of card.getAnimations()) a.cancel();
    card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: 300, easing: "cubic-bezier(.32, .72, 0, 1)" });
  }
}

function deskMove(i, to) {
  if (to < 0 || to >= DESK.cards.length || to === i) return;
  deskFlip(() => {
    const [c] = DESK.cards.splice(i, 1);
    DESK.cards.splice(to, 0, c);
    renderDesk();
  });
}

// Carry a card by ⋮⋮ -- finger or mouse. It stays under the finger where it
// was taken hold of; the others make room as it passes over them; let go and
// it settles into its place.
function deskCarry(card, grip) {
  grip.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    let lifted = false, grab = null;
    const place = (ev) => {
      const base = (card.style.transform = "", card.getBoundingClientRect());
      card.style.transform = `translate(${ev.clientX - grab.x - base.left}px, ${ev.clientY - grab.y - base.top}px)`;
    };
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!lifted) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;   // a tap is not a drag
        lifted = true;
        const r = card.getBoundingClientRect();
        grab = { x: start.x - r.left, y: start.y - r.top };
        for (const a of card.getAnimations()) a.cancel();
        card.classList.add("lifted");
        if (navigator.vibrate) navigator.vibrate(8);
      }
      // Over another card: this one takes its place, and the rest move up.
      // A card still gliding to its place is not a target yet: it would swap straight back.
      const others = [...$("desk-cards").querySelectorAll(".dc")]
        .filter((c) => c !== card && !c.getAnimations().some((a) => a.playState === "running"));
      const over = others.find((c) => {
        const r = c.getBoundingClientRect();
        return ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom;
      });
      if (over) {
        const all = [...$("desk-cards").querySelectorAll(".dc")];
        const from = all.indexOf(card), to = all.indexOf(over);
        deskFlip(() => over.parentNode.insertBefore(card, from < to ? over.nextSibling : over));
      }
      place(ev);
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!lifted) return;
      // Settle from where it is into its slot, then keep the order.
      const at = card.getBoundingClientRect();
      card.style.transform = "";
      const home = card.getBoundingClientRect();
      card.classList.remove("lifted");
      const order = [...$("desk-cards").querySelectorAll(".dc")].map((c) => c.dataset.key);
      DESK.cards.sort((a, b) => order.indexOf(deskKey(a)) - order.indexOf(deskKey(b)));
      const settle = REDUCED.matches ? null : card.animate(
        [{ transform: `translate(${at.left - home.left}px, ${at.top - home.top}px)` }, { transform: "none" }],
        { duration: 280, easing: "cubic-bezier(.32, .72, 0, 1)" });
      const done = () => renderDesk();
      if (settle) settle.onfinish = done; else done();
    };
    // On the window, not the grip: moving the card in the page drops the grip's capture.
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
}

function deskCard(c, i) {
  const card = el("article", "dc" + (c.wide ? " wide" : ""));
  card.dataset.i = i; card.dataset.key = deskKey(c);
  const head = el("div", "dc-head");
  const grip = el("span", "dc-grip");
  grip.append(icon("grip"));
  grip.title = "גרור כדי לסדר מחדש"; grip.setAttribute("aria-hidden", "true");
  deskCarry(card, grip);
  const title = el("span", "dc-name", c.name ? heName(c.name) : chipFor(c.ref).label);
  const tools = el("span", "dc-tools");
  const btn = (name, tip, go) => { const b = ibtn("dc-btn", name, null, tip); b.onclick = go; tools.append(b); return b; };
  btn("prev", "להזיז קודם", () => deskMove(i, i - 1));
  btn("next", "להזיז אחר כך", () => deskMove(i, i + 1));
  btn(c.wide ? "narrow" : "wide", c.wide ? "צר" : "רחב", () => deskFlip(() => { c.wide = !c.wide; renderDesk(); }));
  btn("close", "להוריד מהשולחן", () => {
    // It fades where it is, then the others close the gap.
    card.classList.add("leaving");
    setTimeout(() => deskFlip(() => { DESK.cards = DESK.cards.filter((x) => x !== c); renderDesk(); }),
      REDUCED.matches ? 0 : 150);
  });
  head.append(grip, title, tools);
  const body = el("div", "dc-body");
  if (c.height) body.style.height = c.height + "px";
  // A card drawn taller or shorter keeps its height while the desk is open.
  new ResizeObserver(() => { if (body.offsetHeight) c.height = body.offsetHeight; }).observe(body);
  body.addEventListener("scroll", () => { c.scroll = body.scrollTop; }, { passive: true });
  card.append(head, body);
  if (c.name) {
    const list = commentsOf(c.name);
    if (!list.length) body.append(el("div", "dc-none", "אין ל" + heName(c.name) + " כאן, בעמוד הזה."));
    for (const { seg, e } of list) {
      const entry = el("div", "dc-entry" + (seg.n === S.line ? " here" : ""));
      entry.dataset.ref = e.ref; entry.dataset.n = seg.n;
      const top = el("div", "dc-top");
      const ln = el("button", "dc-line", "שורה " + seg.n);
      ln.onclick = () => selectLine(seg.n);
      top.append(ln);
      if (e.dibur) top.append(el("span", "dc-dib", e.dibur));
      entry.append(top, deskWords(e.he));
      body.append(entry);
    }
  } else {
    // A source off the page (the Tur the partner cited), fetched once.
    if (c.text) body.append(deskWords(c.text));
    else {
      body.append(el("div", "dc-none", "פותח…"));
      fetch("/api/text?ref=" + encodeURIComponent(c.ref)).then((r) => r.json()).then((d) => {
        c.text = d.he || "לא הצלחתי להביא את זה מהספרייה.";
        body.replaceChildren(deskWords(c.text));
      }).catch(() => { body.replaceChildren(el("div", "dc-none", "לא הצלחתי להביא את זה מהספרייה.")); });
    }
  }
  return card;
}

/* Saved layouts: the desk as you arranged it, kept under a name. One tap
   opens it; the one you are in shows ★ (open it by itself with every page)
   and ✕. Only what is saved is kept -- the desk itself stays for the sitting. */
function layouts() {
  try { return JSON.parse(recall("layouts") || "[]"); } catch (e) { return []; }
}
function keepLayouts(list) { remember("layouts", JSON.stringify(list)); }
function deskName() {
  const names = DESK.cards.map((c) => (c.name ? heName(c.name) : chipFor(c.ref).label)).slice(0, 3);
  return names.join(" · ") || "סידור";
}
function saveLayout(name) {
  const main = document.querySelector("main").style;
  const list = layouts().filter((l) => l.name !== name);
  const old = layouts().find((l) => l.name === name);
  list.push({ name, auto: !!(old && old.auto), place: DESK.place, swap: DESK.swap, size: DESK.size,
    w: main.getPropertyValue("--desk-w"), h: main.getPropertyValue("--desk-h"),
    cards: DESK.cards.map((c) => ({ name: c.name, ref: c.ref, wide: !!c.wide, height: c.height })) });
  keepLayouts(list);
  DESK.layout = name;
}
function applyLayout(l) {
  const main = document.querySelector("main").style;
  Object.assign(DESK, { place: l.place || "side", swap: !!l.swap, size: l.size || 16, layout: l.name, open: true,
    focus: null, cards: (l.cards || []).map((c) => Object.assign({}, c)) });
  for (const [k, v] of [["--desk-w", l.w], ["--desk-h", l.h]]) v ? main.setProperty(k, v) : main.removeProperty(k);
  $("desk-pick").hidden = true;
  renderDesk();
}

function drawLayouts() {
  const row = $("desk-layouts");
  row.replaceChildren();
  const list = layouts();
  for (const l of list) {
    const on = l.name === DESK.layout;
    const chip = el("span", "lay" + (on ? " on" : ""));
    const go = el("button", "lay-go", l.name);
    if (l.auto) go.prepend(icon("star", "solid"));
    go.title = "לפתוח את הסידור הזה";
    go.onclick = () => applyLayout(l);
    chip.append(go);
    if (on) {
      const star = ibtn("lay-x", "star", null, l.auto ? "לא לפתוח מעצמו" : "לפתוח מעצמו עם כל דף");
      if (l.auto) star.firstChild.classList.add("solid");
      star.onclick = () => {
        keepLayouts(layouts().map((x) => Object.assign(x, { auto: x.name === l.name ? !l.auto : false })));
        drawLayouts();
      };
      const del = ibtn("lay-x", "close", null, "למחוק את הסידור");
      del.onclick = () => { keepLayouts(layouts().filter((x) => x.name !== l.name)); DESK.layout = null; drawLayouts(); };
      chip.append(star, del);
    }
    row.append(chip);
  }
  if (!DESK.cards.length) return;
  // Save: one tap, a name offered, Enter to keep it.
  const save = ibtn("lay-save", "plus", list.length ? "שמור" : "שמור את הסידור");
  save.title = "לשמור את השולחן כמו שהוא עכשיו";
  save.onclick = () => {
    const form = el("form", "lay-form");
    const input = el("input"); input.value = DESK.layout || deskName(); input.setAttribute("aria-label", "שם הסידור");
    const ok = ibtn("lay-go", "check", null, "לשמור");
    form.append(input, ok);
    form.onsubmit = (e) => { e.preventDefault(); const n = input.value.trim(); if (n) saveLayout(n); drawLayouts(); };
    input.onkeydown = (e) => { if (e.key === "Escape") drawLayouts(); };
    save.replaceWith(form);
    input.focus(); input.select();
  };
  row.append(save);
}

function renderDesk() {
  deskLayout();
  const box = $("desk-cards");
  if (!DESK.open) return;
  drawLayouts();
  box.replaceChildren();
  if (!DESK.cards.length)
    box.append(el("div", "desk-empty", layouts().length
      ? "בחר סידור שמור למעלה, או ״מפרש״ כדי להוסיף."
      : "השולחן ריק. ״מפרש״ כדי להוסיף — או תגיד: ״תפתח את הרשב״א בצד״."));
  DESK.cards.forEach((c, i) => box.append(deskCard(c, i)));
  // A card just put on the desk arrives; the ones already there are only redrawn.
  const shown = new Set(DESK.cards.map(deskKey));
  if (!REDUCED.matches && DESK.shown)
    for (const card of box.querySelectorAll(".dc"))
      if (!DESK.shown.has(card.dataset.key))
        card.animate([{ opacity: 0, transform: "scale(.97)" }, { opacity: 1, transform: "none" }],
          { duration: 260, easing: "cubic-bezier(.32, .72, 0, 1)" });
  DESK.shown = shown;
  const focus = DESK.focus && box.querySelector('.dc-entry[data-ref="' + CSS.escape(DESK.focus) + '"]');
  if (focus) focus.classList.add("focus");
  // Redrawn cards stay where they were read to; a new one opens at the line,
  // and the comment being read is brought into view once.
  const bodies = [...box.querySelectorAll(".dc-body")];
  bodies.forEach((body, i) => {
    const c = DESK.cards[i];
    if (focus && DESK.toFocus && body.contains(focus)) deskScroll(body, focus, "auto");
    else if (c.scroll !== undefined) body.scrollTop = c.scroll;
    else deskHere(null, [body], "auto");
  });
  DESK.toFocus = false;
}

function deskScroll(body, target, behavior) {
  body.scrollTo({ top: target.offsetTop - body.offsetTop - 8, behavior: behavior || "smooth" });
}

// Each card to the comment on the line they are at, as they move through the page.
function deskHere(_, bodies, behavior) {
  if (!DESK.open) return;
  for (const body of bodies || $("desk-cards").querySelectorAll(".dc-body")) {
    const entries = [...body.querySelectorAll(".dc-entry")];
    for (const x of entries) x.classList.toggle("here", +x.dataset.n === S.line);
    const target = entries.find((x) => +x.dataset.n === S.line) || entries.filter((x) => +x.dataset.n < S.line).pop();
    if (target && !visible(target, body)) deskScroll(body, target, behavior);
  }
}

// What the partner quotes while it reads a comment with them, lit on the desk.
function markDesk(text) {
  if (!DESK.open) return;
  const quotes = [...(text || "").matchAll(/«([^»]+)»/g)].map((m) => m[1].split(/\s+/).map(norm).filter(Boolean));
  if (!quotes.length) return;
  for (const n of $("desk-cards").querySelectorAll(".dw.quoted")) n.classList.remove("quoted");
  for (const body of $("desk-cards").querySelectorAll(".dc-body")) {
    const all = [...body.querySelectorAll(".dw[data-k]")];
    let first = null;
    for (const q of quotes) {
      for (let i = 0; i + q.length <= all.length; i++) {
        if (q.every((k, j) => all[i + j].dataset.k === k)) {
          for (let j = 0; j < q.length; j++) all[i + j].classList.add("quoted");
          first = first || all[i];
          break;
        }
      }
    }
    if (first && !visible(first, body))
      body.scrollTo({ top: first.offsetTop - body.offsetTop - body.clientHeight / 3, behavior: "smooth" });
  }
}

// ＋ מפרש: everyone on this amud, by kind; a dot for who speaks on this line.
function deskPicker() {
  const pick = $("desk-pick");
  if (!pick.hidden) { pick.hidden = true; $("desk-add").setAttribute("aria-expanded", "false"); return; }
  pick.replaceChildren();
  const count = {};
  for (const seg of S.pack.segments)
    for (const [name, list] of Object.entries(seg.commentaries))
      count[name] = (count[name] || 0) + list.length;
  const onLine = new Set(Object.keys((S.pack.segments.find((s) => s.n === S.line) || {}).commentaries || {}));
  const weight = (name) => (S.pack.weights || {})[name] || 0;
  const groups = {};
  for (const name of Object.keys(count)) (groups[tier(name)] = groups[tier(name)] || []).push(name);
  for (const g of ["על הדף", "ראשונים", "אחרונים", "עוד"]) {
    const names = (groups[g] || []).sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
    if (!names.length) continue;
    const row = el("div", "dp-row");
    row.append(el("span", "dp-grp", g));
    for (const name of names) {
      const on = DESK.cards.some((c) => c.name === name);
      const b = el("button", "chip" + (on ? " on" : ""), (onLine.has(name) ? "• " : "") + heName(name) + " " + count[name]);
      b.title = onLine.has(name) ? "יש לו מה לומר בשורה הזאת" : "";
      b.onclick = () => {
        if (on) DESK.cards = DESK.cards.filter((c) => c.name !== name); else DESK.cards.push({ name });
        pick.hidden = true; renderDesk(); deskPicker();
      };
      row.append(b);
    }
    pick.append(row);
  }
  pick.append(el("div", "dp-hint", "• — יש לו מה לומר בשורה " + S.line + ". לחיצה שנייה מורידה."));
  pick.hidden = false;
  $("desk-add").setAttribute("aria-expanded", "true");
}

$("open-desk").onclick = () => (DESK.open ? deskClose() : (DESK.open = true, renderDesk()));
$("desk-close").onclick = deskClose;
$("desk-add").onclick = deskPicker;
for (const p of ["side", "below", "full"]) $("desk-" + p).onclick = () => { DESK.place = p; renderDesk(); };
$("desk-swap").onclick = () => { DESK.swap = !DESK.swap; renderDesk(); };
$("desk-smaller").onclick = () => { DESK.size = Math.max(12, DESK.size - 1); deskLayout(); };
$("desk-bigger").onclick = () => { DESK.size = Math.min(26, DESK.size + 1); deskLayout(); };

// The edge toward the page: drag it for more or less desk. Not remembered.
(function sizeDesk() {
  onDrag($("desk-grip"), "resizing", (ev) => {
    const d = $("desk").getBoundingClientRect(), p = document.querySelector(".sheet").getBoundingClientRect();
    const main = document.querySelector("main");
    if (getComputedStyle(main).flexDirection.startsWith("column")) {
      const px = p.top < d.top ? d.bottom - ev.clientY : ev.clientY - d.top;
      main.style.setProperty("--desk-h", Math.round(Math.min(Math.max(px, 140), innerHeight * 0.85)) + "px");
    } else {
      const px = p.left > d.left ? ev.clientX - d.left : d.right - ev.clientX;
      main.style.setProperty("--desk-w", Math.round(Math.min(Math.max(px, 240), innerWidth * 0.8)) + "px");
    }
  });
})();

function openLog() {
  openPanel((panel) => {
    panel.append(el("h2", null, "תמליל"), el("div", "sub", "מה שנאמר בשיחה הזאת"));
    const turns = el("div"); turns.id = "turns";
    panel.append(turns);
    const copy = ibtn("btn", "copy", "העתק את כל השיחה");
    copy.onclick = async () => {
      const text = sessionReport();
      try { await navigator.clipboard.writeText(text); copy.replaceChildren(icon("check"), el("span", null, "הועתק — הדבק ל-Claude")); }
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
  const p = $("panel"), atEnd = p.scrollHeight - p.scrollTop - p.clientHeight < 160;
  requestAnimationFrame(() => { if (atEnd) p.scrollTo({ top: p.scrollHeight, behavior: "smooth" }); });
  box.replaceChildren();
  if (!S.log.length) box.append(el("div", "sub", "עוד לא דיברתם."));
  for (const t of S.log) {
    const row = el("div", "turn" + (t.me ? " me" : "") + (t.error ? " err" : ""));
    row.dir = "auto";
    if (t.me) { row.textContent = t.text; if (t.mode === "reading") row.prepend(icon("book")); if (t.discarded) row.classList.add("discarded"); }
    else if (t.error) row.textContent = "⚠ " + t.text;
    else renderRich(row, t.text);
    if (t.trace) row.append(el("span", "trace", "routed: " + t.trace.kind + (t.trace.claim ? " · claim" : "") +
      (t.trace.cut_in ? " · cut in: " + t.trace.cut_in : "") +
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
    "settings: " + JSON.stringify(S.settings),
    "voice pace: usual " + (usualPace() ? usualPace().toFixed(1) : "?") + " syllables/s over " + PACES.length +
      " sentences (range " + (PACES.length ? Math.min(...PACES).toFixed(1) + "–" + Math.max(...PACES).toFixed(1) : "?") + ")", ""];
  for (const t of S.log) {
    if (t.me) {
      const hd = t.heard || {};
      lines.push("## " + (t.at || "") + " · " + (t.ref || "") + " line " + (t.line || "") +
        " · heard as " + (t.mode || "?") + (t.ms_hear ? " (" + t.ms_hear + " ms)" : ""));
      lines.push("ME: " + t.text + (t.discarded ? "   [taken back]" : ""));
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
        (tr.cut_in ? " · said over the last answer: " + tr.cut_in : "") +
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

// How far you have come: pages per tractate, days in a row, the Daf Yomi.
function progressBox() {
  const box = el("div", "set progress");
  box.append(el("div", "lbl", "ההתקדמות שלי"));
  const body = el("div", "prog"); body.textContent = "…";
  box.append(body);
  fetch("/api/progress?mine=" + encodeURIComponent(S.settings.mine.join(","))).then((r) => r.json()).then((p) => {
    body.replaceChildren();
    const top = [];
    if (p.streak) top.push(p.streak + " ימים ברצף");
    if (p.daf_yomi && p.daf_yomi.ref) top.push("הדף היומי " + p.daf_yomi.he + (p.daf_yomi.done ? " ✓" : " — עוד לא") +
      (p.daf_yomi.streak > 1 ? " (" + p.daf_yomi.streak + " ימים ברצף בדף היומי)" : ""));
    body.append(el("div", "prog-top", top.join(" · ") || "עוד לא למדנו יחד."));
    for (const t of p.tractates) {
      const row = el("div", "prog-row");
      const bar = el("div", "bar"); const fill = el("div", "fill");
      fill.style.width = Math.round(100 * t.done / Math.max(1, t.total)) + "%";
      bar.append(fill);
      row.append(el("span", "prog-name", t.he), bar, el("span", "prog-n", t.done + "/" + t.total));
      body.append(row);
    }
  }).catch(() => { body.textContent = ""; });
  return box;
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
  box.append(el("div", "help", "למה שאין בספרייה: הלכה יומית (פסקי הרב עובדיה), ויקיטקסט (שער הציון, ברכי יוסף, המרדכי), " +
    "וסיכום הדף של D.A.F. (dafyomi.co.il) לכל דף בש״ס — לחזרה, גם על דפים שלמדת לפני האפליקציה. " +
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
        if (key === "script") applyScript();
        if (key === "hearing" && S.listening) { muteMic(); startListening(); }
        if (key === "rate") pace(player);
        if (key === "voice_name") { stopSpeaking(); say(S.settings.language === "he" ? "שלום, בוא נלמד יחד." : "Hello — let's learn together."); }
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
        "כפתור הדף היומי למעלה תמיד מביא אליו. הוא נבנה מראש כל בוקר (וגם של מחר) כל עוד האפליקציה פתוחה."),
      progressBox(),
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
      choice("script", "כתב רש״י", [["plain", "בלי — הכול באותיות רגילות"], ["page", "רש״י ותוספות שעל הדף"],
        ["all", "כל המפרשים"]], "האותיות שבהן נדפסו המפרשים. רגילות קלות יותר לקריאה."),
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
      choice("voice_name", "איזה קול", [["cedar", "Cedar · חם, רגוע"], ["verse", "Verse · חי, ער"]],
        "לחיצה משמיעה דוגמה."),
      choice("speakers", "שמע", [[false, "אוזניות"], [true, "רמקול"]],
        "ברמקול, בזמן שאני מדבר אני לא מקשיב (אחרת אני שומע את עצמי). לעצור: כפתור העצירה או רווח."),
      choice("hearing", "זיהוי דיבור", [["api", "מדויק, עברית ואנגלית יחד"], ["browser", "הדפדפן (חינם, שפה אחת)"]]),
    );
    const k = el("div", "set"); k.append(el("div", "lbl", "מקשים"));
    const keys = el("div", "kbd");
    keys.innerHTML = "<kbd>רווח</kbd> מיקרופון · <kbd>←</kbd> <kbd>→</kbd> עמוד הבא / הקודם · " +
      "<kbd>↑</kbd> <kbd>↓</kbd> שורה · <kbd>Esc</kbd> סגור";
    k.append(keys); panel.append(k);
  }, "settings");
}

$("open-sources").onclick = () => (S.panel === "sources" ? closePanel() : openSources(S.line));
$("open-log").onclick = () => (S.panel === "log" ? closePanel() : openLog());
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
  applyScript();
  syncMic();
  checkHealth();          // not awaited: a slow Sefaria must not hold up a cached page
  await buildPickers();
  setInterval(checkHealth, 60000);
  const last = recall("ref");
  const valid = last && parseRef(last) && S.masechtot.some((m) => m.name === parseRef(last).masechta);
  today();                // the 📅 button shows today's daf by name
  lastTime();             // "last time you learned ... -- a quick review?"
  if (S.settings.open === "today" && (await today())) return openToday();
  turnTo(valid ? last : pickedRef(), valid ? +recall("line." + last) || 1 : 1);
})();
