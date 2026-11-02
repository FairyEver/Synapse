import { Tabs } from '@heroui/react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { WebhookDeliveryHistory } from '../webhook-deliveries'
import WebhookList from './index'
import type { WebhookWorkspaceSearch } from './webhook-workspace-search'

type Props = {
  search: WebhookWorkspaceSearch
  onSearchChange: (update: (current: WebhookWorkspaceSearch) => WebhookWorkspaceSearch) => void
}

export function WebhookWorkspace({ search, onSearchChange }: Props) {
  const activeTab = search.action === 'create' ? 'configuration' : search.tab ?? 'configuration'

  return <>
    <Header fixed><h1 className='text-lg font-semibold'>Webhook</h1></Header>
    <Main>
      <Tabs variant='secondary' selectedKey={activeTab} onSelectionChange={(key) => onSearchChange((current) => ({
        ...current, tab: key === 'deliveries' ? 'deliveries' : 'configuration', action: undefined,
      }))}>
        <Tabs.ListContainer><Tabs.List aria-label='Webhook'>
          <Tabs.Tab id='configuration'>接入配置<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id='deliveries'>触发记录<Tabs.Indicator /></Tabs.Tab>
        </Tabs.List></Tabs.ListContainer>
        <Tabs.Panel id='configuration' className='pt-6'>
          <WebhookList key={search.action ?? 'list'} createOnOpen={search.action === 'create'} />
        </Tabs.Panel>
        <Tabs.Panel id='deliveries' className='pt-6'>
          <WebhookDeliveryHistory mode='user' search={search} onSearchChange={(update) => onSearchChange((current) => ({ ...current, ...update(current) }))} />
        </Tabs.Panel>
      </Tabs>
    </Main>
  </>
}
