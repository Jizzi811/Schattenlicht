"""Start Schattenlicht with Deepgram TTS billed directly by Deepgram.

The exported Agent Builder code in ``agent.py`` still constructs
``inference.TTS(model='deepgram/aura-2', ...)``. This launcher replaces only
that constructor with LiveKit's direct Deepgram plugin. STT and LLM remain
unchanged.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from dotenv import load_dotenv
from livekit.agents import inference
from livekit.plugins import deepgram

load_dotenv(".env.local")

logger = logging.getLogger("agent-Schattenlicht")
_original_inference_tts = inference.TTS


def _tts_with_direct_deepgram(*args: Any, **kwargs: Any):
    """Route the existing Deepgram Aura-2 config to Deepgram directly."""
    configured_model = kwargs.get("model")
    if configured_model is None and args:
        configured_model = args[0]

    if configured_model != "deepgram/aura-2":
        return _original_inference_tts(*args, **kwargs)

    api_key = os.getenv("DEEPGRAM_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "DEEPGRAM_API_KEY fehlt. Hinterlege den Key beim LiveKit-Agenten "
            "und deploye ihn danach erneut."
        )

    tts_model = os.getenv("DEEPGRAM_TTS_MODEL", "aura-2-julius-de").strip()
    if not tts_model:
        tts_model = "aura-2-julius-de"

    logger.info(
        "Deepgram TTS wird direkt verwendet (Modell: %s); "
        "LiveKit-Inference-Guthaben wird dafür nicht belastet.",
        tts_model,
    )
    return deepgram.TTS(model=tts_model, api_key=api_key)


# Apply the compatibility bridge before importing the generated agent module.
inference.TTS = _tts_with_direct_deepgram

import agent as schattenlicht_agent  # noqa: E402


if __name__ == "__main__":
    schattenlicht_agent.cli.run_app(schattenlicht_agent.server)
