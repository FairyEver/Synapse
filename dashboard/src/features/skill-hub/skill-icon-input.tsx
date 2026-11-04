import { Button, Label, Spinner } from '@heroui/react'
import { useEffect, useId, useRef, useState } from 'react'
import { inspectHubIconInput, SKILL_HUB_LIMITS as limits } from '@synapse/shared/skill-hub-contracts'

const iconError = () => new Error('请选择不超过 2 MiB 的有效 PNG、JPEG 或 WebP 图标。')

export async function normalizeSkillHubIcon(file: File): Promise<Blob> {
  if (!file.size || file.size > limits.originalIconBytes) throw iconError()
  const buffer = await file.arrayBuffer()
  const expected = inspectHubIconInput(new Uint8Array(buffer))
  if (!expected) throw iconError()
  try {
    const bitmap = await createImageBitmap(new Blob([buffer], { type: expected.type }), { imageOrientation: 'none' })
    try {
      if (bitmap.width !== expected.width || bitmap.height !== expected.height) throw iconError()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = limits.iconSize
      const context = canvas.getContext('2d')
      if (!context) throw iconError()
      const side = Math.min(bitmap.width, bitmap.height)
      context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, limits.iconSize, limits.iconSize)
      const output = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!output || output.type !== 'image/png' || !output.size || output.size > limits.iconBytes) throw iconError()
      return output
    } finally { bitmap.close() }
  } catch { throw iconError() }
}

export function SkillIconInput({ value, current, disabled, onChange, onBusyChange }: {
  value?: Blob | null; current?: boolean; disabled: boolean; onChange: (value?: Blob | null) => void
  onBusyChange: (busy: boolean) => void
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const change = useRef(0)
  useEffect(() => () => { change.current++ }, [])
  useEffect(() => {
    if (!value) { setPreview(''); return }
    const url = URL.createObjectURL(value)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [value])

  async function select(file: File) {
    const marker = ++change.current
    setError('')
    setBusy(true)
    onBusyChange(true)
    try {
      const normalized = await normalizeSkillHubIcon(file)
      if (marker === change.current) onChange(normalized)
    } catch (err) {
      if (marker === change.current) setError(err instanceof Error ? err.message : iconError().message)
    } finally {
      if (marker === change.current) { setBusy(false); onBusyChange(false) }
    }
  }
  return <div className="grid gap-2">
    <Label id={id}>商店图标</Label>
    <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
      onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void select(file) }} />
    <div className="flex flex-wrap items-center gap-2">
      {preview ? <img className="size-12 rounded-lg object-cover" alt="新图标预览" src={preview} /> : null}
      <Button type="button" variant="secondary" isDisabled={disabled} isPending={busy} aria-describedby={id}
        onPress={() => input.current?.click()}>{busy ? <Spinner size="sm" /> : null}选择图标</Button>
      {value || (current && value !== null) ? <Button type="button" variant="ghost" isDisabled={disabled || busy}
        onPress={() => { setError(''); onChange(current ? null : undefined) }}>移除图标</Button> : null}
      {current && value !== undefined ? <Button type="button" variant="ghost" isDisabled={disabled || busy}
        onPress={() => { setError(''); onChange(undefined) }}>保留原图标</Button> : null}
    </div>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
  </div>
}
