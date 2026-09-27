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
VOICE_DIRECTION = ("A warm, sharp study partner in a beit midrash. Natural and "
                   "conversational, unhurried, never theatrical. Hebrew with an "
                   "Israeli accent; English plainly.")


class ModelError(RuntimeError):
    pass


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

    def models(self):
        """What this key can actually reach. Model names drift; this is truth."""
        try:
            return sorted(m.id for m in self.client.models.list())
        except Exception as exc:
            raise ModelError("could not list models: %s" % exc)

    # -- thinking ----------------------------------------------------------------

    def say(self, system, messages, heavy=True, max_tokens=None, as_json=False, cache_key=None):
        """One completion. `messages` is [{'role': 'user'|'assistant', 'content': str}]."""
        model = self.heavy if heavy else self.cheap
        budget = max_tokens or (4000 if heavy else 1200)
        if self.provider == "openai":
            return self._openai(model, system, messages, budget, as_json,
                                self.effort if heavy else "none", cache_key)
        return self._anthropic(model, system, messages, budget)

    def _openai(self, model, system, messages, budget, as_json, effort, cache_key):
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
                response = self.client.chat.completions.create(**kwargs)
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
                result = self.client.audio.transcriptions.create(file=buffer, **kwargs)
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
                response = self.client.audio.speech.create(**kwargs)
                audio = response.read()
                return audio, ("audio/wav" if audio[:4] == b"RIFF" else "audio/mpeg")
            except Exception as exc:
                if "instructions" in kwargs and _rejects(exc, "instructions"):
                    kwargs.pop("instructions")
                    continue
                if kwargs.get("voice") not in ("alloy", None) and _rejects(exc, "voice"):
                    kwargs["voice"] = "alloy"
                    continue
                raise ModelError("%s: %s" % (self.tts, exc))
        raise ModelError("%s: could not speak" % self.tts)


# -- what gets spoken ----------------------------------------------------------

QUOTE = re.compile(r"«[^»]*»")
CITE = re.compile(r"\[\[[^\]]+\]\]")


def speakable(text):
    """The reply as it should sound.

    Citations are for the screen. Quotations of the text -- which the partner
    wraps in «» -- are shown and highlighted on the page instead of read aloud,
    because synthesised Aramaic sounds wrong to exactly the ear that would
    notice, and reading the gemara is the learner's job, not the machine's.
    Everything else is spoken, in whatever language it is in.
    """
    out = CITE.sub("", text)
    out = QUOTE.sub(" … ", out)
    out = re.sub(r"\s+([,.;:?!])", r"\1", out)
    out = re.sub(r"(\s*…\s*){2,}", " … ", out)
    return re.sub(r"\s{2,}", " ", out).strip()
