import { useState } from "react"
import { ArrowLeft, ArrowRight, ExternalLink, Globe2, RotateCw } from "lucide-react"
import type { CustomAppDto } from "@synapse/shared"

import { Badge } from "@/components/ui/badge"
import { createRendererLogger } from "@/app-shell/logging"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { cn } from "@/lib/utils"
import {
  CUSTOM_APP_IFRAME_ALLOW,
  customAppIframeSandbox,
} from "./iframe-compatibility"

const logger = createRendererLogger("custom-app.iframe")

export function IframeCustomAppContent({ app }: { readonly app: CustomAppDto }) {
  const [sourceUrl] = useState(app.startUrl)
  const [frameVersion, setFrameVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const sandbox = customAppIframeSandbox(sourceUrl, window.location.href)

  const title = (
    <div className="flex min-w-0 items-center gap-2">
      <Globe2 className="size-4 shrink-0 text-muted-foreground" />
      <h2 className="truncate text-sm font-semibold">{app.name}</h2>
      <Badge variant="outline">应用内嵌</Badge>
    </div>
  )

  const actions = (
    <>
      <SystemAppTopBarActionButton
        iconOnly
        type="button"
        aria-label="后退"
        tooltip="iframe 模式无法读取网页导航历史"
        disabled
      >
        <ArrowLeft />
      </SystemAppTopBarActionButton>
      <SystemAppTopBarActionButton
        iconOnly
        type="button"
        aria-label="前进"
        tooltip="iframe 模式无法读取网页导航历史"
        disabled
      >
        <ArrowRight />
      </SystemAppTopBarActionButton>
      <SystemAppTopBarActionButton
        iconOnly
        type="button"
        aria-label="刷新"
        tooltip="刷新"
        onClick={() => {
          setLoading(true)
          setFrameVersion((version) => version + 1)
        }}
      >
        <RotateCw className={cn(loading && "animate-spin motion-reduce:animate-none")} />
      </SystemAppTopBarActionButton>
      <SystemAppTopBarActionButton
        iconOnly
        type="button"
        aria-label="在浏览器打开"
        tooltip="在浏览器打开"
        onClick={() => {
          const shell = getSynapseBridge()?.shell
          if (!shell) return
          void shell.openExternal(sourceUrl).catch((error) => {
            logger.warn("Failed to open iframe app externally.", { appId: app.id, error })
          })
        }}
      >
        <ExternalLink />
      </SystemAppTopBarActionButton>
    </>
  )

  return (
    <SystemAppWindowShell
      left={title}
      embeddedLeftAddon={title}
      actions={actions}
    >
      <div className="relative h-full min-h-0 bg-background">
        <iframe
          key={frameVersion}
          src={sourceUrl}
          name="synapse-custom-app"
          title={app.name}
          sandbox={sandbox}
          allow={CUSTOM_APP_IFRAME_ALLOW}
          allowFullScreen
          loading="eager"
          referrerPolicy="strict-origin-when-cross-origin"
          className="h-full w-full border-0 bg-background"
          onLoad={() => setLoading(false)}
        />
      </div>
    </SystemAppWindowShell>
  )
}
