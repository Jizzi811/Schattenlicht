"""Start Schattenlicht as a self-hosted LiveKit worker.

The Agent Builder export in ``agent.py`` still references LiveKit Inference.
This launcher replaces STT, LLM, and TTS with provider plugins before importing
that generated module:

- Deepgram Nova-3 for German speech recognition
- NVIDIA's OpenAI-compatible API for the language model
- Deepgram Aura-2 Julius for German speech output

It also overrides the fixed Builder dispatch name with ``LIVEKIT_AGENT_NAME``
and lowers the forest ambience so it cannot overpower the voice.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import livekit.agents as agents_module
from dotenv import load_dotenv
from livekit.agents import AgentServer, inference
from livekit.plugins import deepgram, openai

load_dotenv(".env.local")

logger = logging.getLogger("agent-Schattenlicht")
_original_rtc_session = AgentServer.rtc_session
_original_audio_config = agents_module.AudioConfig


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(
            f"{name} fehlt. Hinterlege die Variable beim Hosting des "
            "Schattenlicht-Workers und starte den Prozess danach neu."
        )
    return value


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} muss eine Zahl sein, zum Beispiel 0.02.") from exc


def _direct_deepgram_stt(*_args: Any, **_kwargs: Any):
    api_key = _required_env("DEEPGRAM_API_KEY")
    model = os.getenv("DEEPGRAM_STT_MODEL", "nova-3").strip() or "nova-3"
    language = os.getenv("DEEPGRAM_STT_LANGUAGE", "de").strip() or "de"
    logger.info(
        "Deepgram STT wird direkt verwendet (Modell: %s, Sprache: %s).",
        model,
        language,
    )
    return deepgram.STT(
        model=model,
        language=language,
        api_key=api_key,
    )


def _direct_nvidia_llm(*_args: Any, **_kwargs: Any):
    api_key = _required_env("NVIDIA_API_KEY")
    model = (
        os.getenv("NVIDIA_LLM_MODEL", "openai/gpt-oss-20b").strip()
        or "openai/gpt-oss-20b"
    )
    base_url = (
        os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1").strip()
        or "https://integrate.api.nvidia.com/v1"
    ).rstrip("/")
    logger.info(
        "NVIDIA LLM wird direkt verwendet (Modell: %s, Endpoint: %s).",
        model,
        base_url,
    )
    return openai.LLM(
        model=model,
        base_url=base_url,
        api_key=api_key,
    )


def _direct_deepgram_tts(*_args: Any, **_kwargs: Any):
    api_key = _required_env("DEEPGRAM_API_KEY")
    model = (
        os.getenv("DEEPGRAM_TTS_MODEL", "aura-2-julius-de").strip()
        or "aura-2-julius-de"
    )
    logger.info("Deepgram TTS wird direkt verwendet (Modell: %s).", model)
    return deepgram.TTS(
        model=model,
        api_key=api_key,
    )


def _rtc_session_with_configured_name(
    self: AgentServer,
    *args: Any,
    **kwargs: Any,
):
    agent_name = (
        os.getenv("LIVEKIT_AGENT_NAME", "Schattenlicht-Selfhosted").strip()
        or "Schattenlicht-Selfhosted"
    )
    kwargs["agent_name"] = agent_name
    logger.info("LiveKit-Worker registriert sich als: %s", agent_name)
    return _original_rtc_session(self, *args, **kwargs)


def _quiet_audio_config(*args: Any, **kwargs: Any):
    volume = max(0.0, min(1.0, _float_env("SCHATTENLICHT_AMBIENCE_VOLUME", 0.02)))
    kwargs["volume"] = volume
    logger.info("Hintergrundatmosphäre läuft mit Lautstärke %.2f.", volume)
    return _original_audio_config(*args, **kwargs)


# Apply the compatibility bridge before importing the generated Builder module.
inference.STT = _direct_deepgram_stt
inference.LLM = _direct_nvidia_llm
inference.TTS = _direct_deepgram_tts
AgentServer.rtc_session = _rtc_session_with_configured_name
agents_module.AudioConfig = _quiet_audio_config

import agent as schattenlicht_agent  # noqa: E402


if __name__ == "__main__":
    schattenlicht_agent.cli.run_app(schattenlicht_agent.server)
