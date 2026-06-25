import type { SynapseEditorId } from "@/types/editor"

type EditorDirectoriesViewProps = {
  readonly selectedEditorId: SynapseEditorId
}

function EditorDirectoriesView({ selectedEditorId }: EditorDirectoriesViewProps) {
  return (
    <div className="p-2 text-sm text-muted-foreground">
      {selectedEditorId}
    </div>
  )
}

export { EditorDirectoriesView }
