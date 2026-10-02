// The small exchanges of sitting together, answered at once.
//
// "Hey, what's up?" went through speech recognition, a routing model, the
// partner and speech synthesis before a two-word answer came back -- six or
// seven seconds for "hey". Across a table that is an eternity. These are
// recognised from the words alone, answered from a short list with no model at
// all, and their audio is made once and kept, so they come back as fast as the
// recogniser can hear them.
//
// Only short utterances, and only when nothing in them is being read from the
// page: "I'm gonna read -- מאימתי קורין..." is reading, not small talk.

import { re, search, match, findall, pysplit, strip } from "./py.js";
import * as store from "./store.js";

export const EN = re(String.raw`[A-Za-z]`);

// (pattern, English replies, Hebrew replies). First match wins.
const _KINDS = [
  // "Enough" / "skip": the rest of the current answer is dropped.
  ["skip", String.raw`^(ok(ay)?,? )?(skip( it)?|next|enough|that'?s enough|stop|move on|די|דלג|הבא|מספיק|תפסיק)[.!]?$`,
   null, null],
  // "A bit faster" / "slower": the page changes its speaking speed.
  ["faster", String.raw`\b(speak|talk|go|say it|read)?\s*(a (bit|little) )?faster\b|\bspeed (it )?up\b|` +
             String.raw`(תדבר|דבר|תקרא)?\s*(קצת )?(יותר )?מהר( יותר)?\b`,
   null, null],
  ["slower", String.raw`\b(speak|talk|go|say it|read)?\s*(a (bit|little) )?slower\b|\bslow (it )?down\b|` +
             String.raw`(תדבר|דבר|תקרא)?\s*(קצת )?(יותר )?לאט( יותר)?\b`,
   null, null],
  // "What?" after an answer means it was not heard: say it again, don't
  // reassure them that *it* can hear ("Yes, I hear you" to "I didn't hear you").
  ["again", String.raw`^(what|huh|sorry|pardon)\??$|\bsay (that|it) again\b|\brepeat (that|it|yourself)\b|` +
            String.raw`\bi (didn'?t|did not|couldn'?t|can'?t|don'?t) (hear|catch) (you|that|it)\b|\bcome again\b|` +
            String.raw`^מה\??$|לא שמעתי|תחזור על זה|תגיד שוב|עוד פעם`,
   null, null],
  ["cant_hear", String.raw`\bi can'?t hear you\b|\bi don'?t hear you\b|אני לא שומע אותך`,
   ["Can you hear me now? I'll keep it short."], ["עכשיו אתה שומע אותי?"]],
  ["hear_me", String.raw`\b(can|do) you hear me\b|\bare you (there|with me)\b|\bhello\?|` +
              String.raw`אתה שומע( אותי)?|שומע אותי|אתה (שם|איתי)`,
   ["Yes, I hear you.", "I'm here, I hear you."], ["כן, שומע אותך.", "כאן, שומע."]],
  ["time", String.raw`\bwhat time is it\b|\bwhat'?s the time\b|מה השעה`,
   null, null],
  ["reading", String.raw`\b(i'?m )?(gonna|going to) read\b|\blet me read\b|\bhear me read\b|\blisten to me read\b|` +
              String.raw`^go ahead\b|אני (קורא|אקרא|הולך לקרוא)|תקשיב לי|בוא נקרא|` +
              String.raw`\blet'?s (continue|keep going|go on|move on)\b|נמשיך|בוא נמשיך`,
   ["Go ahead.", "Go ahead, I'm following."], ["קדימה.", "קדימה, אני איתך."]],
  ["thanks", String.raw`^(ok(ay)?,? )?(thanks|thank you)\b|^תודה`,
   ["Sure.", "Of course."], ["בשמחה.", "בכיף."]],
  ["help", String.raw`\bwhat can (i|you) (say|do)\b|\bwhat do you (do|know how to do)\b|^help\b|\bvoice commands\b|` +
           String.raw`מה אפשר להגיד|מה אתה יודע לעשות|מה אפשר לבקש|^עזרה`,
   ["You can say: faster, slower, answer in Hebrew, bring the Rishonim, leave out the Meiri, test me, " +
    "what did we learn yesterday, remind me of the mishna, today's daf, go to Shabbat 30, enough, or what?"],
   ["אפשר להגיד: יותר מהר, יותר לאט, תענה באנגלית, תביא ראשונים, בלי המאירי, תבחן אותי, " +
    "מה למדנו אתמול, תזכיר לי את המשנה, הדף היומי, תעבור לשבת ל׳, די, או מה?"]],
  ["hello", String.raw`^(hey|hi|hello|yo|good (morning|evening))\b|\bwhat'?s up\b|\bhow are you\b|\bhow'?s it going\b|` +
            String.raw`^(היי|הי|שלום|בוקר טוב|ערב טוב)|מה נשמע|מה קורה|מה שלומך`,
   ["Hey! All good — ready when you are.", "Good, thanks. Where are we starting?"],
   ["היי! הכל טוב, מוכן כשאתה מוכן.", "טוב, תודה. מאיפה מתחילים?"]],
];
export const KINDS = _KINDS.map(([k, p, en, he]) => [k, re(p, "i"), en, he]);

export const FILLER = new Set(["ok", "okay", "so", "um", "uh", "yeah", "yes", "well", "hey", "right", "now", "then",
  "again", "it", "you", "me", "i", "and", "אוקיי", "טוב", "אז", "יאללה", "רגע", "שוב", "כן"]);

// Every fixed reply, so its audio can be made ahead of time.
export const FIXED = KINDS.flatMap(([, , en, he]) => [...(en || []), ...(he || [])].filter((r) => r));


// Asking for something is never small talk: "so go ahead and answer" got "Go
// ahead." and "answer the question I asked" got "Yes, I hear you."
export const REQUEST = re(String.raw`\b(answer|explain|tell|repeat|continue|summari[sz]e|question|why|how|which|who|when|where)\b|` +
                          String.raw`תענה|ענה|תסביר|תגיד לי|שאלה|למה|איך|מי |מתי|איפה`, "i");


// "Um." and "Okay." are not turns. In use "Okay." got "Yes, I hear you." and
// "Um." got a second reply on top of "Go for it."
export const HESITATION = new Set(["um", "umm", "uh", "uhh", "hmm", "hm", "mm", "mmm", "mhm", "erm", "er", "ah", "אמ", "אממ",
  "אה", "אהה", "הממ", "ממ"]);
export const ACK = new Set(["ok", "okay", "right", "yes", "yeah", "yep", "sure", "cool", "great", "nice", "alright", "good",
  "got", "see", "i", "it", "so", "go", "ahead", "אוקיי", "טוב", "נכון", "כן", "סבבה", "יפה", "הבנתי", "אז"]);


export function words(said) {
  return findall(re(String.raw`[\w'א-ת]+`), said || "").map((w) => w.toLowerCase());
}

/** Only a sound while thinking: no reply at all. */
export function hesitation(said) {
  const w = words(said);
  return w.length > 0 && w.every((x) => HESITATION.has(x));
}

/** "Okay", "right", "got it", "yes" -- and nothing else. */
export function acknowledges(said) {
  const w = words(said);
  return w.length > 0 && w.length <= 4 && w.every((x) => ACK.has(x) || HESITATION.has(x));
}

/** [kind, text] for small talk, or null. `language` is the setting;
 *  `asked` is whether the partner's last words were a question -- then "okay"
 *  is an answer to it, for the partner.
 *
 *  kind "again" has no text: the client says its last answer once more; kind
 *  "filler" has none either, and nothing is said back.
 */
export function reply(said, { language = "en", asked = false } = {}) {
  const text = strip(said);
  if (!text || pysplit(text).length > 9) return null;
  if (hesitation(text) || (acknowledges(text) && !asked)) return ["filler", ""];
  if (search(REQUEST, text) && !search(re(String.raw`what time|מה השעה|say (that|it) again|repeat (that|it)|` +
                                          String.raw`let'?s (continue|keep going|go on|move on)`, "i"), text)) {
    return null;
  }
  for (const [kind, pattern, en, he] of KINDS) {
    const hit = search(pattern, text);
    if (!hit) continue;
    // Nothing else of substance said: "hey, what's the summary here?" is a question.
    const rest = findall(re(String.raw`[\w'א-ת]+`), text.slice(0, hit.start()) + " " + text.slice(hit.end()))
      .filter((w) => !FILLER.has(w.toLowerCase()));
    // "Can you talk a little bit faster?" is still just "faster": in use the
    // extra words sent it to the model, which could not change the speed.
    if (rest.length > (kind === "faster" || kind === "slower" ? 6 : 2)) return null;
    const hebrew = language === "he" || (language === "auto" && !search(EN, text));
    if (kind === "reading" && asked && match(re(String.raw`^\W*((ok(ay)?|yes|yeah|sure|so)\W+)*go ahead\W*$`, "i"), text)) {
      return null;     // "go ahead" after "want it?" is a yes, for the partner
    }
    if (["again", "faster", "slower", "skip"].includes(kind)) return [kind, ""];
    if (kind === "time") {
      const now = store.stamp().slice(11, 16);    // time.strftime("%H:%M")
      return [kind, hebrew ? "השעה " + now + ". ממשיכים?" : "It's " + now + ". Shall we keep going?"];
    }
    const choices = hebrew ? he : en;
    return [kind, choices[Math.floor(Math.random() * choices.length)]];   // random.choice
  }
  return null;
}
