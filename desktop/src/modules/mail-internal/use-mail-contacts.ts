import { useEffect, useState } from "react"
import { mailRequest } from "@/lib/mail-api"
import type { MailContact } from "@/types/mail"
import type { MailBox } from "./use-mail"

export function useMailContacts(box: MailBox, revision: number) {
  const [state, setState] = useState<{ box: MailBox; items: MailContact[]; error: string | null } | null>(null)
  useEffect(() => {
    let active = true
    void mailRequest({ kind: "contactList", box }).then(result => {
      if (active) setState({ box, items: result.items, error: null })
    }).catch((cause: unknown) => {
      if (active) setState(current => ({ box, items: current?.box === box ? current.items : [], error: cause instanceof Error ? cause.message : "人员加载失败。" }))
    })
    return () => { active = false }
  }, [box, revision])
  return { contacts: state?.box === box ? state.items : [], contactsReady: state?.box === box, contactsError: state?.box === box ? state.error : null }
}
