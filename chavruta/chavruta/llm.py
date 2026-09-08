# -*- coding: utf-8 -*-
"""Talking to a model, cheaply where cheap is enough.

Two jobs with very different value per token, so they get different models.
Deciding "is this a question about a word, a contradiction, or the halacha"
is classification and a budget model does it perfectly. Telling a learner that
their reading cannot stand and showing why from the page is the product, and
that is where the money goes.

Splitting them is most of the cost story: the routing call is a couple of
hundred tokens against a small model, and the expensive call happens once per
turn with a system prompt that barely changes -- which providers cache
automatically at a large discount, so a long session pays full price for the
page roughly once.

Provider and models come from the environment, because model names move faster
than this file will:

    CHAVRUTA_PROVIDER      openai (default) | anthropic
    CHAVRUTA_MODEL_HEAVY   the chavruta turn
    CHAVRUTA_MODEL_CHEAP   routing and classification
"""

import json
import os

# Checked against published pricing in September 2026. Verify with `doctor`,
# which asks your key what it can actually reach -- these move.
DEFAULTS = {
    # ~$2/$12 per Mtok heavy, ~$0.20/$1.20 cheap, with cached input ~10x less.
    "openai": {"heavy": "gpt-5.6-terra", "cheap": "gpt-5.6-luna"},
    "anthropic": {"heavy": "claude-opus-5", "cheap": "claude-haiku-4-5"},
}


class ModelError(RuntimeError):
    pass


class LLM:
    def __init__(self, provider=None, heavy=None, cheap=None):
        self.provider = (provider or os.environ.get("CHAVRUTA_PROVIDER") or "openai").lower()
        if self.provider not in DEFAULTS:
            raise ModelError("unknown provider %r" % self.provider)
        picked = DEFAULTS[self.provider]
        self.heavy = heavy or os.environ.get("CHAVRUTA_MODEL_HEAVY") or picked["heavy"]
        self.cheap = cheap or os.environ.get("CHAVRUTA_MODEL_CHEAP") or picked["cheap"]
        self._client = None

    # -- clients ---------------------------------------------------------------

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
                self._client = OpenAI()
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

    # -- the one call everything goes through ----------------------------------

    def say(self, system, messages, heavy=True, max_tokens=1500, as_json=False):
        """One completion. `messages` is [{'role': 'user'|'assistant', 'content': str}]."""
        model = self.heavy if heavy else self.cheap
        if self.provider == "openai":
            return self._openai(model, system, messages, max_tokens, as_json)
        return self._anthropic(model, system, messages, max_tokens)

    def _openai(self, model, system, messages, max_tokens, as_json):
        # The system prompt carries the whole daf and does not change during a
        # session, so it sits first and the provider caches it for free.
        kwargs = {
            "model": model,
            "messages": [{"role": "system", "content": system}] + list(messages),
            "max_completion_tokens": max_tokens,
        }
        if as_json:
            kwargs["response_format"] = {"type": "json_object"}
        try:
            response = self.client.chat.completions.create(**kwargs)
        except Exception as exc:
            complaint = str(exc)
            # Older deployments still want the pre-2024 parameter name.
            if "max_tokens" in complaint and "max_completion_tokens" in complaint:
                kwargs["max_tokens"] = kwargs.pop("max_completion_tokens")
                response = self.client.chat.completions.create(**kwargs)
            # Some newer models are served only by the Responses API.
            elif "responses" in complaint.lower() or "v1/chat" in complaint:
                return self._openai_responses(model, system, messages, max_tokens, as_json)
            else:
                raise ModelError("%s: %s" % (model, complaint))
        return (response.choices[0].message.content or "").strip()

    def _openai_responses(self, model, system, messages, max_tokens, as_json):
        """The Responses API, for models that are not served on chat/completions."""
        transcript = "\n\n".join(
            "%s: %s" % (m["role"].upper(), m["content"]) for m in messages)
        kwargs = {"model": model, "instructions": system, "input": transcript,
                  "max_output_tokens": max_tokens}
        if as_json:
            kwargs["text"] = {"format": {"type": "json_object"}}
        try:
            response = self.client.responses.create(**kwargs)
        except Exception as exc:
            raise ModelError("%s: %s" % (model, exc))
        text = getattr(response, "output_text", None)
        if text is None:  # older shapes return the blocks instead
            text = "".join(getattr(c, "text", "") for item in
                           getattr(response, "output", []) or []
                           for c in getattr(item, "content", []) or [])
        return (text or "").strip()

    def _anthropic(self, model, system, messages, max_tokens):
        try:
            response = self.client.messages.create(
                model=model, max_tokens=max_tokens,
                system=[{"type": "text", "text": system,
                         "cache_control": {"type": "ephemeral"}}],
                thinking={"type": "adaptive"},
                messages=list(messages),
            )
        except Exception as exc:
            raise ModelError("%s: %s" % (model, exc))
        if response.stop_reason == "refusal":
            raise ModelError("the model declined that request")
        return "".join(b.text for b in response.content if b.type == "text").strip()

    def json(self, system, messages, heavy=False, max_tokens=400):
        """A completion parsed as JSON, with the model's slop tolerated."""
        raw = self.say(system, messages, heavy=heavy,
                       max_tokens=max_tokens, as_json=True)
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
