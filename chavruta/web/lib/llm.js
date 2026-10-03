// Everything that talks to a model: thinking, listening, speaking.
//
// Two jobs with very different value per token, so they get different models.
// Deciding "was that a question about a word, a contradiction, or the halacha" is
// classification and a budget model does it perfectly. Telling a learner that
// their reading cannot stand and showing why from the page is the product, and
// that is where the money goes.
//
// Listening and speaking go through the same provider, so a sentence that starts
// in English and lands in Aramaic is heard as one sentence, and an answer that
// mixes Hebrew and English is spoken by one voice rather than two robots taking
// turns.
//
// Configured from `config` (web/lib/net.js), because model names move faster than code
// (on the Python server these were environment variables):
//
//     config.provider          openai (default) | anthropic           (CHAVRUTA_PROVIDER)
//     config.models.heavy      the chavruta's turn                    (CHAVRUTA_MODEL_HEAVY)
//     config.models.cheap      routing and classification             (CHAVRUTA_MODEL_CHEAP)
//     config.models.stt        speech to text           (openai)      (CHAVRUTA_MODEL_STT)
//     config.models.tts        text to speech           (openai)      (CHAVRUTA_MODEL_TTS)
//     config.models.voice      which voice              (openai)      (CHAVRUTA_VOICE)
//     config.effort            how hard the heavy model thinks: none..high   (CHAVRUTA_EFFORT)
//
// The Python used the OpenAI SDK. Here the same REST endpoints are called through
// net.js (the Worker holds the key), with the SDK's request bodies, its retries
// (connection errors, 408/409/429/5xx, with its backoff) and its error text
// ("Error code: 400 - {'error': {...}}"), so that _rejects() reads the same words.

import { config, request } from "./net.js";
import { re, search, match, sub, finditer, strip, pysplit, rsplit, str, repr, any, sorted, truthy } from "./py.js";

export const DEFAULTS = {
  // ~$2/$12 per Mtok heavy, ~$0.20/$1.20 cheap; cached input ~10x cheaper.
  "openai": {
    "heavy": "gpt-5.6-terra", "cheap": "gpt-5.6-luna",
    "stt": "gpt-transcribe", "tts": "gpt-4o-mini-tts", "voice": "cedar",
  },
  "anthropic": { "heavy": "claude-opus-5", "cheap": "claude-haiku-4-5" },
};

// How a chavruta sounds. Short, per OpenAI's own advice for this parameter.
// One person, one voice: in use, asking for an Israeli accent on the Hebrew and
// plain English made each switch of language sound like a different speaker.
export const VOICE_DIRECTION = ("A warm, sharp study partner in a beit midrash. Natural and " +
                                "conversational, at a brisk, lively pace -- never slow or drawn out, never theatrical. Keep exactly the same " +
                                "voice, pitch, pace and warmth throughout -- one person who moves " +
                                "between English and Hebrew mid-sentence, never two speakers.");

export class ModelError extends Error {}
ModelError.prototype.name = "ModelError";

// Python's str(exc): the message alone.
const exc_str = (exc) => (exc && exc.message !== undefined ? exc.message : str(exc));

export function _loosen(kwargs, exc) {
  // Drop or soften the one parameter a model refused. False if none applies.
  const ladder = { "none": "minimal", "minimal": "low" };
  if ("reasoning_effort" in kwargs && _rejects(exc, "reasoning_effort", "reasoning effort")) {
    const nxt = ladder[kwargs["reasoning_effort"]];
    if (nxt) kwargs["reasoning_effort"] = nxt;
    else delete kwargs["reasoning_effort"];
    return true;
  }
  if ("prompt_cache_key" in kwargs && _rejects(exc, "prompt_cache_key")) {
    delete kwargs["prompt_cache_key"];
    return true;
  }
  if ("max_completion_tokens" in kwargs && _rejects(exc, "max_completion_tokens")) {
    kwargs["max_tokens"] = kwargs["max_completion_tokens"];
    delete kwargs["max_completion_tokens"];
    return true;
  }
  return false;
}

export function _rejects(exc, ...words) {
  const text = exc_str(exc).toLowerCase();
  return words.some((w) => text.includes(w));
}

// -- the OpenAI client, as the SDK behaved -------------------------------------------

// The SDK's exceptions, with the text its str() gave.
export class APIError extends Error {
  constructor(message, { body = null } = {}) { super(message); this.body = body; }
}
export class APIStatusError extends APIError {
  constructor(message, { status, body = null } = {}) { super(message, { body }); this.status_code = status; }
}
export class APIConnectionError extends APIError {
  constructor(message = "Connection error.") { super(message); }
}
export class APITimeoutError extends APIConnectionError {
  constructor() { super("Request timed out."); }
}

const INITIAL_RETRY_DELAY = 0.5, MAX_RETRY_DELAY = 8.0, MAX_RETRY_AFTER_DELAY = 2 * 60;
const sleep = (seconds) => new Promise((ok) => setTimeout(ok, seconds * 1000));
// What httpx sent as the uploaded file's type: Python's mimetypes.guess_type of its name.
// The order the SDK put a transcription's fields in (its own, whatever the caller's).
const FORM_ORDER = ["model", "chunking_strategy", "include", "keywords", "known_speaker_names",
                    "known_speaker_references", "language", "languages", "prompt", "response_format",
                    "stream", "temperature", "timestamp_granularities"];
const FILE_TYPES = { "webm": "video/webm", "ogg": "audio/ogg", "mp4": "video/mp4", "wav": "audio/x-wav", "mp3": "audio/mpeg" };

function retry_after(headers) {
  const ms = parseFloat(headers.get("retry-after-ms"));
  if (Number.isFinite(ms)) return ms / 1000;
  const raw = headers.get("retry-after");
  if (raw === null) return null;
  const s = parseFloat(raw);
  if (Number.isFinite(s)) return s;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : (at - Date.now()) / 1000;
}

function should_retry(response) {
  const after = retry_after(response.headers);
  if (after !== null && Number.isFinite(after) && after > MAX_RETRY_AFTER_DELAY) return false;
  const header = response.headers.get("x-should-retry");
  if (header === "true") return true;
  if (header === "false") return false;
  return [408, 409, 429].includes(response.status) || response.status >= 500;
}

function retry_timeout(nb_retries, headers = null) {
  const after = headers ? retry_after(headers) : null;
  if (after !== null && Number.isFinite(after) && after > 0 && after <= MAX_RETRY_AFTER_DELAY) return after;
  const seconds = Math.min(INITIAL_RETRY_DELAY * 2 ** Math.min(nb_retries, 1000), MAX_RETRY_DELAY);
  return Math.max(0, seconds * (1 - 0.25 * Math.random()));
}

async function status_error(response) {
  const text = strip(await response.text());
  let body = text, message;
  try {
    body = JSON.parse(text);
    message = "Error code: " + response.status + " - " + str(body);
  } catch (e) {
    message = text || "Error code: " + response.status;
  }
  const data = body && typeof body === "object" && !Array.isArray(body) && "error" in body ? body.error : body;
  return new APIStatusError(message, { status: response.status, body: data });
}

const timed_out = (e) => e && (e.name === "TimeoutError" || e.message === "timed out");

/** A body read with a deadline: the SDK's client had a timeout on every read. */
async function deadline(promise, seconds, ctl) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, fail) => {
      timer = setTimeout(() => { ctl.abort(new Error("timed out")); fail(new APITimeoutError()); }, seconds * 1000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

/** Server-sent events, decoded as the SDK's SSEDecoder decodes them. */
async function* events(response, seconds, ctl) {
  const reader = response.body.getReader();
  const text = new TextDecoder("utf-8");
  let buffer = "", event = null, data = [], last_id = null, retry = null;
  const decode = (line) => {
    if (!line) {
      if (!event && !data.length && !last_id && retry === null) return null;
      const sse = { event, data: data.join("\n"), id: last_id, retry };
      event = null; data = []; retry = null;
      return sse;
    }
    if (line.startsWith(":")) return null;
    const at = line.indexOf(":");
    const field = at < 0 ? line : line.slice(0, at);
    let value = at < 0 ? "" : line.slice(at + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") { if (!value.includes("\0")) last_id = value; }
    else if (field === "retry") { const n = parseInt(value, 10); if (!Number.isNaN(n)) retry = n; }
    return null;
  };
  try {
    for (;;) {
      const { done, value } = await deadline(reader.read(), seconds, ctl);
      buffer += done ? text.decode() : text.decode(value, { stream: true });
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = done ? "" : lines.pop();
      if (done && lines.length && lines[lines.length - 1] === "") lines.pop();
      for (const line of lines) {
        const sse = decode(line);
        if (sse) yield sse;
      }
      if (done) {
        const sse = decode("");
        if (sse) yield sse;
        return;
      }
    }
  } finally {
    try { reader.releaseLock(); } catch (e) { /* already done */ }
  }
}

/** The SDK's Stream: chat.completion.chunk objects, an error event raised. */
async function* chunks(response, seconds, ctl) {
  try {
    for await (const sse of events(response, seconds, ctl)) {
      if (sse.data.startsWith("[DONE]")) break;
      const data = JSON.parse(sse.data);
      if (data && typeof data === "object" && !Array.isArray(data) && data.error) {
        const error = data.error;
        let message = error && typeof error === "object" ? error.message : null;
        if (!message || typeof message !== "string") message = "An error occurred during streaming";
        throw new APIError(message, { body: error });
      }
      yield data;
    }
  } finally {
    ctl.abort(new Error("closed"));
  }
}

/** What `OpenAI(max_retries=2, timeout=60)` was, over config.openai. */
export class OpenAIClient {
  constructor({ timeout = 60, max_retries = 2 } = {}) {
    this.timeout = timeout;
    this.max_retries = max_retries;
    const create = (path, opts = {}) => (kwargs) => this._create(path, kwargs, opts);
    this.chat = { completions: { create: create("/chat/completions") } };
    this.responses = { create: create("/responses") };
    this.audio = {
      transcriptions: { create: create("/audio/transcriptions", { form: true }) },
      speech: {
        create: create("/audio/speech", { binary: true }),
        with_streaming_response: { create: create("/audio/speech", { binary: true, streaming: true }) },
      },
    };
    this.models = { list: () => this._send("/models", { method: "GET" }).then(async ([r, ctl]) =>
      JSON.parse(await deadline(r.text(), this.timeout, ctl)).data) };
  }

  with_options({ timeout = null, max_retries = null } = {}) {
    return new OpenAIClient({ timeout: timeout ?? this.timeout, max_retries: max_retries ?? this.max_retries });
  }

  /** One request, retried as the SDK retried it: [Response, AbortController]. */
  async _send(path, { method = "POST", json = null, form = null, accept = "application/json" } = {}) {
    for (let nb = 0; ; nb++) {
      const remaining = this.max_retries - nb;
      const ctl = new AbortController();
      const headers = { "Accept": accept };
      let body = null;
      if (json !== null) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
      if (form !== null) body = form();           // FormData sets its own boundary
      let response;
      try {
        response = await request(config.openai + path, { method, headers, body, timeout: this.timeout, signal: ctl.signal });
      } catch (e) {
        if (remaining > 0) { await sleep(retry_timeout(nb)); continue; }
        throw timed_out(e) ? new APITimeoutError() : new APIConnectionError();
      }
      if (!response.ok) {
        if (remaining > 0 && should_retry(response)) {
          try { await response.body?.cancel(); } catch (e) { /* nothing to cancel */ }
          await sleep(retry_timeout(nb, response.headers));
          continue;
        }
        throw await status_error(response);
      }
      return [response, ctl];
    }
  }

  async _create(path, kwargs, { form = false, binary = false, streaming = false } = {}) {
    if (form) {
      // multipart/form-data as the SDK sent it: the fields in order, lists as
      // "name[]" once per item, then the file.
      const { file, ...fields } = kwargs;
      const build = () => {
        const data = new FormData();
        const order = Object.keys(fields).sort((a, b) => FORM_ORDER.indexOf(a) - FORM_ORDER.indexOf(b));
        for (const k of order) {
          const v = fields[k];
          if (v === undefined || v === null) continue;
          if (Array.isArray(v)) for (const item of v) data.append(k + "[]", String(item));
          else data.append(k, String(v));
        }
        const suffix = file.name.split(".").pop();
        data.append("file", new Blob([file.data], { type: FILE_TYPES[suffix] || "application/octet-stream" }), file.name);
        return data;
      };
      const [r, ctl] = await this._send(path, { form: build });
      return JSON.parse(await deadline(r.text(), this.timeout, ctl));
    }
    if (binary) {
      const [r, ctl] = await this._send(path, { json: kwargs, accept: "application/octet-stream" });
      if (streaming) return { iter_bytes: (size) => bytes(r, size, this.timeout, ctl) };
      return { read: async () => new Uint8Array(await deadline(r.arrayBuffer(), this.timeout, ctl)) };
    }
    const [r, ctl] = await this._send(path, { json: kwargs });
    if (kwargs.stream) return chunks(r, this.timeout, ctl);
    return JSON.parse(await deadline(r.text(), this.timeout, ctl));
  }
}

/** httpx's iter_bytes(size): chunks of exactly `size` bytes, the last one shorter. */
async function* bytes(response, size, seconds, ctl) {
  const reader = response.body.getReader();
  let held = new Uint8Array(0);
  try {
    for (;;) {
      const { done, value } = await deadline(reader.read(), seconds, ctl);
      if (value && value.length) {
        const joined = new Uint8Array(held.length + value.length);
        joined.set(held); joined.set(value, held.length);
        held = joined;
      }
      while (size && held.length >= size) {
        yield held.slice(0, size);
        held = held.slice(size);
      }
      if (done) break;
    }
    if (held.length) yield held;
  } finally {
    try { reader.releaseLock(); } catch (e) { /* already done */ }
    ctl.abort(new Error("closed"));
  }
}

export class LLM {
  constructor({ provider = null, heavy = null, cheap = null } = {}) {
    const models = config.models || {};
    this.provider = (provider || config.provider || "openai").toLowerCase();
    if (!(this.provider in DEFAULTS)) {
      throw new ModelError("unknown provider " + repr(this.provider));
    }
    const picked = DEFAULTS[this.provider];
    this.heavy = heavy || models.heavy || picked["heavy"];
    this.cheap = cheap || models.cheap || picked["cheap"];
    this.stt = models.stt || picked["stt"] || null;
    this.tts = models.tts || picked["tts"] || null;
    this.voice = models.voice || picked["voice"] || null;
    // Latency is a hard constraint for a spoken partner, and the reasoning
    // models spend their thinking tokens before the first word. "low" keeps
    // a turn to a few seconds; raise it if answers feel shallow.
    this.effort = config.effort ?? "low";
    this._client = null;
  }

  get can_hear() {
    return this.provider === "openai" && Boolean(this.stt);
  }

  get can_speak() {
    return this.provider === "openai" && Boolean(this.tts);
  }

  get client() {
    if (this._client === null) {
      if (this.provider === "openai") {
        // The key is the Worker's: the browser never holds it.
        this._client = new OpenAIClient({ max_retries: 2, timeout: 60 });
      } else {
        throw new ModelError("anthropic provider not available in the browser");
      }
    }
    return this._client;
  }

  // A spoken partner cannot wait out a hung request: the client default is a
  // minute per try with two retries, which in use left the learner staring at
  // "listening" for over a minute before an error. Short leashes, one retry.
  static LEASH = { "hear": [15, 1], "cheap": [12, 1], "heavy": [50, 1], "speak": [20, 1] };

  leashed(job) {
    const [timeout, retries] = LLM.LEASH[job];
    return this.client.with_options({ timeout, max_retries: retries });
  }

  async models() {
    // What this key can actually reach. Model names drift; this is truth.
    try {
      return sorted((await this.client.models.list()).map((m) => m.id));
    } catch (exc) {
      throw new ModelError("could not list models: " + exc_str(exc));
    }
  }

  // -- thinking ----------------------------------------------------------------

  async say(system, messages, { heavy = true, max_tokens = null, as_json = false, cache_key = null, effort = null } = {}) {
    // One completion. `messages` is [{'role': 'user'|'assistant', 'content': str}].
    const model = heavy ? this.heavy : this.cheap;
    const budget = max_tokens || (heavy ? 4000 : 1200);
    if (this.provider === "openai") {
      return this._openai(model, system, messages, budget, as_json,
                          heavy ? (effort || this.effort) : "none", cache_key,
                          { job: heavy ? "heavy" : "cheap" });
    }
    return this._anthropic(model, system, messages, budget);
  }

  async* say_stream(system, messages, { cache_key = null, effort = null, max_tokens = null } = {}) {
    // The partner's answer as it is written: yields pieces of text.
    //
    // Waiting for the whole answer before saying a word was most of the
    // wait -- five to sixteen seconds. Streamed, the first sentence can be
    // spoken while the rest is still being written. Where streaming is not
    // available, the whole answer comes as one piece.
    if (this.provider !== "openai") {
      yield await this.say(system, messages, { heavy: true, cache_key });
      return;
    }
    const budget = max_tokens || 4000;
    const kwargs = { "model": this.heavy, "stream": true, "max_completion_tokens": budget,
                     "messages": [{ "role": "system", "content": system }, ...messages] };
    if (effort || this.effort) kwargs["reasoning_effort"] = effort || this.effort;
    if (cache_key) kwargs["prompt_cache_key"] = cache_key;
    let stream = null;
    for (let _ = 0; _ < 6; _++) {
      try {
        stream = await this.leashed("heavy").chat.completions.create(kwargs);
        break;
      } catch (exc) {
        if (_rejects(exc, "stream")) break;
        if (!_loosen(kwargs, exc)) throw new ModelError(this.heavy + ": " + exc_str(exc));
      }
    }
    if (stream === null) {
      yield await this.say(system, messages, { heavy: true, cache_key, effort });
      return;
    }
    let spoke = false;
    try {
      for await (const chunk of stream) {
        if (!chunk.choices || !chunk.choices.length) continue;
        const piece = chunk.choices[0].delta ? chunk.choices[0].delta.content : null;
        if (piece) {
          spoke = true;
          yield piece;
        }
      }
    } catch (exc) {
      if (spoke) throw new ModelError(this.heavy + ": cut off: " + exc_str(exc));
    }
    if (!spoke) {
      // All of the budget went on thinking: ask again, whole, with more room.
      yield await this.say(system, messages, { heavy: true, cache_key, effort, max_tokens: budget * 2 });
    }
  }

  async _openai(model, system, messages, budget, as_json, effort, cache_key, { job = "heavy" } = {}) {
    const kwargs = {
      "model": model,
      // The system prompt carries the whole amud and holds still for the
      // session, so it goes first and the provider caches it.
      "messages": [{ "role": "system", "content": system }, ...messages],
      "max_completion_tokens": budget,
    };
    if (effort) kwargs["reasoning_effort"] = effort;
    if (cache_key) kwargs["prompt_cache_key"] = cache_key;
    if (as_json) kwargs["response_format"] = { "type": "json_object" };

    // Each parameter below is dropped, one at a time, if the model says it
    // does not take it -- a model name we have not tested should degrade,
    // not fail.
    const ladder = { "none": "minimal", "minimal": "low" };
    for (let _ = 0; _ < 6; _++) {
      let response;
      try {
        response = await this.leashed(job).chat.completions.create(kwargs);
      } catch (exc) {
        if ("reasoning_effort" in kwargs && _rejects(exc, "reasoning_effort", "reasoning effort")) {
          const nxt = ladder[kwargs["reasoning_effort"]];
          if (nxt) kwargs["reasoning_effort"] = nxt;
          else delete kwargs["reasoning_effort"];
          continue;
        }
        if ("prompt_cache_key" in kwargs && _rejects(exc, "prompt_cache_key")) {
          delete kwargs["prompt_cache_key"];
          continue;
        }
        if ("response_format" in kwargs && _rejects(exc, "response_format", "json_object")) {
          delete kwargs["response_format"];
          continue;
        }
        if ("max_completion_tokens" in kwargs && _rejects(exc, "max_completion_tokens")) {
          kwargs["max_tokens"] = kwargs["max_completion_tokens"];
          delete kwargs["max_completion_tokens"];
          continue;
        }
        if (_rejects(exc, "v1/responses", "responses api", "not supported in the v1/chat")) {
          return this._openai_responses(model, system, messages, budget, as_json);
        }
        throw new ModelError(model + ": " + exc_str(exc));
      }
      const choice = response.choices[0];
      const text = strip(choice.message.content || "");
      // Reasoning models spend the budget on thinking first; an empty
      // answer cut off at the limit means the budget was too small, not
      // that there was nothing to say.
      if (!text && choice.finish_reason === "length") {
        const key = "max_completion_tokens" in kwargs ? "max_completion_tokens" : "max_tokens";
        kwargs[key] = kwargs[key] * 2;
        continue;
      }
      return text;
    }
    throw new ModelError(model + ": no answer after retries");
  }

  async _openai_responses(model, system, messages, budget, as_json) {
    const transcript = messages.map((m) => m["role"].toUpperCase() + ": " + str(m["content"])).join("\n\n");
    const kwargs = { "model": model, "instructions": system, "input": transcript,
                     "max_output_tokens": budget };
    if (as_json) kwargs["text"] = { "format": { "type": "json_object" } };
    let response;
    try {
      response = await this.client.responses.create(kwargs);
    } catch (exc) {
      throw new ModelError(model + ": " + exc_str(exc));
    }
    return strip(output_text(response) || "");
  }

  async find_pages(query, domains, { limit = 3 } = {}) {
    // Pages on these sites that answer `query`: [(url, title)].
    //
    // Only the addresses are taken from the search; the pages themselves are
    // then read directly (library.page), so what the partner quotes is the
    // site's own text and not a search engine's retelling of it.
    if (this.provider !== "openai" || !truthy(domains)) return [];
    domains = [...domains];
    const kwargs = { "model": this.cheap, "input": query,
                     "tools": [{ "type": "web_search", "filters": { "allowed_domains": [...domains] } }],
                     "include": ["web_search_call.action.sources"] };
    let response;
    try {
      response = await this.leashed("cheap").responses.create(kwargs);
    } catch (exc) {
      if (!_rejects(exc, "include")) throw new ModelError("web search: " + exc_str(exc));
      delete kwargs["include"];
      try {
        response = await this.leashed("cheap").responses.create(kwargs);
      } catch (exc2) {
        throw new ModelError("web search: " + exc_str(exc2));
      }
    }
    const found = [];

    const keep = (url, title = "") => {
      const host = hostname(url || "");
      if (url && domains.some((d) => host === d || host.endsWith("." + d)) &&
          !found.map(([u]) => u).includes(url)) {
        found.push([url, title || ""]);
      }
    };

    const data = response;
    for (const item of data["output"] || []) {
      for (const source of ((item["action"] || {})["sources"] || [])) keep(source["url"], source["title"]);
      for (const part of item["content"] || []) {
        for (const note of part["annotations"] || []) {
          if (note["type"] === "url_citation") keep(note["url"], note["title"]);
        }
      }
    }
    return found.slice(0, limit);
  }

  async _anthropic(model, system, messages, budget) {
    // The Python called Anthropic's Messages API with the system prompt cached;
    // that SDK does not run in the browser and the Worker does not carry it.
    throw new ModelError("anthropic provider not available in the browser");
  }

  async json(system, messages, { heavy = false, max_tokens = null } = {}) {
    // A completion parsed as JSON, tolerating a model that wraps it in prose.
    const raw = await this.say(system, messages, { heavy, max_tokens, as_json: true });
    try {
      return JSON.parse(raw);
    } catch (e) {
      const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(raw.slice(start, end + 1));
        } catch (e2) {
          // fall through
        }
      }
      throw new ModelError("expected JSON, got: " + raw.slice(0, 200));
    }
  }

  // -- hearing ---------------------------------------------------------------

  async hear(audio, { hint = "", keywords = null, mime = "audio/webm" } = {}) {
    // Speech to text for someone reading Aramaic and talking in two languages.
    //
    // The hint is the text of the page near where they are. Telling the
    // recogniser what it is about to hear is the cheapest accuracy there is:
    // without it, Aramaic read aloud comes back as approximate Hebrew or
    // approximate English.
    if (!this.can_hear) throw new ModelError("speech recognition needs the openai provider");
    const suffix = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4",
                     "audio/wav": "wav", "audio/mpeg": "mp3" }[mime.split(";")[0]] || "webm";
    const prompt = ("Someone studying Talmud: they read the Aramaic aloud and talk about it " +
                    "in English and Hebrew, often in the same sentence. " + hint).slice(0, 900);
    const kwargs = { "model": this.stt, "prompt": prompt,
                     "languages": ["he", "en"], "keywords": (keywords || []).slice(0, 40) };
    for (let _ = 0; _ < 4; _++) {
      const buffer = { data: audio, name: "speech." + suffix };
      try {
        const result = await this.leashed("hear").audio.transcriptions.create({ file: buffer, ...kwargs });
        return strip((result && result.text) || "");
      } catch (exc) {
        let dropped = false;
        for (const optional of ["keywords", "languages", "prompt"]) {
          if (optional in kwargs && _rejects(exc, optional)) {
            delete kwargs[optional];
            dropped = true;
            break;
          }
        }
        if (!dropped) throw new ModelError(this.stt + ": " + exc_str(exc));
      }
    }
    throw new ModelError(this.stt + ": could not transcribe");
  }

  // -- speaking --------------------------------------------------------------

  async speak(text) {
    // Text to speech. Returns [bytes, mime].
    if (!this.can_speak) throw new ModelError("natural voice needs the openai provider");
    const kwargs = { "model": this.tts, "voice": this.voice, "input": text.slice(0, 3800),
                     "instructions": VOICE_DIRECTION, "response_format": "mp3" };
    for (let _ = 0; _ < 3; _++) {
      try {
        const response = await this.leashed("speak").audio.speech.create(kwargs);
        const audio = await response.read();
        return [audio, (String.fromCharCode(...audio.slice(0, 4)) === "RIFF" ? "audio/wav" : "audio/mpeg")];
      } catch (exc) {
        if ("instructions" in kwargs && _rejects(exc, "instructions")) {
          delete kwargs["instructions"];
          continue;
        }
        // Never another voice as a fallback: one voice, or none.
        throw new ModelError(this.tts + ": " + exc_str(exc));
      }
    }
    throw new ModelError(this.tts + ": could not speak");
  }

  async* speak_stream(text) {
    // Text to speech as it is made, so playback starts before it is finished.
    //
    // Yields chunks of mp3. A parameter the model refuses is dropped and the
    // request made again, as long as nothing has been sent yet.
    if (!this.can_speak) throw new ModelError("natural voice needs the openai provider");
    const kwargs = { "model": this.tts, "voice": this.voice, "input": text.slice(0, 3800),
                     "instructions": VOICE_DIRECTION, "response_format": "mp3" };
    let sent = false;
    for (let _ = 0; _ < 3; _++) {
      try {
        const response = await this.leashed("speak").audio.speech.with_streaming_response.create(kwargs);
        for await (const chunk of response.iter_bytes(4096)) {
          sent = true;
          yield chunk;
        }
        return;
      } catch (exc) {
        if (sent) throw new ModelError(this.tts + ": cut off: " + exc_str(exc));
        if ("instructions" in kwargs && _rejects(exc, "instructions")) {
          delete kwargs["instructions"];
          continue;
        }
        throw new ModelError(this.tts + ": " + exc_str(exc));
      }
    }
    throw new ModelError(this.tts + ": could not speak");
  }
}

/** The SDK's Response.output_text: every output_text of every message, joined. */
function output_text(response) {
  const texts = [];
  for (const output of (response && response.output) || []) {
    if (output.type === "message") {
      for (const content of output.content || []) {
        if (content.type === "output_text") texts.push(content.text);
      }
    }
  }
  return texts.join("");
}

/** urllib.parse.urlparse(url).hostname: lower case, or "" when there is none. */
function hostname(url) {
  const m = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)/.exec(url);
  if (!m) return "";
  let netloc = m[1];
  netloc = netloc.slice(netloc.lastIndexOf("@") + 1);
  if (netloc.startsWith("[")) {
    const end = netloc.indexOf("]");
    return end > 0 ? netloc.slice(1, end).toLowerCase() : "";
  }
  return netloc.split(":")[0].toLowerCase();
}


// -- what gets spoken ----------------------------------------------------------

export const QUOTE = re(String.raw`«([^»]*)»`);
export const CITE = re(String.raw`\[\[([^\]]+)\]\]`);
export const SEPARATOR = re(String.raw`^\|[\s:|-]+\|$`);

// How a cited book is said aloud when the sentence leaned on the citation
// instead of naming it ("at [[Tur, Orach Chayim 235]] and ..." read as "at and").
export const SAY_AS = [["Mishneh Torah", "the Rambam"], ["Shulchan Arukh", "the Shulchan Aruch"],
                       ["Tur,", "the Tur"], ["Rashi on", "Rashi"], ["Tosafot on", "Tosafot"],
                       ["Mishnah Berurah", "the Mishnah Berurah"]];


export function said_as(ref) {
  for (const [prefix, name] of SAY_AS) {
    if (ref.startsWith(prefix)) return name;
  }
  if (ref.includes(" on ")) return ref.split(" on ")[0];
  const head = ref.split(",")[0];
  return /^\p{Nd}$/u.test(head.slice(-1)) && head.includes(" ") ? rsplit(head, " ", 1)[0] : head;
}


export function _names(name) {
  const bare = name.replaceAll("the ", "").toLowerCase();
  const words = pysplit(bare);
  if (!words.length) throw new Error("IndexError: list index out of range");    // as bare.split()[0] did
  return new Set([bare, words[0]]);
}


// A citation the sentence leans on as a word: "the text at [[Tur ...]]".
export const AS_A_WORD = re(String.raw`\b(at|in|from|see|of|to|by|per|like|according to|than|with)\s*$`, "i");
export const AND = re(String.raw`\band\s*$`, "i");        // "at [[Tur]] and [[Shulchan Arukh]]": only after one said


export function _cite_aloud(text) {
  // Sources are for the screen: the voice reads only the body. The one
  // exception is a citation the sentence uses as a word ("we need the text at
  // [[Tur ...]]"): then the book's short name, or the sentence has a hole.
  const out = [];
  let last = 0, said = false;
  for (const m of finditer(CITE, text)) {
    const before = text.slice(Math.max(0, m.start() - 60), m.start());
    const name = said_as(strip(m.group(1)));
    out.push(text.slice(last, m.start()));
    const named = any([..._names(name)].map((n) => before.toLowerCase().includes(n)));
    const short = pysplit(name).length <= 3 && !search(String.raw`[:\d]`, name);
    said = Boolean((search(AS_A_WORD, before) || (said && search(AND, before))) && short && !named);
    if (said) out.push(name);
    last = m.end();
  }
  out.push(text.slice(last));
  // Brackets left holding nothing but the sources that were in them.
  return sub(String.raw`\s*\((\s|,|;|\band\b|\bsee\b|\bcf\.?|ראה|עיין|ו)*\)`, "", out.join(""));
}


export function _table_aloud(rows) {
  // A table read the way you would read it to someone: row by row.
  const spoken = [];
  let body = rows.filter((r) => !match(SEPARATOR, r));
  if (body.length > 1 && rows.some((r) => match(SEPARATOR, r))) {
    body = body.slice(1);  // the header row is for the eye
  }
  for (const row of body) {
    let cells = strip(strip(row), "|").split("|").map((c) => strip(sub(CITE, "", c)));
    cells = cells.filter((c) => c);
    if (cells.length) spoken.push(cells.join(", ") + ".");
  }
  return spoken.join(" ");
}

export function speakable(text) {
  // The reply as it should sound.
  //
  // Everything is spoken, in whatever language it is in -- including the short
  // quotations, which the partner marks with «» and which are also lit on the
  // page. (Silencing them left the learner hearing "it begins … and ends …".)
  // Citations are for the screen. A table is read out row by row.
  const lines = text.split("\n"), out = [];
  let i = 0;
  while (i < lines.length) {
    if (strip(lines[i]).startsWith("|")) {
      const rows = [];
      while (i < lines.length && strip(lines[i]).startsWith("|")) {
        rows.push(strip(lines[i]));
        i += 1;
      }
      out.push(_table_aloud(rows));
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }
  let spoken = _cite_aloud(out.join("\n"));
  spoken = sub(QUOTE, (m) => m.group(1), spoken);
  spoken = sub(String.raw`\s+([,.;:?!])`, String.raw`\1`, spoken);
  spoken = sub(String.raw`(\s*…\s*){2,}`, " … ", spoken);
  return strip(sub(String.raw`\s{2,}`, " ", spoken));
}
