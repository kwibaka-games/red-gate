import { WebSocket } from 'ws';
import { RedGateMatch } from './game.js';
import { RED_GATE_GAME } from './metadata.js';
import type { GameToPlatform, PlatformToGame } from '../../protocol/protocol.js';

const matchId = process.env.MATCH_ID;
const platformUrl = process.env.PLATFORM_WS_URL;
const secret = process.env.GAME_SECRET;

if (!matchId || !platformUrl || !secret) {
  console.error('[red-gate-worker] MATCH_ID, PLATFORM_WS_URL and GAME_SECRET are required');
  process.exit(2);
}

const ws = new WebSocket(platformUrl);
let game: RedGateMatch | null = null;
let registered = false;

const send = (message: GameToPlatform) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
};

ws.on('open', () => {
  ws.send(
    JSON.stringify({
      v: 1,
      t: 'register',
      secret,
      matchId,
      game: RED_GATE_GAME,
    } satisfies GameToPlatform),
  );
});

ws.on('message', (raw) => {
  let message: PlatformToGame | { t: string; ok?: boolean; error?: string };
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (!registered) {
    if (message.t !== 'register.ack') return;
    if (!('ok' in message) || !message.ok) {
      console.error('[red-gate-worker] register rejected:', message.error ?? 'unknown');
      process.exit(3);
    }
    registered = true;
    game = new RedGateMatch(send);
    console.log(`[red-gate-worker] matched ${matchId}`);
    return;
  }
  if (!game) return;
  if (message.t === 'register.ack') return;
  game.handle(message as PlatformToGame);
});

ws.on('close', (code) => {
  console.log(`[red-gate-worker] platform closed (${code})`);
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('[red-gate-worker] websocket error:', error.message);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    ws.close();
    process.exit(0);
  });
}
