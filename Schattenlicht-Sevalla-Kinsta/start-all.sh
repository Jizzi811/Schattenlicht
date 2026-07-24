#!/bin/sh
set -eu

VOICE_PID=""
WEB_PID=""

shutdown() {
  trap - TERM INT EXIT
  if [ -n "$VOICE_PID" ]; then
    kill "$VOICE_PID" 2>/dev/null || true
  fi
  if [ -n "$WEB_PID" ]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}

trap shutdown TERM INT EXIT

echo "Starte Schattenlicht Voice-Worker …"
/app/agent/.venv/bin/python /app/agent/src/start_self_hosted.py start &
VOICE_PID=$!

echo "Starte Schattenlicht Webseite …"
node server.mjs &
WEB_PID=$!

# Beide Prozesse müssen dauerhaft laufen. Beendet sich einer, wird der Pod
# kontrolliert beendet, damit Sevalla ihn neu startet und der Fehler im Log
# sichtbar bleibt.
while kill -0 "$VOICE_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 2
done

VOICE_STATUS=0
WEB_STATUS=0
wait "$VOICE_PID" || VOICE_STATUS=$?
wait "$WEB_PID" || WEB_STATUS=$?

if [ "$VOICE_STATUS" -ne 0 ]; then
  echo "Voice-Worker wurde mit Status $VOICE_STATUS beendet." >&2
  exit "$VOICE_STATUS"
fi

if [ "$WEB_STATUS" -ne 0 ]; then
  echo "Webserver wurde mit Status $WEB_STATUS beendet." >&2
  exit "$WEB_STATUS"
fi

exit 1
