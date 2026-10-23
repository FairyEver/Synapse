import { useEffect, useState } from "react"
import type { Draft, MailAsset } from "../../../app-capabilities/mail/shared/types"
import { mailApi, mailError } from "./api"
export function useComposeAssets(draft: Draft | null) {
  const [assets, setAssets] = useState<MailAsset[]>([]), [error, setError] = useState<string | null>(null)
  const ids = draft?.assetIds.join(",")
  useEffect(() => {
    let active = true; setAssets([]); setError(null)
    if (draft) void (async () => {
      const result = []
      for (const assetId of draft.assetIds) { result.push(await mailApi().attachmentGet({ assetId })); if (!active) return }
      if (active) setAssets(result)
    })().catch(cause => { if (active) setError(mailError(cause)) })
    return () => { active = false }
  }, [draft?.id, ids])
  return { assets, error }
}
