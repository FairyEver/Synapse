import { Construction } from "lucide-react"
import { requireSynapseBridge } from "@/lib/electron-bridge"

interface DevOverlayProps {
  children: React.ReactNode
  label?: string
}

function DevOverlay({ children, label = "开发中" }: DevOverlayProps) {
  const isPackaged = requireSynapseBridge().isPackaged

  return (
    <div className="relative h-full">
      {children}
      {isPackaged && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2">
            <Construction className="size-8 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{label}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export { DevOverlay }
