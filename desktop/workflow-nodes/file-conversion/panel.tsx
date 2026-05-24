import { useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { WorkflowParam } from "@/types/workflow"
import { CollapsibleSection } from "../collapsible-section"
import { VariableBindingEditor } from "../variable-binding-editor"
import type { FileConversionNodeConfig } from "./schema"

export interface FileConversionNodePanelProps {
  config: FileConversionNodeConfig
  onChange: (config: FileConversionNodeConfig) => void
  upstreamNodes?: { id: string; name: string }[]
  workflowParams?: WorkflowParam[]
}

const OUTPUT_LABELS: Record<NonNullable<FileConversionNodeConfig["outputMode"]>, string> = {
  result: "Result only",
  "markdown-file": "Markdown file",
}

export function FileConversionNodePanel({
  config,
  onChange,
  upstreamNodes = [],
  workflowParams = [],
}: FileConversionNodePanelProps) {
  const [draft, setDraft] = useState<FileConversionNodeConfig>(() => normalizeConfig(config))

  const commit = (overrides?: Partial<FileConversionNodeConfig>) => {
    const next: FileConversionNodeConfig = { ...draft, ...overrides }
    setDraft(next)
    onChange(next)
  }

  const commitOcr = (overrides: NonNullable<FileConversionNodeConfig["ocr"]>) => {
    commit({ ocr: { ...(draft.ocr ?? {}), ...overrides } })
  }

  const ocr = draft.ocr ?? { enabled: false, languages: [] }
  const outputMode = draft.outputMode ?? "result"

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="转换配置">
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="wf-node-file-conversion-input-path" className="text-xs">Input</Label>
            <Input
              id="wf-node-file-conversion-input-path"
              className="h-7 text-xs"
              value={draft.inputPath}
              onChange={(event) => commit({ inputPath: event.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Output</Label>
            <Select
              value={outputMode}
              onValueChange={(value) => commit({ outputMode: value as FileConversionNodeConfig["outputMode"] })}
            >
              <SelectTrigger className="h-7 w-full text-xs">
                <SelectValue>{OUTPUT_LABELS[outputMode]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="result">Result only</SelectItem>
                <SelectItem value="markdown-file">Markdown file</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {outputMode === "markdown-file" ? (
            <div className="grid gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="wf-node-file-conversion-output-directory" className="text-xs">Directory</Label>
                <Input
                  id="wf-node-file-conversion-output-directory"
                  className="h-7 text-xs"
                  value={draft.outputDirectory ?? ""}
                  onChange={(event) => commit({ outputDirectory: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wf-node-file-conversion-output-path" className="text-xs">File</Label>
                <Input
                  id="wf-node-file-conversion-output-path"
                  className="h-7 text-xs"
                  value={draft.outputPath ?? ""}
                  onChange={(event) => commit({ outputPath: event.target.value })}
                />
              </div>
            </div>
          ) : null}

          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="wf-node-file-conversion-ocr-enabled"
                aria-label="OCR"
                checked={Boolean(ocr.enabled)}
                onCheckedChange={(checked) => commitOcr({ enabled: checked === true })}
              />
              <Label htmlFor="wf-node-file-conversion-ocr-enabled" className="text-xs">OCR</Label>
            </div>

            {ocr.enabled ? (
              <div className="grid gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="wf-node-file-conversion-ocr-languages" className="text-xs">Languages</Label>
                  <Input
                    id="wf-node-file-conversion-ocr-languages"
                    className="h-7 text-xs"
                    value={(ocr.languages ?? []).join(", ")}
                    onChange={(event) => commitOcr({ languages: parseLanguageList(event.target.value) })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="wf-node-file-conversion-ocr-max-pages" className="text-xs">Max pages</Label>
                  <Input
                    id="wf-node-file-conversion-ocr-max-pages"
                    className="h-7 text-xs"
                    inputMode="numeric"
                    value={ocr.maxPages?.toString() ?? ""}
                    onChange={(event) => commitOcr({ maxPages: parseOptionalPositiveInteger(event.target.value) })}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="输入映射" summary={(draft.variables?.length ?? 0) > 0 ? `${draft.variables?.length ?? 0}个` : undefined}>
        <VariableBindingEditor
          variables={[...(draft.variables ?? [])]}
          onChange={(variables) => commit({ variables })}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
        />
      </CollapsibleSection>
    </div>
  )
}

function normalizeConfig(config: FileConversionNodeConfig): FileConversionNodeConfig {
  return {
    inputPath: config.inputPath ?? "",
    outputMode: config.outputMode ?? "result",
    outputPath: config.outputPath ?? "",
    outputDirectory: config.outputDirectory ?? "",
    ocr: {
      enabled: Boolean(config.ocr?.enabled),
      languages: config.ocr?.languages ?? [],
      maxPages: config.ocr?.maxPages,
    },
    variables: config.variables ?? [],
  }
}

function parseLanguageList(value: string): string[] {
  return value.split(",").map((language) => language.trim()).filter(Boolean)
}

function parseOptionalPositiveInteger(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}
