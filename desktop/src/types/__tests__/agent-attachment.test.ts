import { describe, expect, it } from "vitest"

import { AGENT_ATTACHMENT_CONTRACT_VERSION } from "../agent-attachment"

describe("agent attachment contract", () => {
  it("keeps attachment references explicitly versioned", () => {
    expect(AGENT_ATTACHMENT_CONTRACT_VERSION).toBe(2)
  })
})
