import { createFileRoute } from '@tanstack/react-router'
import BackupPage from '@/features/backup'

export const Route = createFileRoute('/_authenticated/backup/')({
  component: BackupPage,
})
