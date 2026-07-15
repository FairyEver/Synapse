import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { inspectSkillEnvSource } from "@/app-shell/installers"
import { createRendererLogger } from "@/app-shell/logging"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type { SynapseContentMeta } from "@/types/content"
import type { SynapseSkillInstallerSource } from "@/types/installers"
import type { SecretSafeView } from "../../../../app-capabilities/secrets/shared/schema"
import type { SkillEnvUpdateScanGroup } from "../../../../app-capabilities/secrets/renderer/skill-env-update-dialog"

type SkillEnvSecretConfigLoadState = "error" | "loading" | "ready"
type SkillEnvSecretConfigMode = "name_conflict" | "new" | "replace" | "reuse"
type SkillEnvSecretConfigSaveState = "failed" | "idle" | "saved" | "saving"
type SkillEnvSecretConfigValueOrigin = "default" | "input"

type SkillEnvSecretConfigField = {
  readonly defaultValue: string
  readonly existingHasValue: boolean
  readonly existingSecretName?: string
  readonly mode: SkillEnvSecretConfigMode
  readonly name: string
  readonly saveState: SkillEnvSecretConfigSaveState
  readonly touched: boolean
  readonly value: string
  readonly valueOrigin: SkillEnvSecretConfigValueOrigin
  readonly visible: boolean
}

type SkillEnvSecretConfigSaveOutcome =
  | { readonly kind: "complete"; readonly groups: readonly SkillEnvUpdateScanGroup[]; readonly savedCount: number }
  | { readonly kind: "partial"; readonly failedCount: number; readonly savedCount: number }
  | { readonly kind: "scan_error"; readonly savedCount: number }

type ScanNamesResult = {
  readonly failedNames: string[]
  readonly groups: SkillEnvUpdateScanGroup[]
}

const logger = createRendererLogger("content.skill-env-secret-config")

function installerSource(item: SynapseContentMeta<"skill">): SynapseSkillInstallerSource {
  return {
    kind: "skill",
    origin: "repository",
    repositoryContentId: item.id,
    sourceIdentity: item.id,
    name: item.name?.trim() || item.id,
    title: item.title,
    description: item.description,
  }
}

function matchSecret(name: string, secrets: readonly SecretSafeView[]): SecretSafeView | undefined {
  return secrets.find((secret) => secret.name === name)
}

function findSecretNameConflict(name: string, secrets: readonly SecretSafeView[]): SecretSafeView | undefined {
  return secrets.find((secret) => secret.name !== name && secret.name.toLowerCase() === name.toLowerCase())
}

function createField(
  name: string,
  defaultValue: string,
  secrets: readonly SecretSafeView[],
): SkillEnvSecretConfigField {
  const secret = matchSecret(name, secrets)
  const nameConflict = secret ? undefined : findSecretNameConflict(name, secrets)
  if (nameConflict) {
    return {
      defaultValue,
      existingHasValue: nameConflict.hasValue,
      existingSecretName: nameConflict.name,
      mode: "name_conflict",
      name,
      saveState: "idle",
      touched: false,
      value: "",
      valueOrigin: "input",
      visible: false,
    }
  }
  if (secret?.hasValue) {
    return {
      defaultValue,
      existingHasValue: true,
      existingSecretName: secret.name,
      mode: "reuse",
      name,
      saveState: "idle",
      touched: false,
      value: "",
      valueOrigin: "input",
      visible: false,
    }
  }

  return {
    defaultValue,
    existingHasValue: false,
    existingSecretName: secret?.name,
    mode: secret ? "replace" : "new",
    name,
    saveState: "idle",
    touched: false,
    value: defaultValue,
    valueOrigin: defaultValue ? "default" : "input",
    visible: false,
  }
}

function mergeScanGroups(
  current: readonly SkillEnvUpdateScanGroup[],
  additions: readonly SkillEnvUpdateScanGroup[],
): SkillEnvUpdateScanGroup[] {
  const next = new Map(current.map((group) => [group.name, group]))
  for (const group of additions) next.set(group.name, group)
  return [...next.values()]
}

function uniqueNames(names: readonly string[]): string[] {
  return [...new Set(names)]
}

function errorDiagnostic(error: unknown): { readonly errorName?: string; readonly errorMessageLength: number } {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessageLength: error.message.length }
  }
  return { errorMessageLength: String(error).length }
}

function useSkillEnvSecretConfig(item: SynapseContentMeta<"skill">) {
  const [loadState, setLoadState] = useState<SkillEnvSecretConfigLoadState>("loading")
  const [fields, setFields] = useState<SkillEnvSecretConfigField[]>([])
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState("")
  const [reloadVersion, setReloadVersion] = useState(0)
  const [pendingScanNames, setPendingScanNames] = useState<string[]>([])
  const [updateGroups, setUpdateGroups] = useState<SkillEnvUpdateScanGroup[]>([])
  const loadGeneration = useRef(0)
  const secretsBridge = useMemo(() => requireBridgeDomain("secrets"), [])

  useEffect(() => {
    const generation = ++loadGeneration.current
    setLoadState("loading")
    setFields([])
    setNotice("")
    setPendingScanNames([])
    setUpdateGroups([])

    void Promise.all([
      inspectSkillEnvSource(installerSource(item)),
      secretsBridge.list(),
    ]).then(([inspection, secretList]) => {
      if (generation !== loadGeneration.current) return
      setFields(inspection.declarations.map(({ name, defaultValue }) => (
        createField(name, defaultValue, secretList.secrets)
      )))
      setLoadState("ready")
    }).catch((error) => {
      if (generation !== loadGeneration.current) return
      logger.error("Failed to load Skill environment configuration.", {
        contentId: item.id,
        ...errorDiagnostic(error),
      })
      setLoadState("error")
    })

    return () => {
      loadGeneration.current += 1
    }
  }, [item, reloadVersion, secretsBridge])

  const updateField = useCallback((name: string, update: (field: SkillEnvSecretConfigField) => SkillEnvSecretConfigField) => {
    setFields((current) => current.map((field) => field.name === name ? update(field) : field))
    setNotice("")
  }, [])

  const setValue = useCallback((name: string, value: string) => {
    updateField(name, (field) => ({
      ...field,
      saveState: "idle",
      touched: true,
      value,
      valueOrigin: "input",
    }))
  }, [updateField])

  const toggleVisibility = useCallback((name: string) => {
    updateField(name, (field) => ({ ...field, visible: !field.visible }))
  }, [updateField])

  const replaceSecret = useCallback((name: string) => {
    updateField(name, (field) => ({
      ...field,
      mode: "replace",
      saveState: "idle",
      touched: false,
      value: "",
      valueOrigin: "input",
      visible: false,
    }))
  }, [updateField])

  const reuseSecret = useCallback((name: string) => {
    updateField(name, (field) => ({
      ...field,
      mode: "reuse",
      saveState: "idle",
      touched: false,
      value: "",
      valueOrigin: "input",
      visible: false,
    }))
  }, [updateField])

  const scanNames = useCallback(async (names: readonly string[]): Promise<ScanNamesResult> => {
    const results = await Promise.all(uniqueNames(names).map(async (name) => {
      try {
        const scanResult = await secretsBridge.scanSkillEnvBindings({ name })
        return { name, scanResult }
      } catch (error) {
        logger.error("Failed to scan installed Skill environment bindings.", {
          contentId: item.id,
          ...errorDiagnostic(error),
        })
        return { name, scanResult: null }
      }
    }))

    return {
      failedNames: results.filter((result) => !result.scanResult).map((result) => result.name),
      groups: results.flatMap(({ name, scanResult }) => (
        scanResult && scanResult.items.some((entry) => entry.status !== "up_to_date")
          ? [{ name, scanResult }]
          : []
      )),
    }
  }, [item.id, secretsBridge])

  const save = useCallback(async (): Promise<SkillEnvSecretConfigSaveOutcome> => {
    if (saving) return { kind: "partial", failedCount: 0, savedCount: 0 }
    const candidates = fields.filter((field) => (
      field.mode !== "name_conflict"
      && field.mode !== "reuse"
      && (field.value.length > 0 || field.touched)
    ))
    const reusedNames = fields
      .filter((field) => field.mode === "reuse" && field.existingHasValue)
      .map((field) => field.existingSecretName ?? field.name)

    if (candidates.length === 0) {
      const namesToScan = uniqueNames([...pendingScanNames, ...reusedNames])
      if (namesToScan.length === 0) {
        return { kind: "complete", groups: updateGroups, savedCount: 0 }
      }
      setSaving(true)
      setNotice("")
      const pendingScanResult = await scanNames(namesToScan)
      const mergedGroups = mergeScanGroups(updateGroups, pendingScanResult.groups)
      setUpdateGroups(mergedGroups)
      setPendingScanNames(pendingScanResult.failedNames)
      setSaving(false)
      if (pendingScanResult.failedNames.length > 0) {
        setNotice("扫描关联 Skill 失败，请重试。")
        return { kind: "scan_error", savedCount: 0 }
      }
      return { kind: "complete", groups: mergedGroups, savedCount: 0 }
    }

    setSaving(true)
    setNotice("")
    const nextFields = [...fields]
    const savedNames: string[] = []
    let failedCount = 0

    for (const candidate of candidates) {
      const fieldIndex = nextFields.findIndex((field) => field.name === candidate.name)
      nextFields[fieldIndex] = { ...candidate, saveState: "saving" }
      setFields([...nextFields])

      try {
        const result = await secretsBridge.upsert({
          name: candidate.existingSecretName ?? candidate.name,
          value: candidate.value,
        })
        savedNames.push(result.secret.name)
        nextFields[fieldIndex] = {
          ...candidate,
          existingHasValue: true,
          existingSecretName: result.secret.name,
          mode: "reuse",
          saveState: "saved",
          value: "",
          valueOrigin: "input",
          visible: false,
        }
      } catch (error) {
        failedCount += 1
        nextFields[fieldIndex] = { ...candidate, saveState: "failed" }
        logger.error("Failed to save Skill environment secret.", {
          contentId: item.id,
          ...errorDiagnostic(error),
        })
      }
      setFields([...nextFields])
    }

    const scanResult = await scanNames([...pendingScanNames, ...reusedNames, ...savedNames])
    const mergedGroups = mergeScanGroups(updateGroups, scanResult.groups)
    setUpdateGroups(mergedGroups)
    setPendingScanNames(scanResult.failedNames)
    setSaving(false)

    const savedCount = savedNames.length
    if (failedCount > 0) {
      setNotice(savedCount > 0 ? "部分密钥已保存，失败项可重试。" : "保存失败，请重试。")
      return { kind: "partial", failedCount, savedCount }
    }
    if (scanResult.failedNames.length > 0) {
      setNotice("密钥已保存，但扫描关联 Skill 失败。")
      return { kind: "scan_error", savedCount }
    }
    return { kind: "complete", groups: mergedGroups, savedCount }
  }, [fields, item.id, pendingScanNames, saving, scanNames, secretsBridge, updateGroups])

  const retryScan = useCallback(async (): Promise<SkillEnvSecretConfigSaveOutcome> => {
    if (saving || pendingScanNames.length === 0) {
      return { kind: "complete", groups: updateGroups, savedCount: 0 }
    }
    setSaving(true)
    setNotice("")
    const result = await scanNames(pendingScanNames)
    const mergedGroups = mergeScanGroups(updateGroups, result.groups)
    setUpdateGroups(mergedGroups)
    setPendingScanNames(result.failedNames)
    setSaving(false)

    if (result.failedNames.length > 0) {
      setNotice("扫描关联 Skill 失败，请重试。")
      return { kind: "scan_error", savedCount: 0 }
    }
    return { kind: "complete", groups: mergedGroups, savedCount: 0 }
  }, [pendingScanNames, saving, scanNames, updateGroups])

  const hasUnsavedValues = fields.some((field) => field.mode !== "reuse" && field.value.length > 0)
  const hasSaveFailures = fields.some((field) => field.saveState === "failed" && field.value.length > 0)
  const hasNameConflicts = fields.some((field) => field.mode === "name_conflict")

  return {
    fields,
    hasSaveFailures,
    hasNameConflicts,
    hasUnsavedValues,
    loadState,
    notice,
    pendingScanNames,
    replaceSecret,
    reload: () => setReloadVersion((current) => current + 1),
    retryScan,
    reuseSecret,
    save,
    saving,
    setValue,
    toggleVisibility,
  }
}

export { useSkillEnvSecretConfig }
export type {
  SkillEnvSecretConfigField,
  SkillEnvSecretConfigSaveOutcome,
}
