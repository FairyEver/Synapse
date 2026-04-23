type EmptyScanStateProps = {
  message: string
}

function EmptyScanState({ message }: EmptyScanStateProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

export { EmptyScanState }
