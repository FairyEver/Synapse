import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SettingsFieldRow } from "@/modules/settings/components/settings-field-row"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import { useVoiceSettings } from "@/modules/settings/hooks/use-voice-settings"

/** 官方实时语音识别在售的引擎。默认那条是实测选出来的，理由见 capability.ts。 */
const ENGINE_OPTIONS = [
  { value: "Hy-ASR-3.0-preview", label: "Hy-ASR-3.0-preview（混元 · 默认）" },
  { value: "16k_zh_en_2.0", label: "16k_zh_en_2.0（中英混合 · 大模型2.0）" },
  { value: "16k_zh_en", label: "16k_zh_en（中英混合 · 大模型1.0）" },
  { value: "16k_zh", label: "16k_zh（普通话 · 通用）" },
] as const

type Draft = {
  appId: string
  secretId: string
  engineModelType: string
  hotwordList: string
}

const EMPTY_DRAFT: Draft = { appId: "", secretId: "", engineModelType: "", hotwordList: "" }

function VoiceInputPanel() {
  const { settings, isLoading, isSaving, error, save } = useVoiceSettings()
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [secretKey, setSecretKey] = useState("")
  const [savedAt, setSavedAt] = useState(false)

  useEffect(() => {
    if (!settings) return
    setDraft({
      appId: settings.appId,
      secretId: settings.secretId,
      engineModelType: settings.engineModelType,
      hotwordList: settings.hotwordList,
    })
  }, [settings])

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setSavedAt(false)
  }

  const submit = async () => {
    const ok = await save({
      appId: draft.appId,
      secretId: draft.secretId,
      engineModelType: draft.engineModelType,
      hotwordList: draft.hotwordList,
      // 留空表示不改动已保存的密钥。
      ...(secretKey ? { secretKey } : {}),
    })
    if (ok) {
      setSecretKey("")
      setSavedAt(true)
    }
  }

  const clearSecretKey = async () => {
    if (await save({ secretKey: "" })) setSecretKey("")
  }

  if (isLoading) {
    return (
      <SettingsGroup>
        <p className="text-sm text-muted-foreground">正在读取</p>
      </SettingsGroup>
    )
  }

  return (
    <SettingsGroup>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">语音输入</p>
          <p className="mt-1 text-sm text-muted-foreground">
            在腾讯云控制台开通实时语音识别后，把接口密钥填在这里。
          </p>
        </div>
      </div>

      <SettingsFieldRow label="AppID" description="腾讯云控制台的账号 AppID。">
        <Input
          value={draft.appId}
          onChange={(event) => update({ appId: event.target.value })}
          placeholder="1250000000"
          spellCheck={false}
          autoComplete="off"
        />
      </SettingsFieldRow>

      <SettingsFieldRow label="SecretId" description="API 密钥里的 SecretId。">
        <Input
          value={draft.secretId}
          onChange={(event) => update({ secretId: event.target.value })}
          placeholder="AKIDxxxxxxxxxxxxxxxx"
          spellCheck={false}
          autoComplete="off"
        />
      </SettingsFieldRow>

      <SettingsFieldRow
        label="SecretKey"
        description="只保存在本机、写进加密存储，不会再读回界面。留空表示不修改。"
      >
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={secretKey}
            onChange={(event) => { setSecretKey(event.target.value); setSavedAt(false) }}
            placeholder={settings?.hasSecretKey ? "已保存" : "未填写"}
            spellCheck={false}
            autoComplete="off"
          />
          {settings?.hasSecretKey ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void clearSecretKey()}>
              清除
            </Button>
          ) : null}
        </div>
      </SettingsFieldRow>

      <SettingsFieldRow label="识别引擎" description="换了引擎需要重新开始一次录音才生效。">
        <select
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
          value={draft.engineModelType}
          onChange={(event) => update({ engineModelType: event.target.value })}
        >
          {ENGINE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </SettingsFieldRow>

      <SettingsFieldRow
        label="热词"
        description="用英文逗号分隔，形如 词|权重。权重 11 是超级热词，给必须准确的词用。"
      >
        <textarea
          className="min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs"
          value={draft.hotwordList}
          onChange={(event) => update({ hotwordList: event.target.value })}
          spellCheck={false}
        />
      </SettingsFieldRow>

      <div className="flex items-center justify-end gap-3">
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        {savedAt ? <span className="text-sm text-muted-foreground">已保存</span> : null}
        <Button type="button" size="sm" disabled={isSaving} onClick={() => void submit()}>
          {isSaving ? "保存中" : "保存"}
        </Button>
      </div>
    </SettingsGroup>
  )
}

export { VoiceInputPanel }
