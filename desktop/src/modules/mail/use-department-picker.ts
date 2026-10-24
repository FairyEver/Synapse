import { useEffect, useRef, useState } from "react"
import { mailRequest } from "@/lib/mail-api"
import type { MailOrganization } from "@/types/mail"
import { mailError } from "./api"
import { resolveDepartment, type DepartmentMember } from "./department-recipients"

export function useDepartmentPicker() {
  const [query, setQuery] = useState(""), [items, setItems] = useState<MailOrganization[]>([])
  const [selected, setSelected] = useState<MailOrganization | null>(null), [members, setMembers] = useState<DepartmentMember[] | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0)
  const [excludeMissing, setExcludeMissing] = useState(false)
  const generation = useRef(0)
  useEffect(() => {
    const id = ++generation.current
    setLoading(true); setError(null); setItems([]); setMembers(null); setExcludeMissing(false)
    const current = () => generation.current === id
    const timer = setTimeout(() => {
      const task = selected ? resolveDepartment(selected.organizationId, current).then(result => { if (current()) setMembers(result) }) : mailRequest({ kind: "organizationSearch", query }).then(result => { if (current()) setItems(result.items) })
      void task.catch(cause => { if (current()) setError(mailError(cause)) }).finally(() => { if (current()) setLoading(false) })
    }, selected ? 0 : 250)
    return () => { clearTimeout(timer); generation.current++ }
  }, [query, selected, retry])
  const search = (value: string) => { generation.current++; setQuery(value); setItems([]); setLoading(true); setError(null) }
  const select = (value: MailOrganization | null) => { generation.current++; setSelected(value); setMembers(null); setExcludeMissing(false); setLoading(true); setError(null) }
  const missing = members?.filter(member => !member.address) ?? []
  return { query, search, items, selected, select, members, loading, error, setError, retry: () => setRetry(value => value + 1), missing, excludeMissing, setExcludeMissing }
}
