import { describe, expect, it } from "vitest"
import {
  buildContentCreateWindowSearchParams,
  buildContentDetailWindowSearchParams,
  buildContentEditWindowSearchParams,
  parseContentWindowRequest,
} from "@/lib/content-window"

describe("content-window request parsing", () => {
  it("round-trips a detail window request", () => {
    const params = buildContentDetailWindowSearchParams({
      contentType: "rule",
      id: "rule-1",
      title: "Rule One",
      viewMode: "source",
    })

    expect(parseContentWindowRequest(`?${params.toString()}`)).toEqual({
      kind: "detail",
      contentType: "rule",
      id: "rule-1",
      viewMode: "source",
    })
  })

  it("round-trips a create window request", () => {
    const params = buildContentCreateWindowSearchParams({
      contentType: "skill",
      title: "新建 Skill",
    })

    expect(parseContentWindowRequest(`?${params.toString()}`)).toEqual({
      kind: "create",
      contentType: "skill",
    })
  })

  it("round-trips an edit window request", () => {
    const params = buildContentEditWindowSearchParams({
      contentType: "prompt",
      id: "prompt-1",
      origin: "detail",
      title: "编辑提示词",
    })

    expect(parseContentWindowRequest(`?${params.toString()}`)).toEqual({
      kind: "edit",
      contentType: "prompt",
      id: "prompt-1",
      origin: "detail",
    })
  })

  it("rejects content windows without a supported kind", () => {
    expect(parseContentWindowRequest("?synapseWindow=content&windowKind=preview&contentType=rule&id=x")).toBeNull()
  })
})
