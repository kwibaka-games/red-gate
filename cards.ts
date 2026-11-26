import type { RedGateCardDef } from './types.js';

export const BASE_DECK: Array<{ type: string; count: number }> = [
  { type: 'empty-room', count: 2 },
  { type: 'silver-key', count: 3 },
  { type: 'killer-key', count: 1 },
  { type: 'escape-exit', count: 1 },
  { type: 'clue', count: 2 },
  { type: 'trap', count: 1 },
  { type: 'hypno-gas', count: 2 },
  { type: 'lucky', count: 1 },
  { type: 'bullet-room', count: 1 },
  { type: 'pistol', count: 1 },
  { type: 'armor', count: 1 },
  { type: 'keycard', count: 1 },
];

export const EXPANSION_CARDS: string[] = [
  'guardian-key',
  'danger-crack',
  'dizzy-clock',
  'fbi-id',
  'maze-secret',
  'corpse-room',
  'grimoire',
  'tattoo',
  'incense',
  'fool-lamp',
  'whisper',
  'neuro-gas',
  'axe',
  'xray',
  'torture',
  'dagger',
  'handcuff-key',
  'moth',
  'monitor',
  'gas-mask',
  'gift',
  'fake-exit',
];

export const CARD_DEFS: Record<string, RedGateCardDef> = {
  'empty-room': { type: 'empty-room', name: '空房间', kind: 'empty', description: '普通又空白，什么都没有。' },
  'silver-key': { type: 'silver-key', name: '银钥匙', kind: 'key', description: '逃生需要的三把银钥匙之一。' },
  'killer-key': { type: 'killer-key', name: '杀人鬼的钥匙', kind: 'key', description: '你转变为杀人鬼。' },
  'escape-exit': { type: 'escape-exit', name: '逃生出口', kind: 'exit', description: '持有足够钥匙时尝试逃生。' },
  clue: { type: 'clue', name: '不起眼的线索', kind: 'instant', description: '秘密检视大宅中的一张牌。' },
  trap: { type: 'trap', name: '杀人鬼的陷阱', kind: 'instant', description: '你死亡，陷阱重新置入大宅。' },
  'hypno-gas': { type: 'hypno-gas', name: '催眠瓦斯', kind: 'instant', description: '所有玩家失去物品和钥匙，然后打乱大宅。' },
  lucky: { type: 'lucky', name: '福至心灵', kind: 'instant', description: '公开一张被声称为银钥匙的牌。' },
  'bullet-room': { type: 'bullet-room', name: '有子弹的房间', kind: 'instant', description: '持有手枪时选择一名玩家死亡。' },
  pistol: { type: 'pistol', name: '手枪', kind: 'item', description: '没有子弹的空枪。' },
  armor: { type: 'armor', name: '防弹衣', kind: 'item', description: '可以避免一次死亡，但不能避免强制死亡。' },
  keycard: { type: 'keycard', name: '磁卡钥匙', kind: 'item', description: '你的回合内可以额外打开一扇门。' },
  'guardian-key': { type: 'guardian-key', name: '守护钥匙', kind: 'key', expansion: 'guardian-key', description: '也视为银钥匙，可防止一次死亡。' },
  'danger-crack': { type: 'danger-crack', name: '危险的门缝', kind: 'instant', expansion: 'danger-crack', description: '揭示一张牌，或把所有物品和钥匙放入大宅。' },
  'dizzy-clock': { type: 'dizzy-clock', name: '眩晕时钟', kind: 'instant', expansion: 'dizzy-clock', description: '所有玩家把物品交给上家。' },
  'fbi-id': { type: 'fbi-id', name: 'FBI证件', kind: 'instant', expansion: 'fbi-id', description: '查看所有其他牌，选择一张执行其效果。' },
  'maze-secret': { type: 'maze-secret', name: '迷宫的秘密', kind: 'instant', expansion: 'maze-secret', description: '按顺序说出所有其他牌，全部正确则单独获胜。' },
  'corpse-room': { type: 'corpse-room', name: '有尸体的房间', kind: 'instant', expansion: 'corpse-room', description: '复活左侧最近的死亡玩家，他变为杀人鬼。' },
  grimoire: { type: 'grimoire', name: '魔导书', kind: 'instant', expansion: 'grimoire', description: '此后翻到致命牌立即强制死亡。' },
  tattoo: { type: 'tattoo', name: '数字刺青', kind: 'instant', expansion: 'tattoo', description: '所有人秘密选择 1–5，数字和不为 7 时最大者死亡。' },
  incense: { type: 'incense', name: '返魂香', kind: 'instant', expansion: 'incense', description: '所有钥匙洗回大宅，然后复活一名死亡玩家。' },
  'fool-lamp': { type: 'fool-lamp', name: '愚弄之灯', kind: 'instant', expansion: 'fool-lamp', description: '切换你的善恶身份，然后声称这是空房间。' },
  whisper: { type: 'whisper', name: '低声细语', kind: 'instant', expansion: 'whisper', description: '选择一张牌，本局中它不会被洗混。' },
  'neuro-gas': { type: 'neuro-gas', name: '神经瓦斯', kind: 'item', expansion: 'neuro-gas', description: '获得后的第 4 个回合开始时强制死亡。' },
  axe: { type: 'axe', name: '杀人鬼的斧头', kind: 'item', expansion: 'axe', description: '你变为杀人鬼；打开空房间时可以杀死一名玩家。' },
  xray: { type: 'xray', name: 'X光照片', kind: 'item', expansion: 'xray', description: '死亡时不回大宅；持有者死亡后视为一把公开银钥匙。' },
  torture: { type: 'torture', name: '拷问室', kind: 'item', expansion: 'torture', description: '持有者回合不能行动，其他玩家可以用一张银钥匙解救。' },
  dagger: { type: 'dagger', name: '匕首', kind: 'item', expansion: 'dagger', description: '你翻牌时必须让另一名玩家承担效果或获得牌。' },
  'handcuff-key': { type: 'handcuff-key', name: '手铐钥匙', kind: 'item', expansion: 'handcuff-key', description: '给一名玩家戴上手铐，其获得物品或钥匙时改由你获得。' },
  moth: { type: 'moth', name: '沉默的毒蛾', kind: 'item', expansion: 'moth', description: '你不能说话。' },
  monitor: { type: 'monitor', name: '监控室', kind: 'item', expansion: 'monitor', description: '其他玩家查看牌时你可以一起观看。' },
  'gas-mask': { type: 'gas-mask', name: '防毒面具', kind: 'item', expansion: 'gas-mask', description: '不受神经瓦斯和催眠瓦斯影响。' },
  gift: { type: 'gift', name: '杀人鬼的礼物', kind: 'item', expansion: 'gift', description: '你变为杀人鬼，并知道大宅中所有牌。' },
  'fake-exit': { type: 'fake-exit', name: '假的逃生出口', kind: 'item', expansion: 'fake-exit', description: '逃生成功时掷 1D6，小于等于 3 则逃生失败。' },
};

export function cardDef(type: string): RedGateCardDef {
  return CARD_DEFS[type] ?? { type, name: type, kind: 'empty', description: '' };
}

export function buildDeck(expansions: string[]): string[] {
  const selected = new Set(expansions.filter((type) => EXPANSION_CARDS.includes(type)));
  const deck: string[] = [];
  for (const entry of BASE_DECK) {
    let count = entry.count;
    if (entry.type === 'silver-key' && selected.has('guardian-key')) count -= 1;
    for (let i = 0; i < count; i += 1) deck.push(entry.type);
  }
  for (const type of EXPANSION_CARDS) {
    if (selected.has(type)) deck.push(type);
  }
  return deck;
}
