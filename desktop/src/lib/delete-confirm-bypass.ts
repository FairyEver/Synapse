type DeleteConfirmBypassEvent = Pick<MouseEvent, "altKey">

function shouldBypassDeleteConfirm(event: DeleteConfirmBypassEvent): boolean {
  return event.altKey
}

export { shouldBypassDeleteConfirm }
