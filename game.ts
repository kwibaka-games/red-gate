import { randomInt } from 'node:crypto';
import type { GameToPlatform, PlatformToGame, Seat } from '../../protocol/protocol.js';
import { RED_GATE_GAME } from './metadata.js';
import {
  BASE_DECK,
  CARD_DEFS,
  EXPANSION_CARDS,
  buildDeck,
  cardDef,
} from './cards.js';
import type {
  RedGateCardView,
  RedGateClaim,
  RedGateLogEntry,
  RedGateOption,
  RedGatePendingView,
  RedGatePlayerView,
  RedGateResult,
  RedGateRole,
  RedGateView,
} from './types.js';

const KEY_TYPES = new Set(['silver-key', 'killer-key', 'guardian-key']);
const DANGEROUS = new Set(['trap', 'hypno-gas', 'danger-crack', 'neuro-gas']);
const CARD_NAMES = new Map(Object.values(CARD_DEFS).map((def) => [def.type, def.name]));
const MAX_LOG = 250;

interface Player {
  userId: string;
  name: string;
  seat: number;
  alive: boolean;
  connected: boolean;
  role: RedGateRole;
  handcuffedBy: string | null;
  neuroTurn: number | null;
}

interface Card {
  id: string;
  type: string;
  location: 'mansion' | 'held' | 'removed';
  ownerId: string | null;
  door: number | null;
  claim: RedGateClaim | null;
  revealed: boolean;
}

interface EffectContext {
  actorId: string;
  bearerId: string;
  cardId: string;
  fbi?: boolean;
}

type PendingKind =
  | 'dagger-target'
  | 'lie'
  | 'escape'
  | 'clue-card'
  | 'danger-choice'
  | 'danger-card'
  | 'lucky-target'
  | 'bullet-target'
  | 'dizzy'
  | 'fbi-card'
  | 'maze'
  | 'incense-use'
  | 'incense-target'
  | 'whisper-target'
  | 'axe-target'
  | 'handcuff-target'
  | 'keycard'
  | 'tattoo';

interface Pending {
  id: string;
  kind: PendingKind;
  actorId: string;
  prompt: string;
  options: RedGateOption[];
  doors?: number[];
  ctx?: EffectContext;
  submitted?: Map<string, number>;
  deadline?: number;
  timer?: NodeJS.Timeout;
}

interface Match {
  id: string;
  seats: Seat[];
  players: Player[];
  cards: Map<string, Card>;
  nextCardId: number;
  nextDoor: number;
  turnSeat: number;
  turnNumber: number;
  phase: 'waiting' | 'playing' | 'finished';
  stage: 'open' | 'resolving' | 'finished';
  pending: Pending | null;
  ctx: EffectContext | null;
  extraUsed: boolean;
  grimoire: boolean;
  protectedCardId: string | null;
  deadXray: boolean;
  log: RedGateLogEntry[];
  logId: number;
  result: RedGateResult | null;
  expansions: string[];
  ready: Set<string>;
  started: boolean;
  seq: number;
  peeks: Map<string, string[]>;
  peekMansionFor: string | null;
}

export class RedGateMatch {
  private readonly matches = new Map<string, Match>();
  private readonly randomDie: () => number;

  constructor(
    private readonly send: (message: GameToPlatform) => void,
    randomDie: () => number = () => randomInt(1, 7),
  ) {
    this.randomDie = randomDie;
  }

  getMetadata(): typeof RED_GATE_GAME {
    return RED_GATE_GAME;
  }

  handle(message: PlatformToGame): void {
    switch (message.t) {
      case 'match.create':
        this.create(message.matchId, message.seats, message.settings);
        return;
      case 'player.ready':
        this.ready(message.matchId, message.playerId);
        return;
      case 'action':
        this.action(message.matchId, message.playerId, message.action);
        return;
      case 'player.connection': {
        const match = this.matches.get(message.matchId);
        const player = match?.players.find((candidate) => candidate.userId === message.playerId);
        if (!match || !player) return;
        player.connected = message.connected;
        if (message.connected) this.sendViewToPlayer(match, message.playerId);
        else this.sendViews(match);
        return;
      }
      case 'match.abort': {
        const match = this.matches.get(message.matchId);
        if (match?.pending?.timer) clearTimeout(match.pending.timer);
        this.matches.delete(message.matchId);
        return;
      }
      default:
        return;
    }
  }

  private create(matchId: string, seats: Seat[], settings: Record<string, unknown>): void {
    if (seats.length < 3 || seats.length > 8) {
      this.send({
        v: 1,
        t: 'error',
        matchId,
        code: 'E_PLAYERS',
        message: '红色的门和杀人鬼的钥匙需要 3–8 名玩家',
      });
      return;
    }
    const requested = Array.isArray(settings.expansions)
      ? settings.expansions.filter((value): value is string => typeof value === 'string')
      : [];
    const expansions = [...new Set(requested.filter((type) => EXPANSION_CARDS.includes(type)))];
    const match: Match = {
      id: matchId,
      seats,
      players: seats.map((seat) => ({
        userId: seat.userId,
        name: seat.name,
        seat: seat.seat,
        alive: true,
        connected: true,
        role: 'good',
        handcuffedBy: null,
        neuroTurn: null,
      })),
      cards: new Map(),
      nextCardId: 1,
      nextDoor: 1,
      turnSeat: 0,
      turnNumber: 0,
      phase: 'waiting',
      stage: 'open',
      pending: null,
      ctx: null,
      extraUsed: false,
      grimoire: false,
      protectedCardId: null,
      deadXray: false,
      log: [],
      logId: 1,
      result: null,
      expansions,
      ready: new Set(),
      started: false,
      seq: 1,
      peeks: new Map(),
      peekMansionFor: null,
    };
    this.matches.set(matchId, match);
    this.addLog(match, `大宅已经准备好，共 ${buildDeck(expansions).length} 扇红门。`, 'system');
    this.sendViews(match);
  }

  private ready(matchId: string, playerId: string): void {
    const match = this.matches.get(matchId);
    if (!match || match.started) return;
    if (!match.players.some((player) => player.userId === playerId)) return;
    match.ready.add(playerId);
    if (match.ready.size !== match.players.length) {
      this.sendViews(match);
      return;
    }
    match.started = true;
    match.phase = 'playing';
    match.stage = 'open';
    match.turnNumber = 1;
    const deck = buildDeck(match.expansions);
    this.shuffle(deck);
    for (const type of deck) this.addCardToMansion(match, type, false);
    match.turnSeat = 0;
    this.addLog(
      match,
      `${match.players[0]!.name} 先手的回合。大宅中有 ${match.cards.size} 扇门。`,
      'system',
    );
    this.send({ v: 1, t: 'match.started', matchId });
    this.sendViews(match);
  }

  private action(matchId: string, playerId: string, action: unknown): void {
    const match = this.matches.get(matchId);
    if (!match || match.phase !== 'playing' || !action || typeof action !== 'object') return;
    const player = match.players.find((candidate) => candidate.userId === playerId);
    if (!player || !player.alive) return;
    const type = (action as { type?: unknown }).type;
    if (type === 'rescue') {
      this.rescue(match, player, String((action as { targetId?: unknown }).targetId ?? ''));
      return;
    }
    if (match.pending) {
      if (match.pending.kind === 'tattoo' && type === 'tattoo') {
        this.submitTattoo(match, player, Number((action as { number?: unknown }).number));
        return;
      }
      if (match.pending.actorId !== playerId) return;
      if (type === 'maze') {
        const answers = (action as { answers?: unknown }).answers;
        if (Array.isArray(answers)) this.resolveMaze(match, answers.map(String));
        return;
      }
      if (type === 'choice') {
        const choice = String((action as { choice?: unknown }).choice ?? '');
        this.resolvePending(match, choice);
        return;
      }
      return;
    }
    if (match.turnSeat !== player.seat || match.stage !== 'open') return;
    if (type === 'open') {
      const door = Number((action as { door?: unknown }).door);
      if (!Number.isInteger(door)) return;
      const card = [...match.cards.values()].find(
        (candidate) => candidate.location === 'mansion' && candidate.door === door,
      );
      if (!card) return;
      this.openDoor(match, player, card);
    }
  }

  private openDoor(match: Match, actor: Player, card: Card): void {
    match.stage = 'resolving';
    const ctx: EffectContext = {
      actorId: actor.userId,
      bearerId: actor.userId,
      cardId: card.id,
    };
    match.ctx = ctx;
    this.addLog(match, `${actor.name} 打开了 ${card.door} 号门。`);
    const others = match.players.filter(
      (candidate) => candidate.alive && candidate.userId !== actor.userId,
    );
    if (this.playerHasItem(match, actor, 'dagger') && others.length > 0) {
      this.setPending(match, {
        kind: 'dagger-target',
        actorId: actor.userId,
        prompt: '【匕首】：选择一名其他玩家承担这张牌的效果，或获得这张牌。',
        options: others.map((target) => ({ id: target.userId, label: target.name })),
        ctx,
      });
      return;
    }
    this.resolveCard(match, ctx);
  }

  private resolveCard(match: Match, ctx: EffectContext): void {
    if (match.phase !== 'playing') return;
    const card = match.cards.get(ctx.cardId);
    if (!card) return;
    const bearer = this.player(match, ctx.bearerId);
    if (!bearer) return;
    if (DANGEROUS.has(card.type) && this.player(match, ctx.actorId)?.role === 'murderer') {
      this.setPending(match, {
        kind: 'lie',
        actorId: ctx.actorId,
        prompt: `你翻到了【${cardDef(card.type).name}】。你是杀人鬼，要声称这是空房间并跳过效果吗？`,
        options: [
          { id: 'yes', label: '声称空房间，跳过效果' },
          { id: 'no', label: '执行牌的效果' },
        ],
        ctx,
      });
      return;
    }
    this.executeEffect(match, ctx);
  }

  // Effects are filled in below.

  private addLog(
    match: Match,
    text: string,
    kind: RedGateLogEntry['kind'] = 'public',
  ): void {
    match.log.push({ id: match.logId++, text, kind });
    if (match.log.length > MAX_LOG) match.log.splice(0, match.log.length + MAX_LOG);
  }

  private player(match: Match, userId: string): Player | undefined {
    return match.players.find((candidate) => candidate.userId === userId);
  }

  private bySeat(match: Match, seat: number): Player | undefined {
    return match.players.find((candidate) => candidate.seat === seat);
  }

  private current(match: Match): Player | undefined {
    return this.bySeat(match, match.turnSeat);
  }

  private alivePlayers(match: Match): Player[] {
    return match.players.filter((player) => player.alive);
  }

  private mansion(match: Match): Card[] {
    return [...match.cards.values()]
      .filter((card) => card.location === 'mansion')
      .sort((a, b) => (a.door ?? 0) - (b.door ?? 0));
  }

  private held(match: Match, playerId: string): Card[] {
    return [...match.cards.values()].filter(
      (card) => card.location === 'held' && card.ownerId === playerId,
    );
  }

  private heldKeys(match: Match, playerId: string): Card[] {
    return this.held(match, playerId).filter((card) => KEY_TYPES.has(card.type));
  }

  private heldItems(match: Match, playerId: string): Card[] {
    return this.held(match, playerId).filter((card) => !KEY_TYPES.has(card.type));
  }

  private playerHasItem(match: Match, player: Player, type: string): boolean {
    return this.held(match, player.userId).some((card) => card.type === type);
  }

  private cardById(match: Match, id: string): Card | undefined {
    return match.cards.get(id);
  }

  private addCardToMansion(match: Match, type: string, log = true): Card {
    const card: Card = {
      id: `c${match.nextCardId++}`,
      type,
      location: 'mansion',
      ownerId: null,
      door: match.nextDoor++,
      claim: null,
      revealed: false,
    };
    match.cards.set(card.id, card);
    if (log) this.addLog(match, `一张牌被重新放入大宅。`, 'system');
    return card;
  }

  private moveToMansion(match: Match, card: Card): void {
    card.location = 'mansion';
    card.ownerId = null;
    card.claim = null;
    card.revealed = false;
    card.door = match.nextDoor++;
  }

  private removeCard(match: Match, card: Card): void {
    card.location = 'removed';
    card.ownerId = null;
    card.door = null;
    card.claim = null;
  }

  private shuffle<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
  }

  private shuffleMansion(match: Match): void {
    const cards = this.mansion(match);
    if (cards.length === 0) return;
    const protectedCard = match.protectedCardId
      ? cards.find((card) => card.id === match.protectedCardId)
      : undefined;
    const protectedDoor = protectedCard?.door ?? null;
    const pool = cards.filter((card) => card !== protectedCard);
    this.shuffle(pool);
    let door = 1;
    for (const card of pool) {
      if (protectedDoor !== null && door === protectedDoor) door += 1;
      card.door = door++;
      card.claim = null;
      card.revealed = false;
    }
    if (protectedCard && protectedDoor !== null) {
      protectedCard.door = protectedDoor;
      protectedCard.claim = null;
      protectedCard.revealed = false;
    }
    match.nextDoor = Math.max(...cards.map((card) => card.door ?? 0), 0) + 1;
    this.addLog(match, '大宅中的门被重新打乱。', 'system');
  }

  private otherAlive(match: Match, player: Player): Player[] {
    return this.alivePlayers(match).filter((candidate) => candidate.userId !== player.userId);
  }

  private handcuffController(match: Match, player: Player): Player | null {
    if (!player.handcuffedBy) return null;
    const controller = this.player(match, player.handcuffedBy);
    if (!controller || !controller.alive) return null;
    return controller;
  }

  private gainRecipient(match: Match, recipient: Player): Player {
    return this.handcuffController(match, recipient) ?? recipient;
  }

  private sendChatPolicy(match: Match): void {
    const muted = match.players
      .filter((player) => this.playerHasItem(match, player, 'moth'))
      .map((player) => player.userId);
    this.send({ v: 1, t: 'chat.policy', matchId: match.id, mutedUserIds: muted });
  }

  private sendViews(match: Match): void {
    for (const player of match.players) {
      this.send({
        v: 1,
        t: 'view',
        matchId: match.id,
        to: `player:${player.userId}`,
        seq: match.seq,
        view: this.viewFor(match, player.userId),
        actions: [],
      });
    }
    this.send({
      v: 1,
      t: 'view',
      matchId: match.id,
      to: 'spectator',
      seq: match.seq,
      view: this.viewFor(match, null),
      actions: [],
    });
    this.sendChatPolicy(match);
  }

  private sendViewToPlayer(match: Match, playerId: string): void {
    this.send({
      v: 1,
      t: 'view',
      matchId: match.id,
      to: `player:${playerId}`,
      seq: match.seq,
      view: this.viewFor(match, playerId),
      actions: [],
    });
  }

  private cardView(match: Match, card: Card, actual: boolean): RedGateCardView {
    const def = cardDef(card.type);
    const visible = actual || card.revealed || (card.location === 'held' && !KEY_TYPES.has(card.type));
    return {
      id: card.id,
      door: card.door,
      claim: card.claim,
      revealed: card.revealed,
      ...(visible ? { type: card.type, name: def.name, art: `assets/${card.type}.png` } : {}),
      ...(actual ? { actual: card.type } : {}),
    };
  }

  private pendingFor(match: Match, userId: string | null): RedGatePendingView | null {
    const pending = match.pending;
    if (!pending) return null;
    const actor = this.player(match, pending.actorId);
    const isTattoo = pending.kind === 'tattoo';
    const player = userId ? this.player(match, userId) : null;
    const canRespond = isTattoo
      ? !!player?.alive && !pending.submitted?.has(player.userId)
      : userId === pending.actorId;
    return {
      id: pending.id,
      kind: pending.kind,
      actorId: pending.actorId,
      actorName: actor?.name ?? '',
      prompt: pending.prompt,
      ...(pending.options.length ? { options: pending.options } : {}),
      ...(pending.doors ? { doors: pending.doors } : {}),
      ...(pending.deadline ? { deadline: pending.deadline } : {}),
      ...(isTattoo ? { submitted: !!userId && !!pending.submitted?.has(userId) } : {}),
      ...(isTattoo
        ? {
            waitingFor: match.players
              .filter((candidate) => candidate.alive && !pending.submitted?.has(candidate.userId))
              .map((candidate) => candidate.name),
          }
        : {}),
      canRespond,
    };
  }

  private viewFor(match: Match, userId: string | null): RedGateView {
    const spectator = userId === null;
    const viewer = userId ? this.player(match, userId) : null;
    const revealRoles = spectator || match.phase === 'finished';
    const mansion = this.mansion(match);
    const youHasGift = viewer ? this.playerHasItem(match, viewer, 'gift') : false;
    const peekIds = userId ? match.peeks.get(userId) ?? [] : [];
    const pending = this.pendingFor(match, userId);
    const requiredKeys = 3 - (match.deadXray ? 1 : 0);
    const canOpen =
      match.phase === 'playing' &&
      !spectator &&
      !!viewer?.alive &&
      match.stage === 'open' &&
      !match.pending &&
      viewer.seat === match.turnSeat;
    const rescueTargets = this.rescueTargets(match, viewer);
    return {
      schema: 'red-gate-v1',
      phase: match.phase,
      status: match.phase,
      you: viewer
        ? {
            userId: viewer.userId,
            role: viewer.role,
            keys: this.heldKeys(match, viewer.userId).map((card) => this.cardView(match, card, true)),
            items: this.heldItems(match, viewer.userId).map((card) => this.cardView(match, card, true)),
            ...(viewer.handcuffedBy ? { handcuffedBy: viewer.handcuffedBy } : {}),
            muted: this.playerHasItem(match, viewer, 'moth'),
          }
        : null,
      youAreSpectator: spectator,
      turn: this.current(match)?.userId ?? null,
      turnName: this.current(match)?.name ?? null,
      turnNumber: match.turnNumber,
      players: match.players.map((player) => this.playerView(match, player, viewer, revealRoles)),
      mansion: mansion.map((card) =>
        this.cardView(match, card, spectator || card.revealed || youHasGift),
      ),
      pending,
      log: [...match.log],
      expansions: [...match.expansions],
      requiredKeys,
      grimoire: match.grimoire,
      protectedDoor:
        match.protectedCardId
          ? this.cardById(match, match.protectedCardId)?.door ?? null
          : null,
      deadPlayers: match.players.filter((player) => !player.alive).map((player) => player.name),
      canOpen,
      canRescue: spectator || !viewer ? [] : rescueTargets,
      escapeReady: !!viewer && this.heldKeys(match, viewer.userId).length >= requiredKeys,
      ...(match.result ? { result: match.result } : {}),
      ...(peekIds.length
        ? {
            peek: peekIds
              .map((id) => match.cards.get(id))
              .filter((card): card is Card => !!card)
              .map((card) => this.cardView(match, card, true)),
          }
        : {}),
      ...(match.peekMansionFor === userId
        ? {
            peekMansion: mansion.map((card) => this.cardView(match, card, true)),
          }
        : {}),
      ...(youHasGift ? { knowsMansion: true } : {}),
    };
  }

  private playerView(
    match: Match,
    player: Player,
    viewer: Player | null,
    revealRoles: boolean,
  ): RedGatePlayerView {
    const self = viewer?.userId === player.userId;
    const showRole = revealRoles || self;
    return {
      userId: player.userId,
      name: player.name,
      seat: player.seat,
      avatar: null,
      alive: player.alive,
      connected: player.connected,
      isTurn: player.seat === match.turnSeat && match.phase === 'playing',
      claimedKeys: this.heldKeys(match, player.userId).length,
      items: this.heldItems(match, player.userId).map((card) => this.cardView(match, card, true)),
      ...(showRole ? { role: player.role } : {}),
      ...(self || revealRoles
        ? {
            keys: this.heldKeys(match, player.userId).map((card) =>
              this.cardView(match, card, true),
            ),
          }
        : {}),
      ...(player.handcuffedBy ? { handcuffedBy: player.handcuffedBy } : {}),
      tortured: this.playerHasItem(match, player, 'torture'),
      muted: this.playerHasItem(match, player, 'moth'),
    };
  }

  private rescueTargets(match: Match, viewer: Player | null): { userId: string; name: string }[] {
    if (!viewer || !viewer.alive || match.stage !== 'open' || match.pending) return [];
    if (viewer.seat !== match.turnSeat) return [];
    if (this.heldKeys(match, viewer.userId).length === 0) return [];
    return match.players
      .filter(
        (candidate) =>
          candidate.alive &&
          candidate.userId !== viewer.userId &&
          this.playerHasItem(match, candidate, 'torture'),
      )
      .map((candidate) => ({ userId: candidate.userId, name: candidate.name }));
  }

  private setPending(
    match: Match,
    data: Omit<Pending, 'id' | 'submitted' | 'deadline' | 'timer'> & {
      submitted?: Map<string, number>;
      deadline?: number;
      timer?: NodeJS.Timeout;
    },
  ): void {
    if (match.pending?.timer) clearTimeout(match.pending.timer);
    match.pending = {
      ...data,
      id: `p${match.seq++}`,
      submitted: data.submitted ?? new Map(),
      deadline: data.deadline,
      timer: data.timer,
    };
    this.sendViews(match);
  }

  private clearPending(match: Match): void {
    if (match.pending?.timer) clearTimeout(match.pending.timer);
    match.pending = null;
  }

  private resolvePending(match: Match, choice: string): void {
    const pending = match.pending;
    const ctx = pending?.ctx;
    if (!pending || !ctx) return;
    const bearer = this.player(match, ctx.bearerId);
    const actor = this.player(match, ctx.actorId);
    if (!bearer || !actor) return;
    switch (pending.kind) {
      case 'dagger-target': {
        const target = this.player(match, choice);
        if (!target || !target.alive || target.userId === ctx.actorId) return;
        ctx.bearerId = target.userId;
        this.clearPending(match);
        this.addLog(match, `${actor.name} 用匕首让 ${target.name} 承担这张牌。`);
        this.executeEffect(match, ctx);
        return;
      }
      case 'lie':
        if (choice === 'yes') {
          const card = this.cardById(match, ctx.cardId);
          if (card) this.claimEmpty(match, card, bearer);
          this.clearPending(match);
          this.completeCard(match, ctx);
        } else {
          this.clearPending(match);
          this.executeEffect(match, ctx);
        }
        return;
      case 'escape':
        if (choice === 'yes') {
          this.clearPending(match);
          this.attemptEscape(match, ctx);
        } else {
          const card = this.cardById(match, ctx.cardId);
          if (card) this.claimEmpty(match, card, bearer);
          this.clearPending(match);
          this.completeCard(match, ctx);
        }
        return;
      case 'clue-card': {
        const card = this.doorCard(match, choice);
        if (!card) return;
        this.addPeek(match, actor, card);
        this.addLog(match, `${actor.name} 秘密检视了 ${card.door} 号门。`, 'reveal');
        const clue = this.cardById(match, ctx.cardId);
        if (clue) this.removeCard(match, clue);
        this.clearPending(match);
        this.completeCard(match, ctx);
        return;
      }
      case 'danger-choice':
        if (choice === 'reveal') {
          const card = this.cardById(match, ctx.cardId);
          if (!card) return;
          const doors = this.mansion(match)
            .filter((candidate) => candidate.id !== card.id)
            .map((candidate) => candidate.door ?? 0);
          this.setPending(match, {
            kind: 'danger-card',
            actorId: actor.userId,
            prompt: '选择一张大宅中的牌公开。',
            doors,
            ctx,
          });
        } else {
          const card = this.cardById(match, ctx.cardId);
          this.moveAllHeldToMansion(match, bearer);
          if (card && card.location === 'mansion') card.claim = null;
          this.shuffleMansion(match);
          this.clearPending(match);
          this.completeCard(match, ctx);
        }
        return;
      case 'danger-card': {
        const card = this.doorCard(match, choice);
        if (!card) return;
        card.revealed = true;
        this.addLog(match, `${actor.name} 公开了 ${card.door} 号门：${cardDef(card.type).name}。`, 'reveal');
        if (DANGEROUS.has(card.type)) {
          this.kill(match, bearer, true, '危险的门缝');
          if (match.phase === 'playing') this.completeCard(match, ctx);
          return;
        }
        const source = this.cardById(match, ctx.cardId);
        if (source) this.removeCard(match, source);
        card.revealed = false;
        card.claim = null;
        this.clearPending(match);
        if (match.phase === 'playing') this.completeCard(match, ctx);
        return;
      }
      case 'lucky-target': {
        const card = this.cardById(match, choice);
        if (!card || !KEY_TYPES.has(card.type)) return;
        card.revealed = true;
        const owner = card.ownerId ? this.player(match, card.ownerId) : undefined;
        this.addLog(match, `【福至心灵】公开了 ${owner?.name ?? '某玩家'} 的一张钥匙。`, 'reveal');
        if (card.type === 'killer-key') {
          this.removeCard(match, card);
          this.addLog(match, '那张牌是【杀人鬼的钥匙】，它被移出游戏。', 'reveal');
        } else {
          this.addLog(match, '那张牌确实是【银钥匙】。', 'reveal');
        }
        const source = this.cardById(match, ctx.cardId);
        if (source) this.removeCard(match, source);
        this.clearPending(match);
        this.completeCard(match, ctx);
        return;
      }
      case 'bullet-target': {
        const target = this.player(match, choice);
        if (!target || !target.alive) return;
        const source = this.cardById(match, ctx.cardId);
        if (source) this.removeCard(match, source);
        this.addLog(match, `${actor.name} 开枪射杀了 ${target.name}。`, 'death');
        this.kill(match, target, false, '手枪');
        this.clearPending(match);
        if (match.phase === 'playing') this.completeCard(match, ctx);
        return;
      }
      case 'fbi-card': {
        const card = this.doorCard(match, choice);
        if (!card) return;
        const fbi = this.cardById(match, ctx.cardId);
        if (fbi) this.removeCard(match, fbi);
        this.clearPending(match);
        match.peekMansionFor = null;
        ctx.fbi = true;
        ctx.cardId = card.id;
        this.resolveCard(match, ctx);
        return;
      }
      case 'incense-use':
        if (choice === 'yes') {
          const source = this.cardById(match, ctx.cardId);
          if (source) this.removeCard(match, source);
          for (const player of match.players) {
            for (const card of this.heldKeys(match, player.userId)) {
              this.moveToMansion(match, card);
            }
          }
          this.shuffleMansion(match);
          const dead = match.players.filter((player) => !player.alive);
          this.setPending(match, {
            kind: 'incense-target',
            actorId: actor.userId,
            prompt: '选择一名死亡的玩家复活。',
            options: dead.map((player) => ({ id: player.userId, label: player.name })),
            ctx,
          });
        } else {
          const card = this.cardById(match, ctx.cardId);
          if (card) this.claimEmpty(match, card, bearer);
          this.clearPending(match);
          this.completeCard(match, ctx);
        }
        return;
      case 'incense-target': {
        const target = this.player(match, choice);
        if (!target || target.alive) return;
        this.revive(match, target, true);
        this.clearPending(match);
        this.completeCard(match, ctx);
        return;
      }
      case 'whisper-target': {
        const card = this.doorCard(match, choice);
        if (!card) return;
        match.protectedCardId = card.id;
        this.addLog(match, `${actor.name} 用低声细语指定了 ${card.door} 号门；它不会被打乱。`);
        const source = this.cardById(match, ctx.cardId);
        if (source) this.removeCard(match, source);
        this.clearPending(match);
        this.completeCard(match, ctx);
        return;
      }
      case 'axe-target':
        if (choice !== 'skip') {
          const target = this.player(match, choice);
          if (target && target.alive) {
            this.addLog(match, `${actor.name} 用斧头杀死了 ${target.name}。`, 'death');
            this.kill(match, target, false, '杀人鬼的斧头');
          }
        }
        this.clearPending(match);
        if (match.phase === 'playing') this.completeCard(match, ctx);
        return;
      case 'handcuff-target': {
        const target = this.player(match, choice);
        if (!target || !target.alive) return;
        target.handcuffedBy = ctx.bearerId;
        this.addLog(match, `${actor.name} 给 ${target.name} 戴上了手铐。`);
        this.clearPending(match);
        this.completeCard(match, ctx);
        return;
      }
      case 'keycard':
        if (choice === 'yes') {
          match.extraUsed = true;
          match.stage = 'open';
          match.ctx = null;
          this.clearPending(match);
          this.addLog(match, `${actor.name} 使用磁卡钥匙，准备额外打开一扇门。`);
          this.sendViews(match);
        } else {
          this.clearPending(match);
          this.advanceTurn(match);
        }
        return;
      default:
        return;
    }
  }

  private doorCard(match: Match, choice: string): Card | undefined {
    const door = Number(choice);
    if (!Number.isInteger(door)) return undefined;
    return this.mansion(match).find((card) => card.door === door);
  }

  private addPeek(match: Match, viewer: Player, card: Card): void {
    const ids = match.peeks.get(viewer.userId) ?? [];
    ids.push(card.id);
    match.peeks.set(viewer.userId, ids);
    for (const monitor of match.players) {
      if (
        monitor.alive &&
        monitor.userId !== viewer.userId &&
        this.playerHasItem(match, monitor, 'monitor')
      ) {
        const seen = match.peeks.get(monitor.userId) ?? [];
        seen.push(card.id);
        match.peeks.set(monitor.userId, seen);
      }
    }
  }

  private moveAllHeldToMansion(match: Match, player: Player): void {
    for (const card of this.held(match, player.userId)) this.moveToMansion(match, card);
  }

  private claimEmpty(match: Match, card: Card, player: Player): void {
    card.claim = 'empty';
    card.revealed = false;
    if (card.location !== 'mansion') this.moveToMansion(match, card);
    this.addLog(match, `${player.name} 声称 ${card.door} 号门是空房间。`, 'claim');
  }

  private gainKey(match: Match, card: Card, recipient: Player, actor: Player): void {
    const receiver = this.gainRecipient(match, recipient);
    card.location = 'held';
    card.ownerId = receiver.userId;
    card.door = null;
    card.claim = 'silver';
    card.revealed = false;
    this.addLog(match, `${actor.name} 将一张牌扣在面前，声称是银钥匙。`, 'claim');
    if (card.type === 'killer-key' && receiver.role === 'good') {
      receiver.role = 'murderer';
      this.addLog(match, `${receiver.name} 的脸色变了。`, 'death');
    }
    this.checkAllFour(match);
    if (match.phase === 'playing') this.completeCard(match, match.ctx!);
  }

  private gainItem(match: Match, card: Card, recipient: Player, actor: Player): void {
    const receiver = this.gainRecipient(match, recipient);
    card.location = 'held';
    card.ownerId = receiver.userId;
    card.door = null;
    card.claim = null;
    card.revealed = true;
    this.addLog(match, `${actor.name} 获得了【${cardDef(card.type).name}】。`, 'reveal');
    if (card.type === 'axe' || card.type === 'gift') {
      receiver.role = 'murderer';
    }
    if (card.type === 'neuro-gas') {
      receiver.neuroTurn = match.turnNumber;
    }
    if (card.type === 'moth') this.sendChatPolicy(match);
    if (card.type !== 'handcuff-key') this.completeCard(match, match.ctx!);
  }

  private checkAllFour(match: Match): void {
    const keys = [...match.cards.values()].filter(
      (card) => card.location === 'held' && KEY_TYPES.has(card.type),
    );
    if (keys.length < 4) return;
    const killer = keys.find((card) => card.type === 'killer-key');
    for (const card of keys) {
      if (card.type === 'killer-key') this.removeCard(match, card);
      else this.moveToMansion(match, card);
    }
    this.addLog(
      match,
      `${killer ? '四把钥匙被集齐' : '四把钥匙被集齐'}：所有玩家失去钥匙，杀人鬼的钥匙被移出游戏。`,
      'system',
    );
    this.shuffleMansion(match);
  }

  private executeEffect(match: Match, ctx: EffectContext): void {
    const card = this.cardById(match, ctx.cardId);
    const bearer = this.player(match, ctx.bearerId);
    const actor = this.player(match, ctx.actorId);
    if (!card || !bearer || !actor) return;
    switch (card.type) {
      case 'empty-room': {
        this.claimEmpty(match, card, bearer);
        if (this.playerHasItem(match, bearer, 'axe') && bearer.role === 'murderer') {
          const targets = this.otherAlive(match, bearer);
          if (targets.length > 0) {
            this.setPending(match, {
              kind: 'axe-target',
              actorId: actor.userId,
              prompt: '你翻到了空房间。要用杀人鬼的斧头杀死一名玩家吗？',
              options: [
                { id: 'skip', label: '不杀' },
                ...targets.map((target) => ({ id: target.userId, label: target.name })),
              ],
              ctx,
            });
            return;
          }
        }
        this.completeCard(match, ctx);
        return;
      }
      case 'silver-key':
      case 'guardian-key':
      case 'killer-key':
        this.gainKey(match, card, bearer, actor);
        return;
      case 'escape-exit':
        if (this.heldKeys(match, bearer.userId).length >= 3 - (match.deadXray ? 1 : 0)) {
          this.setPending(match, {
            kind: 'escape',
            actorId: actor.userId,
            prompt: '你持有足够的钥匙。要公开逃生出口并尝试逃生吗？',
            options: [
              { id: 'yes', label: '尝试逃生' },
              { id: 'no', label: '不逃生，声称空房间' },
            ],
            ctx,
          });
        } else {
          this.claimEmpty(match, card, bearer);
          this.completeCard(match, ctx);
        }
        return;
      case 'clue': {
        const doors = this.mansion(match)
          .filter((candidate) => candidate.id !== card.id)
          .map((candidate) => candidate.door ?? 0);
        this.setPending(match, {
          kind: 'clue-card',
          actorId: actor.userId,
          prompt: '秘密检视大宅中的一张牌（不执行其效果）。',
          doors,
          ctx,
        });
        return;
      }
      case 'trap':
        this.kill(match, bearer, false, '杀人鬼的陷阱');
        if (match.phase === 'playing') this.completeCard(match, ctx);
        return;
      case 'hypno-gas': {
        this.removeCard(match, card);
        this.addLog(match, `${actor.name} 公开了【催眠瓦斯】。`, 'reveal');
        for (const player of match.players) {
          if (!player.alive) continue;
          if (this.playerHasItem(match, player, 'gas-mask')) continue;
          this.moveAllHeldToMansion(match, player);
        }
        this.shuffleMansion(match);
        this.completeCard(match, ctx);
        return;
      }
      case 'lucky': {
        const candidates = [...match.cards.values()].filter(
          (candidate) =>
            candidate.location === 'held' &&
            KEY_TYPES.has(candidate.type) &&
            candidate.claim === 'silver',
        );
        if (candidates.length === 0) {
          this.claimEmpty(match, card, bearer);
          this.completeCard(match, ctx);
          return;
        }
        this.setPending(match, {
          kind: 'lucky-target',
          actorId: actor.userId,
          prompt: '选择一张被声称为银钥匙的牌公开。',
          options: candidates.map((candidate) => {
            const owner = candidate.ownerId ? this.player(match, candidate.ownerId) : null;
            return {
              id: candidate.id,
              label: `${owner?.name ?? '玩家'} 的一张「银钥匙」`,
            };
          }),
          ctx,
        });
        return;
      }
      case 'bullet-room':
        if (this.playerHasItem(match, bearer, 'pistol')) {
          this.setPending(match, {
            kind: 'bullet-target',
            actorId: actor.userId,
            prompt: '你持有手枪。要开枪杀死一名玩家吗？',
            options: match.players
              .filter((candidate) => candidate.alive)
              .map((candidate) => ({ id: candidate.userId, label: candidate.name })),
            ctx,
          });
        } else {
          this.claimEmpty(match, card, bearer);
          this.completeCard(match, ctx);
        }
        return;
      case 'pistol':
      case 'armor':
      case 'keycard':
      case 'xray':
      case 'monitor':
      case 'gas-mask':
      case 'neuro-gas':
        this.gainItem(match, card, bearer, actor);
        return;
      case 'danger-crack': {
        this.setPending(match, {
          kind: 'danger-choice',
          actorId: actor.userId,
          prompt: '公开一张大宅中的牌，或把所有物品、钥匙和这张牌放入大宅并打乱。',
          options: [
            { id: 'reveal', label: '公开一张大宅中的牌' },
            { id: 'discard', label: '把物品、钥匙和危险的门缝放入大宅' },
          ],
          ctx,
        });
        return;
      }
      case 'dizzy-clock': {
        const itemsByPlayer = new Map<string, Card[]>();
        for (const player of match.players) {
          itemsByPlayer.set(player.userId, this.heldItems(match, player.userId));
        }
        const order = [...match.players].sort((a, b) => a.seat - b.seat);
        for (let index = 0; index < order.length; index += 1) {
          const recipient = order[(index - 1 + order.length) % order.length]!;
          for (const item of itemsByPlayer.get(order[index]!.userId) ?? []) {
            item.ownerId = recipient.userId;
            if (item.type === 'neuro-gas') recipient.neuroTurn = match.turnNumber;
          }
        }
        this.removeCard(match, card);
        this.addLog(match, '所有玩家的物品都交给了上家。');
        this.completeCard(match, ctx);
        return;
      }
      case 'fbi-id': {
        const doors = this.mansion(match)
          .filter((candidate) => candidate.id !== card.id)
          .map((candidate) => candidate.door ?? 0);
        match.peekMansionFor = actor.userId;
        this.setPending(match, {
          kind: 'fbi-card',
          actorId: actor.userId,
          prompt: '你查看了大宅中的所有牌。选择一张执行其效果。',
          doors,
          ctx,
        });
        return;
      }
      case 'maze-secret': {
        const doors = this.mansion(match)
          .filter((candidate) => candidate.id !== card.id)
          .map((candidate) => candidate.door ?? 0);
        this.setPending(match, {
          kind: 'maze',
          actorId: actor.userId,
          prompt: '按门牌顺序说出所有其他牌。全部正确则你单独获胜，否则你死亡。',
          doors,
          ctx,
        });
        return;
      }
      case 'corpse-room': {
        const target = this.nearestDeadLeft(match, actor);
        if (target) {
          this.removeCard(match, card);
          this.revive(match, target, true);
          this.addLog(match, `${actor.name} 复活了 ${target.name}，他变成了杀人鬼。`, 'death');
        }
        this.completeCard(match, ctx);
        return;
      }
      case 'grimoire':
        this.removeCard(match, card);
        match.grimoire = true;
        this.addLog(match, '【魔导书】被公开：此后翻到致命牌会立即强制死亡。', 'reveal');
        this.completeCard(match, ctx);
        return;
      case 'tattoo':
        this.startTattoo(match, ctx);
        return;
      case 'incense':
        if (match.players.some((player) => !player.alive)) {
          this.setPending(match, {
            kind: 'incense-use',
            actorId: actor.userId,
            prompt: '要使用【返魂香】复活一名死亡玩家吗？',
            options: [
              { id: 'yes', label: '使用返魂香' },
              { id: 'no', label: '不使用，声称空房间' },
            ],
            ctx,
          });
        } else {
          this.claimEmpty(match, card, bearer);
          this.completeCard(match, ctx);
        }
        return;
      case 'fool-lamp':
        bearer.role = bearer.role === 'good' ? 'murderer' : 'good';
        this.claimEmpty(match, card, bearer);
        this.addLog(match, '有人被愚弄之灯改变了身份。');
        this.completeCard(match, ctx);
        return;
      case 'whisper': {
        const doors = this.mansion(match)
          .filter((candidate) => candidate.id !== card.id)
          .map((candidate) => candidate.door ?? 0);
        this.setPending(match, {
          kind: 'whisper-target',
          actorId: actor.userId,
          prompt: '选择一张牌；本局中它不会被洗混。',
          doors,
          ctx,
        });
        return;
      }
      case 'axe':
      case 'gift':
      case 'dagger':
        this.gainItem(match, card, bearer, actor);
        return;
      case 'handcuff-key':
        this.gainItem(match, card, bearer, actor);
        if (card.location !== 'held') return;
        this.setPending(match, {
          kind: 'handcuff-target',
          actorId: actor.userId,
          prompt: '给一名玩家戴上手铐。',
          options: match.players
            .filter((candidate) => candidate.alive)
            .map((candidate) => ({ id: candidate.userId, label: candidate.name })),
          ctx,
        });
        return;
      case 'torture':
        this.gainItem(match, card, bearer, actor);
        return;
      case 'moth':
        this.gainItem(match, card, bearer, actor);
        return;
      case 'fake-exit':
        this.gainItem(match, card, bearer, actor);
        return;
      default:
        this.completeCard(match, ctx);
    }
  }

  private completeCard(match: Match, ctx: EffectContext): void {
    if (match.phase !== 'playing' || match.pending) return;
    if (ctx.fbi) {
      ctx.fbi = false;
      this.shuffleMansion(match);
    }
    match.peeks.clear();
    match.peekMansionFor = null;
    match.ctx = null;
    const actor = this.player(match, ctx.actorId);
    if (!actor || !actor.alive) {
      this.advanceTurn(match);
      return;
    }
    if (this.playerHasItem(match, actor, 'torture')) {
      this.advanceTurn(match);
      return;
    }
    if (
      !match.extraUsed &&
      this.playerHasItem(match, actor, 'keycard') &&
      match.stage === 'resolving'
    ) {
      this.setPending(match, {
        kind: 'keycard',
        actorId: actor.userId,
        prompt: '你持有磁卡钥匙。要额外打开一扇门吗？',
        options: [
          { id: 'yes', label: '额外开门' },
          { id: 'no', label: '结束回合' },
        ],
        ctx,
      });
      return;
    }
    this.advanceTurn(match);
  }

  private advanceTurn(match: Match): void {
    if (match.phase !== 'playing') return;
    this.clearPending(match);
    match.ctx = null;
    match.stage = 'open';
    match.extraUsed = false;
    match.peeks.clear();
    match.peekMansionFor = null;
    const count = match.players.length;
    let seat = match.turnSeat;
    for (let step = 0; step < count * 2 + 1; step += 1) {
      seat = (seat + 1) % count;
      match.turnNumber += 1;
      const candidate = this.bySeat(match, seat);
      if (!candidate || !candidate.alive) continue;
      if (
        this.playerHasItem(match, candidate, 'neuro-gas') &&
        candidate.neuroTurn !== null &&
        match.turnNumber - candidate.neuroTurn >= 4
      ) {
        const gas = this.held(match, candidate.userId).find((card) => card.type === 'neuro-gas');
        if (gas) this.removeCard(match, gas);
        this.addLog(match, `${candidate.name} 的神经瓦斯发作了。`, 'death');
        this.kill(match, candidate, true, '神经瓦斯');
        if (match.phase !== 'playing') return;
        continue;
      }
      if (this.playerHasItem(match, candidate, 'torture')) {
        this.addLog(match, `${candidate.name} 被拷问室困住，跳过回合。`, 'system');
        continue;
      }
      match.turnSeat = seat;
      this.addLog(match, `轮到 ${candidate.name}。`, 'system');
      this.sendViews(match);
      return;
    }
    this.finish(match, [], 'all_dead');
  }

  private kill(match: Match, player: Player, forced: boolean, reason: string, batch = false): boolean {
    if (!player.alive) return false;
    if (!forced) {
      const guardian = this.heldKeys(match, player.userId).find(
        (card) => card.type === 'guardian-key',
      );
      if (guardian) {
        guardian.type = 'silver-key';
        guardian.revealed = true;
        this.addLog(match, `${player.name} 公开了守护钥匙，防止了死亡。`, 'reveal');
        return false;
      }
      const armor = this.heldItems(match, player.userId).find((card) => card.type === 'armor');
      if (armor) {
        this.moveToMansion(match, armor);
        this.addLog(match, `${player.name} 的防弹衣挡住了死亡，防弹衣回到大宅。`, 'reveal');
        this.shuffleMansion(match);
        return false;
      }
    }
    player.alive = false;
    player.handcuffedBy = null;
    player.neuroTurn = null;
    this.addLog(match, `${player.name} 死亡了（${reason}）。`, 'death');
    for (const card of this.held(match, player.userId)) {
      if (card.type === 'xray') {
        this.removeCard(match, card);
        match.deadXray = true;
        this.addLog(match, '一张 X 光照片随死亡离开了游戏。', 'system');
      } else {
        this.moveToMansion(match, card);
      }
    }
    for (const other of match.players) {
      if (other.handcuffedBy === player.userId) other.handcuffedBy = null;
    }
    this.shuffleMansion(match);
    if (batch) return true;
    const alive = this.alivePlayers(match);
    if (alive.length === 0) {
      this.finish(match, [], 'all_dead');
      return true;
    }
    if (alive.length === 1 && alive[0]!.role === 'murderer') {
      this.finish(match, [alive[0]!.userId], 'murderer');
    }
    return true;
  }

  private revive(match: Match, player: Player, murderer: boolean): void {
    player.alive = true;
    player.handcuffedBy = null;
    player.neuroTurn = null;
    if (murderer) player.role = 'murderer';
    this.addLog(match, `${player.name} 复活了。`, 'death');
  }

  private nearestDeadLeft(match: Match, player: Player): Player | undefined {
    const sorted = [...match.players].sort((a, b) => a.seat - b.seat);
    const index = sorted.findIndex((candidate) => candidate.userId === player.userId);
    for (let step = 1; step <= sorted.length; step += 1) {
      const candidate = sorted[(index - step + sorted.length) % sorted.length]!;
      if (!candidate.alive) return candidate;
    }
    return undefined;
  }

  private attemptEscape(match: Match, ctx: EffectContext): void {
    const bearer = this.player(match, ctx.bearerId);
    if (!bearer) return;
    const exit = this.cardById(match, ctx.cardId);
    if (exit) this.removeCard(match, exit);
    const keys = this.heldKeys(match, bearer.userId);
    for (const key of keys) key.revealed = true;
    const hasKiller = keys.some((card) => card.type === 'killer-key');
    const fakeHolder = match.players.find(
      (player) => player.alive && this.playerHasItem(match, player, 'fake-exit'),
    );
    let fakeFailed = false;
    if (fakeHolder) {
      const roll = this.randomDie();
      this.addLog(match, `${fakeHolder.name} 的假逃生出口触发：掷出 ${roll}。`, 'reveal');
      fakeFailed = roll <= 3;
    }
    if (hasKiller || fakeFailed) {
      this.addLog(
        match,
        hasKiller ? '逃生用的钥匙中包含杀人鬼的钥匙，逃生失败。' : '逃生出口是假的，逃生失败。',
        'death',
      );
      const alive = this.alivePlayers(match);
      for (const player of alive) this.kill(match, player, true, '逃生失败', true);
      this.finish(match, [], hasKiller ? 'escape_failed' : 'fake_exit_failed');
      return;
    }
    const winners = match.players
      .filter((player) => player.role === 'good')
      .map((player) => player.userId);
    this.finish(match, winners, 'escape');
  }

  private startTattoo(match: Match, ctx: EffectContext): void {
    const dead = new Set<string>();
    const pending = {
      kind: 'tattoo' as const,
      actorId: ctx.actorId,
      prompt: '所有存活玩家秘密选择一个 1–5 的数字。15 秒内未选择则自动选择 1。',
      options: [1, 2, 3, 4, 5].map((number) => ({ id: String(number), label: String(number) })),
      ctx,
      submitted: new Map<string, number>(),
      deadline: Date.now() + 15_000,
    };
    this.setPending(match, pending);
    const timer = setTimeout(() => this.resolveTattoo(match, true), 15_000);
    timer.unref();
    if (match.pending) match.pending.timer = timer;
  }

  private submitTattoo(match: Match, player: Player, number: number): void {
    const pending = match.pending;
    if (!pending || pending.kind !== 'tattoo' || !pending.submitted) return;
    if (!player.alive || pending.submitted.has(player.userId)) return;
    if (!Number.isInteger(number) || number < 1 || number > 5) return;
    pending.submitted.set(player.userId, number);
    if (pending.submitted.size >= this.alivePlayers(match).length) {
      this.resolveTattoo(match, false);
    } else {
      this.sendViews(match);
    }
  }

  private resolveTattoo(match: Match, timeout: boolean): void {
    const pending = match.pending;
    if (!pending || pending.kind !== 'tattoo') return;
    if (pending.timer) clearTimeout(pending.timer);
    const choices = pending.submitted ?? new Map<string, number>();
    for (const player of match.players) {
      if (player.alive && !choices.has(player.userId)) choices.set(player.userId, 1);
    }
    const total = [...choices.values()].reduce((sum, number) => sum + number, 0);
    this.addLog(
      match,
      `数字刺青：${[...choices.entries()]
        .map(([id, number]) => `${this.player(match, id)?.name ?? id}=${number}`)
        .join('，')}，总和 ${total}。${timeout ? '（超时未选择者按 1 计）' : ''}`,
    );
    const source = this.cardById(match, pending.ctx?.cardId ?? '');
    if (source) this.removeCard(match, source);
    this.clearPending(match);
    const ctx = pending.ctx!;
    if (total === 7) {
      this.addLog(match, '总和为 7，无人死亡。');
    } else {
      const max = Math.max(...choices.values());
      const victims = [...choices.entries()]
        .filter(([, number]) => number === max)
        .map(([id]) => this.player(match, id))
        .filter((player): player is Player => !!player && player.alive);
      for (const victim of victims) this.kill(match, victim, false, '数字刺青');
    }
    if (match.phase === 'playing') this.completeCard(match, ctx);
  }

  private resolveMaze(match: Match, answers: string[]): void {
    const pending = match.pending;
    if (!pending || pending.kind !== 'maze' || !pending.ctx) return;
    const ctx = pending.ctx;
    const actor = this.player(match, ctx.actorId);
    if (!actor) return;
    const doors = pending.doors ?? [];
    const expected = doors.map((door) => {
      const card = this.mansion(match).find((candidate) => candidate.door === door);
      return card ? cardDef(card.type).name : '';
    });
    const correct =
      answers.length === expected.length &&
      answers.every((answer, index) => answer.trim() === expected[index]);
    this.clearPending(match);
    const source = this.cardById(match, ctx.cardId);
    if (source) this.removeCard(match, source);
    if (correct) {
      this.addLog(match, `${actor.name} 解开了迷宫的秘密，单独获胜！`, 'reveal');
      this.finish(match, [actor.userId], 'maze');
      return;
    }
    this.addLog(match, `${actor.name} 说错了迷宫的秘密。`, 'death');
    this.kill(match, actor, false, '迷宫的秘密');
    if (match.phase === 'playing') this.completeCard(match, ctx);
  }

  private rescue(match: Match, actor: Player, targetId: string): void {
    if (match.phase !== 'playing' || match.pending || match.stage !== 'open') return;
    if (match.turnSeat !== actor.seat) return;
    const target = this.player(match, targetId);
    if (!target || !target.alive || !this.playerHasItem(match, target, 'torture')) return;
    const silver = this.heldKeys(match, actor.userId).find((card) => card.type === 'silver-key');
    if (!silver) return;
    silver.revealed = true;
    this.moveToMansion(match, silver);
    const torture = this.held(match, target.userId).find((card) => card.type === 'torture');
    if (torture) this.moveToMansion(match, torture);
    this.addLog(match, `${actor.name} 用一张银钥匙解救了 ${target.name}。`);
    this.shuffleMansion(match);
    this.advanceTurn(match);
  }

  private finish(match: Match, winners: string[], reason: RedGateResult['reason']): void {
    if (match.phase === 'finished') return;
    this.clearPending(match);
    match.phase = 'finished';
    match.stage = 'finished';
    match.ctx = null;
    match.result = {
      winners,
      reason,
      roles: Object.fromEntries(match.players.map((player) => [player.userId, player.role])),
    };
    this.addLog(
      match,
      winners.length
        ? `${winners.map((id) => this.player(match, id)?.name ?? id).join('、')} 获胜。`
        : '游戏结束，没有人获胜。',
      'system',
    );
    this.sendViews(match);
    this.send({ v: 1, t: 'result', matchId: match.id, result: match.result });
  }
}
