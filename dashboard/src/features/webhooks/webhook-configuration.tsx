import { useEffect, useState, type FormEvent } from 'react'
import { Button, Card, Description, FieldError, Input, InputGroup, Label, Switch, TextField, toast } from '@heroui/react'
import type { DashboardWebhookDto } from '@synapse/shared'
import { Copy, Eye, EyeOff } from 'lucide-react'
import { RelativeTime } from '@/components/relative-time'
import { getWebhookUrlDisplayState } from './webhook-display'

type Props = {
  webhook: DashboardWebhookDto
  isUpdating: boolean
  isResetting: boolean
  onSaveName: (name: string) => void
  onToggle: () => void
  onResetSecret: () => void
  onDelete: () => void
}

export function WebhookConfiguration({ webhook, isUpdating, isResetting, onSaveName, onToggle, onResetSecret, onDelete }: Props) {
  const [name, setName] = useState(webhook.name)
  const [revealed, setRevealed] = useState(false)
  const urlState = getWebhookUrlDisplayState(webhook)
  const invalidName = !name.trim()
  useEffect(() => setName(webhook.name), [webhook.name])
  useEffect(() => setRevealed(false), [webhook.url])

  async function copyUrl() {
    if (!urlState.copyValue) return
    try {
      await navigator.clipboard.writeText(urlState.copyValue)
      toast.success('接入地址已复制')
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '复制失败')
    }
  }
  function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!invalidName && !isUpdating) onSaveName(name.trim())
  }

  return <div className='grid min-w-0 gap-6'>
    <Card>
      <Card.Header><Card.Title>接入配置</Card.Title></Card.Header>
      <Card.Content className='grid min-w-0 gap-4'>
        <TextField className='min-w-0' isReadOnly>
          <Label>接入地址</Label>
          <InputGroup variant='secondary' fullWidth>
            <InputGroup.Input className='min-w-0 font-mono text-sm' value={revealed && urlState.copyValue ? urlState.copyValue : webhook.maskedUrl} />
            <InputGroup.Suffix>
              <Button variant='ghost' size='sm' isIconOnly isDisabled={!urlState.copyValue}
                aria-label={revealed ? '隐藏接入地址' : '显示接入地址'} onPress={() => setRevealed(!revealed)}>
                {revealed ? <EyeOff /> : <Eye />}
              </Button>
            </InputGroup.Suffix>
          </InputGroup>
          <Description>{urlState.copyValue ? '地址包含访问令牌，请勿公开分享。' : '请重置调用地址后复制新地址。'}</Description>
        </TextField>
        <div className='flex flex-wrap items-center gap-3'>
          <Button variant='secondary' isDisabled={!urlState.copyValue} onPress={() => void copyUrl()}><Copy />复制接入地址</Button>
          {!urlState.copyValue && <Button variant='outline' isDisabled={isResetting} onPress={onResetSecret}>重置调用地址</Button>}
        </div>
        <dl className='grid gap-1 text-sm'>
          <dt className='text-muted'>Webhook 标识</dt>
          <dd className='break-all font-mono'>{webhook.publicId}</dd>
        </dl>
      </Card.Content>
    </Card>

    <Card>
      <Card.Header><Card.Title>基本设置</Card.Title></Card.Header>
      <Card.Content className='grid gap-6'>
        <form className='flex flex-col items-start gap-3 sm:flex-row sm:items-end' onSubmit={saveName}>
          <TextField className='w-full min-w-0 sm:max-w-md' isRequired isInvalid={invalidName} isDisabled={isUpdating}>
            <Label>名称</Label>
            <Input variant='secondary' value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
            <FieldError>名称不能为空</FieldError>
          </TextField>
          <Button type='submit' variant='secondary' isPending={isUpdating} isDisabled={invalidName || name.trim() === webhook.name}>保存名称</Button>
        </form>
        <Switch isSelected={webhook.enabled} isDisabled={isUpdating} onChange={onToggle}>
          <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control><Label>接收 Webhook</Label></Switch.Content>
        </Switch>
        <dl className='grid gap-4 text-sm sm:grid-cols-2'>
          <div className='grid gap-1'><dt className='text-muted'>创建时间</dt><dd><RelativeTime value={webhook.createdAt} /></dd></div>
          <div className='grid gap-1'><dt className='text-muted'>更新时间</dt><dd><RelativeTime value={webhook.updatedAt} /></dd></div>
        </dl>
      </Card.Content>
    </Card>

    <section aria-labelledby='webhook-danger-heading' className='grid gap-4'>
      <h2 id='webhook-danger-heading' className='text-base font-semibold'>危险操作</h2>
      <div className='flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center'>
        <div className='grid gap-1 text-sm'><h3 className='font-medium'>重置调用地址</h3><p className='text-muted'>旧接入地址立即失效，需要更新外部服务配置。</p></div>
        <Button variant='outline' isDisabled={isResetting} onPress={onResetSecret}>重置调用地址</Button>
      </div>
      <div className='flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center'>
        <div className='grid gap-1 text-sm'><h3 className='font-medium'>删除 Webhook</h3><p className='text-muted'>接入地址失效，已有触发记录仍会保留。</p></div>
        <Button variant='danger-soft' onPress={onDelete}>删除 Webhook</Button>
      </div>
    </section>
  </div>
}
