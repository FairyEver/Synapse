import { card, step, EXTRA } from "./definition"
const draw = (count: number) => step("ability.draw", { admissionId: "$admission", count, reason: "card" })
export const DRAW_CARDS = [
  card("21", "小小补给", 2, "从共享能力牌池抽一张。", [draw(1)]),
  card("22", "灵感迸发", 2, "从共享能力牌池抽两张。", [draw(2)]),
  card("23", "满载而归", 1, "从共享能力牌池抽三张。", [draw(3)]),
  card("24", "弃旧图新", 2, "额外消耗自己另一张能力牌，从共享池抽两张。", [draw(2)], { selections: [EXTRA], consumeSelected: true }),
  card("25", "三思而行", 1, "从共享池暂取至多三张能力牌，选一张获得，其余原实例归还并洗匀。", [step("ability.candidates", { admissionId: "$admission", paymentVersion: "$payment", sourceInstanceId: "$instance" })], { requirements: ["candidate_pool"] }),
  card("26", "以一换一", 2, "额外消耗自己另一张能力牌，从共享池抽一张。", [draw(1)], { selections: [EXTRA], consumeSelected: true }),
  card("27", "雨露均沾", 2, "所有仍可行动的真人各从共享池抽一张能力牌。", [step("ability.drawAll", {})], { tags: ["group"] }),
  card("28", "灵感种子", 2, "生成一张新的“小小补给”放入共享池并洗匀，再从池中抽一张，不保证抽到新牌。", [step("ability.generate", { definitionIds: ["21"] }), draw(1)], { tags: ["generate"] }),
  card("29", "埋下伏笔", 1, "选择自己另一张能力牌，生成一个新副本放入共享池并洗匀，原牌保留；牌名仅本人知晓。", [step("ability.generate", { definitionIds: ["$otherDefinition"] })], { selections: [EXTRA], tags: ["generate"] }),
  card("30", "推陈出新", 1, "额外消耗自己另一张能力牌，向池中生成两张随机新牌（排除生成类）并洗匀，再抽两张。", [step("ability.generate", { randomCount: 2 }), draw(2)], { selections: [EXTRA], consumeSelected: true, tags: ["generate"] }),
]
