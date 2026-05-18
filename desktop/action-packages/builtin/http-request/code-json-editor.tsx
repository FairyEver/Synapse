import { useCallback, useEffect, useState } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { json } from "@codemirror/lang-json"
import { oneDark } from "@codemirror/theme-one-dark"
import { Button } from "../../../src/components/ui/button"

interface CodeJsonEditorProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly minHeight?: string
  readonly maxHeight?: string
}

function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  )

  useEffect(() => {
    if (typeof document === "undefined") return
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"))
    })
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return isDark
}

export function CodeJsonEditor({
  value,
  onChange,
  minHeight = "120px",
  maxHeight = "360px",
}: CodeJsonEditorProps) {
  const isDark = useIsDarkMode()

  const handleFormat = useCallback(() => {
    try {
      const parsed = JSON.parse(value)
      onChange(JSON.stringify(parsed, null, 2))
    } catch {
      // ignore — invalid JSON, don't format
    }
  }, [value, onChange])

  const isValidJson = useCallback(() => {
    try {
      JSON.parse(value)
      return true
    } catch {
      return false
    }
  }, [value])

  return (
    <div className="relative group">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={[json()]}
        theme={isDark ? oneDark : undefined}
        minHeight={minHeight}
        maxHeight={maxHeight}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          syntaxHighlighting: true,
          autocompletion: true,
          bracketMatching: true,
          closeBrackets: true,
          highlightActiveLine: false,
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="absolute top-1 right-1 h-6 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleFormat}
        disabled={!isValidJson()}
      >
        格式化
      </Button>
    </div>
  )
}
