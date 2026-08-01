import { createFileRoute } from '@tanstack/react-router'
import MyDevicesPage from '@/features/my-devices'

export const Route = createFileRoute('/_authenticated/my-devices/')({
  component: MyDevicesPage,
})
