import { card, step, install, STATUS, CLEANSE, HUMAN } from "./definition"
export const DEFENSE_CARDS = [
  card("41", "护身符", 2, "阻止下一次他人能力牌对本人底牌的替换、交换或重洗。", [install("hole_guard", 1)]),
  card("42", "铁壁", 1, "阻止两次他人能力牌对本人底牌的替换、交换或重洗，按实际拦截扣减。", [install("hole_guard", 2)]),
  card("43", "缄默护罩", 2, "阻止下一次他人能力牌对本人底牌的查看或公开。", [install("info_guard", 1)]),
  card("44", "守财印", 2, "保护本人暂存待分份额免遭下一次盗取，不阻止原付款人取回。", [install("theft_guard", 1)]),
  card("45", "驱散术", 2, "选择并移除一个公开、可驱散的持续效果，可以属于玩家或全场。", [step("ability.dispel", { effectId: "$status" })], { selections: [STATUS] }),
  card("46", "净化术", 2, "选择并移除本人一个可驱散的负面持续效果；本牌不受追加卡费影响。", [step("ability.dispel", { effectId: "$status", cleanse: true })], { selections: [CLEANSE], ignoreSurcharges: true }),
  card("47", "反窥之眼", 1, "阻止下一次他人私下窥看本人底牌，并私下反窥施放者一张随机底牌；不再次反窥。", [install("reflect", 1)]),
  card("48", "反制咒", 1, "阻止下一次他人以本人为唯一外部目标的敌意能力牌效果，代价不退。", [install("counter", 1)]),
  card("49", "沉重咒印", 1, "选定其他真人下一次用能力牌时额外支付2BB至暂存，成功出牌后结束。", [install("surcharge", 1, { amount: "$bb2" }, { targetSeatNo: "$player", polarity: "negative", hostile: true, singleTarget: true })], { selections: [HUMAN], tags: ["hostile", "single"] }),
  card("50", "以静制动", 1, "在本人下一回合开始前，首次有他人使用能力牌时，本人抽一张，随后结束。", [install("wait_draw", 1)]),
]
