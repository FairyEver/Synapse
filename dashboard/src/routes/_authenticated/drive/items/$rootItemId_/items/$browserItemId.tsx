import { createFileRoute } from '@tanstack/react-router'
import { DriveConsoleItemPage } from '@/features/drive-browser/drive-console-page'

export const Route = createFileRoute('/_authenticated/drive/items/$rootItemId_/items/$browserItemId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { rootItemId, browserItemId } = Route.useParams()
  return <DriveConsoleItemPage rootItemId={rootItemId} itemId={browserItemId} />
}
