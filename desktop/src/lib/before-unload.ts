export function holdBeforeUnloadForCustomDialog(event: BeforeUnloadEvent): void {
  event.returnValue = false
}
