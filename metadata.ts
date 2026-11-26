import type { GameMetadata } from '../../protocol/protocol.js';

export const RED_GATE_GAME: GameMetadata = {
  id: 'red-gate',
  name: '红色的门和杀人鬼的钥匙',
  version: '0.1.0',
  protocol: 1,
  minPlayers: 3,
  maxPlayers: 8,
  description: '3–8 人隐藏身份卡牌游戏：在红门大宅中寻找三把银钥匙，同时提防混在人群中的杀人鬼。',
  author: 'kwibaka',
  spectatorChat: false,
};
