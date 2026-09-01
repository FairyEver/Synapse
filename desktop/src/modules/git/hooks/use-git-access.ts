import { useCallback, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { runTrackedOperation } from "@/lib/ui-tracking"
import type {
  SynapseGitAccessState,
  SynapseGitClearHttpsCredentialInput,
  SynapseGitGenerateSshKeyInput,
  SynapseGitProvider,
  SynapseGitProtocol,
  SynapseGitSaveHttpsCredentialInput,
  SynapseGitSshTestResult,
  SynapseGitTestSshConnectionInput,
} from "@/types/git"

type GitAccessHostInput = {
  readonly host: string
  readonly port?: number | null
  readonly protocol: SynapseGitProtocol
  readonly provider: SynapseGitProvider
}

type GitAccessMutationOptions = {
  readonly hosts?: readonly GitAccessHostInput[]
}

function gitBridge() {
  return requireSynapseBridge().git
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

function throwError(err: unknown, fallback: string): never {
  if (err instanceof Error) throw err
  throw new Error(fallback)
}

export function useGitAccess() {
  const [access, setAccess] = useState<SynapseGitAccessState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (hosts: readonly GitAccessHostInput[] = []) => {
    setLoading(true)
    setError(null)
    try {
      const nextAccess = await gitBridge().checkAccess({ hosts: [...hosts] })
      setAccess(nextAccess)
      return nextAccess
    } catch (err) {
      setError(errorMessage(err, "读取 Git 访问状态失败。"))
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const httpsRefreshHosts = useCallback((
    input: SynapseGitSaveHttpsCredentialInput | SynapseGitClearHttpsCredentialInput,
    options: GitAccessMutationOptions,
  ): readonly GitAccessHostInput[] => {
    if (options.hosts) return options.hosts
    const port = input.port ?? null
    const currentHost = access?.hosts.find((host) => (
      host.host === input.host
      && host.port === port
      && host.protocol === input.protocol
    ))
    return [{ host: input.host, port, protocol: input.protocol, provider: currentHost?.provider ?? "generic" }]
  }, [access?.hosts])

  const configureCredentialHelper = useCallback(async (
    input: { readonly helper: string },
    options: GitAccessMutationOptions = {},
  ) => {
    setError(null)
    try {
      await runTrackedOperation(
        { component: "git", eventKey: "git.credential-helper.configure" },
        () => gitBridge().configureCredentialHelper(input),
      )
      await refresh(options.hosts)
      return true
    } catch (err) {
      const message = errorMessage(err, "配置凭据助手失败。")
      setError(message)
      throwError(err, message)
    }
  }, [refresh])

  const saveHttpsCredential = useCallback(async (
    input: SynapseGitSaveHttpsCredentialInput,
    options: GitAccessMutationOptions = {},
  ) => {
    setError(null)
    try {
      await runTrackedOperation(
        { component: "git", eventKey: "git.credential.save" },
        () => gitBridge().saveHttpsCredential(input),
      )
      await refresh(httpsRefreshHosts(input, options))
      return true
    } catch (err) {
      const message = errorMessage(err, "保存凭据失败。")
      setError(message)
      throwError(err, message)
    }
  }, [httpsRefreshHosts, refresh])

  const clearHttpsCredential = useCallback(async (
    input: SynapseGitClearHttpsCredentialInput,
    options: GitAccessMutationOptions = {},
  ) => {
    setError(null)
    try {
      await runTrackedOperation(
        { component: "git", eventKey: "git.credential.clear" },
        () => gitBridge().clearHttpsCredential(input),
      )
      await refresh(httpsRefreshHosts(input, options))
      return true
    } catch (err) {
      const message = errorMessage(err, "清除凭据失败。")
      setError(message)
      throwError(err, message)
    }
  }, [httpsRefreshHosts, refresh])

  const generateSshKey = useCallback(async (
    input: SynapseGitGenerateSshKeyInput,
    options: GitAccessMutationOptions = {},
  ) => {
    setError(null)
    try {
      await runTrackedOperation(
        { component: "git", eventKey: "git.ssh-key.generate" },
        () => gitBridge().generateSshKey(input),
      )
      await refresh(options.hosts ?? access?.hosts.map((host) => ({
        host: host.host,
        protocol: host.protocol,
        provider: host.provider,
      })) ?? [])
      return true
    } catch (err) {
      const message = errorMessage(err, "生成 SSH 密钥失败。")
      setError(message)
      throwError(err, message)
    }
  }, [access?.hosts, refresh])

  const testSshConnection = useCallback(async (
    input: SynapseGitTestSshConnectionInput,
  ): Promise<SynapseGitSshTestResult | null> => {
    setError(null)
    try {
      return await runTrackedOperation(
        { component: "git", eventKey: "git.ssh.test" },
        () => gitBridge().testSshConnection(input),
      )
    } catch (err) {
      const message = errorMessage(err, "测试 SSH 连接失败。")
      setError(message)
      throwError(err, message)
    }
  }, [])

  return {
    access,
    error,
    loading,
    refresh,
    configureCredentialHelper,
    saveHttpsCredential,
    clearHttpsCredential,
    generateSshKey,
    testSshConnection,
  }
}
