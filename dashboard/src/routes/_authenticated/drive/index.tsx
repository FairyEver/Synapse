import { createFileRoute } from '@tanstack/react-router'
import { DriveConsolePage } from '@/features/drive-browser/drive-console-page'

export const Route = createFileRoute('/_authenticated/drive/')({
  component: DriveConsolePage,
})
