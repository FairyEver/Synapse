import type { FileConversionInput, FileConversionResult } from "../file-conversion"
import { FileConversionError } from "../file-conversion"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../../runtime/security"

export class WorkflowFileConversionInputReadError extends FileConversionError {
  constructor(message: string) {
    super("read_failed", message)
    this.name = "WorkflowFileConversionInputReadError"
  }
}

export interface WorkflowFileConversionContext {
  readonly actor?: ActorIdentity
  readonly runId?: string
}

export interface WorkflowFileConversionService {
  convert(input: FileConversionInput, context?: WorkflowFileConversionContext): Promise<FileConversionResult>
}

export function createWorkflowFileConversionService(deps: {
  readonly fileConversionService: {
    convert(input: FileConversionInput): Promise<FileConversionResult>
  }
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
}): WorkflowFileConversionService {
  return {
    async convert(input, context) {
      const actor = context?.actor ?? { kind: "system" as const, id: "workflow-engine" }
      const metadata = {
        source: "workflow.fileConversionInput",
        ...(context?.runId ? { runId: context.runId } : {}),
      }
      const permission = await deps.permissionGuard.check({
        action: "fs.read.outside-userdata",
        actor,
        resource: input.filePath,
        context: metadata,
      })
      if (!permission.allowed) {
        deps.auditSink.record({
          action: "fs.read.outside-userdata",
          actor,
          resource: input.filePath,
          outcome: "denied",
          metadata: {
            ...metadata,
            reason: permission.reason,
            policyId: permission.policyId,
          },
        })
        throw new WorkflowFileConversionInputReadError("Workflow file conversion input read was denied.")
      }

      deps.auditSink.record({
        action: "fs.read.outside-userdata",
        actor,
        resource: input.filePath,
        outcome: "allowed",
        metadata,
      })
      return deps.fileConversionService.convert(input)
    },
  }
}
