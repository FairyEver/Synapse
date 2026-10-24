import { ChevronDown } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import type { AccountSummary } from "../../../app-capabilities/mail/shared/types"

export function MailAccountSelect({ accounts, accountId, onAccount }: { accounts: AccountSummary[]; accountId: string | null; onAccount(id: string): void }) {
  const selected = accounts.find(account => account.id === accountId)
  return <DropdownMenu data-track="mail.account.menu">
    <DropdownMenuTrigger asChild>
      <SystemAppTopBarActionButton aria-label="邮箱账号" className="min-w-0 max-w-64 shrink" disabled={!accounts.length} tooltip={selected?.email} data-track="mail.account.menu">
        <span className="truncate">{selected?.name ?? "选择邮箱"}</span><ChevronDown data-icon="inline-end" />
      </SystemAppTopBarActionButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-max max-w-sm">
      <DropdownMenuRadioGroup value={accountId ?? ""} onValueChange={onAccount}>
        {accounts.map(account => <DropdownMenuRadioItem key={account.id} value={account.id} textValue={account.name} data-track="mail.account.select">
          <span className="min-w-0 break-all">{account.name}{account.name !== account.email && <span className="block text-muted-foreground">{account.email}</span>}</span>
        </DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}
