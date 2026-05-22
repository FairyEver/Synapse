import { ContentDetailWindowPage } from "@/modules/content/components/content-detail-window-page"
import { ContentEditorWindowPage } from "@/modules/content/components/content-editor-window-page"
import type { SynapseContentWindowRequest } from "@/types/content"

function ContentWindowPage({ request }: { request: SynapseContentWindowRequest }) {
  if (request.kind === "detail") {
    return <ContentDetailWindowPage request={request} />
  }

  return <ContentEditorWindowPage request={request} />
}

export { ContentWindowPage }
