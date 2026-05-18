import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { createRendererLogger } from "@/app-shell/logging"
import { getDiagnosticSnapshot } from "@/lib/diagnostic-context"

const logger = createRendererLogger("app.error-boundary")

type Props = { children: ReactNode }
type State = { hasError: boolean; error: Error | null }

class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error("Uncaught render error.", {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      diagnostics: getDiagnosticSnapshot(),
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
          <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-card p-6">
            <h1 className="text-lg font-medium text-foreground">应用遇到了问题</h1>
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message ?? "发生了未知错误。"}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  logger.info("User requested app reload from error boundary.")
                  window.location.reload()
                }}
              >
                重新加载
              </Button>
              <Button
                onClick={() => {
                  this.setState({ hasError: false, error: null })
                }}
              >
                重试
              </Button>
            </div>
          </div>
        </main>
      )
    }

    return this.props.children
  }
}

export { AppErrorBoundary }
