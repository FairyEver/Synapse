import { describe, expect, it } from "vitest"

import { createPlatformActionDefaultConfig } from "../shell-defaults"

describe("createPlatformActionDefaultConfig", () => {
  it("uses cmd for Windows command defaults", () => {
    expect(createPlatformActionDefaultConfig(
      "builtin.command",
      { command: "", shell: "posix", timeoutMins: 30 },
      "win32",
    )).toEqual({
      command: "",
      shell: "cmd",
      timeoutMins: 30,
    })
  })

  it("uses cmd for Windows script defaults", () => {
    expect(createPlatformActionDefaultConfig(
      "builtin.script",
      { script: "", shell: "posix", timeoutMins: 30 },
      "win32",
    )).toEqual({
      script: "",
      shell: "cmd",
      timeoutMins: 30,
    })
  })

  it("keeps non-Windows and non-shell defaults unchanged", () => {
    expect(createPlatformActionDefaultConfig(
      "builtin.command",
      { command: "", shell: "posix", timeoutMins: 30 },
      "darwin",
    )).toEqual({
      command: "",
      shell: "posix",
      timeoutMins: 30,
    })

    expect(createPlatformActionDefaultConfig(
      "builtin.http-request",
      { method: "GET", url: "", timeoutMins: 5 },
      "win32",
    )).toEqual({
      method: "GET",
      url: "",
      timeoutMins: 5,
    })
  })
})
