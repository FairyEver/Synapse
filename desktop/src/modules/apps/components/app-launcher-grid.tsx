import type { SynapseSystemAppManifest } from "@/modules/apps/types"

type AppLauncherGridProps = {
  readonly apps: readonly SynapseSystemAppManifest[]
  readonly onOpenApp: (appId: SynapseSystemAppManifest["id"]) => void
}

export function AppLauncherGrid({ apps, onOpenApp }: AppLauncherGridProps) {
  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-x-8 gap-y-10 py-8">
      {apps.map((app) => (
        <button
          key={app.id}
          type="button"
          className="group flex min-h-32 flex-col items-center justify-start gap-3 rounded-lg px-3 py-3 text-center outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => onOpenApp(app.id)}
        >
          <img
            src={app.icon}
            alt=""
            className="size-20 rounded-2xl object-cover"
            draggable={false}
          />
          <span className="text-sm font-medium leading-tight">{app.name}</span>
        </button>
      ))}
    </div>
  )
}
