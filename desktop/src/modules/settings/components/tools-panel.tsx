import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EditorDirectoriesContent } from "@/modules/settings/components/editor-directories-panel"

function ToolsPanel() {
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
    </div>
  )
}

export { ToolsPanel }
