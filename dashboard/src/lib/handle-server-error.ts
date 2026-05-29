import { toast } from 'sonner'

export function handleServerError(error: unknown) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(error)
  }

  let errMsg = 'Something went wrong!'

  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    Number(error.status) === 204
  ) {
    errMsg = 'No content.'
  }

  if (isResponseError(error)) {
    errMsg = error.response.data.title
  }

  toast.error(errMsg)
}

function isResponseError(
  error: unknown
): error is { response: { data: { title: string } } } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'data' in error.response &&
    typeof error.response.data === 'object' &&
    error.response.data !== null &&
    'title' in error.response.data &&
    typeof error.response.data.title === 'string' &&
    error.response.data.title.length > 0
  )
}
