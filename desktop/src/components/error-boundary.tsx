import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { createRendererLogger } from "@/app-shell/logging"
import { getDiagnosticSnapshot } from "@/lib/diagnostic-context"
import { sanitizeError } from "@/lib/error-sanitize"

const logger = createRendererLogger("error-boundary")

interface ErrorBoundaryProps {
  children: ReactNode
  fallbackTitle?: string
  onReset?: () => void
}

interface ErrorBoundaryState {
  error: Error | null
  resetKey: number
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null, resetKey: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error("Uncaught render error.", {
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
      diagnostics: getDiagnosticSnapshot(),
    })
  }

  private handleReset = () => {
    this.setState((state) => ({ error: null, resetKey: state.resetKey + 1 }))
    this.props.onReset?.()
  }

  render() {
    if (!this.state.error) {
      return <div key={this.state.resetKey} className="contents">{this.props.children}</div>
    }

    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-base">
              {this.props.fallbackTitle ?? "页面出现问题"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {sanitizeError(this.state.error.message)}
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" onClick={this.handleReset}>
              重试
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }
}

export { ErrorBoundary }
