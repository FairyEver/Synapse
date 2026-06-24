import type { SynapseSystemAppManifest } from "@/modules/apps/types"

type AppLauncherGridProps = {
  readonly apps: readonly SynapseSystemAppManifest[]
  readonly onOpenApp: (appId: SynapseSystemAppManifest["id"]) => void
}

export function AppLauncherGrid({ apps, onOpenApp }: AppLauncherGridProps) {
  return (
    <div
      data-app-launcher-grid
      className="mx-auto grid w-fit grid-cols-2 justify-items-center gap-x-8 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
    >
      {apps.map((app) => (
        <button
          key={app.id}
          type="button"
          className="group flex h-36 w-32 flex-col items-center justify-start rounded-md px-3 py-3 text-center outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-background/60 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
          onClick={() => onOpenApp(app.id)}
        >
          <img
            src={app.icon}
            alt=""
            className="size-22 shrink-0 object-cover transition-transform duration-150 ease-out group-hover:scale-[1.035] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            draggable={false}
          />
          <span className="mt-3 flex min-w-0 flex-1 items-start">
            <span className="block max-w-full truncate text-sm font-medium leading-tight text-foreground">{app.name}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
