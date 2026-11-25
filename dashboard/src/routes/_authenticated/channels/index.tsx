import { createFileRoute } from '@tanstack/react-router'
import ChannelsPage from '@/features/channels'

export const Route = createFileRoute('/_authenticated/channels/')({
  component: ChannelsPage,
})
