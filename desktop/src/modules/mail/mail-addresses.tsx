import { Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Address } from "../../../app-capabilities/mail/shared/types"
import { useCopyMailAddress } from "./use-copy-mail-address"

export function mailDelegates(from: Address[], sender: Address[] = []) {
  const authors = new Set(from.map(value => value.address.toLowerCase()))
  return sender.filter(value => !authors.has(value.address.toLowerCase()))
}

export function MailAddresses({ addresses, showAddress = false }: { addresses: Address[]; showAddress?: boolean }) {
  const copy = useCopyMailAddress()
  return <div className="-ml-2 flex min-w-0 flex-wrap items-center gap-1">
    {addresses.map((value, index) => <Popover key={`${value.address}-${index}`} data-track="mail.address">
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="max-w-full" aria-label={`${value.name?.trim() || value.address}，查看邮箱地址`}>
          <span className="truncate">{showAddress ? value.address : value.name?.trim() || value.address}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-w-[calc(100vw-2rem)]">
        {value.name?.trim() && <p className="font-medium [overflow-wrap:anywhere]">{value.name}</p>}
        <p className="select-text [overflow-wrap:anywhere]">{value.address}</p>
        <Button variant="outline" onClick={() => void copy(value.address)}><Copy />复制邮箱地址</Button>
      </PopoverContent>
    </Popover>)}
  </div>
}
