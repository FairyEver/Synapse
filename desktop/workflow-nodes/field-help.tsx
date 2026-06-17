import { CircleHelp } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

export type FieldHelpContent = {
  title: string
  summary: string
  happens?: string
  risk?: string
  impact?: string
  note?: string
}

export function LabelWithHelp({
  id,
  label,
  help,
}: {
  readonly id?: string
  readonly label: string
  readonly help?: FieldHelpContent
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {help ? <FieldHelp help={help} /> : null}
    </div>
  )
}

export function FieldHelp({ help }: { readonly help: FieldHelpContent }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-4 w-4 text-muted-foreground hover:text-foreground"
          aria-label={`查看${help.title}说明`}
        >
          <CircleHelp className="size-3" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{help.title}</DialogTitle>
          <DialogDescription>{help.summary}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-sm">
          {help.happens ? <FieldHelpLine label="会发生什么" text={help.happens} /> : null}
          {help.impact ? <FieldHelpLine label="影响" text={help.impact} /> : null}
          {help.risk ? <FieldHelpLine label="风险" text={help.risk} /> : null}
          {help.note ? <FieldHelpLine label="注意" text={help.note} /> : null}
        </div>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

function FieldHelpLine({ label, text }: { readonly label: string; readonly text: string }) {
  return (
    <div className="flex gap-2">
      <div className="w-16 shrink-0 text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1 text-xs leading-relaxed">{text}</div>
    </div>
  )
}
