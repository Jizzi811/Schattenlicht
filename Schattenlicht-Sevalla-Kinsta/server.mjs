import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { RoomAgentDispatch, RoomConfiguration } from '@livekit/protocol';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDirectory = path.join(__dirname, 'public');
const app = express();
const port = Number(process.env.PORT || 3000);
const DEFAULT_AGENT_NAME = 'Schattenlicht';
const LOCAL_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

const ARCHETYPES = {
  UN: { name: 'Unschuldiger', symbol: '○' },
  EN: { name: 'Entdecker', symbol: '✦' },
  WE: { name: 'Weiser', symbol: '◉' },
  HE: { name: 'Held', symbol: '◆' },
  RE: { name: 'Rebell', symbol: '⚡' },
  MA: { name: 'Magier', symbol: '✧' },
  LI: { name: 'Liebender', symbol: '♡' },
  NA: { name: 'Narr', symbol: '✺' },
  FU: { name: 'Fürsorglicher', symbol: '❦' },
  SC: { name: 'Schöpfer', symbol: '✱' },
  HR: { name: 'Herrscher', symbol: '♦' },
  JE: { name: 'Jedermann', symbol: '◇' },
};
const ARCHETYPE_CODES = Object.keys(ARCHETYPES);

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '16kb' }));
app.use((request, response, next) => {
  response.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(), payment=(), usb=()',
  });
  if (request.path.startsWith('/api/')) {
    response.set('Cache-Control', 'no-store, max-age=0');
  }
  next();
});

function normalizeOrigin(value) {
  if (!value) return null;
  try {
    return new URL(String(value).trim()).origin;
  } catch {
    return null;
  }
}

function getRequestOrigin(request) {
  const forwardedProto = request.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = request.get('x-forwarded-host')?.split(',')[0]?.trim();
  const protocol = forwardedProto || request.protocol;
  const host = forwardedHost || request.get('host');
  return normalizeOrigin(host ? `${protocol}://${host}` : null);
}

function getAllowedOrigins(request) {
  const allowed = new Set(LOCAL_ORIGINS);
  const configured = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => normalizeOrigin(value))
    .filter(Boolean);
  for (const origin of configured) allowed.add(origin);

  // Same-origin requests from the current Sevalla/custom domain are allowed.
  const currentOrigin = getRequestOrigin(request);
  if (currentOrigin) allowed.add(currentOrigin);
  return allowed;
}

function isAllowedBrowserRequest(request) {
  const fetchSite = request.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return false;
  const origin = normalizeOrigin(request.get('origin'));
  if (!origin) return process.env.NODE_ENV !== 'production';
  return getAllowedOrigins(request).has(origin);
}

function isValidLiveKitUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'wss:' || url.protocol === 'ws:';
  } catch {
    return false;
  }
}

app.get('/health', (_request, response) => {
  response.status(200).json({ ok: true, service: 'schattenlicht' });
});

app.post('/api/livekit-token', async (request, response) => {
  if (!isAllowedBrowserRequest(request)) {
    return response.status(403).json({
      error: 'origin_not_allowed',
      message: 'Diese Website ist für den Sprachzugang nicht freigegeben.',
    });
  }

  const livekitUrl = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  const agentName = process.env.LIVEKIT_AGENT_NAME?.trim() || DEFAULT_AGENT_NAME;

  if (!isValidLiveKitUrl(livekitUrl) || !apiKey || !apiSecret) {
    console.error('LIVEKIT_URL ist ungültig oder LiveKit-Zugangsdaten fehlen.');
    return response.status(500).json({
      error: 'server_configuration_error',
      message: 'Der Sprachagent ist serverseitig noch nicht vollständig konfiguriert.',
    });
  }

  const roomName = `schattenlicht-${crypto.randomUUID()}`;
  const participantIdentity = `gast-${crypto.randomUUID().slice(0, 12)}`;

  try {
    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
      name: 'Gast',
      ttl: '10m',
    });

    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });

    accessToken.roomConfig = new RoomConfiguration({
      agents: [new RoomAgentDispatch({ agentName })],
    });

    const participantToken = await accessToken.toJwt();
    return response.status(201).json({
      server_url: livekitUrl,
      participant_token: participantToken,
      room_name: roomName,
    });
  } catch (error) {
    console.error('LiveKit-Token konnte nicht erzeugt werden:', error);
    return response.status(500).json({
      error: 'token_generation_failed',
      message: 'Die Sprachverbindung konnte nicht vorbereitet werden.',
    });
  }
});

app.post('/api/calculate-archetype-profile', (request, response) => {
  const body = request.body || {};
  const testVersion = Number(body.test_version);
  if (testVersion !== 24 && testVersion !== 36) {
    return response.status(422).json({
      ok: false,
      error: { code: 'invalid_test_version', message: 'test_version muss 24 oder 36 sein.' },
    });
  }

  if (typeof body.answers !== 'string' || !body.answers.trim()) {
    return response.status(422).json({
      ok: false,
      error: { code: 'invalid_answers', message: 'answers muss ein kommagetrennter String sein.' },
    });
  }

  const perArchetype = testVersion === 36 ? 3 : 2;
  const scores = Object.fromEntries(ARCHETYPE_CODES.map((code) => [code, 0]));
  const seen = new Set();
  const invalid = [];
  const duplicates = [];

  for (const rawPair of body.answers.split(',')) {
    const pair = rawPair.trim().toUpperCase();
    if (!pair) continue;
    const match = pair.match(/^([A-Z]{2})([1-3]):([1-5])$/);
    if (!match) {
      invalid.push(pair);
      continue;
    }

    const [, code, numberText, scoreText] = match;
    const number = Number(numberText);
    const score = Number(scoreText);
    const key = `${code}${number}`;

    if (!ARCHETYPES[code] || number < 1 || number > perArchetype) {
      invalid.push(pair);
      continue;
    }
    if (seen.has(key)) {
      duplicates.push(key);
      continue;
    }
    seen.add(key);
    scores[code] += score;
  }

  if (invalid.length) {
    return response.status(422).json({
      ok: false,
      error: { code: 'invalid_answer_format', message: 'Einige Antworten sind ungültig.', invalid },
    });
  }
  if (duplicates.length) {
    return response.status(422).json({
      ok: false,
      error: { code: 'duplicate_answers', message: 'Einige Fragen wurden doppelt beantwortet.', duplicates },
    });
  }

  const expected = ARCHETYPE_CODES.flatMap((code) =>
    Array.from({ length: perArchetype }, (_, index) => `${code}${index + 1}`),
  );
  const missing = expected.filter((key) => !seen.has(key));
  if (missing.length) {
    return response.status(422).json({
      ok: false,
      error: { code: 'missing_answers', message: `Es fehlen ${missing.length} Antworten.`, missing },
    });
  }

  const maximum = perArchetype * 5;
  const ranking = ARCHETYPE_CODES.map((code) => ({
    code,
    name: ARCHETYPES[code].name,
    symbol: ARCHETYPES[code].symbol,
    score: scores[code],
    max: maximum,
    percent: Math.round((scores[code] / maximum) * 100),
  })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'de'));

  return response.status(200).json({
    ok: true,
    test_version: testVersion,
    result: {
      primary: ranking.slice(0, 3),
      less: ranking.slice(-3).reverse(),
      less_lived: ranking.slice(-3).reverse(),
      ranking,
      close_scores: ranking[0].score - ranking[2].score <= 1,
      notice: 'Das Ergebnis dient der Selbstreflexion und ist keine medizinische oder psychologische Diagnose.',
    },
  });
});

app.use(express.static(publicDirectory, {
  extensions: ['html'],
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  setHeaders(response, filePath) {
    if (filePath.endsWith('.html')) response.setHeader('Cache-Control', 'no-cache');
  },
}));

app.get('*', (_request, response) => {
  response.sendFile(path.join(publicDirectory, 'index.html'));
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Schattenlicht läuft auf Port ${port}.`);
});

function shutdown(signal) {
  console.log(`${signal} empfangen, Server wird beendet.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
