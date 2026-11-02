import type { HandState } from "../hand-runner"

export interface CardScenario {
  definitionId: string; input: Record<string, string | number>; initialState?: "reserve" | "dispel" | "cleanse"
  entropy: readonly number[]; expectedStateDelta: { handCount?: number; hole?: string[]; private?: string[]; effect?: string; remaining?: number; cap?: number; amount?: number; pending?: "poker" | "ability"; generated?: number; spent?: number; stackDelta?: number; reserveDelta?: number; markers?: number; deadline?: number }
  expectedPublic: string[]; expectedPrivate: string[]
}
const scenario = (definitionId: string, expectedStateDelta: CardScenario["expectedStateDelta"], input: CardScenario["input"] = {}, initialState?: CardScenario["initialState"], expectedPublic: string[] = [], expectedPrivate: string[] = []): CardScenario => ({ definitionId, input, initialState, entropy: [], expectedStateDelta, expectedPublic, expectedPrivate })
/** Expectations are hand-written from the approved rules, never derived from the catalog. */
export const CARD_SCENARIOS: readonly CardScenario[] = [
  scenario("01", { hole: ["3s", "2c"] }, { hole: 0 }),
  scenario("02", { hole: ["3h", "3d"] }),
  scenario("03", { hole: ["2s", "2c"] }, { hole: 0 }),
  scenario("04", { hole: ["2s", "2c"] }, { hole: 0, player: 1 }),
  scenario("05", { hole: ["2s", "2d"] }, { player: 1 }),
  scenario("06", { pending: "poker", private: ["3s", "3h", "3d"] }, { hole: 0 }, undefined, [], ["3s", "3h", "3d"]),
  scenario("07", { hole: ["3s", "2c"] }, { hole: 0 }),
  scenario("08", { hole: ["3h", "2c"] }, { hole: 0 }),
  scenario("09", { hole: ["3s", "2c"] }, { hole: 0 }),
  scenario("10", { hole: ["2c", "2s"] }),
  scenario("11", { private: ["3h"] }, {}, undefined, [], ["3h"]),
  scenario("12", { private: ["3h", "3d", "3c"] }, {}, undefined, [], ["3h", "3d", "3c"]),
  scenario("13", { private: ["2s"] }, { player: 1 }, undefined, [], ["2s"]),
  scenario("14", { private: ["2s", "2d"] }, { player: 1 }, undefined, [], ["2s", "2d"]),
  scenario("15", { private: ["21"] }, { player: 1 }, undefined, [], ["21"]),
  scenario("16", { private: ["3s", "3h", "3d"] }, {}, undefined, [], ["3s", "3h", "3d"]),
  scenario("17", { markers: 1 }, { hole: 0 }, undefined, ["poker.revealed"]),
  scenario("18", { handCount: 1 }, { targetHole: "1:0", color: "black" }, undefined, ["poker.guessed"]),
  scenario("19", { private: ["s"] }, { player: 1 }, undefined, [], ["s"]),
  scenario("20", { private: ["2"] }, { player: 1 }, undefined, [], ["2"]),
  scenario("21", { handCount: 1 }), scenario("22", { handCount: 2 }), scenario("23", { handCount: 3 }),
  scenario("24", { handCount: 2, spent: 2 }, { ability: "extra" }),
  scenario("25", { pending: "ability" }), scenario("26", { handCount: 1, spent: 2 }, { ability: "extra" }),
  scenario("27", { handCount: 1 }), scenario("28", { handCount: 1, generated: 1 }),
  scenario("29", { handCount: 1, generated: 1 }, { ability: "extra" }),
  scenario("30", { handCount: 2, generated: 2, spent: 2 }, { ability: "extra" }),
  scenario("31", { effect: "waiver", remaining: 1, cap: 20 }), scenario("32", { effect: "waiver", remaining: 1, cap: 6 }),
  scenario("33", { stackDelta: 20, reserveDelta: -20 }, {}, "reserve"),
  scenario("34", { stackDelta: 6, reserveDelta: -6 }, {}, "reserve"),
  scenario("35", { stackDelta: 120, reserveDelta: -120 }, {}, "reserve"),
  scenario("36", { stackDelta: 6, reserveDelta: -6 }, {}, "reserve"),
  scenario("37", { effect: "reserve_seal" }), scenario("38", { handCount: 2, stackDelta: -4, reserveDelta: 4 }),
  scenario("39", { stackDelta: 10, reserveDelta: -10 }, {}, "reserve"), scenario("40", { effect: "reserve_echo", remaining: 1 }),
  scenario("41", { effect: "hole_guard", remaining: 1 }), scenario("42", { effect: "hole_guard", remaining: 2 }),
  scenario("43", { effect: "info_guard", remaining: 1 }), scenario("44", { effect: "theft_guard", remaining: 1 }),
  scenario("45", {}, { status: "existing" }, "dispel"), scenario("46", { stackDelta: 0 }, { status: "existing" }, "cleanse"),
  scenario("47", { effect: "reflect", remaining: 1 }), scenario("48", { effect: "counter", remaining: 1 }),
  scenario("49", { effect: "surcharge", amount: 4, remaining: 1 }, { player: 1 }), scenario("50", { effect: "wait_draw", remaining: 1 }),
  scenario("51", { deadline: 1100000 }), scenario("52", { deadline: 660000 }), scenario("53", { effect: "shrink" }, { player: 1 }),
  scenario("54", { effect: "slow_field" }), scenario("55", { effect: "refill_field", remaining: 1 }),
  scenario("56", { effect: "tide_field", handCount: 0 }), scenario("57", { effect: "double_draw", remaining: 1 }),
  scenario("58", { hole: ["2c", "2h"] }), scenario("59", {}, {}, undefined, ["poker.sparked"]),
  scenario("60", { effect: "reveal_field", markers: 2 }, {}, undefined, ["poker.revealed"]),
]
export const reserveTotal = (h: HandState) => h.reserve?.lots.reduce((n, l) => n + l.remainingAmount, 0) ?? 0
