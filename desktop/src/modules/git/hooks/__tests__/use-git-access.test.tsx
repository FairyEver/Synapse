/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseGitAccessState } from "@/types/git"
import { useGitAccess } from "../use-git-access"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const bridge = vi.hoisted(() => ({
  git: {
    checkAccess: vi.fn(),
    configureCredentialHelper: vi.fn(),
    saveHttpsCredential: vi.fn(),
    clearHttpsCredential: vi.fn(),
    generateSshKey: vi.fn(),
    testSshConnection: vi.fn(),
  },
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => bridge,
}))

function HookHarness({
  onStatus,
}: {
  readonly onStatus: (status: ReturnType<typeof useGitAccess>) => void
}) {
  const status = useGitAccess()
  onStatus(status)
  return null
}

describe("useGitAccess", () => {
  const roots: Root[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ""
    bridge.git.checkAccess.mockResolvedValue(accessState())
    bridge.git.saveHttpsCredential.mockResolvedValue(undefined)
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => {
        root.unmount()
      })
    }
    document.body.innerHTML = ""
  })

  it("refreshes the saved HTTPS host after saving credentials", async () => {
    const statuses = await renderHook(roots)

    await act(async () => {
      await statuses.at(-1)!.saveHttpsCredential({
        host: "github.com",
        protocol: "https",
        username: "writer",
        password: "secret",
      }, {
        hosts: [{ host: "github.com", protocol: "https", provider: "github" }],
      })
    })

    expect(bridge.git.saveHttpsCredential).toHaveBeenCalledWith({
      host: "github.com",
      protocol: "https",
      username: "writer",
      password: "secret",
    })
    expect(bridge.git.checkAccess).toHaveBeenCalledWith({
      hosts: [{ host: "github.com", protocol: "https", provider: "github" }],
    })
  })

  it("uses the current host provider when saving credentials without refresh hosts", async () => {
    bridge.git.checkAccess.mockResolvedValue(accessState({
      host: "github.com",
      protocol: "https",
      provider: "github",
    }))
    const statuses = await renderHook(roots)

    await act(async () => {
      await statuses.at(-1)!.refresh([{ host: "github.com", protocol: "https", provider: "github" }])
    })
    bridge.git.checkAccess.mockClear()

    await act(async () => {
      await statuses.at(-1)!.saveHttpsCredential({
        host: "github.com",
        protocol: "https",
        username: "writer",
        password: "secret",
      })
    })

    expect(bridge.git.checkAccess).toHaveBeenCalledWith({
      hosts: [{ host: "github.com", port: null, protocol: "https", provider: "github" }],
    })
  })

  it("keeps backend save errors visible to callers and hook state", async () => {
    const serviceError = new Error("请先设置安全的凭证保存方式。")
    bridge.git.saveHttpsCredential.mockRejectedValue(serviceError)
    const statuses = await renderHook(roots)

    let caught: unknown
    await act(async () => {
      try {
        await statuses.at(-1)!.saveHttpsCredential({
          host: "github.com",
          protocol: "https",
          username: "writer",
          password: "secret",
        })
      } catch (err) {
        caught = err
      }
    })

    expect(caught).toBe(serviceError)
    expect(statuses.at(-1)!.error).toBe("请先设置安全的凭证保存方式。")
  })
})

async function renderHook(roots: Root[]) {
  const statuses: Array<ReturnType<typeof useGitAccess>> = []
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<HookHarness onStatus={(status) => statuses.push(status)} />)
  })
  return statuses
}

function accessState(host?: Pick<SynapseGitAccessState["hosts"][number], "host" | "protocol" | "provider">): SynapseGitAccessState {
  return {
    checkedAt: "2026-06-20T00:00:00.000Z",
    credentialHelper: {
      helpers: [{ classification: "safe", source: "global", value: "osxkeychain" }],
      management: "synapse-supported",
      helper: "osxkeychain",
      safe: true,
      source: "global",
    },
    hosts: host ? [{ ...host, lastFailure: null, port: null }] : [],
    providerLinks: {
      github: { credentialHelpUrl: null, sshKeysUrl: null, tokenUrl: null },
      gitee: { credentialHelpUrl: null, sshKeysUrl: null, tokenUrl: null },
      gitlab: { credentialHelpUrl: null, sshKeysUrl: null, tokenUrl: null },
      generic: { credentialHelpUrl: null, sshKeysUrl: null, tokenUrl: null },
    },
    ssh: {
      available: false,
      publicKeyComment: null,
      publicKeyFingerprint: null,
      publicKeyPath: null,
      publicKeyType: null,
    },
  }
}
