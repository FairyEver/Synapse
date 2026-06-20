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
      protocol: "https",
      provider: "github",
      remoteKind: "https",
    })
  })

  it("parses scp-like SSH remotes", () => {
    expect(parseGitRemote("git@gitee.com:team/docs.git")).toEqual({
      host: "gitee.com",
      normalizedUrl: "git@gitee.com:team/docs.git",
      protocol: "ssh",
      provider: "gitee",
      remoteKind: "ssh",
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
      protocol: "unknown",
      provider: "generic",
      remoteKind: "unknown",
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
