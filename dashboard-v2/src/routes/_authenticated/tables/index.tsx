import { createFileRoute } from '@tanstack/react-router'
import CloudTablesPage from '@/features/cloud-tables'
export const Route = createFileRoute('/_authenticated/tables/')({ component: CloudTablesPage })
