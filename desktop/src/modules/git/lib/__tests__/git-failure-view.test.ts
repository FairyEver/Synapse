import { describe, expect, it } from "vitest"
import type { SynapseGitUserFacingFailure } from "@/types/git"
import { canHandleGitFailureAction, getGitFailureActionLabel, shouldRouteFailureToAccess } from "../git-failure-view"

function failure(overrides: Partial<SynapseGitUserFacingFailure>): SynapseGitUserFacingFailure {
  return {
    category: "unknown",
    detail: null,
    host: null,
    message: "操作失败。",
    primaryAction: null,
    protocol: "unknown",
    title: "操作失败",
    ...overrides,
  }
}

describe("git failure view", () => {
  it.each([
    ["install-git", "安装 Git"],
    ["set-identity", "配置身份"],
    ["login-host", "登录访问"],
    ["handle-github-auth", "处理 GitHub 访问"],
    ["handle-ssh", "处理 SSH"],
    ["configure-credential-helper", "配置凭据助手"],
    ["retry", "重试"],
    ["choose-directory", "选择目录"],
    ["open-workbench", "进入仓库"],
    ["copy-diagnostics", "复制诊断"],
  ] as const)("returns the action label for %s", (primaryAction, label) => {
    expect(getGitFailureActionLabel(failure({ primaryAction }))).toBe(label)
  })

  it("falls back to category labels when primary action is missing", () => {
    expect(getGitFailureActionLabel(failure({ category: "ssh-auth" }))).toBe("处理 SSH")
    expect(getGitFailureActionLabel(failure({ category: "https-auth" }))).toBe("登录访问")
    expect(getGitFailureActionLabel(failure({ category: "git-missing" }))).toBe("安装 Git")
  })

  it("routes auth and credential helper failures to access", () => {
    expect(shouldRouteFailureToAccess(failure({ category: "https-auth" }))).toBe(true)
    expect(shouldRouteFailureToAccess(failure({ category: "github-auth" }))).toBe(true)
    expect(shouldRouteFailureToAccess(failure({ category: "ssh-auth" }))).toBe(true)
    expect(shouldRouteFailureToAccess(failure({ category: "credential-helper-missing" }))).toBe(true)
    expect(shouldRouteFailureToAccess(failure({ primaryAction: "handle-ssh" }))).toBe(true)
  })

  it("does not route install, path, or worktree failures to access", () => {
    expect(shouldRouteFailureToAccess(failure({ category: "git-missing" }))).toBe(false)
    expect(shouldRouteFailureToAccess(failure({ category: "path" }))).toBe(false)
    expect(shouldRouteFailureToAccess(failure({ category: "dirty" }))).toBe(false)
    expect(shouldRouteFailureToAccess(null)).toBe(false)
  })

  it("only marks implemented failure actions as handleable", () => {
    expect(canHandleGitFailureAction(failure({ category: "git-missing" }))).toBe(true)
    expect(canHandleGitFailureAction(failure({ category: "github-auth" }))).toBe(true)
    expect(canHandleGitFailureAction(failure({ primaryAction: "handle-ssh" }))).toBe(true)
    expect(canHandleGitFailureAction(failure({ category: "missing-identity", primaryAction: "set-identity" }))).toBe(true)
    expect(canHandleGitFailureAction(failure({ category: "network", primaryAction: "retry" }))).toBe(true)
    expect(canHandleGitFailureAction(failure({ category: "path", primaryAction: "choose-directory" }))).toBe(false)
  })
})
