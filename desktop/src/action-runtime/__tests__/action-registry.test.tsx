import { describe, expect, it } from "vitest"
import { rendererActionRegistry } from "../builtin-actions"

describe("renderer action registry", () => {
  it("offers only Agent for Automation", () => {
    expect(rendererActionRegistry.list().map(action => action.manifest.id)).toEqual(["builtin.agent"])
    for (const type of ["command", "script", "http-request", "workflow", "javascript-run", "nodejs-run"]) {
      expect(() => rendererActionRegistry.get(`builtin.${type}`)).toThrow(/not registered/)
    }
  })
})
