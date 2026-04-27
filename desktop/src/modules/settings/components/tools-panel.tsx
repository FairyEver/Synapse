import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AgentRuntimePanel } from "@/modules/settings/components/agent-runtime-panel"
import { EditorDirectoriesContent } from "@/modules/settings/components/editor-directories-panel"

function ToolsPanel({ projectId }: { readonly projectId?: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">IDE</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <EditorDirectoriesContent />
        </CardContent>
      </Card>

      <AgentRuntimePanel projectId={projectId} />
    </div>
  )
}

export { ToolsPanel }
