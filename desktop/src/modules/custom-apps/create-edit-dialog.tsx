import { useEffect, useRef, useState } from "react"
import { ImagePlus } from "lucide-react"
import { parseCustomAppUrl } from "@synapse/shared/custom-apps-contracts"
import type {
  CustomAppCreateInput,
  CustomAppDto,
  CustomAppUpdateInput,
} from "@synapse/shared/custom-apps-contracts"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CustomAppIconPreview } from "./icon-picker"

export type CustomAppIconResult = {
  readonly pngBase64: string
  readonly dataUrl: string
}

type CreateEditCustomAppDialogProps = {
  readonly open: boolean
  readonly mode: "create" | "edit"
  readonly app?: CustomAppDto | null
  readonly disabled?: boolean
  readonly onClose: () => void
  readonly onSubmit: (input: CustomAppCreateInput | CustomAppUpdateInput) => Promise<void>
  readonly fetchFavicon: (url: string) => Promise<CustomAppIconResult | null>
  readonly chooseIcon: () => Promise<CustomAppIconResult | null>
}

export function CreateEditCustomAppDialog({
  open,
  mode,
  app = null,
  disabled = false,
  onClose,
  onSubmit,
  fetchFavicon,
  chooseIcon,
}: CreateEditCustomAppDialogProps) {
  const [name, setName] = useState("")
  const [startUrl, setStartUrl] = useState("")
  const [iconSource, setIconSource] = useState<"favicon" | "custom">("favicon")
  const [iconPreview, setIconPreview] = useState<string | null>(null)
  const [iconPngBase64, setIconPngBase64] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadingFavicon, setLoadingFavicon] = useState(false)
  const createAttemptRef = useRef<{ readonly id: `cwa_${string}`; readonly operationId: string } | null>(null)
  const updateOperationIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(app?.name ?? "")
    setStartUrl(app?.startUrl ?? "")
    setIconSource(app?.iconSource ?? "favicon")
    setIconPreview(app?.iconUrl ?? null)
    setIconPngBase64(null)
    setError(null)
    setSaving(false)
    setLoadingFavicon(false)
    createAttemptRef.current = {
      id: `cwa_${crypto.randomUUID()}`,
      operationId: crypto.randomUUID(),
    }
    updateOperationIdRef.current = crypto.randomUUID()
  }, [app, open])

  const applyIcon = (result: CustomAppIconResult | null, source: "favicon" | "custom") => {
    if (!result) return
    setIconSource(source)
    setIconPreview(result.dataUrl)
    setIconPngBase64(result.pngBase64)
  }

  const fetchWebsiteIcon = async (value: string) => {
    if (disabled || !parseCustomAppUrl(value)) return
    setLoadingFavicon(true)
    try {
      applyIcon(await fetchFavicon(value), "favicon")
    } finally {
      setLoadingFavicon(false)
    }
  }

  const loadFavicon = async (value: string) => {
    if (iconSource === "custom") return
    await fetchWebsiteIcon(value)
  }

  const submit = async () => {
    const normalizedUrl = parseCustomAppUrl(startUrl)
    const trimmedName = name.trim()
    if (!trimmedName || Array.from(trimmedName).length > 64) {
      setError("请输入应用名称")
      return
    }
    if (!normalizedUrl) {
      setError("请输入有效的 HTTP(S) 网址")
      return
    }

    setSaving(true)
    setError(null)
    try {
      if (mode === "create") {
        const attempt = createAttemptRef.current ??= {
          id: `cwa_${crypto.randomUUID()}`,
          operationId: crypto.randomUUID(),
        }
        await onSubmit({
          operationId: attempt.operationId,
          id: attempt.id,
          name: trimmedName,
          startUrl: normalizedUrl,
          iconSource,
          ...(iconPngBase64 ? { iconPngBase64 } : {}),
        })
      } else if (app) {
        const input: CustomAppUpdateInput = {
          operationId: updateOperationIdRef.current ??= crypto.randomUUID(),
        }
        if (trimmedName !== app.name) input.name = trimmedName
        if (normalizedUrl !== app.startUrl) input.startUrl = normalizedUrl
        if (iconPngBase64) input.iconPngBase64 = iconPngBase64
        if (iconSource !== app.iconSource) input.iconSource = iconSource
        if (!iconPngBase64 && iconSource === "favicon" && app.iconSource === "custom") {
          input.iconPngBase64 = null
        }
        if (Object.keys(input).length === 1) {
          onClose()
          return
        }
        await onSubmit(input)
      }
      createAttemptRef.current = null
      updateOperationIdRef.current = null
      onClose()
    } catch {
      setError("保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent className="sm:max-w-[480px]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "新建自定义应用" : "编辑自定义应用"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>图标</Label>
            <div className="flex items-center gap-3">
              <CustomAppIconPreview src={iconPreview} size="lg" />
              <Button type="button" variant="outline" size="sm" disabled={disabled || saving} onClick={async () => {
                const result = await chooseIcon()
                applyIcon(result, "custom")
              }}>
                <ImagePlus />
                选择图片
              </Button>
              {iconSource === "custom" && (
                <Button type="button" variant="ghost" size="sm" disabled={disabled || saving} onClick={() => {
                  setIconSource("favicon")
                  setIconPngBase64(null)
                  setIconPreview(null)
                  void fetchWebsiteIcon(startUrl)
                }}>
                  使用网站图标
                </Button>
              )}
              {loadingFavicon && <span className="text-xs text-muted-foreground" role="status">正在获取图标</span>}
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="custom-app-name">名称</Label>
            <Input
              id="custom-app-name"
              aria-label="名称"
              value={name}
              disabled={disabled || saving}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="custom-app-url">网址</Label>
            <Input
              id="custom-app-url"
              aria-label="网址"
              value={startUrl}
              disabled={disabled || saving}
              onChange={(event) => setStartUrl(event.target.value)}
              onBlur={() => { void loadFavicon(startUrl) }}
            />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>取消</Button>
          <Button type="button" disabled={disabled || saving || loadingFavicon} onClick={() => { void submit() }}>
            {saving ? "保存中" : mode === "create" ? "创建" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
