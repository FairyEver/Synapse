import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Chip, Modal, Tabs } from '@heroui/react'
import { ArrowRight, Check, ChevronDown, ChevronUp, Layers, Trophy } from 'lucide-react'
import { scenarios, format, signed, delta, winnerIds, type Scenario, type Player } from './model'
import './preview.css'

const faces = import.meta.glob('../../../../dashboard/src/game-center/games/poker/assets/cards/*.svg', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const art = Object.fromEntries(Object.entries(faces).map(([path, svg]) => [path.split('/').pop()!.replace('.svg', ''), `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`]))
const suits: Record<string, string> = { s: '黑桃', h: '红桃', d: '方片', c: '梅花' }

function PlayingCard({ card, highlighted = false, source }: { card?: string; highlighted?: boolean; source?: string }) {
  const label = card ? `${suits[card[1]]}${card[0] === 'T' ? '10' : card[0]}` : '未公开手牌'
  return <span className="card-with-source">
    <span className="playing-card" data-highlighted={highlighted} data-hidden={!card} role="img" aria-label={label}>
      {card ? <img src={art[card]} alt="" draggable={false} /> : <span aria-hidden="true">♠</span>}
      {highlighted && <span className="card-check" aria-hidden="true"><Check size={10} strokeWidth={3} /></span>}
    </span>
    {source && <span className="card-source">{source}</span>}
  </span>
}

function Hand({ player }: { player: Player }) {
  return <div className="hole-cards"><PlayingCard card={player.hole?.[0]} /><PlayingCard card={player.hole?.[1]} /></div>
}

function PlayerRow({ player, winner, chosen, onChoose, pools }: { player: Player; winner: boolean; chosen: boolean; onChoose: () => void; pools: string[] }) {
  const net = delta(player)
  return <tr data-me={player.me} data-selected={chosen}>
    <td><div className="player-name"><span className="initial" aria-hidden="true">{player.name[0]}</span><div><div className="name-line"><strong>{player.name}</strong>{player.me && <span className="text-muted text-xs">你</span>}{winner && <Trophy size={14} className="text-accent" aria-label="收池玩家" />}</div><span className="row-meta">{player.folded ? '已弃牌' : pools.join(' · ') || '未收池'}</span></div></div></td>
    <td><div className="hand-cell"><Hand player={player} /><span className="text-muted text-xs">{player.folded ? '未公开' : player.rank || player.detail}</span></div></td>
    <td className="numeric">{format(player.invested)}</td>
    <td className="numeric">{format(player.payout)}</td>
    <td className="numeric"><strong className={net > 0 ? 'text-success-soft-foreground' : ''}>{signed(net)}</strong><span className="mobile-ending">投 {format(player.invested)}<br />收 {format(player.payout)}<br />余 {format(player.ending)}</span></td>
    <td className="numeric ending-column">{format(player.ending)}</td>
    <td className="detail-column"><Button variant="ghost" size="sm" isDisabled={!player.best} onPress={onChoose} aria-label={`查看${player.name}的最佳五张牌`} aria-pressed={chosen}>比牌</Button></td>
  </tr>
}

function PotBreakdown({ scenario }: { scenario: Scenario }) {
  return <div className="pots-list">{scenario.pots.map(pot => <section className="pot-row" key={pot.name}>
    <div className="pot-heading"><span className="flex items-center gap-2"><Layers size={16} className="text-muted" /><strong>{pot.name}</strong></span><strong className="tabular-nums">{format(pot.amount)}</strong></div>
    <p className="text-xs text-muted">{pot.refund ? '不参与比牌，原路返还' : `参与：${pot.eligible.map(i => scenario.players[i].name).join('、')}`}</p>
    <div className="pot-shares">{Object.entries(pot.shares).map(([index, amount]) => <span key={index}>{scenario.players[Number(index)].name}<ArrowRight size={13} className="text-muted" /><b>{format(amount)}</b></span>)}</div>
  </section>)}</div>
}

function ResultDialog({ scenario, open, onOpenChange }: { scenario: Scenario; open: boolean; onOpenChange: (value: boolean) => void }) {
  const winners = winnerIds(scenario)
  const [selected, setSelected] = useState(winners[0])
  const [rules, setRules] = useState(false)
  const player = scenario.players[selected]
  const mine = scenario.players.find(p => p.me)!
  const net = delta(mine)
  const total = scenario.pots.filter(p => !p.refund).reduce((sum, p) => sum + p.amount, 0)
  const refund = scenario.pots.filter(p => p.refund).reduce((sum, p) => sum + (p.shares[scenario.players.indexOf(mine)] || 0), 0)
  const boardBest = new Set(player.best ?? [])
  const ranks = ['皇家同花顺', '同花顺', '四条', ...(scenario.variant === 'short32' ? ['同花', '葫芦'] : ['葫芦', '同花']), '顺子', '三条', '两对', '一对', '高牌']
  return <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange} isDismissable>
    <Modal.Container size="lg" placement="center" scroll="inside">
      <Modal.Dialog className="result-dialog sm:max-w-5xl">
        <Modal.CloseTrigger aria-label="关闭结算，返回牌桌" />
        <Modal.Header>
          <div className="header-meta"><span>第 {scenario.hand} 手</span><span>·</span><span>{scenario.variant === 'short32' ? '32 张短牌' : '标准德州扑克'}</span><span>·</span><span>盲注 5 / 10</span></div>
          <Modal.Heading>本局结算</Modal.Heading>
        </Modal.Header>
        <Modal.Body>
          <section className="outcome-section" aria-label="本局输赢">
            <div className="outcome-main"><span className="trophy-medallion" aria-hidden="true"><Trophy size={25} strokeWidth={1.7} /></span><div><h2>{scenario.title}</h2><div className="winner-subtitle"><span>{scenario.reason}</span></div></div></div>
            <div className="personal-result"><span className="text-xs text-muted">{net > 0 ? '你的本局净赢' : net < 0 ? '你的本局净输' : '你的本局净变化'}</span><strong className={net > 0 ? 'text-success-soft-foreground' : ''}>{signed(net)}<span>点数</span></strong><span className="text-xs text-muted">收回 {format(mine.payout)} − 投入 {format(mine.invested)}{refund > 0 ? `（收回含返还 ${format(refund)}）` : ''}</span></div>
          </section>
          <section className="board-section" aria-label="公共牌">
            <div className="board-label"><span>公共牌</span><span className="text-xs text-muted">底池 {format(total)}</span></div>
            <div className="board-cards">{scenario.board.map(card => <PlayingCard key={card} card={card} highlighted={boardBest.has(card)} />)}{Array.from({ length: 5 - scenario.board.length }, (_, i) => <span className="undealt-card" role="img" aria-label="未发公共牌" key={i}>未发</span>)}</div>
            <p className="board-caption">{scenario.comparison}</p>
          </section>
          {player.best && <section className="best-section" aria-label={`${player.name}的最佳五张牌`}>
            <div className="best-copy"><div className="flex flex-wrap items-center gap-2"><h3>{player.name}{player.me ? '（你）' : ''}的最佳五张</h3>{winners.includes(selected) && <Chip size="sm" color="accent" variant="soft">{scenario.pots.filter(p => !p.refund && p.shares[selected]).map(p => p.name).join(' · ')}赢家</Chip>}</div><p><strong>{player.rank}</strong><span>{player.detail}</span></p><span className="text-xs text-muted">标记表示参与组成牌型的手牌</span></div>
            <div className="best-cards">{player.best.map(card => <PlayingCard key={card} card={card} highlighted={player.hole?.includes(card)} source={scenario.decisive?.includes(card) ? '决定胜负' : player.hole?.includes(card) ? '手牌' : '公共牌'} />)}</div>
          </section>}
          <Tabs className="w-full" variant="secondary" aria-label="结算详情">
            <Tabs.ListContainer><Tabs.List aria-label="结算详情"><Tabs.Tab id="players">全员结算 <span className="tab-count">{scenario.players.length}</span><Tabs.Indicator /></Tabs.Tab><Tabs.Tab id="pots">底池分配 <span className="tab-count">{scenario.pots.length}</span><Tabs.Indicator /></Tabs.Tab></Tabs.List></Tabs.ListContainer>
            <Tabs.Panel id="players" className="pt-3">
              <div className="table-wrap"><table className="players-table"><caption className="sr-only">本局每位玩家的手牌、投入、收回、净变化和剩余筹码</caption><thead><tr><th>玩家</th><th>手牌 / 牌型</th><th className="numeric">投入</th><th className="numeric">收回</th><th className="numeric">净变化</th><th className="numeric ending-column">剩余</th><th className="detail-column"><span className="sr-only">比牌</span></th></tr></thead><tbody>{scenario.players.map((p, i) => <PlayerRow key={i} player={p} winner={winners.includes(i)} chosen={selected === i} pools={scenario.pots.filter(pot => !pot.refund && pot.shares[i]).map(pot => pot.name)} onChoose={() => setSelected(i)} />)}</tbody></table></div>
              <p className="privacy-note">未公开的手牌保持隐藏。收回包含底池分配及未跟注返还。</p>
            </Tabs.Panel>
            <Tabs.Panel id="pots" className="pt-3"><PotBreakdown scenario={scenario} /></Tabs.Panel>
          </Tabs>
          {rules && <section className="rules-section" aria-label="本局牌型顺序"><h3>{scenario.variant === 'short32' ? '32 张短牌' : '标准德州扑克'} · 从大到小</h3><p>{ranks.join(' › ')}</p><p className="text-muted text-xs">选七张中最好的五张比较；牌型相同时逐张比点数，花色不分大小。{scenario.variant === 'short32' ? 'A、7、8、9、10 可组成最小顺子。' : 'A、2、3、4、5 可组成最小顺子。'}</p></section>}
        </Modal.Body>
        <Modal.Footer className="result-footer">
          <Button variant="ghost" onPress={() => setRules(!rules)} aria-expanded={rules}>{rules ? <ChevronUp /> : <ChevronDown />}牌型顺序</Button>
          <span className="footer-hint">下一手开始前自动收起，可从牌局记录重看</span>
          <Button onPress={() => onOpenChange(false)}>返回牌桌<ArrowRight /></Button>
        </Modal.Footer>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>
}

function App() {
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState(true)
  const scenario = scenarios[index]
  function choose(i: number) { setIndex(i); setOpen(true) }
  return <main className="prototype-page">
    <header className="prototype-top"><span className="flex items-center gap-2 font-semibold"><span className="brand-suit" aria-hidden="true">♠</span>德州扑克</span><Chip variant="soft">交互原型</Chip></header>
    <div className="prototype-content"><div className="prototype-intro"><span className="text-muted text-sm">HeroUI · 每手结算</span><h1>一手结束，<br />看清每一份输赢。</h1><p>查看赢家、最佳五张牌与全员筹码变化。<br />以下场景均为演示数据，不连接真实牌局。</p><Button onPress={() => setOpen(true)}>打开本局结算<ArrowRight /></Button></div>
      <section className="scenario-list" aria-label="选择原型场景"><h2>预览场景</h2>{scenarios.map((s, i) => <Button key={s.id} variant={index === i ? 'secondary' : 'ghost'} className="scenario-button" onPress={() => choose(i)}><span>{s.label}</span><ArrowRight /></Button>)}</section>
    </div>
    <footer className="prototype-bottom"><span>桌面弹窗 / 窄屏滚动布局</span><span>关闭面板后可切换示例场景</span></footer>
    <ResultDialog key={scenario.id} scenario={scenario} open={open} onOpenChange={setOpen} />
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)
