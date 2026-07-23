# Schattenlicht – Sevalla Application Hosting

Dieses Paket ist für **Sevalla Application Hosting** (ehemals Kinsta Application Hosting) vorbereitet. Es enthält:

- die statische Schattenlicht-Homepage unter `public/`
- den eigenen LiveKit-Voice-Orb
- einen serverseitigen Token-Endpunkt unter `/api/livekit-token`
- die Archetypen-Auswertung unter `/api/calculate-archetype-profile`
- einen Health-Endpunkt unter `/health`

## Benötigte Environment Variables

```text
LIVEKIT_URL=wss://DEIN-PROJEKT.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_AGENT_NAME=Schattenlicht
ALLOWED_ORIGINS=https://deine-domain.tld
```

`ALLOWED_ORIGINS` darf mehrere Domains enthalten, getrennt durch Kommas. Same-Origin-Aufrufe über die aktuelle Sevalla-Domain werden zusätzlich automatisch akzeptiert.

## Sevalla-Einstellungen

- Service: Application
- Git-Repository: dieses Repository
- Build path: `.`
- Build strategy: Nixpacks oder Railpack
- Build command: automatisch / `npm install`
- Start command: `npm start`
- Web process port: automatisch über `PORT`
- Health check path: `/health`

## Lokal starten

```bash
npm install
npm start
```

Danach: `http://localhost:3000`

## Hinweise

- Keine LiveKit-Geheimnisse im Frontend hinterlegen.
- Der Python-Voice-Agent im Ordner `agent/` ist nur als Referenz enthalten und wird separat bei LiveKit Cloud betrieben.
- Die frühere `netlify.toml` und die Netlify-Functions werden nicht mehr benötigt.
