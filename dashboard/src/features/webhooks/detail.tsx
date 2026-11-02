import { Button, Card, Chip, Link, Skeleton, Tabs, toast } from '@heroui/react'
import { useState } from 'react'
import type { DashboardWebhookDto } from '@synapse/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { dashboardApi } from '@/lib/api'
import { consoleHref } from '@/lib/console-href'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { WebhookDeliveryHistory } from '../webhook-deliveries'
import { WebhookConfiguration } from './webhook-configuration'
import { getWebhookErrorMessage } from './webhook-error'
import { WebhookUrlDialog } from './webhook-url-dialog'
import { getWebhookResetSecretDialogDescription, webhookResetSecretDialogTitle } from './webhook-reset-secret'

export default function WebhookDetailPage() {
  const { webhookId } = useParams({ from: '/_authenticated/webhooks/$webhookId' })
  const search = useSearch({ from: '/_authenticated/webhooks/$webhookId' })
  const navigate = useNavigate({ from: '/webhooks/$webhookId' })
  const [oneTimeUrl, setOneTimeUrl] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DashboardWebhookDto | null>(null)
  const [resetSecretTarget, setResetSecretTarget] = useState<DashboardWebhookDto | null>(null)
  const queryClient = useQueryClient()
  const webhookQuery = useQuery({ queryKey: ['dashboard-webhook', webhookId], queryFn: () => dashboardApi.getWebhook(webhookId) })
  const webhook = webhookQuery.data

  function replaceWebhook(updated: DashboardWebhookDto) {
    queryClient.setQueryData(['dashboard-webhook', updated.id], updated)
    void queryClient.invalidateQueries({ queryKey: ['dashboard-webhooks'] })
  }
  const update = useMutation({
    mutationFn: (input: { name?: string; enabled?: boolean }) => dashboardApi.updateWebhook(webhookId, input),
    onSuccess: (updated) => { replaceWebhook(updated); toast.success('已保存') },
    onError: (error) => toast.danger(getWebhookErrorMessage(error, '保存失败')),
  })
  const resetSecret = useMutation({
    mutationFn: (id: string) => dashboardApi.resetWebhookSecret(id),
    onSuccess: (result) => { setResetSecretTarget(null); setOneTimeUrl(result.url); replaceWebhook(result.webhook); toast.success('调用地址已重置') },
    onError: (error) => toast.danger(getWebhookErrorMessage(error, '重置失败')),
  })
  const remove = useMutation({
    mutationFn: (id: string) => dashboardApi.deleteWebhook(id),
    onSuccess: (_result, deletedId) => {
      setDeleteTarget(null)
      queryClient.removeQueries({ queryKey: ['dashboard-webhook', deletedId] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-webhooks'] })
      toast.success('已删除')
      void navigate({ to: '/webhooks/' })
    },
    onError: (error) => toast.danger(getWebhookErrorMessage(error, '删除失败')),
  })

  return <>
    <Header fixed><h1 className='text-lg font-semibold'>Webhook</h1></Header>
    <Main>
      <div><Link href={consoleHref('/webhooks/')}>返回 Webhook 列表</Link></div>
      {webhookQuery.isLoading ? <Card><Card.Content className='grid gap-4'><Skeleton className='h-6 w-48' /><Skeleton className='h-40 w-full' /></Card.Content></Card>
        : webhookQuery.isError ? <Card><Card.Content className='grid justify-items-start gap-3'>
          <h2 className='font-medium'>加载失败</h2><p className='text-sm text-muted'>{getWebhookErrorMessage(webhookQuery.error, '详情加载失败')}</p>
          <Button variant='secondary' onPress={() => void webhookQuery.refetch()}>重试</Button>
        </Card.Content></Card>
        : webhook ? <>
          <div className='flex flex-wrap items-center gap-3'>
            <h2 className='min-w-0 wrap-anywhere text-2xl font-semibold'>{webhook.name}</h2>
            <Chip variant='soft' color={webhook.enabled ? 'success' : 'default'}>{webhook.enabled ? '已启用' : '已停用'}</Chip>
          </div>
          <Tabs variant='secondary' selectedKey={search.tab ?? 'configuration'} onSelectionChange={(key) => void navigate({ search: (current) => ({ ...current, tab: key === 'deliveries' ? 'deliveries' : 'configuration' }) })}>
            <Tabs.ListContainer><Tabs.List aria-label='Webhook 页面'>
              <Tabs.Tab id='configuration'>配置<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id='deliveries'>触发记录<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List></Tabs.ListContainer>
            <Tabs.Panel id='configuration' className='max-w-3xl pt-6'>
              <WebhookConfiguration key={webhook.id} webhook={webhook} isUpdating={update.isPending} isResetting={resetSecret.isPending}
                onSaveName={(name) => update.mutate({ name })} onToggle={() => update.mutate({ enabled: !webhook.enabled })}
                onResetSecret={() => setResetSecretTarget(webhook)} onDelete={() => setDeleteTarget(webhook)} />
            </Tabs.Panel>
            <Tabs.Panel id='deliveries' className='pt-6'>
              <WebhookDeliveryHistory mode='user' scopeWebhookId={webhook.id} search={search} onSearchChange={(change) => void navigate({ search: change })} />
            </Tabs.Panel>
          </Tabs>
        </> : <p className='text-muted'>未找到 Webhook</p>}
      <WebhookUrlDialog open={Boolean(oneTimeUrl)} title='新的接入地址' url={oneTimeUrl ?? ''} onOpenChange={(open) => { if (!open) setOneTimeUrl(null) }} />
      <ConfirmDialog open={Boolean(resetSecretTarget)} onOpenChange={(open) => { if (!open) setResetSecretTarget(null) }}
        title={webhookResetSecretDialogTitle} desc={getWebhookResetSecretDialogDescription(resetSecretTarget)} cancelBtnText='取消' confirmText='重置调用地址'
        destructive isLoading={resetSecret.isPending} handleConfirm={() => { if (resetSecretTarget) resetSecret.mutate(resetSecretTarget.id) }} />
      <ConfirmDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }} title='删除 Webhook'
        desc={`删除「${deleteTarget?.name ?? ''}」后，接入地址立即失效，已有触发记录仍会保留。`} cancelBtnText='取消' confirmText='删除 Webhook'
        destructive isLoading={remove.isPending} handleConfirm={() => { if (deleteTarget) remove.mutate(deleteTarget.id) }} />
    </Main>
  </>
}
