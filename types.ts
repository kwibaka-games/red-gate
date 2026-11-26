export type RedGateRole = 'good' | 'murderer';
export type RedGateCardKind = 'empty' | 'key' | 'exit' | 'instant' | 'item';
export type RedGateCardLocation = 'mansion' | 'held' | 'removed';
export type RedGateClaim = 'silver' | 'empty';

export interface RedGateCardDef {
  type: string;
  name: string;
  kind: RedGateCardKind;
  expansion?: string;
  description: string;
}

export interface RedGateCardView {
  id: string;
  door: number | null;
  claim: RedGateClaim | null;
  type?: string;
  name?: string;
  art?: string;
  revealed: boolean;
  /** Only present for the owner's own hand or for spectators. */
  actual?: string;
}

export interface RedGatePlayerView {
  userId: string;
  name: string;
  seat: number;
  avatar: string | null;
  alive: boolean;
  connected: boolean;
  /** Only visible to the player themselves, spectators, or after game end. */
  role?: RedGateRole;
  isTurn: boolean;
  claimedKeys: number;
  items: RedGateCardView[];
  keys?: RedGateCardView[];
  handcuffedBy?: string;
  tortured?: boolean;
  muted?: boolean;
}

export interface RedGateOption {
  id: string;
  label: string;
  detail?: string;
}

export interface RedGatePendingView {
  id: string;
  kind: string;
  actorId: string;
  actorName: string;
  prompt: string;
  options?: RedGateOption[];
  doors?: number[];
  deadline?: number;
  submitted?: boolean;
  canRespond: boolean;
  /** For multi-player prompts (数字刺青), which players still need to submit. */
  waitingFor?: string[];
}

export interface RedGateLogEntry {
  id: number;
  text: string;
  kind: 'public' | 'reveal' | 'claim' | 'death' | 'system';
}

export interface RedGateResult {
  winners: string[];
  reason:
    | 'escape'
    | 'murderer'
    | 'maze'
    | 'all_dead'
    | 'escape_failed'
    | 'fake_exit_failed'
    | 'resign';
  roles: Record<string, RedGateRole>;
  board?: unknown;
}

export interface RedGateView {
  schema: 'red-gate-v1';
  phase: 'waiting' | 'playing' | 'finished';
  status: 'waiting' | 'playing' | 'finished';
  you: {
    userId: string;
    role: RedGateRole;
    keys: RedGateCardView[];
    items: RedGateCardView[];
    handcuffedBy?: string;
    muted: boolean;
  } | null;
  youAreSpectator: boolean;
  turn: string | null;
  turnName: string | null;
  turnNumber: number;
  players: RedGatePlayerView[];
  mansion: RedGateCardView[];
  pending: RedGatePendingView | null;
  log: RedGateLogEntry[];
  expansions: string[];
  requiredKeys: number;
  grimoire: boolean;
  protectedDoor: number | null;
  deadPlayers: string[];
  canOpen: boolean;
  canRescue: { userId: string; name: string }[];
  escapeReady: boolean;
  result?: RedGateResult;
  /** Private cards revealed to this viewer by clue/FBI/monitor. */
  peek?: RedGateCardView[];
  /** For FBI: all actual mansion cards, private to the chooser. */
  peekMansion?: RedGateCardView[];
  /** Gift holder sees every mansion card. */
  knowsMansion?: boolean;
}
