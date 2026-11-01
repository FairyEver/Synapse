export type Player = {
  name: string; hole?: string[]; best?: string[]; rank?: string; detail?: string
  invested: number; payout: number; ending: number; folded?: boolean; me?: boolean
}
export type Pot = { name: string; amount: number; eligible: number[]; shares: Record<number, number>; refund?: boolean }
export type Scenario = {
  id: string; label: string; hand: number; variant: 'standard52' | 'short32'
  board: string[]; title: string; reason: string; comparison: string
  players: Player[]; pots: Pot[]; decisive?: string[]
}

const showdown: Player[] = [
  { name: '沐白', me: true, hole: ['Ah', 'Ad'], best: ['Ah', 'Ad', 'Ac', 'Ks', 'Kd'], rank: '葫芦', detail: '三张 A · 一对 K', invested: 600, payout: 1850, ending: 3250 },
  { name: '林川', hole: ['Kh', 'Qh'], best: ['Kh', 'Ks', 'Kd', 'Ac', 'Qh'], rank: '三条', detail: '三张 K', invested: 600, payout: 0, ending: 1400 },
  { name: '小满', hole: ['Qs', 'Qd'], best: ['Ks', 'Kd', 'Qs', 'Qd', 'Ac'], rank: '两对', detail: 'K 和 Q 两对', invested: 600, payout: 0, ending: 1400 },
  { name: '阿舟', folded: true, invested: 50, payout: 0, ending: 1950 },
]
const common = {
  variant: 'standard52' as const, board: ['Ac', 'Ks', 'Kd', '7h', '2c'],
  pots: [{ name: '主池', amount: 1850, eligible: [0, 1, 2], shares: { 0: 1850 } }],
}

export const scenarios: Scenario[] = [
  { ...common, id: 'win', label: '我获胜', hand: 24, title: '你赢下了本局',
    reason: 'A 葫芦，拿下主池', comparison: '三张 A 加一对 K，击败林川的三条 K。', players: showdown },
  { ...common, id: 'loss', label: '我落败', hand: 25, title: '沐白赢下了本局',
    reason: '葫芦胜过三条', comparison: '你组成了三条 K；沐白的三张 A 加一对 K 更大。',
    players: showdown.map((p, i) => ({ ...p, me: i === 1 })) },
  { id: 'split', label: '平分底池', hand: 26, variant: 'standard52', board: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
    title: '两人平分底池', reason: '公共牌组成皇家同花顺', comparison: '双方最好的五张牌完全相同，手牌不参与比较，花色不分大小。',
    players: [
      { name: '沐白', me: true, hole: ['Qh', 'Qd'], best: ['As', 'Ks', 'Qs', 'Js', 'Ts'], rank: '皇家同花顺', detail: '使用全部公共牌', invested: 500, payout: 500, ending: 2000 },
      { name: '林川', hole: ['9h', '9d'], best: ['As', 'Ks', 'Qs', 'Js', 'Ts'], rank: '皇家同花顺', detail: '使用全部公共牌', invested: 500, payout: 500, ending: 2000 },
    ], pots: [{ name: '主池', amount: 1000, eligible: [0, 1], shares: { 0: 500, 1: 500 } }] },
  { ...common, id: 'side', label: '主池与边池', hand: 27, title: '沐白与林川分别收池',
    reason: 'A 葫芦赢主池，三条 K 赢边池', comparison: '沐白全下 300，只参与主池；林川在边池中击败小满的两对。',
    players: [
      { ...showdown[0], invested: 300, payout: 900, ending: 900 },
      { ...showdown[1], invested: 600, payout: 600, ending: 2000 },
      { ...showdown[2], invested: 600, ending: 1400 },
    ], pots: [
      { name: '主池', amount: 900, eligible: [0, 1, 2], shares: { 0: 900 } },
      { name: '边池 1', amount: 600, eligible: [1, 2], shares: { 1: 600 } },
    ] },
  { id: 'fold', label: '弃牌收池与返还', hand: 28, variant: 'standard52', board: ['Kh', '9c', '2d'],
    title: '你赢下了本局', reason: '其余玩家全部弃牌', comparison: '无需摊牌或比较牌型。未被跟注的 100 单独返还，不计入赢得的底池。',
    players: [
      { name: '沐白', me: true, hole: ['As', 'Qs'], detail: '无需摊牌', invested: 220, payout: 440, ending: 2220 },
      { name: '林川', folded: true, invested: 120, payout: 0, ending: 1880 },
      { name: '小满', folded: true, invested: 80, payout: 0, ending: 1920 },
      { name: '阿舟', folded: true, invested: 20, payout: 0, ending: 1980 },
    ], pots: [
      { name: '主池', amount: 340, eligible: [0], shares: { 0: 340 } },
      { name: '未跟注返还', amount: 100, eligible: [0], shares: { 0: 100 }, refund: true },
    ] },
  { id: 'kicker', label: '踢脚牌决胜', hand: 29, variant: 'standard52', board: ['As', 'Kd', '8c', '5h', '2d'],
    title: '你赢下了本局', reason: '同为一对 A，Q 踢脚牌更大', comparison: '先比一对 A，再比 K，均相同；下一张比较 Q 与 J，Q 更大。', decisive: ['Qs'],
    players: [
      { name: '沐白', me: true, hole: ['Ah', 'Qs'], best: ['Ah', 'As', 'Kd', 'Qs', '8c'], rank: '一对', detail: 'A 一对 · Q 踢脚', invested: 500, payout: 1000, ending: 2500 },
      { name: '林川', hole: ['Ad', 'Js'], best: ['Ad', 'As', 'Kd', 'Js', '8c'], rank: '一对', detail: 'A 一对 · J 踢脚', invested: 500, payout: 0, ending: 1500 },
    ], pots: [{ name: '主池', amount: 1000, eligible: [0, 1], shares: { 0: 1000 } }] },
  { id: 'short', label: '32 张短牌', hand: 30, variant: 'short32', board: ['Ah', 'Kh', '7h', 'Ad', 'Kd'],
    title: '你赢下了本局', reason: '短牌规则：同花胜过葫芦', comparison: '你的红桃同花击败林川的 A 葫芦。本局采用 32 张短牌的牌型顺序。',
    players: [
      { name: '沐白', me: true, hole: ['Qh', 'Jh'], best: ['Ah', 'Kh', 'Qh', 'Jh', '7h'], rank: '同花', detail: 'A 领头的红桃同花', invested: 500, payout: 1000, ending: 2500 },
      { name: '林川', hole: ['As', 'Ks'], best: ['As', 'Ah', 'Ad', 'Ks', 'Kh'], rank: '葫芦', detail: '三张 A · 一对 K', invested: 500, payout: 0, ending: 1500 },
    ], pots: [{ name: '主池', amount: 1000, eligible: [0, 1], shares: { 0: 1000 } }] },
]

export const format = (n: number) => n.toLocaleString('zh-CN')
export const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${format(Math.abs(n))}`
export const delta = (p: Player) => p.payout - p.invested
export const winnerIds = (s: Scenario) => [...new Set(s.pots.filter(p => !p.refund).flatMap(p => Object.keys(p.shares).map(Number)))]
