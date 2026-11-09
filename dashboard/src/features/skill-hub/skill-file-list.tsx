import { Button, Modal } from '@heroui/react'
import { File } from 'lucide-react'
import { useState } from 'react'
import type { SkillHubDetail } from '@synapse/shared/skill-hub-contracts'
import { ApiError } from '@/lib/api-client'
import { useSkillHubFilePreview } from './use-skill-hub'

export function SkillFileList({ skill, session, reload }: { skill: SkillHubDetail; session: string; reload: () => void }) {
  const [path, setPath] = useState<string | null>(null)

  return <>
    <ul className="divide-y divide-separator">
      {skill.files.map((file) => <li key={file.path}>
        <Button variant="ghost" aria-haspopup="dialog" onPress={() => setPath(file.path)}
          className="h-auto min-h-11 w-full justify-start gap-2 px-2 py-3 text-start font-normal">
          <File className="size-4 shrink-0 text-muted" aria-hidden="true" />
          <span className="min-w-0 flex-1 wrap-anywhere font-mono whitespace-normal">{file.path}</span>
          <span className="shrink-0 text-muted tabular-nums">{file.size.toLocaleString()} B</span>
        </Button>
      </li>)}
    </ul>
    {path !== null && <FilePreviewDialog session={session} id={skill.id} version={skill.currentVersion.id} path={path}
      onClose={() => setPath(null)} reload={reload} />}
  </>
}

function FilePreviewDialog({ session, id, version, path, onClose, reload }: {
  session: string; id: string; version: string; path: string; onClose: () => void; reload: () => void
}) {
  const preview = useSkillHubFilePreview(session, id, version, path)
  const error = preview.error
  const status = error instanceof ApiError ? error.status : undefined

  return <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) onClose() }}>
    <Modal.Container size="lg" scroll="inside">
      <Modal.Dialog className="sm:max-w-3xl">
        <Modal.CloseTrigger aria-label="关闭文件预览" />
        <Modal.Header className="pe-8">
          <Modal.Heading className="wrap-anywhere font-mono">{path}</Modal.Heading>
        </Modal.Header>
        <Modal.Body>
          {error ? <div className="space-y-3">
            <p role="alert" className="text-sm text-danger">{error.message || '文件读取失败。'}</p>
            {status === 409 ? <Button variant="secondary" onPress={() => { onClose(); reload() }}>刷新文件列表</Button>
              : (status === undefined || status >= 500 || status === 429) && <Button variant="secondary" onPress={() => void preview.refetch()}>重试</Button>}
          </div> : preview.data ? (
            preview.data.content === '' ? <p className="text-sm text-muted">空文件</p>
              : <pre className="wrap-anywhere font-mono text-sm leading-relaxed whitespace-pre-wrap">{preview.data.content}</pre>
          ) : <p role="status" className="text-sm text-muted">正在读取文件…</p>}
        </Modal.Body>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>
}
