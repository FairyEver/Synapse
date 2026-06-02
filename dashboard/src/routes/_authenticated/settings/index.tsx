import { createFileRoute } from '@tanstack/react-router'
import { ProfileSettings } from '@/features/settings/profile-settings'

export const Route = createFileRoute('/_authenticated/settings/')({
  component: ProfileSettings,
})
