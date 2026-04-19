import { useEffect, useRef, useState } from "react"
import { useCurrentRepoProfile, useLocalIdentity } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { readRepoProfileState, updateRepoDisplayName } from "@/app-shell/user-profile"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SynapseRepoProfileState } from "@/types/identity"

type RepositoryDisplayNameFieldProps = {
  repositoryUuid: string
  isActiveRepository: boolean
  disabled?: boolean
}

const logger = createRendererLogger("settings.repositories.display-name")

function getDisplayNameFromState(state: SynapseRepoProfileState | null): string {
  if (!state) {
    return ""
  }

  if (state.status === "ready") {
    return state.profile.displayName
  }

  return ""
}

function RepositoryDisplayNameField({
  repositoryUuid,
  isActiveRepository,
  disabled,
}: RepositoryDisplayNameFieldProps) {
  const { localIdentityState } = useLocalIdentity()
  const { refreshRepoProfileState } = useCurrentRepoProfile()
  const [profileState, setProfileState] = useState<SynapseRepoProfileState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const lastSavedRef = useRef("")
  const saveTimerRef = useRef<number | null>(null)
  const isLocalIdentityReady = localIdentityState?.status === "ready"
  const inputId = `repository-display-name-${repositoryUuid}`

  useEffect(() => {
    if (!isLocalIdentityReady) {
      setProfileState(null)
      setIsLoading(false)
      return
    }

    let isCancelled = false

    setIsLoading(true)
    setLoadError(null)

    readRepoProfileState(repositoryUuid)
      .then((nextState) => {
        if (isCancelled) {
          return
        }

        setProfileState(nextState)
        const nextDisplayName = getDisplayNameFromState(nextState)
        setDraft(nextDisplayName)
        lastSavedRef.current = nextDisplayName
        setSaveState("idle")
        setSaveError(null)
      })
      .catch((readError: unknown) => {
        if (isCancelled) {
          return
        }

        logger.error("Failed to read repo profile state for settings card.", {
          error: readError,
          repositoryUuid,
        })
        setLoadError(readError instanceof Error ? readError.message : "读取仓库显示名失败。")
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [isLocalIdentityReady, repositoryUuid])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const saveDraft = () => {
    const nextDisplayName = draft.trim()

    if (!nextDisplayName) {
      setSaveError("显示名称不能为空。")
      return
    }

    if (nextDisplayName === lastSavedRef.current) {
      return
    }

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }

    setSaveState("saving")
    setSaveError(null)

    saveTimerRef.current = window.setTimeout(() => {
      updateRepoDisplayName(repositoryUuid, nextDisplayName)
        .then(async (nextProfile) => {
          lastSavedRef.current = nextProfile.displayName
          setDraft(nextProfile.displayName)
          setProfileState({ status: "ready", profile: nextProfile })
          setSaveState("saved")

          if (isActiveRepository) {
            await refreshRepoProfileState()
          }
        })
        .catch((saveErrorValue: unknown) => {
          logger.error("Failed to save repo display name from settings card.", {
            error: saveErrorValue,
            repositoryUuid,
          })
          setSaveError(
            saveErrorValue instanceof Error ? saveErrorValue.message : "保存显示名称失败。",
          )
          setSaveState("idle")
        })
        .finally(() => {
          saveTimerRef.current = null
        })
    }, 800)
  }

  const isFieldDisabled = disabled || isLoading || !isLocalIdentityReady || loadError !== null
  const needsOnboarding = profileState?.status === "needs-onboarding"

  let hint: string | null = null
  if (saveError) {
    hint = null
  } else if (loadError) {
    hint = null
  } else if (isLoading) {
    hint = "正在读取..."
  } else if (saveState === "saving") {
    hint = "正在保存..."
  } else if (saveState === "saved") {
    hint = "已保存。"
  } else if (needsOnboarding) {
    hint = "尚未在这个目录里设置显示名。"
  } else {
    hint = "失焦后自动保存。"
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId}>显示名称</Label>
      <Input
        id={inputId}
        value={draft}
        disabled={isFieldDisabled}
        aria-invalid={saveError || loadError ? true : undefined}
        placeholder={needsOnboarding ? "输入在这个目录里的显示名" : ""}
        onFocus={() => {
          if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
          }
        }}
        onBlur={saveDraft}
        onChange={(event) => {
          setDraft(event.target.value)
          setSaveError(null)
          setSaveState("idle")
        }}
      />
      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : saveError ? (
        <p className="text-sm text-destructive">{saveError}</p>
      ) : hint ? (
        <p className="text-sm text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

export { RepositoryDisplayNameField }
