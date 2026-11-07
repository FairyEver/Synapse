import type { CustomAppDto } from "@synapse/shared"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type DeleteCustomAppDialogProps = {
  readonly app: CustomAppDto | null
  readonly onClose: () => void
  readonly onConfirm: (app: CustomAppDto) => Promise<void>
}

export function DeleteCustomAppDialog({ app, onClose, onConfirm }: DeleteCustomAppDialogProps) {
  return (
    <AlertDialog open={Boolean(app)} onOpenChange={(open) => { if (!open) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除应用</AlertDialogTitle>
          <AlertDialogDescription>删除“{app?.name}”</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={() => { if (app) void onConfirm(app) }}>删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
