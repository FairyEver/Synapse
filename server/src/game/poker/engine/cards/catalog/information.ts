import { card, step, HOLE, PLAYER, HUMAN, HIDDEN, COLOR } from "./definition"
const ownPeek = (mode: string) => step("poker.peek", { seatNo: "$self", mode })
const otherPeek = (mode: string) => step("poker.peek", { seatNo: "$player", mode, hostile: true, singleTarget: true })
const hostile = { selections: [PLAYER], tags: ["hostile", "single"] }
export const INFORMATION_CARDS = [
  card("11", "先知之眼", 2, "私下预览当前牌序下一张将发出的公共牌；牌序变化会使预览失效，河牌不可用。", [ownPeek("next")], { excludeRiver: true }),
  card("12", "洞悉先机", 1, "私下预览当前牌序下一阶段全部公共牌；牌序变化会使预览失效，河牌不可用。", [ownPeek("stage")], { excludeRiver: true }),
  card("13", "察言观色", 2, "私下查看选定其他未弃牌玩家的一张随机底牌。", [otherPeek("one")], hostile),
  card("14", "明察秋毫", 1, "私下查看选定其他未弃牌玩家的两张底牌。", [otherPeek("two")], hostile),
  card("15", "探囊知底", 2, "私下查看选定其他真人手中一张随机能力牌；没有牌的玩家不可选。", [step("ability.peek", { targetSeatNo: "$player" })], { selections: [HUMAN], tags: ["hostile", "single"], requirements: ["target_holds_ability"] }),
  card("16", "观星术", 1, "私下查看剩余牌堆顶部至多三张，包含可能被烧掉的牌。", [ownPeek("top")]),
  card("17", "开诚布公", 2, "公开自己选定底牌；本局该实体牌处于任何玩家底牌中时都公开。", [step("poker.reveal", { seatNo: "$self", cardIndex: "$hole", duration: "hand" })], { selections: [HOLE] }),
  card("18", "猜牌游戏", 2, "选择其他玩家一张未公开底牌，猜红或黑；公布颜色，猜中抽一张能力牌。", [step("poker.guess", { seatNo: "$targetSeat", cardIndex: "$targetSlot", color: "$color", hostile: true, singleTarget: true })], { selections: [HIDDEN, COLOR], tags: ["hostile", "single"] }),
  card("19", "花色侦测", 1, "私下得知选定其他玩家一张随机底牌的花色，不显示点数。", [otherPeek("suit")], hostile),
  card("20", "点数侦测", 1, "私下得知选定其他玩家一张随机底牌的点数，不显示花色。", [otherPeek("rank")], hostile),
]
