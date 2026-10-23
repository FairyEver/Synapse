import { runTrackedOperation } from "@/lib/ui-tracking"
/** Only stable action names reach telemetry; addresses, subjects and bodies never do. */
export function runMailUiOperation<T>(operation: "select" | "search" | "mutate" | "configure" | "save" | "send", task: () => Promise<T>): Promise<T> {
  return runTrackedOperation({ component: "mail", eventKey: "mail.operation", name: operation }, task)
}
