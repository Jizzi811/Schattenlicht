# Schattenlicht – Sevalla Application Hosting

Dieses Verzeichnis enthält die komplette Schattenlicht-Anwendung für Sevalla:

- die Webseite unter `public/`
- den Node-/Express-Endpunkt `/api/livekit-token`
- die Archetypen-Auswertung
- den selbst gehosteten LiveKit-Voice-Worker unter `agent/`
- Deepgram direkt für Spracherkennung und Julius-Sprachausgabe
- NVIDIA direkt als OpenAI-kompatibles Sprachmodell

Der Voice-Worker läuft außerhalb des LiveKit Agent Hostings. Er benötigt deshalb keinen zusätzlichen LiveKit-Cloud-Agent-Slot und verbraucht für STT, LLM und TTS kein LiveKit-Inference-Guthaben.

## Benötigte Environment Variables in Sevalla

Die folgenden Variablen müssen für die Anwendung beziehungsweise beide Prozesse verfügbar sein:

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

ALLOWED_ORIGINS=https://deine-domain.tld
```

`LIVEKIT_AGENT_NAME` muss beim Webprozess und beim Voice-Worker identisch sein. Der eigene Name `Schattenlicht-Selfhosted` verhindert, dass der alte Builder-Agent versehentlich einen Auftrag übernimmt.

## Sevalla-Build einstellen

In **Settings → Build strategy**:

```text
Build strategy: Dockerfile
Dockerfile path: Schattenlicht-Sevalla-Kinsta/Dockerfile
Context: Schattenlicht-Sevalla-Kinsta
```

Falls die Anwendung bereits mit dem Build-Pfad `Schattenlicht-Sevalla-Kinsta` angelegt wurde, kann der Dockerfile-Pfad in der Oberfläche je nach Darstellung auch nur `Dockerfile` lauten. Entscheidend ist, dass der Build-Kontext dieses Verzeichnis ist.

## Prozesse

Das Docker-Image enthält sowohl Node.js als auch den Python-Agenten.

### Webprozess

```text
npm start
```

Der Webprozess hört auf `PORT`, liefert die Webseite aus und erstellt die LiveKit-Zugangstoken.

### Background Worker

Unter **Processes → Create new process → Background worker** anlegen:

```text
Name: schattenlicht-voice
Start command: npm run voice
Instances: 1
```

Der Worker muss dauerhaft laufen. Hibernation oder Skalierung auf null darf für diesen Prozess nicht aktiv sein.

## Reihenfolge der Inbetriebnahme

1. Änderungen aus GitHub deployen.
2. Dockerfile als Build-Strategie auswählen.
3. Alle Environment Variables in Sevalla hinterlegen.
4. Webprozess mit `npm start` betreiben.
5. Background Worker mit `npm run voice` anlegen.
6. In den Worker-Logs prüfen, ob er sich als `Schattenlicht-Selfhosted` registriert.
7. Webseite neu laden und den Orb testen.

Der alte Builder-Agent darf während des Tests bestehen bleiben, weil die Webseite gezielt `Schattenlicht-Selfhosted` anfordert. Nach erfolgreichem Test kann der Builder-Agent gelöscht werden.

## Erwartete Logzeilen

Beim Start des Workers sollten unter anderem diese Hinweise erscheinen:

```text
LiveKit-Worker registriert sich als: Schattenlicht-Selfhosted
Deepgram STT wird direkt verwendet
NVIDIA LLM wird direkt verwendet
Deepgram TTS wird direkt verwendet
```

Fehlt eine Variable, beendet sich der Worker mit einer klaren Meldung, beispielsweise:

```text
NVIDIA_API_KEY fehlt. Hinterlege die Variable beim Hosting des Schattenlicht-Workers und starte den Prozess danach neu.
```

## Lokal starten

Webseite:

```bash
npm install
npm start
```

Voice-Worker:

```bash
cd agent
uv sync
uv pip install "livekit-agents[deepgram,openai]~=1.5"
uv run python src/start_self_hosted.py console
```

## Hinweise

- API-Schlüssel niemals in GitHub oder im Browsercode hinterlegen.
- Die Lautstärkeverstärkung im Browser bleibt in `public/orb-agent.js` aktiv.
- Der Health-Endpunkt des Webprozesses liegt unter `/health`.
- Der Voice-Worker ist ein Hintergrundprozess und benötigt keinen öffentlichen Port.
