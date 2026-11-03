// Offline study only: node server/test/poker-card-economy/study.cjs [boards] [paired trials] [seed]
const { load } = require("../poker-roll-research/loader.cjs")
const { cards, ranks } = require("../poker-roll-research/engine.cjs")
const { choose, mean, percentile, rng, seedOf, summarize } = load("math.ts")
const { visibleRank, visibleStrength } = load("policies.ts")

const boards = Number(process.argv[2] ?? 256), trials = Number(process.argv[3] ?? 64)
if (![boards, trials].every(n => Number.isSafeInteger(n) && n >= 2)) throw new Error("Invalid sample size")
const seed = Number(process.argv[4] ?? 20261103)
if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("Invalid seed")
const streets = { preflop: 0, flop: 3, turn: 4, river: 5 }
const ids = ["01", "02", "06", "07"]
const encode = ({ category, kickers }) => kickers.reduce((sum, rank, index) => sum + rank * 15 ** (4 - index), category * 15 ** 5)
const rank = (cards, variant) => encode(visibleRank(cards, variant))
const replace = (hole, slot, next) => slot === 0 ? [next, hole[1]] : [hole[0], next]
const take = (array, n, random) => {
  const pool = [...array]
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(random() * (pool.length - i))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool
}
const share = (value, others) => value < others.max ? 0 : value > others.max ? 1 : 1 / (1 + others.ties)
function opposition(opponents, board, variant) {
  const values = opponents.map(hole => rank([...hole, ...board], variant))
  const max = Math.max(...values)
  return { max, ties: values.filter(v => v === max).length }
}
function evaluateCell(variant, players, street) {
  const random = rng(seedOf(seed, variant, players, street))
  const deck = cards.orderedDeck(variant), boardSize = streets[street]
  const summaries = Object.fromEntries(ids.map(id => [id, []]))
  for (let i = 0; i < boards; i++) {
    const layout = take(deck, 2 + boardSize, random)
    const hole = layout.slice(0, 2), board = layout.slice(2, 2 + boardSize), unseen = layout.slice(2 + boardSize)
    // The player chooses the slot before seeing draws, using only their cards and the board.
    const values = [0, 1].map(slot => Object.fromEntries(unseen.map(card => [card, visibleStrength(replace(hole, slot, card), board, variant)])))
    const slotFor = count => {
      const expected = values.map(scores => Object.values(scores).sort((a, b) => a - b).reduce((sum, v, j) => sum + v * choose(j, count - 1) / choose(unseen.length, count), 0))
      return expected[1] > expected[0] ? 1 : 0
    }
    const single = slotFor(1), triple = slotFor(3)
    const best = (slot, candidates) => candidates.reduce((a, b) => values[slot][b] > values[slot][a] ? b : a)
    const totals = ids.map(() => ({ gain: 0, after: 0 }))
    for (let j = 0; j < trials; j++) {
      const dealt = take(unseen, (players - 1) * 2 + 5, random)
      const opponents = Array.from({ length: players - 1 }, (_, k) => dealt.slice(k * 2, k * 2 + 2))
      const remaining = dealt.slice((players - 1) * 2)
      const options = remaining.slice(0, 5)
      const future = take(remaining, 5 - boardSize, random).slice(0, 5 - boardSize)
      const beforeBoard = [...board, ...future], baseOthers = opposition(opponents, beforeBoard, variant)
      const base = share(rank([...hole, ...beforeBoard], variant), baseOthers)
      if (i === 0 && j === 0) {
        for (const h of [hole, ...opponents]) if (rank([...h, ...beforeBoard], variant) !== encode(ranks.evaluate([...h, ...beforeBoard], variant))) throw new Error("Rank implementation differs from reference")
      }
      const randomSlot = Math.floor(random() * 2)
      const after = [replace(hole, single, options[0]), options.slice(0, 2), replace(hole, triple, best(triple, options.slice(0, 3))), replace(hole, randomSlot, best(randomSlot, options))]
      after.forEach((next, k) => {
        // Couple the worlds by putting released cards in the sampled positions of the acquired cards.
        const replacements = new Map(next.flatMap((card, slot) => card === hole[slot] ? [] : [[card, hole[slot]]]))
        const changed = future.some(c => replacements.has(c))
        const finalBoard = changed ? [...board, ...future.map(c => replacements.get(c) ?? c)] : beforeBoard
        const equity = share(rank([...next, ...finalBoard], variant), changed ? opposition(opponents, finalBoard, variant) : baseOthers)
        totals[k].gain += equity - base
        totals[k].after += equity
      })
    }
    ids.forEach((id, k) => summaries[id].push({ gain: totals[k].gain / trials, after: totals[k].after / trials }))
  }
  return summaries
}

const cells = []
for (const variant of ["standard52", "short32"]) for (const players of [2, 4, 6]) for (const street of Object.keys(streets)) {
  cells.push({ variant, players, street, results: evaluateCell(variant, players, street) })
}
const pct = n => +(100 * n).toFixed(1)
const overview = Object.fromEntries(ids.map(id => {
  const group = cells.flatMap(cell => cell.results[id]), gain = group.map(r => r.gain)
  const result = summarize(gain)
  return [id, { mean: pct(result.mean), ci95: [pct(result.lower), pct(result.upper)], p90: pct(percentile(gain, .9)), positive: pct(mean(gain.map(v => Number(v > 0)))),
    byStreet: Object.fromEntries(Object.keys(streets).map(street => [street, pct(mean(cells.filter(c => c.street === street).flatMap(c => c.results[id].map(r => r.gain))))])) }]
}))
// Threshold model: EV = P × gain - (1 - new equity) × fee. Fees join the sole main pot.
const rates = { "01": [.25, .035], "02": [.25, .045], "06": [.75, .12], "07": [.75, .12] }
const stage = { preflop: .5, flop: 1, turn: 1.25, river: 1.5 }
const bigBlind = 20
const round = blinds => Math.ceil(bigBlind * blinds - 1e-9) / bigBlind
const v3Fee = (id, pot, street, previous) => {
  const [blind, rate] = rates[id]
  return round((blind + pot * rate * stage[street]) * (1 + .35 * Math.min(previous, 3)))
}
const valuable = (pot, row, fee) => Number(pot * row.gain > fee * (1 - row.after))
const showdowns = Object.fromEntries([3, 12, 40].map(pot => [pot, Object.fromEntries(ids.map(id => {
  const useRates = [0, 1, 2].map(previous => {
    const decisions = cells.flatMap(cell => cell.results[id].map(row => valuable(pot, row, v3Fee(id, pot, cell.street, previous))))
    return pct(mean(decisions))
  })
  return [id, useRates]
}))]))
// Compare the old fee at a stylized equal effective depth, and a flat price pegged to the v3 6 BB flop.
const comparison = Object.fromEntries([3, 12, 40].map(pot => [pot, Object.fromEntries(["v2 at 100BB", "v2 at 1000BB", "fixed", "v3"].map(model => {
  const decisions = cells.flatMap(({ players, street, results }) => ids.flatMap(id => {
    const [u, v] = street === "preflop" ? [1, 3] : street === "flop" ? [2, 5] : [4, 8]
    const w = bigBlind * (10 * pot + (players - 1) * (model === "v2 at 100BB" ? 100 : 1000))
    const normal = Math.max(2000, u * w), superPrice = Math.max(normal + 2000, v * w)
    const v2 = id === "01" ? normal / 2000 : id === "02" ? normal / 1000 : id === "06" ? superPrice / 2000 : superPrice * 3 / 4000
    const fee = model === "fixed" ? v3Fee(id, 6, "flop", 0) : model === "v3" ? v3Fee(id, pot, street, 0) : Math.ceil(v2) / bigBlind
    return results[id].map(row => valuable(pot, row, fee))
  }))
  return [model, pct(mean(decisions))]
}))]))
process.stdout.write(JSON.stringify({ seed, cells: cells.length, boards, trials, overview, positiveEvPercentByPotBbAndPreviousUses: showdowns, firstUseModelComparison: comparison }, null, 2) + "\n")
