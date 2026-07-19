import { useEffect, useState } from "react"
import { FolderOpen } from "lucide-react"
import { toast } from "sonner"

import { prepareLocalSkillSource } from "../../../src/app-shell/installers"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Button } from "../../../src/components/ui/button"
import { Card, CardContent } from "../../../src/components/ui/card"
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "../../../src/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../../src/components/ui/input-group"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Spinner } from "../../../src/components/ui/spinner"
import { useAppConfig } from "../../../src/app-shell/config"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { useEditorAdaptersForContentType } from "../../../src/modules/content/hooks/use-editor-adapters-for-content-type"
import { SharedInstallerFlow } from "../../../src/modules/installers/shared/shared-installer-flow"
import type { SynapseInstallerSource } from "../../../src/types/installers"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"

const logger = createRendererLogger("skill-installer.app")

export function SkillInstallerModule() {
  const { config } = useAppConfig()
  const { error, filteredAdapters, isLoading, load } = useEditorAdaptersForContentType({
    contentType: "skill",
    enabled: true,
    loggerName: "skill-installer.editors",
  })

  useEffect(() => {
    void load()
  }, [load])

  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto w-full max-w-2xl p-3 sm:p-5">
          <Card className="py-0">
            <CardContent className="p-4 sm:p-5">
              {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner />
                  加载中
                </div>
              ) : null}
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <SharedInstallerFlow
                editors={filteredAdapters}
                kind="skill"
                mode="page"
                projects={config.global.projects}
                onCancel={() => window.close()}
                onInstalled={() => {
                  toast.success("安装完成")
                }}
                renderSourceInput={({ onSourceReady }) => (
                  <SkillSourceInput onSourceReady={onSourceReady} />
                )}
              />
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

function SkillSourceInput({
  onSourceReady,
}: {
  readonly onSourceReady: (source: SynapseInstallerSource) => void
}) {
  const [sourceDirectoryPath, setSourceDirectoryPath] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const chooseDirectory = async () => {
    setError("")
    const selected = await requireBridgeDomain("repository").chooseDirectory()
    if (!selected) return
    setSourceDirectoryPath(selected)
    await prepare(selected)
  }

  const prepare = async (selectedPath = sourceDirectoryPath) => {
    if (!selectedPath.trim() || busy) return
    setBusy(true)
    setError("")
    try {
      const source = await prepareLocalSkillSource({ sourceDirectoryPath: selectedPath })
      onSourceReady(source)
    } catch (err) {
      const message = err instanceof Error ? err.message : "读取 Skill 失败"
      logger.error("Failed to prepare local Skill source.", err)
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <FieldSet className="gap-4">
      <FieldGroup className="gap-4">
        <Field className="gap-2 md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:items-center">
          <FieldLabel htmlFor="skill-source-path">Skill 目录</FieldLabel>
          <FieldContent>
            <InputGroup>
              <InputGroupAddon>
                <FolderOpen className="size-4" />
              </InputGroupAddon>
              <InputGroupInput
                id="skill-source-path"
                value={sourceDirectoryPath}
                placeholder="选择包含 SKILL.md 的目录"
                onChange={(event) => setSourceDirectoryPath(event.target.value)}
                disabled={busy}
              />
              <InputGroupAddon align="inline-end">
                <Button type="button" variant="outline" size="xs" onClick={chooseDirectory} disabled={busy}>
                  选择
                </Button>
              </InputGroupAddon>
            </InputGroup>
          </FieldContent>
        </Field>
      </FieldGroup>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end">
        <Button type="button" onClick={() => void prepare()} disabled={!sourceDirectoryPath.trim() || busy}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          继续
        </Button>
      </div>
    </FieldSet>
  )
}
