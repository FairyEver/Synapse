import { z } from "zod"
import { JsonNamespace } from "../../../runtime/data-repo/backends/json"
import { MainActionRegistry } from "../../../action-runtime/action-registry"
import { InMemoryAuditSink } from "../../../runtime/security"
import { AutomationExecutionService } from "../../automation/execution-service"
import { AutomationRunRepository } from "../../automation/run-repository"
import { AutomationService } from "../../automation/automation-service"
import type { AutomationRun } from "../../automation/types"
import { MailTriggerActivation } from "../activation"
import { mailTriggerRig } from "./fixtures"

export async function engineRig() {
  const rig = await mailTriggerRig(), bodies: string[] = [], actions = new MainActionRegistry()
  actions.register({ manifest: { id: "test.executor", title: "test", authorization: "none", permissions: [], configSchema: z.record(z.string(), z.unknown()), configFields: [], defaultConfig: {} },
    execute: async ({ context }) => { bodies.push(context.templateVariables?.["trigger.payload.body"] ?? ""); return { status: "success", summary: "done" } } })
  const runs = new AutomationRunRepository({ runs: new JsonNamespace<AutomationRun>({ name: "automation.runs", schemaVersion: 1, backend: "json", filePath: `${rig.root}/runs.json` }) })
  const execution = new AutomationExecutionService({ items: rig.items, runs, actions, permissionGuard: { registerPolicy: () => () => undefined, check: async () => ({ allowed: true }) }, auditSink: new InMemoryAuditSink(), defaultCwd: rig.root, logger: { warn: () => undefined } })
  const automation = new AutomationService({ items: rig.items, runs, actions, triggers: rig.triggers, execution, defaultCwd: rig.root })
  const activation = new MailTriggerActivation({ repository: rig.repo, context: rig.context, sourceFor: type => type === "test.mail" ? rig.source : undefined, listItems: () => rig.items.list() })
  automation.attachTriggerLifecycle("test.mail", activation)
  return { ...rig, runs, automation, activation, execution, bodies }
}
