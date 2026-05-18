import { ShieldCheck, ShieldX } from "lucide-react"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { track } from "@/lib/ui-tracking"
import type { SynapseAgentPendingPermission } from "@/types/agent"

type AgentPermissionPanelProps = {
  pendingPermissions: SynapseAgentPendingPermission[]
  onRespond: (requestId: string, behavior: "allow" | "deny") => void
}

function AgentPermissionPanel({
  pendingPermissions,
  onRespond,
}: AgentPermissionPanelProps) {
  if (pendingPermissions.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      {pendingPermissions.map((permission) => (
        <Alert key={permission.requestId}>
          <AlertTitle>{permission.toolName}</AlertTitle>
          {permission.toolInput ? (
            <AlertDescription className="whitespace-pre-wrap break-words">
              {permission.toolInput}
            </AlertDescription>
          ) : null}
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              data-track="agent-permission-deny"
              onClick={() => handlePermissionResponse(permission, "deny", onRespond)}
            >
              <ShieldX data-icon="inline-start" />
              拒绝
            </Button>
            <Button
              size="sm"
              data-track="agent-permission-allow"
              onClick={() => handlePermissionResponse(permission, "allow", onRespond)}
            >
              <ShieldCheck data-icon="inline-start" />
              允许
            </Button>
          </div>
        </Alert>
      ))}
    </div>
  )
}

function handlePermissionResponse(
  permission: SynapseAgentPendingPermission,
  behavior: "allow" | "deny",
  onRespond: (requestId: string, behavior: "allow" | "deny") => void,
): void {
  track({
    component: "agent",
    name: "agent-permission-response",
    action: "submit",
    value: behavior,
    metadata: {
      boundary: "renderer.agent.permission-response",
      requestId: permission.requestId,
      projectId: permission.projectId,
      sessionKey: permission.sessionKey,
      conversationId: permission.conversationId,
      toolName: permission.toolName,
      behavior,
      inputLength: permission.toolInput?.length ?? 0,
    },
  })
  onRespond(permission.requestId, behavior)
}

export { AgentPermissionPanel }
