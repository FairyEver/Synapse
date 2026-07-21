import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { autocompletion, startCompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete"
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from "@uiw/react-codemirror"
import { Button } from "@/components/ui/button"
import { createRendererLogger } from "@/app-shell/logging"
import type { VariableBinding } from "./schemas/variable-binding"
import {
  buildPromptShortcutOptions,
  extractClaudeCodeGlobalSkillNames,
  matchPromptShortcutTrigger,
  shouldStartPromptShortcutCompletion,
} from "./prompt-shortcuts"

const logger = createRendererLogger("workflow.prompt-editor")

interface PromptEditorProps {
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  variables: VariableBinding[]
  placeholder?: string
  rows?: number
  enableSkillShortcuts?: boolean
}

function useClaudeCodeGlobalSkillNames(enabled: boolean): { skillNames: string[]; refresh: () => void } {
  const [skillNames, setSkillNames] = useState<string[]>([])
  const activeScanRequestRef = useRef<string | null>(null)
  const requestIdRef = useRef(0)

  const refresh = useCallback(() => {
    if (!enabled) return

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    void (async () => {
      const editorScan = window.synapse?.editorScan
      if (!editorScan) return
      const previousRequestId = activeScanRequestRef.current
      if (previousRequestId) {
        try {
          await editorScan.cancelScan({ requestId: previousRequestId })
        } catch (error) {
          logger.warn("Failed to cancel the previous Skill shortcut scan.", {
            errorName: error instanceof Error ? error.name : typeof error,
          })
        }
      }
      const scanRequest = { requestId: crypto.randomUUID() }
      activeScanRequestRef.current = scanRequest.requestId
      try {
        const scan = await editorScan.scanAll(scanRequest)
        if (requestIdRef.current === requestId) {
          setSkillNames(extractClaudeCodeGlobalSkillNames(scan))
        }
      } catch (error) {
        if (requestIdRef.current === requestId) {
          logger.warn("Failed to load Claude Code global skills.", {
            errorName: error instanceof Error ? error.name : typeof error,
          })
        }
      } finally {
        if (activeScanRequestRef.current === scanRequest.requestId) {
          activeScanRequestRef.current = null
        }
      }
    })()
  }, [enabled])

  useEffect(() => {
    if (!enabled) return

    refresh()

    return () => {
      requestIdRef.current += 1
      const requestId = activeScanRequestRef.current
      activeScanRequestRef.current = null
      const editorScan = window.synapse?.editorScan
      if (!requestId || !editorScan) return
      void editorScan.cancelScan({ requestId }).catch((error) => {
        logger.warn("Failed to cancel the Skill shortcut scan on unmount.", {
          errorName: error instanceof Error ? error.name : typeof error,
        })
      })
    }
  }, [enabled, refresh])

  return { skillNames, refresh }
}

export function PromptEditor({
  value,
  onChange,
  onBlur,
  variables,
  placeholder,
  rows = 8,
  enableSkillShortcuts = true,
}: PromptEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const { skillNames, refresh: refreshSkillNames } = useClaudeCodeGlobalSkillNames(enableSkillShortcuts)
  const options = useMemo(() => buildPromptShortcutOptions({ variables, skillNames }), [variables, skillNames])
  const minHeight = `${Math.max(rows, 3) * 20}px`

  const completionSource = useCallback((context: CompletionContext): CompletionResult | null => {
    const match = matchPromptShortcutTrigger(context.state.doc.toString(), context.pos)
    if (!match) return null
    if (match.kind === "skill" && !enableSkillShortcuts) return null

    const sourceOptions = match.kind === "variable" ? options.variables : options.skills
    if (sourceOptions.length === 0) return null

    return {
      from: match.from,
      options: sourceOptions.map((option) => ({
        label: option.completionLabel,
        displayLabel: option.label,
        type: match.kind === "variable" ? "variable" : "keyword",
        detail: match.kind === "variable" ? "变量" : "Skill",
        apply: option.apply,
      })),
      validFor: match.kind === "variable" ? /^@[^\s@/]*$/ : /^\/[^\s@/]*$/,
    }
  }, [enableSkillShortcuts, options])

  const extensions = useMemo(() => [
    autocompletion({ override: [completionSource] }),
    EditorView.lineWrapping,
    EditorView.domEventHandlers({
      focus: () => {
        refreshSkillNames()
        return false
      },
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return
      const cursor = update.state.selection.main
      if (!cursor.empty) return
      if (shouldStartPromptShortcutCompletion(update.state.doc.toString(), cursor.from)) {
        const match = matchPromptShortcutTrigger(update.state.doc.toString(), cursor.from)
        if (match?.kind === "skill" && !enableSkillShortcuts) return
        startCompletion(update.view)
      }
    }),
  ], [completionSource, enableSkillShortcuts, refreshSkillNames])

  const insertTrigger = (trigger: "@" | "/") => {
    const view = editorRef.current?.view
    if (!view) return

    const selection = view.state.selection.main
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: trigger },
      selection: { anchor: selection.from + trigger.length },
    })
    view.focus()
    requestAnimationFrame(() => startCompletion(view))
  }

  return (
    <div className="grid gap-0">
      <div className="rounded-t-md border border-b-0 bg-background overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
        <CodeMirror
          ref={editorRef}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          minHeight={minHeight}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            syntaxHighlighting: false,
            autocompletion: false,
            bracketMatching: false,
            closeBrackets: false,
            highlightActiveLine: false,
            searchKeymap: false,
          }}
          extensions={extensions}
          theme="none"
        />
      </div>
      <div className="flex items-center gap-1.5 border rounded-b-md px-2 py-1.5 bg-muted/30">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[10px]"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => insertTrigger("@")}
        >
          @ 变量
        </Button>
        {enableSkillShortcuts ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px]"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => insertTrigger("/")}
          >
            / Skill
          </Button>
        ) : null}
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{value.length}字</span>
      </div>
    </div>
  )
}
