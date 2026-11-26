/**
 * Red Gate browser module.
 * Hidden keys and identities are omitted by the server for non-owners; the
 * spectator view is intentionally complete but cannot chat (metadata flag).
 */

const CARD_NAMES = [
  '空房间',
  '银钥匙',
  '杀人鬼的钥匙',
  '逃生出口',
  '不起眼的线索',
  '杀人鬼的陷阱',
  '催眠瓦斯',
  '福至心灵',
  '有子弹的房间',
  '手枪',
  '防弹衣',
  '磁卡钥匙',
  '守护钥匙',
  '危险的门缝',
  '眩晕时钟',
  'FBI证件',
  '迷宫的秘密',
  '有尸体的房间',
  '魔导书',
  '数字刺青',
  '返魂香',
  '愚弄之灯',
  '低声细语',
  '神经瓦斯',
  '杀人鬼的斧头',
  'X光照片',
  '拷问室',
  '匕首',
  '手铐钥匙',
  '沉默的毒蛾',
  '监控室',
  '防毒面具',
  '杀人鬼的礼物',
  '假的逃生出口',
];

const PHASES = {
  waiting: '等待开始',
  playing: '对局进行中',
  finished: '对局结束',
};

let countdownTimer = null;
let mazeDraft = {};

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function art(type) {
  return `/games/red-gate/assets/${type}.png`;
}

function playerName(view, id) {
  return view.players.find((player) => player.userId === id)?.name || id;
}

function roleLabel(role) {
  return role === 'murderer' ? '杀人鬼' : '好人';
}

function cardImage(card, className = 'rg-card-art') {
  const wrap = el('div', className);
  if (card.type) {
    const img = document.createElement('img');
    img.src = art(card.type);
    img.alt = card.name || '';
    img.loading = 'lazy';
    wrap.appendChild(img);
    wrap.appendChild(el('span', 'rg-card-caption', card.name || ''));
  } else {
    wrap.appendChild(el('span', 'rg-card-back-mark', '？'));
    wrap.appendChild(el('span', 'rg-card-caption', '扣置的牌'));
  }
  return wrap;
}

export function render(container, { view, onAction }) {
  container.replaceChildren();
  if (!view || view.schema !== 'red-gate-v1') {
    container.appendChild(el('p', 'muted', '等待红门视图…'));
    return;
  }
  if (countdownTimer) clearInterval(countdownTimer);
  if (view.phase !== 'playing') mazeDraft = {};

  const root = el('div', 'rg-shell');
  const header = el('div', 'rg-header');
  header.appendChild(el('span', 'rg-mode', '3–8 人 · 隐藏身份'));
  header.appendChild(el('span', 'rg-turn', view.turn ? `回合：${view.turnName}` : ''));
  header.appendChild(el('span', 'rg-keys', `逃生需要 ${view.requiredKeys} 把钥匙`));
  if (view.grimoire) header.appendChild(el('span', 'rg-danger-badge', '魔导书生效'));
  root.appendChild(header);

  const hint = el('p', 'rg-hint');
  if (view.phase === 'waiting') hint.textContent = '等待所有玩家准备。';
  else if (view.phase === 'finished') hint.textContent = '对局结束。';
  else if (view.pending) hint.textContent = view.pending.prompt;
  else if (view.canOpen) hint.textContent = '点击大宅中的一扇门，执行它的效果。';
  else hint.textContent = '等待当前玩家行动。';
  root.appendChild(hint);

  if (view.canRescue?.length) {
    const rescue = el('div', 'rg-rescue');
    rescue.appendChild(el('span', 'muted', '可用银钥匙解救：'));
    for (const target of view.canRescue) {
      const button = el('button', 'rg-button', `解救 ${target.name}`);
      button.type = 'button';
      button.addEventListener('click', () => onAction({ type: 'rescue', targetId: target.userId }));
      rescue.appendChild(button);
    }
    root.appendChild(rescue);
  }

  if (view.pending?.canRespond) {
    root.appendChild(renderPrompt(view, onAction));
  } else if (view.pending) {
    root.appendChild(
      el(
        'p',
        'rg-wait',
        `${view.pending.actorName} 正在处理：${view.pending.prompt}`,
      ),
    );
  }

  const layout = el('div', 'rg-layout');
  layout.appendChild(renderMansion(view, onAction));
  layout.appendChild(renderPlayers(view));
  root.appendChild(layout);
  root.appendChild(renderHand(view));

  if (view.peek?.length) {
    const peek = el('div', 'rg-peek');
    peek.appendChild(el('h3', '', '你看到的牌'));
    for (const card of view.peek) peek.appendChild(cardImage(card, 'rg-peek-card'));
    root.appendChild(peek);
  }
  if (view.peekMansion?.length) {
    const peek = el('div', 'rg-peek');
    peek.appendChild(el('h3', '', '大宅中的全部牌（FBI证件）'));
    for (const card of view.peekMansion) {
      const item = cardImage(card, 'rg-peek-card');
      item.appendChild(el('span', 'rg-door-num', `${card.door} 号门`));
      peek.appendChild(item);
    }
    root.appendChild(peek);
  }

  if (view.result) {
    const result = el('div', 'rg-result');
    result.appendChild(
      el(
        'strong',
        '',
        view.result.winners.length
          ? `${view.result.winners.map((id) => playerName(view, id)).join('、')} 获胜`
          : '没有人获胜',
      ),
    );
    const reasons = {
      escape: '成功逃生',
      murderer: '最后存活的杀人鬼',
      maze: '解开迷宫的秘密',
      all_dead: '所有人死亡',
      escape_failed: '逃生失败，所有人死亡',
      fake_exit_failed: '假逃生出口，所有人死亡',
      resign: '认输',
    };
    result.appendChild(el('span', 'muted', reasons[view.result.reason] || view.result.reason));
    root.appendChild(result);
  }

  root.appendChild(renderLog(view));
  container.appendChild(root);
}

function renderMansion(view, onAction) {
  const panel = el('div', 'rg-panel rg-mansion-panel');
  const head = el('div', 'rg-panel-head');
  head.appendChild(el('h3', '', '大宅'));
  head.appendChild(el('span', 'muted small', `${view.mansion.length} 扇门`));
  panel.appendChild(head);
  const grid = el('div', 'rg-mansion');
  const pendingDoors = view.pending?.canRespond && view.pending.doors
    ? new Set(view.pending.doors)
    : null;
  for (const card of view.mansion) {
    const clickable = view.canOpen || (pendingDoors && pendingDoors.has(card.door));
    const tile = el('button', `rg-door${clickable ? ' clickable' : ''}${card.revealed ? ' revealed' : ''}`);
    tile.type = 'button';
    tile.disabled = !clickable;
    tile.title = card.type ? `${card.door} 号门：${card.name}` : `${card.door} 号门`;
    if (card.type) {
      tile.appendChild(cardImage(card, 'rg-card-art'));
    } else {
      tile.appendChild(el('span', 'rg-door-num', String(card.door)));
      tile.appendChild(el('span', 'rg-door-back', '红门'));
      if (card.claim === 'empty') tile.appendChild(el('span', 'rg-claim-badge', '声称：空房间'));
    }
    if (card.revealed) tile.classList.add('revealed');
    if (clickable) {
      tile.addEventListener('click', () => {
        if (pendingDoors) onAction({ type: 'choice', choice: String(card.door) });
        else onAction({ type: 'open', door: card.door });
      });
    }
    grid.appendChild(tile);
  }
  panel.appendChild(grid);
  return panel;
}

function renderPlayers(view) {
  const panel = el('div', 'rg-panel rg-players-panel');
  panel.appendChild(el('h3', '', '玩家'));
  for (const player of view.players) {
    const row = el('div', `rg-player${player.alive ? '' : ' dead'}${player.isTurn ? ' turn' : ''}`);
    const top = el('div', 'rg-player-top');
    const initial = el('span', 'rg-avatar', (player.name || '?').slice(0, 1).toUpperCase());
    const name = el('div', 'rg-player-name');
    name.appendChild(document.createTextNode(player.name));
    if (player.isTurn) name.appendChild(el('span', 'rg-turn-badge', '行动中'));
    if (!player.alive) name.appendChild(el('span', 'rg-dead-badge', '死亡'));
    top.append(initial, name);
    if (player.role) top.appendChild(el('span', 'rg-role', roleLabel(player.role)));
    row.appendChild(top);
    const status = el('div', 'rg-player-status');
    status.appendChild(el('span', '', `钥匙 ${player.claimedKeys}`));
    if (player.tortured) status.appendChild(el('span', 'rg-warn', '被拷问'));
    if (player.muted) status.appendChild(el('span', 'rg-warn', '沉默'));
    if (player.handcuffedBy) status.appendChild(el('span', 'rg-warn', '被手铐'));
    row.appendChild(status);
    if (player.keys?.length) {
      const keys = el('div', 'rg-small-cards');
      for (const key of player.keys) keys.appendChild(cardImage(key, 'rg-small-card'));
      row.appendChild(keys);
    }
    if (player.items.length) {
      const items = el('div', 'rg-small-cards');
      for (const item of player.items) items.appendChild(cardImage(item, 'rg-small-card'));
      row.appendChild(items);
    }
    panel.appendChild(row);
  }
  return panel;
}

function renderHand(view) {
  const panel = el('div', 'rg-hand');
  const head = el('div', 'rg-panel-head');
  head.appendChild(el('h3', '', '你的手牌'));
  if (view.you) head.appendChild(el('span', 'rg-role', roleLabel(view.you.role)));
  panel.appendChild(head);
  if (!view.you) {
    panel.appendChild(el('p', 'muted', '观战者可以看到所有牌，但不能发言。'));
    return panel;
  }
  const keys = view.you.keys;
  const items = view.you.items;
  if (!keys.length && !items.length) {
    panel.appendChild(el('p', 'muted', '你还没有物品或钥匙。'));
    return panel;
  }
  const cards = el('div', 'rg-small-cards');
  for (const card of [...keys, ...items]) {
    const node = cardImage(card, 'rg-hand-card');
    if (card.type?.includes('key')) node.classList.add('key-card');
    cards.appendChild(node);
  }
  panel.appendChild(cards);
  return panel;
}

function renderPrompt(view, onAction) {
  const pending = view.pending;
  const box = el('div', 'rg-prompt');
  box.appendChild(el('strong', '', `${pending.actorName}：${pending.prompt}`));
  if (pending.kind === 'maze') {
    const doors = pending.doors || [];
    const form = el('div', 'rg-maze');
    const selects = [];
    for (const door of doors) {
      const row = el('label', 'rg-maze-row');
      row.appendChild(el('span', '', `${door} 号门`));
      const select = document.createElement('select');
      select.className = 'rg-maze-select';
      const empty = el('option', '', '选择牌名');
      empty.value = '';
      select.appendChild(empty);
      for (const name of CARD_NAMES) {
        const option = el('option', '', name);
        option.value = name;
        select.appendChild(option);
      }
      select.value = mazeDraft[door] || '';
      select.addEventListener('change', () => {
        mazeDraft[door] = select.value;
      });
      selects.push(select);
      row.appendChild(select);
      form.appendChild(row);
    }
    const submit = el('button', 'rg-button primary', '提交答案');
    submit.type = 'button';
    submit.addEventListener('click', () => {
      if (selects.some((select) => !select.value)) {
        window.alert('请为每一扇门选择牌名。');
        return;
      }
      onAction({ type: 'maze', answers: selects.map((select) => select.value) });
    });
    form.appendChild(submit);
    box.appendChild(form);
    return box;
  }
  if (pending.kind === 'tattoo') {
    if (pending.submitted) {
      box.appendChild(el('p', 'muted', '已提交，等待其他玩家…'));
    } else {
      const row = el('div', 'rg-choice-row');
      for (const option of pending.options || []) {
        const button = el('button', 'rg-button', option.label);
        button.type = 'button';
        button.addEventListener('click', () =>
          onAction({ type: 'tattoo', number: Number(option.id) }),
        );
        row.appendChild(button);
      }
      box.appendChild(row);
    }
    if (pending.deadline) {
      const timer = el('span', 'rg-deadline');
      const update = () => {
        const seconds = Math.max(0, Math.ceil((pending.deadline - Date.now()) / 1000));
        timer.textContent = `剩余 ${seconds} 秒`;
      };
      update();
      countdownTimer = setInterval(update, 250);
      box.appendChild(timer);
    }
    return box;
  }
  if (pending.doors?.length) {
    box.appendChild(el('p', 'muted', '请点击大宅中高亮的门。'));
  }
  if (pending.options?.length) {
    const row = el('div', 'rg-choice-row');
    for (const option of pending.options) {
      const button = el('button', 'rg-button', option.label);
      button.type = 'button';
      if (option.detail) button.title = option.detail;
      button.addEventListener('click', () =>
        onAction({ type: 'choice', choice: option.id }),
      );
      row.appendChild(button);
    }
    box.appendChild(row);
  }
  return box;
}

function renderLog(view) {
  const panel = el('div', 'rg-panel rg-log');
  panel.appendChild(el('h3', '', '记录'));
  const list = el('div', 'rg-log-list');
  for (const entry of view.log.slice(-80).reverse()) {
    list.appendChild(el('div', `rg-log-line ${entry.kind}`, entry.text));
  }
  panel.appendChild(list);
  return panel;
}
