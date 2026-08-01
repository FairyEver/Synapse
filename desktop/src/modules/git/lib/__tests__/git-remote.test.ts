import { describe, expect, it } from "vitest"
import {
  buildGitProviderLinks,
  parseGitRemote,
} from "../git-remote"

describe("parseGitRemote", () => {
  it("parses GitHub HTTPS remotes", () => {
    expect(parseGitRemote("https://github.com/FairyEver/Synapse.git")).toEqual({
      host: "github.com",
      normalizedUrl: "https://github.com/FairyEver/Synapse.git",
      port: null,
      protocol: "https",
      provider: "github",
      remoteKind: "https",
      username: null,
    })
  })

  it("preserves HTTP protocol, username, and non-default port", () => {
    expect(parseGitRemote("http://writer@git.company.com:8080/team/docs.git")).toEqual({
      host: "git.company.com",
      normalizedUrl: "http://writer@git.company.com:8080/team/docs.git",
      port: 8080,
      protocol: "http",
      provider: "generic",
      remoteKind: "http",
      username: "writer",
    })
  })

  it("parses scp-like SSH remotes", () => {
    expect(parseGitRemote("git@gitee.com:team/docs.git")).toEqual({
      host: "gitee.com",
      normalizedUrl: "git@gitee.com:team/docs.git",
      port: null,
      protocol: "ssh",
      provider: "gitee",
      remoteKind: "ssh",
      username: "git",
    })
  })

  it("treats company HTTPS remotes as generic", () => {
    expect(parseGitRemote("https://git.company.com/team/docs.git")).toMatchObject({
      host: "git.company.com",
      protocol: "https",
      provider: "generic",
      remoteKind: "https",
    })
  })

  it("returns unknown for empty or unsupported values", () => {
    expect(parseGitRemote("")).toEqual({
      host: null,
      normalizedUrl: "",
      port: null,
      protocol: "unknown",
      provider: "generic",
      remoteKind: "unknown",
      username: null,
    })
    expect(parseGitRemote("/Users/me/repo")).toMatchObject({
      host: null,
      protocol: "file",
      provider: "generic",
      remoteKind: "unknown",
    })
  })
})

describe("buildGitProviderLinks", () => {
  it("returns official setup links for GitHub", () => {
    expect(buildGitProviderLinks("github")).toEqual({
      credentialHelpUrl: "https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git",
      sshKeysUrl: "https://github.com/settings/keys",
      tokenUrl: "https://github.com/settings/tokens",
    })
  })

  it("returns known SSH pages for Gitee and GitLab", () => {
    expect(buildGitProviderLinks("gitee").sshKeysUrl).toBe("https://gitee.com/profile/sshkeys")
    expect(buildGitProviderLinks("gitlab").sshKeysUrl).toBe("https://gitlab.com/-/user_settings/ssh_keys")
  })
})
