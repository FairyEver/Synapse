import { card, step, install, HUMAN } from "./definition"
export const TABLE_CARDS = [
  card("51", "争分夺秒", 2, "当前剩余操作时间翻倍，最多延至本回合开始后1200秒。", [step("clock.change", { kind: "double" })]),
  card("52", "从容不迫", 2, "当前操作时间增加60秒，最多延至本回合开始后1200秒。", [step("clock.change", { kind: "extend", milliseconds: 60000 })]),
  card("53", "急促咒语", 1, "选定其他真人下一次正常行动回合基础时限减少300秒，同族不叠加；期限内净化返还。", [install("shrink", null, {}, { targetSeatNo: "$player", polarity: "negative", hostile: true, singleTarget: true })], { selections: [HUMAN], tags: ["hostile", "single"] }),
  card("54", "时间缓流", 1, "本阶段后续新行动回合基础时限增加60秒，已开始回合不变，同族替换。", [install("slow_field", null, {}, { field: true, polarity: "neutral", expiresStreet: true })], { tags: ["group"] }),
  card("55", "幸运帷幕", 1, "下一次阶段自动补牌时，每名合资格真人额外抽一张，触发一次；河牌不可用。", [install("refill_field", 1, {}, { field: true, polarity: "neutral" })], { tags: ["group"], excludeRiver: true }),
  card("56", "法力潮汐", 1, "本阶段每名真人首次再使用一张能力牌后额外抽一张，本牌自身不触发；同族替换。", [install("tide_field", null, {}, { field: true, polarity: "neutral", expiresStreet: true })], { tags: ["group"] }),
  card("57", "一箭双雕", 1, "本人下一次因卡牌效果直接从共享池抽能力牌时额外抽一张，不计阶段补牌或候选选择。", [install("double_draw", 1)]),
  card("58", "调换位置", 2, "对调自己两张底牌的左右位置，不改变实体牌和牌型。", [step("poker.swapPositions", { seatNo: "$self" })]),
  card("59", "星光一闪", 2, "在牌桌播放一次短促星光，不改变其他规则。", [step("poker.spark", {})]),
  card("60", "众目睽睽", 1, "本阶段所有未弃牌玩家各有一张随机底牌公开，受信息保护者排除；标记随实体牌移动。", [install("reveal_field", null, {}, { field: true, polarity: "neutral", expiresStreet: true }), step("poker.revealAll", {})], { tags: ["hostile", "group"] }),
]
