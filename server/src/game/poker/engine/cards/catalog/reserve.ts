import { card, step, install } from "./definition"
const steal = (cap: string, target = "all") => step("chips.steal", { actorAdmissionId: "$admission", cap, target, ...(target === "richest" ? { targetAdmissionId: "$richest", targetSeatNo: "$richestSeat", hostile: true, singleTarget: true } : {}) })
const refund = (cap?: string) => step("chips.refund", { actorAdmissionId: "$admission", lotId: "$lastLot", ...(cap ? { cap } : {}) })
export const RESERVE_CARDS = [
  card("31", "赦免", 1, "下一次正额筹码支付减免至多10BB，触发一次后结束，未用满不保留。", [install("waiver", 1, { cap: "$bb10" })]),
  card("32", "小赦免", 2, "下一次正额筹码支付减免至多3BB，触发一次后结束。", [install("waiver", 1, { cap: "$bb3" })]),
  card("33", "妙手空空", 1, "从其他人的暂存待分份额按比例偷取至多10BB，立即获得，不取自己份额。", [steal("$bb10")], { requirements: ["stealable"], tags: ["hostile", "group"] }),
  card("34", "顺手牵羊", 2, "从其他人的暂存待分份额按比例偷取至多3BB，立即获得，不取自己份额。", [steal("$bb3")], { requirements: ["stealable"], tags: ["hostile", "group"] }),
  card("35", "物归原主", 1, "取回本次用牌之前本人最近一笔正额暂存尚未被取走的全部筹码；已空不跳过。", [refund()], { requirements: ["recent_deposit"] }),
  card("36", "小本回收", 2, "从本次用牌之前本人最近一笔正额暂存剩余中取回至多3BB；已空不跳过。", [refund("$bb3")], { requirements: ["recent_deposit"] }),
  card("37", "暂存封条", 1, "本阶段结束前全桌暂存不能被盗取，退款与最终分配不受影响。", [install("reserve_seal", null, {}, { field: true, polarity: "neutral", expiresStreet: true })], { tags: ["group"] }),
  card("38", "慷慨解囊", 2, "支付2BB筹码至暂存，从共享池抽两张能力牌。", [step("ability.draw", { admissionId: "$admission", count: 2, reason: "card" })], { costBB: 2 }),
  card("39", "劫富济贫", 1, "从暂存待分份额最多的其他身份处偷取至多5BB；同额按庄家左侧，受保护不改选。", [steal("$bb5", "richest")], { requirements: ["stealable"], tags: ["hostile", "single"] }),
  card("40", "暂存回响", 1, "本人下一次实际向暂存支付正额筹码后，抽一张能力牌，触发一次。", [install("reserve_echo", 1)]),
]
