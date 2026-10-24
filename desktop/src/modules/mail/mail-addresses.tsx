import { useState } from "react"
import { Copy, PenSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Address } from "../../../app-capabilities/mail/shared/types"
import { useCopyMailAddress } from "./use-copy-mail-address"

export function mailDelegates(from: Address[], sender: Address[] = []) {
  const authors = new Set(from.map(value => value.address.toLowerCase()))
  return sender.filter(value => !authors.has(value.address.toLowerCase()))
}

export function MailAddresses({ addresses, showAddress = false, onCompose }: { addresses: Address[]; showAddress?: boolean; onCompose(recipient: Address): void }) {
  const copy = useCopyMailAddress()
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  return <div className="-ml-2 flex min-w-0 flex-wrap items-center gap-1">
    {addresses.map((value, index) => <Popover key={`${value.address}-${index}`} data-track="mail.address" open={openIndex === index} onOpenChange={open => setOpenIndex(open ? index : null)}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="max-w-full" aria-label={`${value.name?.trim() || value.address}，查看邮箱地址`}>
          <span className="truncate">{showAddress ? value.address : value.name?.trim() || value.address}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-w-[calc(100vw-2rem)]">
        {value.name?.trim() && <p className="font-medium [overflow-wrap:anywhere]">{value.name}</p>}
        <div className="flex items-center gap-1">
          <p className="min-w-0 select-text [overflow-wrap:anywhere]">{value.address}</p>
          <Button variant="ghost" size="icon-xs" aria-label="复制邮箱地址" title="复制邮箱地址" onClick={() => void copy(value.address)}><Copy /></Button>
        </div>
        <Button variant="outline" onClick={() => { setOpenIndex(null); onCompose(value) }}><PenSquare />写邮件</Button>
      </PopoverContent>
    </Popover>)}
  </div>
}
