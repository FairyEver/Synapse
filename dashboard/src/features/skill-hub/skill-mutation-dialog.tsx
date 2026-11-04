import { Button, Modal } from '@heroui/react'
import type { ReactNode } from 'react'
import type { SkillPublishModel } from './use-skill-publish'

export function SkillMutationDialog({ title, children, onClose, onSubmit, label, model, disabled, onReload }: {
  title: string; children: ReactNode; onClose: () => void; onSubmit: () => void; label: string
  model: SkillPublishModel; disabled?: boolean; onReload?: () => void
}) {
  return <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open && !model.busy) onClose() }}
    isDismissable={!model.busy} isKeyboardDismissDisabled={model.busy}>
    <Modal.Container size="lg">
      <Modal.Dialog>
        <Modal.CloseTrigger isDisabled={model.busy} />
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
          event.preventDefault()
          if (!disabled && !model.conflict && !model.pendingId && !model.busy) onSubmit()
        }}>
          <Modal.Header className="pe-8"><Modal.Heading className="wrap-anywhere">{title}</Modal.Heading></Modal.Header>
          <Modal.Body className="space-y-4">
            {children}
            {model.error ? <p role="alert" className="wrap-anywhere text-sm text-danger">{model.error}</p> : null}
            {model.pendingId ? <p className="text-sm text-muted">请先确认上次操作的结果。</p> : null}
            {model.conflict && onReload ? <Button type="button" variant="secondary" onPress={onReload}>读取当前资料并保留草稿</Button> : null}
          </Modal.Body>
          <Modal.Footer className="flex-wrap">
            <Button type="button" variant="tertiary" isDisabled={model.busy} onPress={onClose}>关闭</Button>
            {model.pendingId ? <>
              {model.canRetry ? <Button type="button" variant="secondary" isDisabled={model.busy} onPress={() => void model.retryOriginal()}>重试原请求</Button> : null}
              <Button type="button" isPending={model.busy} onPress={() => void model.check()}>查询回执</Button>
            </> : <Button type="submit" isDisabled={disabled || model.conflict} isPending={model.busy}>{label}</Button>}
          </Modal.Footer>
        </form>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>
}
