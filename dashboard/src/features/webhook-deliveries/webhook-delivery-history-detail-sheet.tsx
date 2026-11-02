import { Accordion, Alert, Chip, Drawer, Tabs } from '@heroui/react'
import type { ReactNode } from 'react'
import type { WebhookDeliveryHistoryDto } from '@synapse/shared'
import { getWebhookDeliveryStatusLabel, getWebhookReceiptStatusLabel } from '@/features/webhooks/webhook-display'
import { formatWebhookDeliveryHistoryBody, formatWebhookDeliveryHistoryDateTime, getWebhookDeliveryHistoryStatusColor } from './webhook-delivery-history-display'

type DetailSheetProps = {
  delivery: WebhookDeliveryHistoryDto | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WebhookDeliveryHistoryDetailSheet({ delivery, open, onOpenChange }: DetailSheetProps) {
  return <Drawer.Backdrop isOpen={open} onOpenChange={onOpenChange}>
    <Drawer.Content placement='right'><Drawer.Dialog className='sm:max-w-2xl'>
      <Drawer.CloseTrigger />
      <Drawer.Header className='pe-10'><Drawer.Heading className='min-w-0 wrap-anywhere'>{delivery?.webhook.name ?? '触发详情'}</Drawer.Heading></Drawer.Header>
      {delivery && <Drawer.Body className='flex flex-col gap-5'>
        <div className='flex flex-wrap items-center gap-2'>
          <Chip variant='soft' color={getWebhookDeliveryHistoryStatusColor(delivery.status)}>{getWebhookDeliveryStatusLabel(delivery.status)}</Chip>
          {delivery.webhook.deletedAt && <Chip variant='secondary'>Webhook 已删除</Chip>}
          <time className='text-sm text-muted' dateTime={delivery.receivedAt}>{formatWebhookDeliveryHistoryDateTime(delivery.receivedAt)}</time>
        </div>
        {delivery.error && <Alert status='danger'><Alert.Indicator /><Alert.Content><Alert.Title>投递异常</Alert.Title><Alert.Description className='wrap-anywhere'>{delivery.error}</Alert.Description></Alert.Content></Alert>}
        <Tabs key={delivery.id} defaultSelectedKey='request' variant='secondary' className='min-w-0'>
          <Tabs.ListContainer><Tabs.List aria-label='触发详情'>
            <Tabs.Tab id='request'>请求<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id='receipts'>桌面端回执<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List></Tabs.ListContainer>
          <Tabs.Panel id='request' className='grid min-w-0 gap-5 pt-5'>
            <dl className='grid gap-4 text-sm sm:grid-cols-2'>
              <DetailField label='请求方法'><span className='font-mono'>{delivery.method}</span></DetailField>
              <DetailField label='请求体'>{formatWebhookDeliveryHistoryBody(delivery)}</DetailField>
              <DetailField label='路径' wide><span className='font-mono'>{delivery.path}</span></DetailField>
              <DetailField label='Webhook 标识' wide><span className='font-mono'>{delivery.webhook.publicId}</span></DetailField>
              {delivery.user && <DetailField label='用户' wide>{delivery.user.email}</DetailField>}
            </dl>
            <section className='grid min-w-0 gap-2' aria-label='请求体预览'>
              <h3 className='text-sm font-medium'>请求体预览</h3>
              {delivery.bodyPreview !== undefined ? <CodeBlock text={delivery.bodyPreview} /> : <p className='text-sm text-muted'>无请求体预览</p>}
            </section>
            <Accordion allowsMultipleExpanded>
              <JsonSection label='Query 参数' value={delivery.query} />
              <JsonSection label='请求头 Headers' value={delivery.headers} />
            </Accordion>
          </Tabs.Panel>
          <Tabs.Panel id='receipts' className='grid min-w-0 gap-5 pt-5'>
            <dl className='grid grid-cols-2 gap-4 text-sm sm:grid-cols-4'>
              <DetailField label='在线桌面端'>{delivery.onlineClientCount}</DetailField>
              <DetailField label='已发送'>{delivery.sentClientCount}</DetailField>
              <DetailField label='已确认收到'>{delivery.acknowledgedClientCount}</DetailField>
              <DetailField label='发送失败'>{delivery.failedClientCount}</DetailField>
            </dl>
            <p className='text-sm text-muted'>确认收到不代表自动化已执行。</p>
            {delivery.clientReceipts.length ? <ul className='divide-y divide-separator'>
              {delivery.clientReceipts.map((receipt) => <li key={receipt.id} className='grid gap-2 py-4 first:pt-0'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <span className='min-w-0 wrap-anywhere font-medium'>{receipt.deviceName}</span>
                  <Chip variant='soft' color={receipt.status === 'acknowledged' ? 'success' : receipt.status === 'send_failed' ? 'danger' : 'accent'}>{getWebhookReceiptStatusLabel(receipt.status)}</Chip>
                </div>
                <p className='text-sm text-muted'>{receipt.platform} · {receipt.appVersion}</p>
                <dl className='grid gap-2 text-sm sm:grid-cols-2'>
                  <DetailField label='发送时间'>{formatWebhookDeliveryHistoryDateTime(receipt.sentAt)}</DetailField>
                  {receipt.acknowledgedAt && <DetailField label='确认时间'>{formatWebhookDeliveryHistoryDateTime(receipt.acknowledgedAt)}</DetailField>}
                </dl>
              </li>)}
            </ul> : <p className='text-sm text-muted'>暂无桌面端回执</p>}
          </Tabs.Panel>
        </Tabs>
      </Drawer.Body>}
    </Drawer.Dialog></Drawer.Content>
  </Drawer.Backdrop>
}
function DetailField({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`grid min-w-0 gap-1${wide ? ' sm:col-span-2' : ''}`}><dt className='text-muted'>{label}</dt><dd className='wrap-anywhere'>{children}</dd></div>
}
function CodeBlock({ text }: { text: string }) {
  return <pre className='min-w-0 rounded-lg bg-surface-secondary p-3 font-mono text-xs whitespace-pre-wrap wrap-anywhere'>{text}</pre>
}
function JsonSection({ label, value }: { label: string; value: unknown }) {
  return <Accordion.Item><Accordion.Heading><Accordion.Trigger>{label}<Accordion.Indicator /></Accordion.Trigger></Accordion.Heading><Accordion.Panel><Accordion.Body><CodeBlock text={JSON.stringify(value, null, 2) ?? '无'} /></Accordion.Body></Accordion.Panel></Accordion.Item>
}
