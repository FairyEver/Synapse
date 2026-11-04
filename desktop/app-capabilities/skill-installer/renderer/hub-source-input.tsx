import { useEffect, useState, type ReactNode } from "react"
import { useAccount } from "../../../src/app-shell/account"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Button } from "../../../src/components/ui/button"
import { Spinner } from "../../../src/components/ui/spinner"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import type { SynapseSkillInstallerSource } from "../../../src/types/installers"
import type { HubInstallOpenRequest } from "../../skill-hub/shared/install-source"

const logger = createRendererLogger("skill-installer.hub")
type Props = { request: HubInstallOpenRequest; children: (source: SynapseSkillInstallerSource) => ReactNode }

export function HubSourceInput(props: Props) {
  const { state, isLoading, pendingAction, startLogin, refresh } = useAccount()
  if (isLoading) return <p role="status"><Spinner /> 正在读取账号</p>
  if (state.status !== "authenticated") return (
    <div className="flex items-center gap-3">
      <p>登录 Synapse 后安装团队 Skill。</p>
      <Button disabled={pendingAction === "login" || state.status === "authenticating"} onClick={() => void startLogin()}>
        {state.status === "authenticating" ? "等待登录" : "登录"}
      </Button>
    </div>
  )
  if (state.connectivity !== "online") return (
    <div className="flex items-center gap-3"><p>账号离线，请重新连接。</p><Button onClick={() => void refresh()}>重试</Button></div>
  )
  return <HubSourceLoader key={state.profile.user.id} {...props} />
}

function HubSourceLoader({ request, children }: Props) {
  const [source, setSource] = useState<SynapseSkillInstallerSource | null>(null)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    let id: string | undefined
    const bridge = requireBridgeDomain("skillHub")
    const release = (preparedSourceId: string) => {
      void bridge.releaseInstall({ preparedSourceId }).catch((error) =>
        logger.error("Failed to release Skill Hub installer source.", { errorName: error instanceof Error ? error.name : typeof error }))
    }
    void bridge.prepareInstall({ skillId: request.skillId }).then((result) => {
      if (!result.ok) {
        if (live) setError(result.message)
        return
      }
      id = result.source.preparedSourceId
      if (live) setSource(result.source)
      else if (id) release(id)
    }).catch((error) => {
      if (live) setError("暂时无法读取 Skill，请重试。")
      logger.error("Failed to open Skill Hub installer source.", { errorName: error instanceof Error ? error.name : typeof error })
    })
    return () => { live = false; if (id) release(id) }
  }, [request.skillId, attempt])

  if (error) return <div className="flex flex-wrap items-center gap-3"><p role="alert">{error}</p>
    <Button onClick={() => { setError(""); setAttempt((n) => n + 1) }}>重新读取最新版</Button></div>
  if (!source) return <p role="status" className="flex items-center gap-2"><Spinner /> 正在读取最新版</p>
  return children(source)
}
