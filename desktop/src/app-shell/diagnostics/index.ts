import { createRendererLogger } from "@/app-shell/logging"
import { installConsoleInterceptor } from "./console-interceptor"
import { installGlobalErrorListener } from "./global-error-listener"
import { installNetworkInterceptor } from "./network-interceptor"
import { installResourceErrorListener } from "./resource-error-listener"
import { installPerformanceObserver } from "./performance-observer"
import { installHeartbeatResponder } from "./heartbeat-responder"

export function installDiagnostics(): () => void {
  const consoleLogger = createRendererLogger("diagnostics.console")
  const globalErrorLogger = createRendererLogger("diagnostics.global-error")
  const networkLogger = createRendererLogger("diagnostics.network")
  const resourceLogger = createRendererLogger("diagnostics.resource")
  const performanceLogger = createRendererLogger("diagnostics.performance")

  const cleanups = [
    installConsoleInterceptor(consoleLogger),
    installGlobalErrorListener(globalErrorLogger),
    installNetworkInterceptor(networkLogger),
    installResourceErrorListener(resourceLogger),
    installPerformanceObserver(performanceLogger),
    installHeartbeatResponder(),
  ]

  return () => {
    for (const cleanup of cleanups) {
      cleanup()
    }
  }
}
