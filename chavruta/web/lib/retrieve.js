// Which sources enter the conversation, and when.
//
// The backbone -- what is printed on the page, Rashi and Tosafot and where
// printed Rabbeinu Chananel -- is always in front of the partner, for the whole
// amud, in a system prompt that holds still and is cached.
//
// Everything else is on the bench. It is already in the pack (Sefaria returns
// every link on a daf in one request), so widening costs no network and no wait;
// what it costs is attention and tokens. So each turn a cheap model classifies
// what was said, and only then does anything from the bench come in: because the
// learner named it, because the question is the kind that commentator answers,
// or because the learner has asked to learn deeper.
//
// Ported from chavruta/retrieve.py. Jobs and pairs (Python tuples) are arrays.
// plan() and guess() are async: plan asks the store whether a recap is kept.

import * as who from "./commentators.js";
import * as library from "./library.js";
import * as review from "./review.js";
import * as web from "./web.js";
import * as store from "./store.js";
import { re, search, match, sub, finditer, findall, escape, pysplit, rsplit, rstrip, sorted, truthy, or, any, fmt, str } from "./py.js";

// Beyond the question kinds: the small exchanges of sitting together, which
// want a few words back and not a lecture.
export const LIGHT = {
  "ping": "checking you can hear them, telling you they are about to read, thanks, " +
          "hello, a joke -- anything that needs only a few words back. NOT a request: " +
          "'answer it', 'so answer', 'go on', 'what did you say', 'answer my question' " +
          "want the real answer, so they are 'other'",
  "other": "anything else -- including asking you to answer, continue, or repeat what " +
           "you said, which you then do in full",
  "check_reading": "asking whether they read it right, or whether they missed or " +
                   "swapped a word",
  "people": "who a sage or commentator was: when or where he lived, which century, " +
            "who came first, who taught whom, was he someone's student",
  "review": "asks to be reminded what was learned before -- the last pages, yesterday, " +
            "last time, the mishna or chapter so far -- or for a summary of it",
  "quiz": "asks you to test them or ask them questions on what they learned",
  "recall": "asks whether they already learned something, or where they saw it -- 'did we learn " +
            "this yesterday?', 'I think I read this somewhere', 'where did this word come up?'",
  "settings": "asks you to change how you work -- speak faster or slower, answer in Hebrew or " +
              "English, bring more or fewer commentators, stop speaking up, wait longer, always " +
              "bring or leave out a commentator, open on the daf yomi",
};

// What can be changed by voice, and to what. Anything else the router says is
// dropped: a setting is never set to a value the settings screen does not offer.
export const SETTINGS = {
  "rate": ["faster", "slower"], "language": ["en", "he", "auto"],
  "depth": ["daf", "rishonim", "acharonim"], "voices": [1, 2, 3, 5],
  "nudges": [true, false], "checks": [true, false], "pause": ["short", "normal", "long"],
  "speak": [true, false], "view": ["daf", "lin"], "translate": [true, false],
  "stops": [true, false], "speakers": [true, false], "sites_halacha": [true, false],
  "open": ["last", "today"],
};

// Python's ==, for `value in (...)`: True == 1 and False == 0 there.
const _num = (x) => typeof x === "number" || typeof x === "boolean";
const _eq = (a, b) => (_num(a) && _num(b) ? Number(a) === Number(b) : a === b);
const _among = (x, xs) => xs.some((y) => _eq(x, y));
const _dict = (x) => x !== null && typeof x === "object" && !Array.isArray(x) && !(x instanceof Set) && !(x instanceof Map);
const _has = (c, x) => (c instanceof Set || c instanceof Map ? c.has(x) : Array.isArray(c) ? c.includes(x)
  : _dict(c) ? Object.hasOwn(c, x) : false);
// Python's ==, deep: tuples, lists and dicts compare by what is in them.
function _same(a, b) {
  if (_eq(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => _same(x, b[i]));
  if (_dict(a) && _dict(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && _same(a[k], b[k]));
  }
  return false;
}
const _in_list = (x, xs) => xs.some((y) => _same(x, y));


/** The router's proposed changes, kept only where they are real settings. */
export function settings_changes(raw) {
  const out = [];
  for (const change of Array.isArray(raw) ? raw : []) {
    if (!_dict(change)) {
      continue;
    }
    const [name, value] = [change.name ?? null, change.value ?? null];
    if (typeof name === "string" && Object.hasOwn(SETTINGS, name) && _among(value, SETTINGS[name])) {
      out.push({ "name": name, "value": value });
    } else if (name === "voices" && (Number.isInteger(value) || typeof value === "boolean")) {
      out.push({ "name": name, "value": Math.max(1, Math.min(5, Number(value))) });
    } else if (name === "favor" && _dict(value) && truthy(value.name ?? null) && _among(value.value, [1, -1, 0])) {
      const known = who.TABLE.flatMap(([, names]) => names.map(([n]) => n));
      const match_ = resolve(str(value.name), new Set(known)) || (known.includes(value.name) ? value.name : null);
      if (known.includes(match_)) {
        out.push({ "name": "favor", "value": { "name": match_, "value": value.value } });
      }
    } else if (name === "mine" && _dict(value) && who.MASECHTOT.some((m) => m.name === value.masechta)) {
      out.push({ "name": "mine", "value": { "masechta": value.masechta, "add": value.add !== false } });
    }
  }
  return out.slice(0, 4);
}
export const KINDS = [...Object.keys(who.ROUTES), ...Object.keys(LIGHT), "reading", "navigate"];

// Depth: how far past the printed page to reach without being asked.
export const DEPTHS = {
  "daf": "only what is printed on the page",
  "rishonim": "the page, plus the Rishonim strong in this masechta",
  "acharonim": "the page, the Rishonim, and the Acharonim on Rashi and Tosafot",
};
export const ACHARONIM = ["Maharsha", "Penei Yehoshua", "Rashash", "Chiddushei Rabbi Akiva Eiger",
                          "Tzelach", "Gilyon HaShas"];

export const ROUTER_SYSTEM = fmt(`You sort what a person studying Talmud just said to their
study partner. Reply with JSON only:

{"kind": one of %s,
 "claim": true if they are asserting what the text means (not asking),
 "names": commentators they mentioned by name, in English spelling
          (e.g. "Rashi", "Tosafot", "Rashba", "Rambam", "Meiri"), else [],
 "navigate": {"daf": number, "amud": "a" or "b", "masechta": the tractate
             if they named one, spelled exactly as in this list: %s -- else null}
             if they asked to go to a page; {"daf_yomi": true} if they asked
             for today's daf ("the daf yomi", "הדף היומי"); else null,
 "settings": only when kind is "settings": the changes, as [{"name": ..., "value": ...}]
             with name one of rate ("faster"/"slower"), language ("en"/"he"/"auto"),
             depth ("daf"/"rishonim"/"acharonim"), voices (1-5, how many commentators),
             nudges (true/false, speaking up unasked), checks (true/false, asking about
             misread words), pause ("short"/"normal"/"long", how long to wait),
             speak (true/false, answering aloud), view ("daf"/"lin"), translate,
             stops, speakers (true/false), sites_halacha (true/false, checking Halacha
             Yomit on halacha questions), open ("last"/"today"), favor ({"name":
             commentator, "value": 1 always / -1 leave out / 0 normal}), mine
             ({"masechta": tractate, "add": true/false}); else [],
 "language": "he" if they spoke mostly Hebrew, "en" if mostly English,
 "reply": only when kind is "ping": the few words a study partner across the
          table would say back to exactly this, in their language. "Yes, I
          hear you." only if they asked whether you hear them; "we have some
          time then" gets "Plenty -- let's learn."; "let's start from the
          gemara" gets "Go ahead."; "כן, שומע אותך.", "יאללה, קדימה.". Else null}

The kinds:
%s
- reading: they are reading the text aloud, not saying anything about it
- navigate: they asked to go to another page ("go to daf 5", "תעבור לדף ה׳ עמוד ב")

Hebrew numerals for pages: ב=2, י=10, יא=11, טו=15, כ=20, ל=30, מ=40, נ=50, ס=60.
"עמוד א" is a, "עמוד ב" is b. If no amud is said, use a.`,
KINDS, who.MASECHTOT.map((m) => fmt("%s (%s)", m.name, m.he)).join(", "),
[...Object.entries(who.ROUTES), ...Object.entries(LIGHT)].map(([k, v]) => fmt("- %s: %s", k, v)).join("\n"));


// They spoke while it was still answering: what is this to the answer?
export const CUT_IN_SYSTEM = `

They spoke while you were still answering something else. The message starts
with what you were answering and how far you got. Add a field:
 "cut_in": "aside" -- a quick question about something in what you were just
             saying or reading to them: a word, a name, "wait, who's that?",
             "what does that mean?". It will be answered briefly and then you
             go back to where you were. When unsure, this.
           "merge" -- they are correcting, narrowing or adding to what they
             asked: "no, I meant ...", "and in the Rambam?", "what about when
             ...", "I'm asking about the night". The question as it now stands
             is answered instead.
           "new" -- a different question, not about what you were saying.
           "later" -- they want to keep something for later: "remind me to
             ask ...", "let's come back to that", "נחזור לזה אחר כך".`;
export const CUT_INS = ["aside", "merge", "new", "later"];
export const LATER = re(String.raw`\b(later|come back to (it|that|this)|remind me|hold (on to )?that|park (it|that)|` +
                        String.raw`for another time)\b|אחר כך|נחזור לזה|תזכיר לי|תזכור את זה|בהמשך`, "i");
export const MERGE = re(String.raw`^\W*(no,? (i|what i) mean|i mean|i meant|actually|rather|not that|` +
                        String.raw`(and|but) (what about|also|in|according to)|what about|how about|` +
                        String.raw`לא,? (התכוונתי|אני מתכוון|הכוונה)|התכוונתי|בעצם|ומה עם|ומה לגבי|וגם)`, "i");


/** The line the router reads before their words, when they cut in. */
export function cut_in_context(cut) {
  const said = pysplit(cut.said || "").join(" ").slice(-300);
  const unsaid = pysplit(cut.unsaid || "").join(" ").slice(0, 200);
  return fmt("[you were answering «%s»; you had said: «...%s»; still to say: «%s...»]\n",
             (cut.asked || "").slice(0, 200), said, unsaid);
}


// Python's iteration of whatever the model put there: a list, a string's
// letters, a dict's keys.
const _items = (x) => (Array.isArray(x) ? x : typeof x === "string" ? [...x] : _dict(x) ? Object.keys(x) : []);


/** One short call to the budget model. On any failure, consult broadly.
 *
 * `cut`: what it was saying when they spoke ({asked, said, unsaid}); then the
 * answer also says what their words are to it (see CUT_IN_SYSTEM). */
export async function classify(llm, said, { cut = null } = {}) {
  const system = ROUTER_SYSTEM + (cut ? CUT_IN_SYSTEM : "");
  const content = (cut ? cut_in_context(cut) : "") + said;
  let out;
  try {
    out = await llm.json(system, [{ "role": "user", "content": content }], { heavy: false });
  } catch (e) {
    out = null;
  }
  if (out === undefined) out = null;
  let cut_kind = null;
  if (cut) {
    // The plain cases need no judgment; the rest are the model's call.
    const theirs = (out || {}).cut_in;
    cut_kind = search(LATER, said) ? "later" : search(MERGE, said) ? "merge"
      : _among(theirs, CUT_INS) ? theirs
        : (pysplit(said).length <= 12 ? "aside" : "new");
  }
  if (out === null) {
    return { "kind": "other", "claim": false, "names": [], "navigate": null, "language": null,
             "reply": null, "settings": [], "cut_in": cut_kind };
  }
  const kind = out.kind ?? null;
  let nav = out.navigate ?? null;
  const names = new Set(who.MASECHTOT.map((m) => m.name));
  if (_dict(nav) && truthy(nav.daf_yomi)) {
    nav = { "daf_yomi": true };
  } else if (!(_dict(nav) && /^\d+$/u.test(Object.hasOwn(nav, "daf") ? str(nav.daf) : ""))) {
    nav = null;
  } else {
    nav = { "daf": parseInt(str(nav.daf), 10), "amud": str(nav.amud ?? null).toLowerCase() === "b" ? "b" : "a",
            "masechta": names.has(nav.masechta) ? nav.masechta : null };
  }
  return {
    "kind": KINDS.includes(kind) ? kind : "other",
    "claim": truthy(out.claim),
    "names": _items(or(out.names ?? null, [])).filter((n) => truthy(n)).map((n) => str(n)).slice(0, 4),
    "navigate": nav,
    "language": ["he", "en"].includes(out.language) ? out.language : null,
    "reply": kind === "ping" && truthy(out.reply) ? str(out.reply).slice(0, 160) : null,
    "settings": kind === "settings" ? settings_changes(out.settings ?? null) : [],
    "cut_in": cut_kind,
  };
}


// -- a head start ----------------------------------------------------------------
// The router takes a second or two. For a plain question about the page --
// no other book to fetch, no page to turn, no setting -- the answer can start
// on a guess of its kind while the router decides; the server uses the head
// start only if the router agrees (see server.say), so a wrong guess costs
// tokens, never time.
export const SPECIAL = re(
  String.raw`\b(daf|page|amud|go to|turn to|faster|slower|louder|from now on|turn (off|on)|settings?|in (hebrew|english)|` +
  String.raw`remind|last time|yesterday|review|recap|refresh|summar|quiz|test me|did we (learn|see|study)|where did i|` +
  String.raw`who was|who were|when did|which century|lived|halacha|halakha|halachic|practice|practically|ruling|rule[sd]?|` +
  String.raw`codified|posek|poskim|tur|shulchan|rambam|mishnah berurah|rema|rama|zmanim|sunset|sunrise|` +
  String.raw`wikisource|halacha yomit|outline|desk|side|screen|note|save this|progress|streak|read (it|that|this)|` +
  String.raw`never ?mind|later|repeat|again|what did you say|hear me|can you hear|are you there|hello|thanks|thank you)\b|` +
  String.raw`דף|עמוד|תעבור|מהר|לאט|מעכשיו|הגדר|בעברית|באנגלית|תזכיר|חזרה|סיכום|תבחן|שאלות חזרה|למדנו|ראיתי|` +
  String.raw`מי היה|מתי חי|הלכה|הלכתא|למעשה|פסק|טור|שולחן ערוך|רמב\"?ם|משנה ברורה|רמ\"?א|זמנים|שקיעה|` +
  String.raw`הערה|תשמור|תקרא|שוב|לא משנה|עזוב|אחר כך|שומע|תודה`, "i");
export const GUESS_KINDS = [
  ["conflict", re(String.raw`\b(contradict\w*|but (earlier|before|above|on the other)|elsewhere|doesn'?t (fit|square|match)|` +
                  String.raw`inconsisten\w*|how does (this|that) (fit|square))\b|סתירה|סותר|והא|אבל (קודם|למעלה)`, "i")],
  ["logic", re(String.raw`\b(why|how come|what'?s the reason|reasoning|what (is|was) the machlok\w*|what are they arguing|` +
               String.raw`what'?s the difference)\b|למה|מדוע|מה הטעם|מאי טעמא|במה נחלקו|מה ההבדל`, "i")],
  ["structure", re(String.raw`\b(why is this here|how did we get|where are we|what is the gemara doing|where does this ` +
                   String.raw`(start|end)|structure|flow)\b|איך הגענו|מה הגמרא עושה|איפה אנחנו`, "i")],
  ["meaning", re(String.raw`\b(what does .{1,40} mean|meaning of|what is (a|an|the) \w+|what'?s (a|an|the) \w+|translate|` +
                 String.raw`define|definition)\b|מה (פירוש|זה|הכוונה|המשמעות)|פירוש המילה|מה זאת אומרת|תרגום`, "i")],
];


/** A route for a plain question about the page, or None: a guess of what
 * the router will say, good enough to start on. */
export async function guess(said, pack, line, { cut = null } = {}) {
  const words = pysplit(said || "");
  if (words.length < 4 || search(SPECIAL, said) || library.place_in(said)) {
    return null;
  }
  const present = new Set(pack.commentators());
  void present;
  const names = [];
  for (const w of findall(re(String.raw`[\w'\"״׳]+`), said)) {
    const target = ALIASES[_key(w)] ?? null;
    if (target && !names.includes(target)) {
      names.push(target);
    }
  }
  if (names.some((n) => !["Rashi", "Tosafot"].includes(n))) {
    return null;                        // another book: the router decides what to open
  }
  let kind = GUESS_KINDS.find(([, pattern]) => search(pattern, said))?.[0] ?? null;
  if (names.length && (kind === null || kind === "meaning")) {
    kind = "on_commentary";
  }
  kind = kind || "other";
  const hebrew = findall(re(String.raw`[א-ת]`), said).length > findall(re(String.raw`[A-Za-z]`), said).length;
  const route = { "kind": kind, "claim": false, "names": names, "navigate": null, "settings": [],
                  "language": hebrew ? "he" : "en", "reply": null, "cut_in": null };
  if (cut) {
    if (search(LATER, said)) {
      return null;
    }
    route.cut_in = search(MERGE, said) ? "merge" : (words.length <= 12 ? "aside" : "new");
  }
  if (truthy(await plan(pack, line, { ...route, said }))) {
    return null;                        // something to fetch: wait for the router
  }
  return route;
}


/** Whether the router's route is the guess -- the head start stands. */
export function agrees(real, guessed, { auto_language = false } = {}) {
  const a = new Set(or(real.names ?? null, [])), b = new Set(guessed.names);
  return (real.kind ?? null) === guessed.kind && a.size === b.size && [...a].every((x) => b.has(x)) &&
    !truthy(real.navigate ?? null) && !truthy(real.settings ?? null) &&
    (real.cut_in ?? null) === (guessed.cut_in ?? null) &&
    (!auto_language || (real.language ?? null) === guessed.language);
}


/** A commentator's comments within `reach` lines of n, nearest first. */
export function _near(pack, n, name, reach) {
  const found = [];
  for (const segment of pack.segments) {
    const distance = Math.abs(segment.n - n);
    if (distance <= reach) {
      for (const entry of segment.commentaries[name] || []) {
        found.push([distance, segment.n, name, entry]);
      }
    }
  }
  return sorted(found, (t) => [t[0], t[1]]).map(([, , name_, entry]) => [name_, entry]);
}


// Where a comment raises a difficulty. "That's the Tzelach's question" can only
// be said about questions it knows are on the page, so every comment near the
// line is scanned for one -- locally, with no call -- and the question itself
// is what the partner sees, not the whole comment.
// "אם כן למה" is the gemara's own question, quoted, not the commentator's.
export const ASKS = re(String.raw`קשה|קשיא|ק"ל|וא"ת|ואם תאמר|ואת"ל|תימה|תימא|תמוה|יש לדקדק|יש להקשות|יש לתמוה|` +
                       String.raw`צ"ע|צריך עיון|צ"ב|צריך ביאור|לכאורה|הקשה|מקשים|(?<!כן )(?<!א"כ )ו?למה|מדוע|` +
                       String.raw`מאי טעמא|מה טעם|ואין לומר|היאך`);
// Not someone who asks: a translation, and a digest of Tosafot's rulings.
export const NOT_ASKING = ["Steinsaltz", "Piskei Tosafot"];


/** A work's comments in the book's own order (Sefaria lists them otherwise). */
export function _in_order(entries) {
  return sorted(entries, (e) => findall(re(String.raw`\d+`), rsplit(e.ref, " ", 1).slice(-1)[0])
    .map((x) => (/^\d+$/u.test(x) ? parseInt(x, 10) : 0)));
}


// str.rfind(sub, 0, end): the last place before `end`, or -1.
const _rfind = (s, sub_, end) => (end <= 0 ? (sub_ === "" ? 0 : -1) : s.lastIndexOf(sub_, end - sub_.length));


/** (name, entry, the question in its words) for comments near line n that
 * raise a difficulty -- nearest first, at most three per work. */
export function asked_here(pack, n, { most = 12, words = 36 } = {}) {
  const sec = (pack.data.sections || []).find((x) => x.from <= n && n <= x.to) ?? null;
  let lines = pack.segments.filter((s) => (sec ? sec.from <= s.n && s.n <= sec.to : Math.abs(s.n - n) <= 2));
  lines = sorted(lines, (s) => [Math.abs(s.n - n), s.n]);
  const out = [], per = {};
  for (const segment of lines) {
    for (const [name, entries] of Object.entries(segment.commentaries)) {
      if (NOT_ASKING.includes(name)) {
        continue;
      }
      for (const entry of _in_order(entries)) {
        const text = pysplit(entry.he || "").join(" ");
        // Not "בתד"ה קשיא" -- the name of a Tosafot, not a question.
        let hit = null;
        for (const h of finditer(ASKS, text)) {
          if (!rstrip(text.slice(0, h.start())).endsWith('ד"ה')) {
            hit = h;
            break;
          }
        }
        if (!hit || (per[name] ?? 0) >= 3) {
          continue;
        }
        const start = _rfind(text, " ", hit.start()) + 1;      // from the word it is in
        const before = pysplit(text.slice(0, start)).slice(-8);
        const after = pysplit(text.slice(start)).slice(0, Math.max(0, words - before.length));
        out.push([name, entry, [...before, ...after].join(" ")]);
        per[name] = (per[name] ?? 0) + 1;
        if (out.length >= most) {
          return out;
        }
      }
    }
  }
  return out;
}


// How people actually say the names, mapped to what Sefaria calls them. Matched
// whole, never by prefix: a prefix match heard "Rashba" and fetched Rashi.
export const ALIASES = {
  "rashi": "Rashi", "רשי": "Rashi",
  "tosafot": "Tosafot", "tosafos": "Tosafot", "tosfos": "Tosafot", "tosfot": "Tosafot",
  "תוספות": "Tosafot", "tosafotharosh": "Tosafot HaRosh",
  "rashba": "Rashba", "רשבא": "Rashba", "ritva": "Ritva", "ריטבא": "Ritva",
  "ramban": "Ramban", "רמבן": "Ramban", "nachmanides": "Ramban",
  "rambam": "Rambam", "רמבם": "Rambam", "maimonides": "Rambam",
  "rif": "Rif", "ריף": "Rif", "rosh": "Rosh", "ראש": "Rosh",
  "ran": "Ran", "רן": "Ran", "meiri": "Meiri", "hameiri": "Meiri", "מאירי": "Meiri",
  "maharsha": "Maharsha", "מהרשא": "Maharsha", "rashash": "Rashash",
  "peneiyehoshua": "Penei Yehoshua", "pnei yehoshua": "Penei Yehoshua",
  "shitamekubetzet": "Shita Mekubetzet", "shittahmekubbetzet": "Shita Mekubetzet",
  "rabbeinuchananel": "Rabbeinu Chananel", "rabbeinutam": "Tosafot",
  "steinsaltz": "Steinsaltz", "rabbiakivaeiger": "Chiddushei Rabbi Akiva Eiger",
  "akivaeiger": "Chiddushei Rabbi Akiva Eiger", "tzelach": "Tzelach", "צלח": "Tzelach",
  // Past the page: reached through the links rather than found in the pack.
  "rabbeinuyonah": "Rabbeinu Yonah", "רבינויונה": "Rabbeinu Yonah",
  "tur": "Tur", "טור": "Tur", "הטור": "Tur",
  "shulchanarukh": "Shulchan Arukh", "shulchanaruch": "Shulchan Arukh",
  "שולחןערוך": "Shulchan Arukh", "שוע": "Shulchan Arukh",
  "rama": "Rema", "rema": "Rema", "ramo": "Rema", "רמא": "Rema",
  "mishnahberurah": "Mishnah Berurah", "mishnaberura": "Mishnah Berurah",
  "משנהברורה": "Mishnah Berurah", "magenavraham": "Magen Avraham",
  "taz": "Turei Zahav", "טז": "Turei Zahav", "beityosef": "Beit Yosef", "ביתיוסף": "Beit Yosef",
  "bach": "Bach", "arukhhashulchan": "Arukh HaShulchan", "kafhachayim": "Kaf HaChayim",
  "shiltei hagiborim": "Shiltei HaGiborim", "shilteihagiborim": "Shiltei HaGiborim",
  "kesefmishneh": "Kessef Mishneh", "kessefmishneh": "Kessef Mishneh", "כסףמשנה": "Kessef Mishneh",
  "raavad": "Hasagot HaRaavad", "haraavad": "Hasagot HaRaavad", "ראבד": "Hasagot HaRaavad",
  "השגותהראבד": "Hasagot HaRaavad", "lechemmishneh": "Lechem Mishneh", "לחםמשנה": "Lechem Mishneh",
  "mishnehlamelech": "Mishneh LaMelech", "משנהלמלך": "Mishneh LaMelech",
  "darkheimoshe": "Darkhei Moshe", "darkeimoshe": "Darkhei Moshe", "דרכימשה": "Darkhei Moshe",
  "prisha": "Prisha", "פרישה": "Prisha", "machatzithashekel": "Machatzit HaShekel",
  "מחציתהשקל": "Machatzit HaShekel", "perimegadim": "Peri Megadim", "primegadim": "Peri Megadim",
  "pri megadim": "Peri Megadim", "פרימגדים": "Peri Megadim", "shaareiteshuvah": "Sha'arei Teshuvah",
  "שערית שובה": "Sha'arei Teshuvah", "שעריתשובה": "Sha'arei Teshuvah",
  "eliyahrabbah": "Eliyah Rabbah", "אליהרבה": "Eliyah Rabbah",
  "beurhagra": "Beur HaGra", "biurhagra": "Beur HaGra", "gra": "Beur HaGra", "הגרא": "Beur HaGra",
  "beerheitev": "Ba'er Hetev", "baerhetev": "Ba'er Hetev", "בארהיטב": "Ba'er Hetev",
  "magenavraham": "Magen Avraham", "מגןאברהם": "Magen Avraham", "kafhachaim": "Kaf HaChayim",
  "כףהחיים": "Kaf HaChayim", "aruchhashulchan": "Arukh HaShulchan", "ערוךהשולחן": "Arukh HaShulchan",
  "biurhalacha": "Biur Halacha", "beurhalacha": "Biur Halacha", "ביאורהלכה": "Biur Halacha",
  "maharshal": "Maharshal", "מהרשל": "Maharshal", "chokhmatshlomo": "Maharshal",
  "maharam": "Maharam", "maharamlublin": "Maharam", "מהרם": "Maharam",
  "yaavetz": "Ya'avetz", "yavetz": "Ya'avetz", "יעבץ": "Ya'avetz",
  "tzlach": "Tzelach", "tzelach": "Tzelach", "raah": "Ra'ah", "ראה": "Ra'ah",
  "baalhamaor": "Ba'al HaMaor", "hamaor": "Ba'al HaMaor", "בעלהמאור": "Ba'al HaMaor",
  "benyehoyada": "Ben Yehoyada", "בןיהוידע": "Ben Yehoyada", "petacheinayim": "Petach Einayim",
  "פני יהושע": "Penei Yehoshua", "פנייהושע": "Penei Yehoshua",
};
const _alias = (k) => (Object.hasOwn(ALIASES, k) ? ALIASES[k] : null);

// The codes, and where each hangs: the Rema is inside the Shulchan Arukh's
// text; the later poskim are comments on its seif, or on the Tur's siman.
//
// Names as Sefaria's links call them (checked against its links on Shulchan
// Arukh OC 235:1 and 58:1, Tur OC 235:1 and Mishneh Torah, Reading the Shema
// 1:9 -- see docs/research/halacha.md).
export const CODES = ["Rambam", "Tur", "Shulchan Arukh"];
export const ON_THE_SEIF = ["Mishnah Berurah", "Magen Avraham", "Turei Zahav", "Kaf HaChayim",
                            "Beur HaGra", "Biur Halacha", "Ba'er Hetev", "Machatzit HaShekel", "Peri Megadim",
                            "Sha'arei Teshuvah", "Eliyah Rabbah"];
export const ON_THE_TUR = ["Beit Yosef", "Bach", "Darkhei Moshe", "Prisha"];
export const ON_THE_RIF = ["Rabbeinu Yonah", "Shiltei HaGiborim", "Ra'ah"];
export const ON_THE_RAMBAM = ["Kessef Mishneh", "Hasagot HaRaavad", "Lechem Mishneh", "Mishneh LaMelech"];
// Not linked to the seif on Sefaria, but numbered by the Shulchan Arukh's simanim.
export const BY_SIMAN = { "Arukh HaShulchan": "Arukh HaShulchan, Orach Chaim %s" };


export function _key(name) {
  return [...name.toLowerCase()].filter((ch) => /^[\p{L}\p{N}]$/u.test(ch)).join("");
}


/** Match a spoken name to one the pack holds ("Tosfos" -> "Tosafot"). */
export function _canonical(name, present) {
  const key = _key(name);
  for (const p of present) {
    if (_key(p) === key) {
      return p;
    }
  }
  const target = _alias(key) || _alias(name.toLowerCase());
  return _has(present, target) ? target : null;
}


/** A spoken name as the pack or the library knows it, or None. */
export function resolve(name, present) {
  return _canonical(name, present) || _alias(_key(name)) || _alias(name.toLowerCase());
}


// Where a commentary says it is ruling. Positional choice picked the Meiri's
// opening paragraph when asked about halacha, while "ולענין פסק הלכה" sat three
// comments further down the same amud.
export const RULING = re(String.raw`^.{0,40}?(פסק|הלכה|הלכתא|נמצא|לענין מעשה|והלכך)`);

// Small exchanges and page-turns open nothing: a mic check does not need the Meiri.
// Questions about people open no commentary either; they fetch the people.
export const QUIET = ["ping", "reading", "navigate", "people", "review", "quiz", "recall", "settings"];


/** Sources already in the pack that come into this one turn, beyond the backbone. */
export function extras(pack, n, route, { depth = "daf", budget = 7 } = {}) {
  const kind = route.kind ?? null;
  if (QUIET.includes(kind)) {
    return [];
  }
  const masechta = pack.data.masechta ?? "";
  const present = new Set(pack.commentators());
  const backbone = new Set(who.backbone_for(masechta));
  const chosen = [];

  const add = (pair) => {
    if (!_in_list(pair, chosen)) {
      chosen.push(pair);
    }
  };

  const take = (names, reach, { per = 2, most = null } = {}) => {
    let got = 0;
    for (const wanted of names) {
      for (const name of who.filed(wanted, present)) {
        if (backbone.has(name) || (most !== null && got >= most)) {
          continue;
        }
        const pairs = _near(pack, n, name, reach).slice(0, per);
        for (const pair of pairs) {
          add(pair);
        }
        got += pairs.length ? 1 : 0;
      }
    }
  };

  // Named by the learner: always, and look across the whole amud for them --
  // Sefaria hangs the Rosh on this mishna off line 12.
  for (const spoken of route.names ?? []) {
    const match_ = _canonical(spoken, present) || (
      truthy(who.filed(_alias(_key(spoken)) ?? "", present)) ? _alias(_key(spoken)) : null);
    if (match_) {
      const before = chosen.length;
      take([match_], 2, { per: 3 });
      if (chosen.length === before) {
        take([match_], 99, { per: 2 });
      }
    }
  }

  const named = chosen.length;
  // The learner's favourites, where they have something in this unit.
  if (Object.hasOwn(who.ROUTES, kind ?? "") && truthy(route.prefer ?? null)) {
    const sec = (pack.data.sections || []).find((x) => x.from <= n && n <= x.to) ?? null;
    let unit = pack.segments.filter((s) => (sec ? sec.from <= s.n && s.n <= sec.to : Math.abs(s.n - n) <= 2));
    unit = sorted(unit, (s) => Math.abs(s.n - n));
    for (const wanted of route.prefer) {
      for (const name of who.filed(wanted, present)) {
        const s = unit.find((s_) => truthy(s_.commentaries[name] ?? null));
        const entry = s ? s.commentaries[name][0] : null;
        if (entry && !backbone.has(name)) {
          add([name, entry]);
        }
      }
    }
  }
  if (kind === "halacha") {
    // Where the Rishonim on this amud say how it is ruled, wherever it
    // sits -- one ruling each, not four paragraphs of the same Meiri.
    // The digests first; the Meiri last -- an overview, light for psak.
    const ruled = new Set();
    for (const segment of pack.segments) {
      for (const name of ["Rosh", "Rif", "Rashba", "Tosafot HaRosh", "Meiri"]) {
        if (ruled.has(name)) {
          continue;
        }
        for (const entry of segment.commentaries[name] || []) {
          if (search(RULING, entry.he)) {
            add([name, entry]);
            ruled.add(name);
            break;
          }
        }
      }
    }
    take(["Rif", "Rosh"], 99, { per: 1 });
  // Otherwise by what kind of work answers what kind of question: a question
  // on Tosafot goes to his explainers (the Maharsha, Tosafot HaRosh), a
  // contradiction with another sugya to R' Akiva Eiger, "why" to the
  // Catalonian novellae, an aggadah to the Maharsha's Chidushei Agadot and the
  // Ben Yehoyada.
  } else if (kind === "conflict") {
    take([...who.ASK["conflict"], ...who.wide_for(masechta, { kinds: [kind] })], 1, { per: 1, most: 3 });
  } else if (kind === "logic") {
    take([...who.ASK["logic"], ...who.wide_for(masechta, { kinds: [kind] })], 1, { per: 1, most: 3 });
  } else if (kind === "on_commentary") {
    const names = new Set((route.names ?? []).map((x) => resolve(x, present)));
    const ask = names.has("Tosafot") ? who.ASK["on_tosafot"]
      : names.has("Rashi") ? who.ASK["on_rashi"] : who.ASK["on_commentary"];
    take(ask, 1, { per: 1, most: 3 });
  } else if (kind === "aggadah") {
    take(who.ASK["aggadah"], 1, { per: 1, most: 3 });
  } else if (kind === "structure") {
    take(["Meiri"], 1, { per: 1 });
  }

  // Depth widens questions about the page, not chat. It offers a few voices,
  // not everyone: in use it opened six a turn, and because the Meiri has a
  // comment on nearly every line he was in every one of them, and in almost
  // every answer. So: at most three, one comment each, and whoever was cited
  // in the last answers goes to the back of the line.
  if (Object.hasOwn(who.ROUTES, kind ?? "") && ["rishonim", "acharonim"].includes(depth)) {
    const pool = [...who.wide_for(masechta).slice(0, 6), ...(depth === "acharonim" ? ACHARONIM : [])];
    const avoid = new Set(or(route.avoid ?? null, []));
    const fresh = pool.filter((x) => !avoid.has(x));     // the just-cited sit this one out
    let room = Math.min(3, or(route.voices ?? null, 3));
    for (const name of fresh) {
      if (room <= 0) {
        break;
      }
      if (backbone.has(name) || !present.has(name) || chosen.some(([nm]) => nm === name)) {
        continue;
      }
      const got = _near(pack, n, name, 1).slice(0, 1);
      if (got.length) {
        add(got[0]);
        room -= 1;
      }
    }
  }

  // One comment per commentator unless the learner asked for him by name;
  // nobody they asked to leave out, unless they name him; and no more
  // unasked voices than they set (a halacha chain needs at least three).
  const mute = new Set(or(route.mute ?? null, []));
  let voices = or(route.voices ?? null, 3);
  if (kind === "halacha") {
    voices = Math.max(voices + 2, 5);
  }
  const out = [], seen = new Set();
  let unasked = 0;
  chosen.forEach(([name, entry], i) => {
    if (i >= named) {
      if (seen.has(name) || mute.has(name)) {
        return;
      }
      if (!seen.has(name) && unasked >= voices) {
        return;
      }
      unasked += 1;
    }
    seen.add(name);
    out.push([name, entry]);
  });
  return out.slice(0, budget);
}


export function _line_refs(pack, n, { reach = 0 } = {}) {
  const lines = pack.segments.filter((s) => Math.abs(s.n - n) <= reach);
  return sorted(lines, (s) => Math.abs(s.n - n));
}


/** What to go and get from Sefaria for this turn -- the calls past the page.
 *
 * Returns [(job, label)], where a job is what library.gather runs and the
 * label is the book as a person would say it, for "let me pull up ...". */
export async function plan(pack, n, route) {
  const kind = route.kind ?? null;
  if (kind === "people") {
    return people_plan(pack, route);
  }
  if (kind === "review" || kind === "recall") {
    // "The last nine pages": the D.A.F. outline of every daf in the stretch
    // (one quick page each, side by side), and a recap made from the text
    // only for the last amud or two -- the one they want in detail. In use
    // twelve recaps, each building its page first, ran past the deadline
    // and the answer came back with almost nothing.
    const pages = or(route.pages ?? null, []);
    const outlines = or(route.sites ?? null, []).includes(web.DAF_SITE);
    const dafim = [];
    for (const ref of pages) {
      const m = match(re(String.raw`^(.+) (\d+)[ab]$`), ref);
      if (m && !_in_list([m.group(1), parseInt(m.group(2), 10)], dafim)) {
        dafim.push([m.group(1), parseInt(m.group(2), 10)]);
      }
    }
    const kept = [];
    for (const ref of pages) {
      if (await review.has_recap(ref)) kept.push(ref);
    }
    const recaps = [...kept, ...pages.slice(-(outlines ? 2 : 6))];
    let jobs = [...new Set(pages.filter((r) => recaps.includes(r)))].map((ref) => [["recap", ref], "Recap"])
      .concat(or(route.parallels ?? null, []).map((ref) => [["text", ref], "Parallels"]));
    if (outlines) {
      jobs = jobs.concat(dafim.slice(-10).map(([m, d]) => [["outline", m, d], "D.A.F. outline"]));
    }
    return jobs;
  }
  if (QUIET.includes(kind) || kind === "check_reading") {
    return [];
  }
  const present = new Set(pack.commentators());
  const jobs = [];

  const add = (job, label) => {
    if (!_in_list(job, jobs.map(([j]) => j))) {
      jobs.push([job, label]);
    }
  };

  // The ein mishpat of the whole unit they are in, nearest lines first, two
  // per code: asked from the end of the mishna about its opening, the line
  // alone pointed at the Rambam on sacrifices rather than on Shema.
  const sec = (pack.data.sections || []).find((x) => x.from <= n && n <= x.to) ?? null;
  let lines = or(pack.segments.filter((s) => sec && sec.from <= s.n && s.n <= sec.to), _line_refs(pack, n, { reach: 3 }));
  lines = sorted(lines, (s) => Math.abs(s.n - n));
  const found = {}, titles = new Set();
  for (const segment of lines) {
    for (const ref of segment.halacha || []) {
      const book = library.name_of(ref);
      const title = rsplit(ref, " ", 1)[0];   // "Mishneh Torah, Reading the Shema"
      if (!CODES.includes(book) || (found[book] ??= []).includes(ref) || found[book].length >= 2) {
        continue;
      }
      if (book === "Rambam" && titles.has(title)) {
        continue;  // one halacha per set of hilchot, so each topic is heard
      }
      titles.add(title);
      found[book].push(ref);
    }
  }
  const codes = {};
  for (const [book, refs] of Object.entries(found)) codes[book] = refs[0];
  const rif = _line_refs(pack, n, { reach: 2 }).flatMap((s) => (s.commentaries["Rif"] || []).map((e) => e.ref)).slice(0, 1);

  let named = (route.names ?? []).map((x) => resolve(x, present));
  named = named.filter((x) => x);
  // The learner's table: a favourite poseik comes with every halacha
  // question; one they left out comes only when named.
  const prefer = [...or(route.prefer ?? null, [])].filter((x) => !named.includes(x));
  const mute = new Set([...or(route.mute ?? null, [])].filter((x) => !named.includes(x)));
  const wants_codes = kind === "halacha" || named.some(
    (x) => [...CODES, "Rema", ...ON_THE_SEIF, ...ON_THE_TUR, ...ON_THE_RAMBAM, ...Object.keys(BY_SIMAN)].includes(x));
  if (wants_codes) {
    for (const book of CODES) {
      if (mute.has(book)) {
        continue;
      }
      for (const ref of found[book] || []) {
        add(["text", ref], book);
      }
    }
    let later = or(named.filter((x) => ON_THE_SEIF.includes(x)),
                   ["Mishnah Berurah"].filter((x) => !mute.has(x)));
    if (kind === "halacha") {
      later = [...later, ...prefer.filter((p) => ON_THE_SEIF.includes(p) && !later.includes(p))];
    }
    for (const seif of found["Shulchan Arukh"] || []) {
      for (const book of later) {
        add(["follow", seif, book], book);
      }
    }
    const tur = codes["Tur"] ?? null;
    let on_tur = named.filter((x) => ON_THE_TUR.includes(x));
    if (kind === "halacha") {
      on_tur = [...on_tur, ...prefer.filter((p) => ON_THE_TUR.includes(p) && !on_tur.includes(p))];
    }
    for (const book of on_tur) {
      if (tur) {
        add(["follow", tur, book], book);
      }
    }
    // The Rambam's own commentators hang off his halacha.
    const rambam = !mute.has("Rambam") ? (codes["Rambam"] ?? null) : null;
    let on_rambam = named.filter((x) => ON_THE_RAMBAM.includes(x));
    if (kind === "halacha") {
      on_rambam = [...on_rambam, ...prefer.filter((p) => ON_THE_RAMBAM.includes(p) && !on_rambam.includes(p))];
    }
    for (const book of on_rambam) {
      if (rambam) {
        add(["follow", rambam, book], book);
      }
    }
    // Numbered by siman though Sefaria does not link them to it.
    const wanted = [...named.filter((x) => Object.hasOwn(BY_SIMAN, x)),
                    ...(kind === "halacha" ? prefer.filter((p) => Object.hasOwn(BY_SIMAN, p)) : [])];
    const seif = (found["Shulchan Arukh"] || [null])[0];
    const siman = search(re(String.raw`(\d+)(?::\d+)?$`), seif || "");
    for (const book of new Set(wanted)) {
      if (siman && seif.startsWith("Shulchan Arukh, Orach Chayim")) {
        add(["text", fmt(BY_SIMAN[book], siman.group(1))], book);
      }
    }
  }

  // A Rishon who is not on this page but hangs off the Rif. On Berakhot the
  // Rif is read with Talmidei Rabbeinu Yonah as a matter of course, so a
  // halacha question brings him unasked.
  const rif_voices = named.filter((x) => ON_THE_RIF.includes(x));
  if (kind === "halacha" && pack.data.masechta === "Berakhot" && !mute.has("Rabbeinu Yonah")) {
    rif_voices.push("Rabbeinu Yonah");
  }
  if (kind === "halacha") {
    rif_voices.push(...prefer.filter((p) => ON_THE_RIF.includes(p) && !rif_voices.includes(p)));
  }
  for (const book of rif_voices) {
    if (rif.length) {
      add(["follow", rif[0], book], book);
    }
  }

  // "I remember the opposite elsewhere": what the page itself points at.
  if (kind === "conflict") {
    const seg = pack.segment(n);
    const mine = re(String.raw`^` + escape(pack.data.masechta ?? "") + String.raw` \d+[ab]:\d+(-\d+)?$`);
    for (const ref of (seg.xrefs || []).filter((r) => match(mine, r)).slice(0, 2)) {
      add(["text", ref], ref);
    }
  }

  // "Give me numbers": tonight's real times, and a summer and a winter night
  // when they ask about the seasons.
  // Trusted sites, for what Sefaria does not have: Rav Ovadia's rulings on
  // Halacha Yomit, the Sha'ar HaTziyun on Wikisource. Named, asked for ("check
  // online"), or -- if the learner set it -- with every halacha question.
  const said_ = route.said || "";
  const sites = or(route.sites ?? null, []);
  let wanted = web.WORKS.filter(([d, pattern]) => sites.includes(d) && search(pattern, said_)).map(([d]) => d);
  if (search(web.ANY_SITE, said_)) {
    wanted = [...sites];
  }
  if (kind === "halacha" && truthy(route.sites_halacha ?? null) && sites.includes("halachayomit.co.il")) {
    wanted.push("halachayomit.co.il");
  }
  const seif = (found["Shulchan Arukh"] || [null])[0];
  const siman = search(re(String.raw`Orach Chayim (\d+)`), seif || "");
  for (const domain of new Set(wanted)) {
    if (domain === "he.wikisource.org") {
      add(["wiki", wiki_query(pack, n, said_, siman ? siman.group(1) : null)], web.label(domain));
    } else {
      const context = fmt("%s%s", pack.data.he_ref || pack.ref,
                          siman ? fmt(", שולחן ערוך אורח חיים סימן %s", siman.group(1)) : "");
      add(["site", domain, fmt("%s (%s)", said_, context)], web.label(domain));
    }
  }

  // A place named on its own ("let's say in Tel Aviv") is about the clock too:
  // in use that turn was answered with a sunset the model made up.
  const said = route.said || "";
  const place = route.place ?? null;
  if ((search(CLOCK, said) || library.place_in(said)) && ["halacha", "meaning", "other", "logic"].includes(kind)) {
    const today = store.today();
    add(["zmanim", today, place], "Zmanim");
    if (search(SEASONS, said)) {
      add(["zmanim", fmt("%d-06-21", +today.slice(0, 4)), place], "Zmanim");
      add(["zmanim", fmt("%d-12-21", +today.slice(0, 4)), place], "Zmanim");
    }
  }
  return jobs;
}


/** 235 -> רלה, as Wikisource titles number simanim. */
export function hebrew_number(n) {
  const [ones, tens, hundreds] = ["אבגדהוזחט", "יכלמנסעפצ", "קרשת"];
  let out = "";
  n = Math.trunc(Number(n));
  while (n >= 400) {
    [out, n] = [out + "ת", n - 400];
  }
  if (n >= 100) {
    [out, n] = [out + hundreds[Math.floor(n / 100) - 1], n % 100];
  }
  if (n === 15 || n === 16) {
    return out + (n === 15 ? "טו" : "טז");
  }
  if (n >= 10) {
    [out, n] = [out + tens[Math.floor(n / 10) - 1], n % 10];
  }
  return out + (n ? ones[n - 1] : "");
}


// The Wikisource works, as its titles name them, and how to find the place.
export const WIKI_WORKS = [
  [re(String.raw`sha'?ar ha-?tziyun|שער הציון`, "i"), "שער הציון", "siman"],
  [re(String.raw`birkei yosef|ברכי יוסף`, "i"), "ברכי יוסף אורח חיים", "siman"],
  [re(String.raw`chazon ish|חזון איש`, "i"), "חזון איש אורח חיים", "siman"],
  [re(String.raw`mordechai|מרדכי`, "i"), "מרדכי", "line"],
];


export function wiki_query(pack, n, said, siman) {
  for (const [pattern, work, by] of WIKI_WORKS) {
    if (search(pattern, said)) {
      if (by === "siman" && siman) {
        return fmt("%s %s", work, hebrew_number(siman));
      }
      if (by === "line") {
        const words = pysplit(pack.segment(n).he_plain).slice(0, 4);
        const masechta = (pack.data.he_ref || "").split(" ")[0];
        return fmt("%s %s %s", work, masechta, words.join(" "));
      }
      return work;
    }
  }
  return said;
}


/** Who they asked about -- by name, or, for "when did *he* live?", whoever
 * the last answers cited. A commentator on this page is looked up through his
 * own book, which names him exactly; anyone else by name. */
export function people_plan(pack, route) {
  const present = new Set(pack.commentators());
  let names = (route.names ?? []).map((x) => resolve(x, present) || x);
  if (!names.length) {
    names = [...or(route.avoid ?? null, [])];     // the ones just cited
  }
  const books = {};
  for (const segment of pack.segments) {
    for (const [name, entries] of Object.entries(segment.commentaries)) {
      for (const entry of entries) {
        if (!Object.hasOwn(books, name)) {
          books[name] = sub(re(String.raw`\s+\d+[ab]?(:\d+)*(-\d+)?$`), "", entry.ref);
        }
      }
    }
  }
  const jobs = [];
  for (const name of names.slice(0, 3)) {
    const job = ["person", name, Object.hasOwn(books, name) ? books[name] : null, pack.ref];
    if (!_in_list(job, jobs.map(([j]) => j))) {
      jobs.push([job, "some background on " + name]);
    }
  }
  return jobs;
}


export const CLOCK = re(String.raw`\b(what time|clock|o'?clock|numbers?|real[- ]world time|tonight|today|p\.?m\.?|a\.?m\.?|` +
                        String.raw`summer|winter|latest|last time (to|for|you can|one can|we can|i can)|sunset|sundown|sunrise|dawn|nightfall|dark|stars come out|` +
                        String.raw`how long (till|until|to|before))\b|מה השעה|באיזו שעה|עד איזו שעה|הלילה|היום|קיץ|חורף|` +
                        String.raw`שקיעה|השקיעה|זריחה|הזריחה|צאת הכוכבים|עלות השחר|מתי מחשיך|כמה זמן עד`, "i");
export const SEASONS = re(String.raw`\b(summer|winter|seasons?)\b|קיץ|חורף`, "i");
