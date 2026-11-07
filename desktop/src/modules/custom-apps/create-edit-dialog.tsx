import { useEffect, useRef, useState } from "react"
import { AppWindow, Check, CircleHelp, ImagePlus, PanelTop, ShieldAlert } from "lucide-react"
import { parseCustomAppUrl } from "@synapse/shared/custom-apps-contracts"
import type {
  CustomAppCreateInput,
  CustomAppDto,
  CustomAppOpenMode,
  CustomAppUpdateInput,
} from "@synapse/shared/custom-apps-contracts"

import { Badge } from "@/components/ui/badge"
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
import { cn } from "@/lib/utils"
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
  const [openMode, setOpenMode] = useState<CustomAppOpenMode | null>(null)
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
    setOpenMode(app?.openMode ?? null)
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
    if (!openMode) {
      setError("请选择打开方式")
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
          openMode,
          iconSource,
          ...(iconPngBase64 ? { iconPngBase64 } : {}),
        })
      } else if (app) {
        const input: CustomAppUpdateInput = {
          operationId: updateOperationIdRef.current ??= crypto.randomUUID(),
        }
        if (trimmedName !== app.name) input.name = trimmedName
        if (normalizedUrl !== app.startUrl) input.startUrl = normalizedUrl
        if (openMode !== app.openMode) input.openMode = openMode
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
      <DialogContent className="sm:max-w-[620px]" aria-describedby={undefined}>
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
          <fieldset>
            <legend className="mb-2 text-sm font-medium">打开方式</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <OpenModeOption
                description="通过 iframe 在主窗口内加载。部分网站会禁止嵌入，可能出现空白、登录失败、弹窗、下载或跨站 Cookie 受限。"
                disabled={disabled || saving}
                icon={PanelTop}
                mode="iframe"
                selected={openMode === "iframe"}
                title="应用内嵌"
                warning
                onSelect={() => {
                  setOpenMode("iframe")
                  setError(null)
                }}
              />
              <OpenModeOption
                description="始终打开专用窗口，网页直接加载，不占用主窗口。"
                disabled={disabled || saving}
                icon={AppWindow}
                mode="window"
                selected={openMode === "window"}
                title="独立窗口"
                onSelect={() => {
                  setOpenMode("window")
                  setError(null)
                }}
              />
            </div>
          </fieldset>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>取消</Button>
          <Button type="button" disabled={disabled || saving || loadingFavicon || !openMode} onClick={() => { void submit() }}>
            {saving ? "保存中" : mode === "create" ? "创建" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OpenModeOption({
  description,
  disabled,
  icon: Icon,
  mode,
  onSelect,
  selected,
  title,
  warning = false,
}: {
  readonly description: string
  readonly disabled: boolean
  readonly icon: typeof PanelTop
  readonly mode: CustomAppOpenMode
  readonly onSelect: () => void
  readonly selected: boolean
  readonly title: string
  readonly warning?: boolean
}) {
  const descriptionId = `custom-app-open-mode-${mode}-description`
  return (
    <label
      className={cn(
        "flex min-h-[142px] cursor-pointer flex-col rounded-lg border p-3 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        selected
          ? "border-foreground bg-muted/50"
          : "border-border bg-background hover:bg-muted/30",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="radio"
        name="custom-app-opening-mode"
        value={mode}
        aria-label={title}
        aria-describedby={descriptionId}
        className="sr-only"
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{title}</span>
              {warning ? <Badge variant="outline">可能受限</Badge> : null}
            </div>
          </div>
        </div>
        <span
          className={cn(
            "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
            selected
              ? "border-foreground bg-foreground text-background"
              : "border-input bg-background",
          )}
          aria-hidden="true"
        >
          {selected ? <Check className="size-2.5" strokeWidth={3} /> : null}
        </span>
      </div>
      <p id={descriptionId} className="mt-3 text-xs leading-5 text-muted-foreground">{description}</p>
      {warning ? (
        <p className="mt-auto flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
          <ShieldAlert className="size-3.5 shrink-0" />
          页面空白或无法登录时，请改用独立窗口。
        </p>
      ) : (
        <p className="mt-auto flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
          <CircleHelp className="size-3.5 shrink-0" />
          点击应用时只打开新窗口。
        </p>
      )}
    </label>
  )
}
