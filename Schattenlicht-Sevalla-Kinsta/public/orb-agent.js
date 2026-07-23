import {
  Room,
  RoomEvent,
  Track,
} from 'https://esm.sh/livekit-client@2.20.1?bundle';

const UI_TEXT = {
  ready: 'Berühre den Orb, um das Gespräch zu beginnen.',
  connecting: 'Die Verbindung wird aufgebaut …',
  initializing: 'Schattenlicht wird vorbereitet …',
  idle: 'Schattenlicht ist bereit. Du kannst sprechen.',
  listening: 'Schattenlicht hört dir zu.',
  thinking: 'Schattenlicht denkt nach …',
  speaking: 'Schattenlicht spricht.',
  disconnected: 'Das Gespräch wurde beendet.',
  error: 'Die Verbindung ist fehlgeschlagen. Berühre den Orb für einen neuen Versuch.',
  microphoneDenied: 'Der Mikrofonzugriff wurde nicht erlaubt. Bitte gib ihn im Browser frei und versuche es erneut.',
  audioBlocked: 'Tippe noch einmal auf den Orb, um die Audiowiedergabe zu erlauben.',
};

// Verstärkung der Agent-Stimme. Ein <audio>-Element ist auf 100 % gedeckelt,
// daher läuft die Wiedergabe über einen Web-Audio-GainNode mit Faktor > 1.
const AGENT_VOLUME_GAIN = 2.8;

const AGENT_STATES = new Set([
  'connecting',
  'pre-connect-buffering',
  'initializing',
  'idle',
  'listening',
  'thinking',
  'speaking',
  'disconnected',
  'failed',
]);

function waitForElement(selector, timeoutMs = 20000) {
  const existing = document.querySelector(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} wurde nicht gefunden.`));
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (!element) return;
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve(element);
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

const orb = await waitForElement('#schattenlicht-orb');
const statusEl = await waitForElement('#orb-status');
orb.dataset.agentBound = 'true';
const statusPill = document.getElementById('orb-status-pill');
const helpEl = document.getElementById('orb-help');

let room = null;
let currentState = 'ready';
let lastAgentState = 'idle';
let busy = false;
let intentionalDisconnect = false;
let audioContext = null;
let analyser = null;
let analyserSource = null;
let gainNode = null;
let limiterNode = null;
let animationFrame = null;
let agentParticipantIdentity = null;
let agentWaitTimer = null;
const attachedAudioElements = new Set();

function normalizeAgentState(rawState) {
  if (!rawState || !AGENT_STATES.has(rawState)) return null;
  if (rawState === 'pre-connect-buffering') return 'connecting';
  if (rawState === 'failed') return 'error';
  return rawState;
}

function setState(state, customText = null) {
  currentState = state;
  if (['idle', 'listening', 'thinking', 'speaking', 'initializing'].includes(state)) {
    lastAgentState = state;
  }
  orb.dataset.state = state;
  statusPill?.setAttribute('data-state', state);
  statusEl.textContent = customText || UI_TEXT[state] || UI_TEXT.ready;

  const active = !['ready', 'disconnected', 'error', 'microphoneDenied'].includes(state);
  orb.setAttribute('aria-pressed', String(active));
  orb.setAttribute(
    'aria-label',
    state === 'audioBlocked'
      ? 'Audiowiedergabe für Schattenlicht erlauben'
      : active
        ? 'Gespräch mit Schattenlicht beenden'
        : 'Gespräch mit Schattenlicht beginnen',
  );

  if (helpEl) {
    helpEl.textContent = active
      ? 'Berühre den Orb erneut, um das Gespräch zu beenden. Dein Mikrofon ist während der Verbindung aktiv.'
      : 'Dein Mikrofon wird erst nach deinem Klick und deiner Browser-Bestätigung aktiviert.';
  }
}

function setAudioLevel(level) {
  const clamped = Math.max(0, Math.min(1, level));
  orb.style.setProperty('--orb-level', clamped.toFixed(3));
  // Für orb-visual.js (Canvas-Effekte) ohne teures getComputedStyle bereitstellen.
  orb._orbLevel = clamped;
}

function clearAgentWaitTimer() {
  if (agentWaitTimer) window.clearTimeout(agentWaitTimer);
  agentWaitTimer = null;
}

function stopVisualizer() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  analyserSource?.disconnect();
  analyser?.disconnect();
  gainNode?.disconnect();
  limiterNode?.disconnect();
  analyserSource = null;
  analyser = null;
  gainNode = null;
  limiterNode = null;
  setAudioLevel(0);
}

// Verstärkter Wiedergabe- und Analyse-Graph über das <audio>-Element.
// createMediaElementSource leitet die Wiedergabe des Elements in den WebAudio-
// Graphen um (das Element gibt danach keinen Direktton mehr aus -> kein
// Doppelton). Das ist zuverlässiger als createMediaStreamSource, das bei
// entfernten WebRTC-Tracks je nach Browser stumm bleiben kann.
async function setupAudioChain(audioElement) {
  stopVisualizer();

  audioContext ||= new AudioContext();
  if (audioContext.state === 'suspended') {
    await audioContext.resume().catch(() => {});
  }

  analyserSource = audioContext.createMediaElementSource(audioElement);

  gainNode = audioContext.createGain();
  gainNode.gain.value = AGENT_VOLUME_GAIN;
  limiterNode = audioContext.createDynamicsCompressor();
  limiterNode.threshold.value = -8;
  limiterNode.knee.value = 6;
  limiterNode.ratio.value = 12;
  limiterNode.attack.value = 0.003;
  limiterNode.release.value = 0.25;

  // Quelle -> Gain (> 1) -> Limiter -> Ausgabe (hörbar & verstärkt).
  analyserSource.connect(gainNode);
  gainNode.connect(limiterNode);
  limiterNode.connect(audioContext.destination);

  // Zusätzlicher Abgriff für die Pegel-Analyse (kein zweiter Ausgang).
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.82;
  analyserSource.connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  const tick = () => {
    if (!analyser) return;
    analyser.getByteTimeDomainData(samples);
    let squareSum = 0;
    for (const sample of samples) {
      const centered = (sample - 128) / 128;
      squareSum += centered * centered;
    }
    const rms = Math.sqrt(squareSum / samples.length);
    setAudioLevel(Math.min(1, rms * 4.5));
    animationFrame = requestAnimationFrame(tick);
  };
  tick();
}

function attachAgentAudio(track) {
  const audioElement = track.attach();
  audioElement.autoplay = true;
  audioElement.playsInline = true;
  audioElement.style.display = 'none';
  document.body.appendChild(audioElement);
  attachedAudioElements.add(audioElement);

  setupAudioChain(audioElement).catch((error) => {
    // Fällt der verstärkte Graph aus, spielt das Element selbst (Normallautstärke).
    console.warn('Audio-Verstärkung nicht verfügbar, Normallautstärke:', error);
    audioElement.muted = false;
    audioElement.volume = 1;
  });
}

function detachAllAudio() {
  for (const element of attachedAudioElements) {
    element.remove();
  }
  attachedAudioElements.clear();
  stopVisualizer();
}

// Stimmung des Agenten auf den Orb übertragen (Farbwechsel je nach Stimmung).
// Der Agent kann dazu ein Attribut "mood" (oder "lk.agent.mood") setzen, z. B.
// calm, cool, deep, warm, tender, alert. Ohne Wert driftet die Farbe sanft von
// selbst (siehe orb-visual.js).
function applyMood(attributes) {
  const mood = attributes?.['mood'] ?? attributes?.['lk.agent.mood'];
  if (typeof mood === 'string' && mood.trim()) {
    orb.dataset.mood = mood.trim().toLowerCase();
  }
}

function readAgentState(participant) {
  applyMood(participant?.attributes);
  const state = participant?.attributes?.['lk.agent.state'];
  const normalized = normalizeAgentState(state);
  if (normalized) {
    agentParticipantIdentity = participant.identity;
    clearAgentWaitTimer();
    setState(normalized);
  }
}

function registerRoomEvents(activeRoom) {
  activeRoom.on(RoomEvent.ParticipantConnected, (participant) => {
    readAgentState(participant);
  });

  activeRoom.on(RoomEvent.ParticipantAttributesChanged, (changed, participant) => {
    if ('mood' in changed || 'lk.agent.mood' in changed) {
      applyMood(participant?.attributes ?? changed);
    }
    const rawState = changed['lk.agent.state'];
    const normalized = normalizeAgentState(rawState);
    if (!normalized) return;
    agentParticipantIdentity = participant.identity;
    clearAgentWaitTimer();
    setState(normalized);
  });

  activeRoom.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (track.kind !== Track.Kind.Audio) return;
    agentParticipantIdentity ||= participant.identity;
    clearAgentWaitTimer();
    attachAgentAudio(track);
  });

  activeRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach((element) => {
      attachedAudioElements.delete(element);
      element.remove();
    });
    stopVisualizer();
  });

  activeRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
    if (participant.identity === agentParticipantIdentity && room) {
      setState('error', 'Schattenlicht hat die Verbindung beendet. Berühre den Orb für einen neuen Versuch.');
      activeRoom.disconnect().catch(() => {});
    }
  });

  activeRoom.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (!activeRoom.canPlayAudio) {
      setState('audioBlocked');
    }
  });

  activeRoom.on(RoomEvent.Reconnecting, () => {
    setState('connecting', 'Die Verbindung wird wiederhergestellt …');
  });

  activeRoom.on(RoomEvent.Reconnected, () => {
    setState('initializing', 'Schattenlicht verbindet sich erneut …');
  });

  activeRoom.on(RoomEvent.Disconnected, () => {
    const wasIntentional = intentionalDisconnect;
    cleanupRoom();
    setState(wasIntentional ? 'disconnected' : 'error');
    if (wasIntentional) {
      window.setTimeout(() => {
        if (!room && currentState === 'disconnected') setState('ready');
      }, 1800);
    }
  });
}

async function fetchConnectionDetails() {
  const response = await fetch('/api/livekit-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'schattenlicht-orb' }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'Der Token-Endpunkt antwortet nicht.');
  }

  if (!data.server_url || !data.participant_token) {
    throw new Error('Die Verbindungsdaten sind unvollständig.');
  }

  return data;
}

async function startConversation() {
  intentionalDisconnect = false;
  setState('connecting');

  const { server_url: serverUrl, participant_token: token } =
    await fetchConnectionDetails();

  const nextRoom = new Room({
    adaptiveStream: true,
    dynacast: true,
    disconnectOnPageLeave: true,
  });
  room = nextRoom;
  registerRoomEvents(nextRoom);

  await nextRoom.connect(serverUrl, token);
  setState('initializing');

  await nextRoom.startAudio().catch(() => {});
  await nextRoom.localParticipant.setMicrophoneEnabled(true);

  clearAgentWaitTimer();
  agentWaitTimer = window.setTimeout(() => {
    if (room === nextRoom && !agentParticipantIdentity) {
      setState(
        'initializing',
        'Schattenlicht wird noch vorbereitet. Das kann einen Moment dauern …',
      );
    }
  }, 12000);

  for (const participant of nextRoom.remoteParticipants.values()) {
    readAgentState(participant);
  }
}

function cleanupRoom() {
  clearAgentWaitTimer();
  detachAllAudio();
  delete orb.dataset.mood;
  agentParticipantIdentity = null;
  room = null;
  intentionalDisconnect = false;
}

async function stopConversation() {
  if (!room) {
    cleanupRoom();
    setState('ready');
    return;
  }

  intentionalDisconnect = true;
  const activeRoom = room;
  await activeRoom.localParticipant.setMicrophoneEnabled(false).catch(() => {});
  await activeRoom.disconnect().catch(() => {});

  if (room === activeRoom) {
    cleanupRoom();
    setState('disconnected');
    window.setTimeout(() => {
      if (!room && currentState === 'disconnected') setState('ready');
    }, 1800);
  }
}

orb.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  orb.disabled = true;

  try {
    if (room && currentState === 'audioBlocked') {
      await room.startAudio();
      await audioContext?.resume().catch(() => {});
      setState(lastAgentState);
    } else if (room) {
      await stopConversation();
    } else {
      await startConversation();
    }
  } catch (error) {
    console.error('Schattenlicht-Verbindung fehlgeschlagen:', error);

    const microphoneDenied =
      error?.name === 'NotAllowedError' ||
      error?.name === 'PermissionDeniedError' ||
      /permission|microphone|notallowed/i.test(error?.message || '');

    if (room) {
      intentionalDisconnect = true;
      await room.disconnect().catch(() => {});
    }
    cleanupRoom();
    setState(
      microphoneDenied ? 'microphoneDenied' : 'error',
      microphoneDenied ? UI_TEXT.microphoneDenied : error?.message || UI_TEXT.error,
    );
  } finally {
    busy = false;
    orb.disabled = false;
  }
});

window.addEventListener('pagehide', () => {
  if (!room) return;
  intentionalDisconnect = true;
  room.disconnect().catch(() => {});
});

setState('ready');
