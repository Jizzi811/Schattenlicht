# Direkte Deepgram-Stimme für Schattenlicht

Schattenlicht verwendet für die Ausgabe weiterhin die deutsche Stimme **Julius** (`aura-2-julius-de`). Die TTS-Anfragen laufen jetzt über das offizielle Deepgram-Plugin von LiveKit direkt zu Deepgram. Dadurch wird für die Sprachausgabe kein LiveKit-Inference-Guthaben mehr verbraucht.

## Benötigte Variable

Beim separat deployten LiveKit-Agenten muss diese Umgebungsvariable gesetzt sein:

```text
DEEPGRAM_API_KEY=dein_deepgram_key
```

Optional lässt sich die Stimme ohne Codeänderung austauschen:

```text
DEEPGRAM_TTS_MODEL=aura-2-julius-de
```

Geeignete weitere deutsche Aura-2-Modelle sind beispielsweise `aura-2-fabian-de`, `aura-2-elara-de`, `aura-2-lara-de` oder `aura-2-kara-de`.

## Deployment

Der Docker-Startbefehl nutzt automatisch:

```text
src/start_with_deepgram.py
```

Nach dem Eintragen oder Ändern des Keys muss der **Python-Agent bei LiveKit Cloud neu deployt** werden. Ein Neustart nur der Webseite auf Sevalla/Kinsta reicht nicht, weil die Stimme im separaten Agent-Service erzeugt wird.

## Lokal testen

```bash
uv sync --locked
uv pip install "livekit-agents[deepgram]~=1.5"
uv run python src/start_with_deepgram.py console
```

## Fehlerdiagnose

Fehlt der Key, steht im Agent-Log ausdrücklich:

```text
DEEPGRAM_API_KEY fehlt. Hinterlege den Key beim LiveKit-Agenten und deploye ihn danach erneut.
```

Bei einem ungültigen Key, fehlendem Deepgram-Guthaben oder einem Provider-Fehler erscheint die eigentliche Deepgram-Fehlermeldung im LiveKit-Agent-Log.

## Wichtig

Nur die **Sprachausgabe** läuft damit direkt über Deepgram. Die aktuelle Spracherkennung (`assemblyai/...`) und das Sprachmodell (`xai/grok-4.5`) laufen im bestehenden Agent-Code weiterhin über LiveKit Inference und können dessen Guthaben weiterhin verbrauchen.
