# -*- coding: utf-8 -*-
"""Everything that talks to a model: thinking, listening, speaking.

Two jobs with very different value per token, so they get different models.
Deciding "was that a question about a word, a contradiction, or the halacha" is
classification and a budget model does it perfectly. Telling a learner that
their reading cannot stand and showing why from the page is the product, and
that is where the money goes.

Listening and speaking go through the same provider, so a sentence that starts
in English and lands in Aramaic is heard as one sentence, and an answer that
mixes Hebrew and English is spoken by one voice rather than two robots taking
turns.

Configured from the environment, because model names move faster than code:

    CHAVRUTA_PROVIDER        openai (default) | anthropic
    CHAVRUTA_MODEL_HEAVY     the chavruta's turn
    CHAVRUTA_MODEL_CHEAP     routing and classification
    CHAVRUTA_MODEL_STT       speech to text           (openai)
    CHAVRUTA_MODEL_TTS       text to speech           (openai)
    CHAVRUTA_VOICE           which voice              (openai)
    CHAVRUTA_EFFORT          how hard the heavy model thinks: none..high
"""

import io
import json
import os
import re

DEFAULTS = {
    # ~$2/$12 per Mtok heavy, ~$0.20/$1.20 cheap; cached input ~10x cheaper.
    "openai": {"heavy": "gpt-5.6-terra", "cheap": "gpt-5.6-luna",
               "stt": "gpt-transcribe", "tts": "gpt-4o-mini-tts", "voice": "cedar"},
    "anthropic": {"heavy": "claude-opus-5", "cheap": "claude-haiku-4-5"},
}

# How a chavruta sounds. Short, per OpenAI's own advice for this parameter.
# One person, one voice: in use, asking for an Israeli accent on the Hebrew and
# plain English made each switch of language sound like a different speaker.
VOICE_DIRECTION = ("A warm, sharp study partner in a beit midrash. Natural and "
                   "conversational, unhurried, never theatrical. Keep exactly the same "
                   "voice, pitch, pace and warmth throughout -- one person who moves "
                   "between English and Hebrew mid-sentence, never two speakers.")


class ModelError(RuntimeError):
    pass


def _loosen(kwargs, exc):
    """Drop or soften the one parameter a model refused. False if none applies."""
    ladder = {"none": "minimal", "minimal": "low"}
    if "reasoning_effort" in kwargs and _rejects(exc, "reasoning_effort", "reasoning effort"):
        nxt = ladder.get(kwargs["reasoning_effort"])
        if nxt:
            kwargs["reasoning_effort"] = nxt
        else:
            kwargs.pop("reasoning_effort")
        return True
    if "prompt_cache_key" in kwargs and _rejects(exc, "prompt_cache_key"):
        kwargs.pop("prompt_cache_key")
        return True
    if "max_completion_tokens" in kwargs and _rejects(exc, "max_completion_tokens"):
        kwargs["max_tokens"] = kwargs.pop("max_completion_tokens")
        return True
    return False


def _rejects(exc, *words):
    text = str(exc).lower()
    return any(w in text for w in words)


class LLM:
    def __init__(self, provider=None, heavy=None, cheap=None):
        self.provider = (provider or os.environ.get("CHAVRUTA_PROVIDER") or "openai").lower()
        if self.provider not in DEFAULTS:
            raise ModelError("unknown provider %r" % self.provider)
        picked = DEFAULTS[self.provider]
        self.heavy = heavy or os.environ.get("CHAVRUTA_MODEL_HEAVY") or picked["heavy"]
        self.cheap = cheap or os.environ.get("CHAVRUTA_MODEL_CHEAP") or picked["cheap"]
        self.stt = os.environ.get("CHAVRUTA_MODEL_STT") or picked.get("stt")
        self.tts = os.environ.get("CHAVRUTA_MODEL_TTS") or picked.get("tts")
        self.voice = os.environ.get("CHAVRUTA_VOICE") or picked.get("voice")
        # Latency is a hard constraint for a spoken partner, and the reasoning
        # models spend their thinking tokens before the first word. "low" keeps
        # a turn to a few seconds; raise it if answers feel shallow.
        self.effort = os.environ.get("CHAVRUTA_EFFORT", "low")
        self._client = None

    @property
    def can_hear(self):
        return self.provider == "openai" and bool(self.stt)

    @property
    def can_speak(self):
        return self.provider == "openai" and bool(self.tts)

    @property
    def client(self):
        if self._client is None:
            if self.provider == "openai":
                try:
                    from openai import OpenAI
                except ImportError:
                    raise ModelError("pip install openai")
                if not os.environ.get("OPENAI_API_KEY"):
                    raise ModelError("OPENAI_API_KEY is not set -- put it in .env")
                self._client = OpenAI(max_retries=2, timeout=60)
            else:
                try:
                    import anthropic
                except ImportError:
                    raise ModelError("pip install anthropic")
                self._client = anthropic.Anthropic()
        return self._client

    # A spoken partner cannot wait out a hung request: the client default is a
    # minute per try with two retries, which in use left the learner staring at
    # "listening" for over a minute before an error. Short leashes, one retry.
    LEASH = {"hear": (15, 1), "cheap": (12, 1), "heavy": (50, 1), "speak": (20, 1)}

    def leashed(self, job):
        timeout, retries = self.LEASH[job]
        try:
            return self.client.with_options(timeout=timeout, max_retries=retries)
        except AttributeError:
            return self.client

    def models(self):
        """What this key can actually reach. Model names drift; this is truth."""
        try:
            return sorted(m.id for m in self.client.models.list())
        except Exception as exc:
            raise ModelError("could not list models: %s" % exc)

    # -- thinking ----------------------------------------------------------------

    def say(self, system, messages, heavy=True, max_tokens=None, as_json=False, cache_key=None, effort=None):
        """One completion. `messages` is [{'role': 'user'|'assistant', 'content': str}]."""
        model = self.heavy if heavy else self.cheap
        budget = max_tokens or (4000 if heavy else 1200)
        if self.provider == "openai":
            return self._openai(model, system, messages, budget, as_json,
                                (effort or self.effort) if heavy else "none", cache_key,
                                "heavy" if heavy else "cheap")
        return self._anthropic(model, system, messages, budget)

    def say_stream(self, system, messages, cache_key=None, effort=None, max_tokens=None):
        """The partner's answer as it is written: yields pieces of text.

        Waiting for the whole answer before saying a word was most of the
        wait -- five to sixteen seconds. Streamed, the first sentence can be
        spoken while the rest is still being written. Where streaming is not
        available, the whole answer comes as one piece.
        """
        if self.provider != "openai":
            yield self.say(system, messages, heavy=True, cache_key=cache_key)
            return
        budget = max_tokens or 4000
        kwargs = {"model": self.heavy, "stream": True, "max_completion_tokens": budget,
                  "messages": [{"role": "system", "content": system}] + list(messages)}
        if effort or self.effort:
            kwargs["reasoning_effort"] = effort or self.effort
        if cache_key:
            kwargs["prompt_cache_key"] = cache_key
        stream = None
        for _ in range(6):
            try:
                stream = self.leashed("heavy").chat.completions.create(**kwargs)
                break
            except Exception as exc:
                if _rejects(exc, "stream"):
                    break
                if not _loosen(kwargs, exc):
                    raise ModelError("%s: %s" % (self.heavy, exc))
        if stream is None:
            yield self.say(system, messages, heavy=True, cache_key=cache_key, effort=effort)
            return
        said = False
        try:
            for chunk in stream:
                if not getattr(chunk, "choices", None):
                    continue
                piece = chunk.choices[0].delta.content if chunk.choices[0].delta else None
                if piece:
                    said = True
                    yield piece
        except Exception as exc:
            if said:
                raise ModelError("%s: cut off: %s" % (self.heavy, exc))
        if not said:
            # All of the budget went on thinking: ask again, whole, with more room.
            yield self.say(system, messages, heavy=True, cache_key=cache_key, effort=effort,
                           max_tokens=budget * 2)

    def _openai(self, model, system, messages, budget, as_json, effort, cache_key, job="heavy"):
        kwargs = {
            "model": model,
            # The system prompt carries the whole amud and holds still for the
            # session, so it goes first and the provider caches it.
            "messages": [{"role": "system", "content": system}] + list(messages),
            "max_completion_tokens": budget,
        }
        if effort:
            kwargs["reasoning_effort"] = effort
        if cache_key:
            kwargs["prompt_cache_key"] = cache_key
        if as_json:
            kwargs["response_format"] = {"type": "json_object"}

        # Each parameter below is dropped, one at a time, if the model says it
        # does not take it -- a model name we have not tested should degrade,
        # not fail.
        ladder = {"none": "minimal", "minimal": "low"}
        for _ in range(6):
            try:
                response = self.leashed(job).chat.completions.create(**kwargs)
            except Exception as exc:
                if "reasoning_effort" in kwargs and _rejects(exc, "reasoning_effort", "reasoning effort"):
                    nxt = ladder.get(kwargs["reasoning_effort"])
                    if nxt:
                        kwargs["reasoning_effort"] = nxt
                    else:
                        kwargs.pop("reasoning_effort")
                    continue
                if "prompt_cache_key" in kwargs and _rejects(exc, "prompt_cache_key"):
                    kwargs.pop("prompt_cache_key")
                    continue
                if "response_format" in kwargs and _rejects(exc, "response_format", "json_object"):
                    kwargs.pop("response_format")
                    continue
                if "max_completion_tokens" in kwargs and _rejects(exc, "max_completion_tokens"):
                    kwargs["max_tokens"] = kwargs.pop("max_completion_tokens")
                    continue
                if _rejects(exc, "v1/responses", "responses api", "not supported in the v1/chat"):
                    return self._openai_responses(model, system, messages, budget, as_json)
                raise ModelError("%s: %s" % (model, exc))
            choice = response.choices[0]
            text = (choice.message.content or "").strip()
            # Reasoning models spend the budget on thinking first; an empty
            # answer cut off at the limit means the budget was too small, not
            # that there was nothing to say.
            if not text and choice.finish_reason == "length":
                key = "max_completion_tokens" if "max_completion_tokens" in kwargs else "max_tokens"
                kwargs[key] = kwargs[key] * 2
                continue
            return text
        raise ModelError("%s: no answer after retries" % model)

    def _openai_responses(self, model, system, messages, budget, as_json):
        transcript = "\n\n".join("%s: %s" % (m["role"].upper(), m["content"]) for m in messages)
        kwargs = {"model": model, "instructions": system, "input": transcript,
                  "max_output_tokens": budget}
        if as_json:
            kwargs["text"] = {"format": {"type": "json_object"}}
        try:
            response = self.client.responses.create(**kwargs)
        except Exception as exc:
            raise ModelError("%s: %s" % (model, exc))
        return (getattr(response, "output_text", "") or "").strip()

    def _anthropic(self, model, system, messages, budget):
        try:
            response = self.client.messages.create(
                model=model, max_tokens=budget,
                system=[{"type": "text", "text": system,
                         "cache_control": {"type": "ephemeral"}}],
                messages=list(messages),
            )
        except Exception as exc:
            raise ModelError("%s: %s" % (model, exc))
        if response.stop_reason == "refusal":
            raise ModelError("the model declined that request")
        return "".join(b.text for b in response.content if b.type == "text").strip()

    def json(self, system, messages, heavy=False, max_tokens=None):
        """A completion parsed as JSON, tolerating a model that wraps it in prose."""
        raw = self.say(system, messages, heavy=heavy, max_tokens=max_tokens, as_json=True)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            start, end = raw.find("{"), raw.rfind("}")
            if start >= 0 and end > start:
                try:
                    return json.loads(raw[start:end + 1])
                except json.JSONDecodeError:
                    pass
            raise ModelError("expected JSON, got: %s" % raw[:200])

    # -- hearing ---------------------------------------------------------------

    def hear(self, audio, hint="", keywords=None, mime="audio/webm"):
        """Speech to text for someone reading Aramaic and talking in two languages.

        The hint is the text of the page near where they are. Telling the
        recogniser what it is about to hear is the cheapest accuracy there is:
        without it, Aramaic read aloud comes back as approximate Hebrew or
        approximate English.
        """
        if not self.can_hear:
            raise ModelError("speech recognition needs the openai provider")
        suffix = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4",
                  "audio/wav": "wav", "audio/mpeg": "mp3"}.get(mime.split(";")[0], "webm")
        prompt = ("Someone studying Talmud: they read the Aramaic aloud and talk about it "
                  "in English and Hebrew, often in the same sentence. " + hint)[:900]
        kwargs = {"model": self.stt, "prompt": prompt,
                  "languages": ["he", "en"], "keywords": (keywords or [])[:40]}
        for _ in range(4):
            buffer = io.BytesIO(audio)
            buffer.name = "speech.%s" % suffix
            try:
                result = self.leashed("hear").audio.transcriptions.create(file=buffer, **kwargs)
                return (getattr(result, "text", "") or "").strip()
            except Exception as exc:
                for optional in ("keywords", "languages", "prompt"):
                    if optional in kwargs and _rejects(exc, optional):
                        kwargs.pop(optional)
                        break
                else:
                    raise ModelError("%s: %s" % (self.stt, exc))
        raise ModelError("%s: could not transcribe" % self.stt)

    # -- speaking --------------------------------------------------------------

    def speak(self, text):
        """Text to speech. Returns (bytes, mime)."""
        if not self.can_speak:
            raise ModelError("natural voice needs the openai provider")
        kwargs = {"model": self.tts, "voice": self.voice, "input": text[:3800],
                  "instructions": VOICE_DIRECTION, "response_format": "mp3"}
        for _ in range(3):
            try:
                response = self.leashed("speak").audio.speech.create(**kwargs)
                audio = response.read()
                return audio, ("audio/wav" if audio[:4] == b"RIFF" else "audio/mpeg")
            except Exception as exc:
                if "instructions" in kwargs and _rejects(exc, "instructions"):
                    kwargs.pop("instructions")
                    continue
                # Never another voice as a fallback: one voice, or none.
                raise ModelError("%s: %s" % (self.tts, exc))
        raise ModelError("%s: could not speak" % self.tts)

    def speak_stream(self, text):
        """Text to speech as it is made, so playback starts before it is finished.

        Yields chunks of mp3. A parameter the model refuses is dropped and the
        request made again, as long as nothing has been sent yet.
        """
        if not self.can_speak:
            raise ModelError("natural voice needs the openai provider")
        kwargs = {"model": self.tts, "voice": self.voice, "input": text[:3800],
                  "instructions": VOICE_DIRECTION, "response_format": "mp3"}
        sent = False
        for _ in range(3):
            try:
                with self.leashed("speak").audio.speech.with_streaming_response.create(**kwargs) as response:
                    for chunk in response.iter_bytes(4096):
                        sent = True
                        yield chunk
                return
            except Exception as exc:
                if sent:
                    raise ModelError("%s: cut off: %s" % (self.tts, exc))
                if "instructions" in kwargs and _rejects(exc, "instructions"):
                    kwargs.pop("instructions")
                    continue
                raise ModelError("%s: %s" % (self.tts, exc))
        raise ModelError("%s: could not speak" % self.tts)


# -- what gets spoken ----------------------------------------------------------

QUOTE = re.compile(r"«([^»]*)»")
CITE = re.compile(r"\[\[([^\]]+)\]\]")
SEPARATOR = re.compile(r"^\|[\s:|-]+\|$")

# How a cited book is said aloud when the sentence leaned on the citation
# instead of naming it ("at [[Tur, Orach Chayim 235]] and ..." read as "at and").
SAY_AS = [("Mishneh Torah", "the Rambam"), ("Shulchan Arukh", "the Shulchan Aruch"),
          ("Tur,", "the Tur"), ("Rashi on", "Rashi"), ("Tosafot on", "Tosafot"),
          ("Mishnah Berurah", "the Mishnah Berurah")]


def said_as(ref):
    for prefix, name in SAY_AS:
        if ref.startswith(prefix):
            return name
    if " on " in ref:
        return ref.split(" on ")[0]
    head = ref.split(",")[0]
    return head.rsplit(" ", 1)[0] if head[-1:].isdigit() and " " in head else head


def _names(name):
    bare = name.replace("the ", "").lower()
    return {bare, bare.split()[0]}


def _cite_aloud(text):
    """Drop a citation that follows its name; say the book where nothing named it."""
    out, last = [], 0
    for m in CITE.finditer(text):
        before = text[max(0, m.start() - 60):m.start()].lower()
        name = said_as(m.group(1).strip())
        out.append(text[last:m.start()])
        hebrew_name = re.search(r"[א-ת][\"'״׳]?[א-ת]*\s*$", text[max(0, m.start() - 20):m.start()])
        if not (any(n in before for n in _names(name)) or hebrew_name):
            out.append(name)
        last = m.end()
    out.append(text[last:])
    return "".join(out)


def _table_aloud(rows):
    """A table read the way you would read it to someone: row by row."""
    spoken = []
    body = [r for r in rows if not SEPARATOR.match(r)]
    if len(body) > 1 and any(SEPARATOR.match(r) for r in rows):
        body = body[1:]  # the header row is for the eye
    for row in body:
        cells = [CITE.sub("", c).strip() for c in row.strip().strip("|").split("|")]
        cells = [c for c in cells if c]
        if cells:
            spoken.append(", ".join(cells) + ".")
    return " ".join(spoken)


def speakable(text):
    """The reply as it should sound.

    Everything is spoken, in whatever language it is in -- including the short
    quotations, which the partner marks with «» and which are also lit on the
    page. (Silencing them left the learner hearing "it begins … and ends …".)
    Citations are for the screen. A table is read out row by row.
    """
    lines, out, i = text.split("\n"), [], 0
    while i < len(lines):
        if lines[i].strip().startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i].strip())
                i += 1
            out.append(_table_aloud(rows))
            continue
        out.append(lines[i])
        i += 1
    spoken = _cite_aloud("\n".join(out))
    spoken = QUOTE.sub(lambda m: m.group(1), spoken)
    spoken = re.sub(r"\s+([,.;:?!])", r"\1", spoken)
    spoken = re.sub(r"(\s*…\s*){2,}", " … ", spoken)
    return re.sub(r"\s{2,}", " ", spoken).strip()
