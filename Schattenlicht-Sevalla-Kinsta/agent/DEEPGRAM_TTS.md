# Schattenlicht ohne LiveKit Inference

Der selbst gehostete Launcher `src/start_self_hosted.py` ersetzt die drei im Builder-Export eingetragenen LiveKit-Inference-Dienste, ohne den langen Systemprompt in `agent.py` umzubauen:

- STT: Deepgram Nova-3 direkt
- LLM: NVIDIA über die OpenAI-kompatible API
- TTS: Deepgram Aura-2 Julius direkt

## Benötigte Variablen

```text
LIVEKIT_URL=wss://DEIN-PROJEKT.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_AGENT_NAME=Schattenlicht-Selfhosted

DEEPGRAM_API_KEY=...
DEEPGRAM_STT_MODEL=nova-3
DEEPGRAM_STT_LANGUAGE=de
DEEPGRAM_TTS_MODEL=aura-2-julius-de

NVIDIA_API_KEY=...
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_LLM_MODEL=openai/gpt-oss-20b
```

Die Modellvariablen sind optional; die gezeigten Werte sind die eingebauten Standards. Die drei API-/LiveKit-Zugangsdaten sind erforderlich.

## Start

Mit Docker:

```bash
docker build -t schattenlicht-agent .
docker run --env-file .env.local schattenlicht-agent
```

Lokal:

```bash
uv sync
uv pip install "livekit-agents[deepgram,openai]~=1.5"
uv run python src/start_self_hosted.py console
```

Produktion:

```bash
uv run python src/start_self_hosted.py start
```

## Dispatch-Name

Der Launcher ersetzt den fest im Builder-Export eingetragenen Namen durch `LIVEKIT_AGENT_NAME`. Die Webseite muss denselben Namen bei der Raumerstellung anfordern. Für die parallele Testphase mit dem alten Builder-Agenten wird empfohlen:

```text
LIVEKIT_AGENT_NAME=Schattenlicht-Selfhosted
```

## Fehlerdiagnose

Der Worker protokolliert beim Start die ausgewählten Dienste und Modelle, aber niemals die Schlüssel. Fehlende Variablen führen zu einer eindeutigen Fehlermeldung.

Falls der Worker verbunden ist, aber keine Antwort erzeugt, zuerst prüfen:

1. Ist das NVIDIA-Modell unter dem verwendeten API-Key freigeschaltet?
2. Unterstützt das gewählte Modell Chat Completions und Tool-Aufrufe?
3. Ist bei Deepgram noch Guthaben beziehungsweise Kontingent vorhanden?
4. Stimmen `LIVEKIT_URL`, `LIVEKIT_API_KEY` und `LIVEKIT_API_SECRET` mit dem Projekt der Webseite überein?
5. Ist `LIVEKIT_AGENT_NAME` im Webprozess und Worker exakt gleich geschrieben?
