import { useEffect, useState, type FormEvent } from "react"
import { toast } from "sonner"

import { useAppConfig } from "../../../src/app-shell/config"
import { prepareInlineRuleSource } from "../../../src/app-shell/installers"
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
import { Input } from "../../../src/components/ui/input"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Spinner } from "../../../src/components/ui/spinner"
import { Textarea } from "../../../src/components/ui/textarea"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import { startTrackedOperation } from "../../../src/lib/ui-tracking"
import { useEditorAdaptersForContentType } from "../../../src/modules/content/hooks/use-editor-adapters-for-content-type"
import { SharedInstallerFlow } from "../../../src/modules/installers/shared/shared-installer-flow"
import type { SynapseInstallerSource } from "../../../src/types/installers"

const logger = createRendererLogger("rule-installer.app")

export function RuleInstallerModule() {
  const { config } = useAppConfig()
  const { error, filteredAdapters, isLoading, load } = useEditorAdaptersForContentType({
    contentType: "rule",
    enabled: true,
    loggerName: "rule-installer.editors",
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
                kind="rule"
                mode="page"
                projects={config.global.projects}
                onCancel={() => window.close()}
                onInstalled={() => {
                  toast.success("安装完成")
                }}
                renderSourceInput={({ onSourceReady }) => (
                  <RuleSourceInput onSourceReady={onSourceReady} />
                )}
              />
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

function RuleSourceInput({
  onSourceReady,
}: {
  readonly onSourceReady: (source: SynapseInstallerSource) => void
}) {
  const [name, setName] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const finishTracking = startTrackedOperation({ component: "rule-installer", eventKey: "rule-installer.source.prepare" })
    setBusy(true)
    setError("")
    try {
      const source = await prepareInlineRuleSource({ name, body })
      finishTracking("success")
      onSourceReady(source)
    } catch (err) {
      finishTracking("failure")
      const message = err instanceof Error ? err.message : "读取 Rule 失败"
      logger.error("Failed to prepare inline Rule source.", err)
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} data-track="rule-installer.source.prepare">
      <FieldSet className="gap-4">
        <FieldGroup className="gap-4">
          <Field className="gap-2 md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:items-center">
            <FieldLabel htmlFor="rule-source-name">Name</FieldLabel>
            <FieldContent>
              <Input
                id="rule-source-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                autoComplete="off"
              />
            </FieldContent>
          </Field>
          <Field className="gap-2 md:grid md:grid-cols-[7rem_minmax(0,1fr)]">
            <FieldLabel htmlFor="rule-source-body">正文</FieldLabel>
            <FieldContent>
              <Textarea
                id="rule-source-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                disabled={busy}
                className="min-h-52 resize-y font-mono text-sm"
              />
            </FieldContent>
          </Field>
        </FieldGroup>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={!name.trim() || !body.trim() || busy}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            继续
          </Button>
        </div>
      </FieldSet>
    </form>
  )
}
