import { describe, expect, it } from "vitest"

import { applyGroupOrder, moveGroupId } from "../terminal-group-order"
import type { SynapseTerminalGroupSummary } from "../../../../src/types/terminal"

function createGroup(id: string, sortOrder: number): SynapseTerminalGroupSummary {
  return {
    id,
    name: id,
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    sortOrder,
    groupRevision: 1,
    launchRevision: 1,
    membershipRevision: 1,
    commandCollectionRevision: 1,
  }
}

describe("terminal group order", () => {
  it("moves a group one position in each direction", () => {
    expect(moveGroupId(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"])
    expect(moveGroupId(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"])
  })

  it("ignores moves that would leave the list", () => {
    expect(moveGroupId(["a", "b"], "a", "up")).toBeNull()
    expect(moveGroupId(["a", "b"], "b", "down")).toBeNull()
    expect(moveGroupId(["a", "b"], "missing", "up")).toBeNull()
  })

  it("applies the requested order and appends groups that are not listed", () => {
    const groups = [createGroup("a", 0), createGroup("b", 1), createGroup("c", 2)]

    expect(applyGroupOrder(groups, ["c", "a"]).map((group) => [group.id, group.sortOrder]))
      .toEqual([["c", 0], ["a", 1], ["b", 2]])
    expect(applyGroupOrder(groups, ["c", "unknown", "c", "b"]).map((group) => group.id))
      .toEqual(["c", "b", "a"])
  })
})
