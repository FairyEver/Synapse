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
} from "./prompt-shortcuts"

const logger = createRendererLogger("workflow.prompt-editor")

interface PromptEditorProps {
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  variables: VariableBinding[]
  placeholder?: string
  rows?: number
}

function useClaudeCodeGlobalSkillNames(): string[] {
  const [skillNames, setSkillNames] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const scan = await window.synapse?.editorScan?.scanAll?.()
        if (!cancelled) {
          setSkillNames(extractClaudeCodeGlobalSkillNames(scan))
        }
      } catch (error) {
        logger.warn("Failed to load Claude Code global skills.", { error })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return skillNames
}

export function PromptEditor({ value, onChange, onBlur, variables, placeholder, rows = 8 }: PromptEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const skillNames = useClaudeCodeGlobalSkillNames()
  const options = useMemo(() => buildPromptShortcutOptions({ variables, skillNames }), [variables, skillNames])
  const minHeight = `${Math.max(rows, 3) * 20}px`

  const completionSource = useCallback((context: CompletionContext): CompletionResult | null => {
    const match = matchPromptShortcutTrigger(context.state.doc.toString(), context.pos)
    if (!match) return null

    const sourceOptions = match.kind === "variable" ? options.variables : options.skills
    if (sourceOptions.length === 0) return null

    return {
      from: match.from,
      options: sourceOptions.map((option) => ({
        label: option.label,
        type: match.kind === "variable" ? "variable" : "keyword",
        apply: option.apply,
      })),
      validFor: match.kind === "variable" ? /^@[^\s@/]*$/ : /^\/[^\s@/]*$/,
    }
  }, [options])

  const extensions = useMemo(() => [
    autocompletion({ override: [completionSource] }),
    EditorView.lineWrapping,
  ], [completionSource])

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
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{value.length}字</span>
      </div>
    </div>
  )
}
