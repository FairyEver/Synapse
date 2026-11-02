import { card, step, HOLE, PLAYER } from "./definition"
const replace = (mode: string) => step("poker.replace", { seatNo: "$self", cardIndex: "$hole", mode, paymentVersion: "$payment" })
export const HOLE_CARDS = [
  card("01", "换牌术", 2, "选择自己一张底牌，随机换一张；先取新牌，再洗回旧牌。", [replace("draw")], { selections: [HOLE], requirements: ["deck"] }),
  card("02", "重整旗鼓", 2, "将自己两张底牌洗回牌堆，再随机抽两张，可能抽回原牌。", [step("poker.reset", { seatNo: "$self" })]),
  card("03", "移花接木", 2, "选择自己一张底牌，与随机其他未弃牌玩家的一张随机底牌交换。", [step("poker.randomExchange", { seatNo: "$self", cardIndex: "$hole" })], { selections: [HOLE], tags: ["hostile", "single"] }),
  card("04", "精准调包", 1, "选择自己一张底牌，与选定其他未弃牌玩家的一张随机底牌交换。", [step("poker.exchange", { seatNo: "$self", targetSeatNo: "$player", cardIndex: "$hole", hostile: true, singleTarget: true })], { selections: [HOLE, PLAYER], tags: ["hostile", "single"] }),
  card("05", "对调双生", 1, "与选定其他未弃牌玩家交换整副两张底牌。", [step("poker.exchange", { seatNo: "$self", targetSeatNo: "$player", whole: true, hostile: true, singleTarget: true })], { selections: [PLAYER], tags: ["hostile", "single"] }),
  card("06", "左右逢源", 2, "为自己选定底牌随机取至多三个候选，选一张；其余与旧牌洗回牌堆。", [replace("candidates")], { selections: [HOLE], requirements: ["deck"] }),
  card("07", "择高而留", 1, "随机取至多两张候选，以点数较高者替换选定底牌；同点按固定花色顺序。", [replace("highest")], { selections: [HOLE], requirements: ["deck"] }),
  card("08", "红色邀约", 2, "随机取剩余牌堆中的一张红色牌替换选定底牌；没有则不换。", [replace("red")], { selections: [HOLE] }),
  card("09", "黑色邀约", 2, "随机取剩余牌堆中的一张黑色牌替换选定底牌；没有则不换。", [replace("black")], { selections: [HOLE] }),
  card("10", "天地重洗", 1, "将所有未弃牌且未受改牌保护的玩家底牌混洗，再各发两张；不足两人则被阻止。", [step("poker.shuffleHoles", {})], { tags: ["hostile", "group"] }),
]
