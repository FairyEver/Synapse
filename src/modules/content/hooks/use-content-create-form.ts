import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react"
import { isDeepEqual } from "@/lib/deep-equal"

type ContentCreateFormConfig<T> = {
  createEmpty: () => T
  normalize: (payload: T) => T
  validate: (payload: T) => Partial<Record<string, string>>
  errorFallbackMessage: string
}

type ContentCreateFormOptions<T> = {
  initialValue?: T | null
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: T) => Promise<void> | void
  open: boolean
}

type ContentCreateFormReturn<T> = {
  baseline: T
  errors: Partial<Record<string, string>>
  form: T
  handleDialogOpenChange: (nextOpen: boolean) => void
  handleDiscard: () => void
  handleSubmit: (event: React.FormEvent<HTMLFormElement>, payloadOverride?: T) => void
  isDiscardConfirmOpen: boolean
  isSubmitting: boolean
  setErrors: Dispatch<SetStateAction<Partial<Record<string, string>>>>
  setForm: Dispatch<SetStateAction<T>>
  setIsDiscardConfirmOpen: Dispatch<SetStateAction<boolean>>
  submitError: string | null
  updateField: <K extends keyof T>(field: K, value: T[K]) => void
}

function useContentCreateForm<T extends Record<string, unknown>>(
  config: ContentCreateFormConfig<T>,
  options: ContentCreateFormOptions<T>,
): ContentCreateFormReturn<T> {
  const { createEmpty, normalize, validate, errorFallbackMessage } = config
  const { initialValue = null, onOpenChange, onSubmit, open } = options

  const baseline = useMemo(
    () => normalize(initialValue ?? createEmpty()),
    [initialValue],
  )
  const [form, setForm] = useState<T>(() => baseline)
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    setForm(baseline)
    setErrors({})
    setIsSubmitting(false)
    setIsDiscardConfirmOpen(false)
    setSubmitError(null)
  }, [baseline, open])

  const updateField = <K extends keyof T>(field: K, value: T[K]) => {
    const nextForm = { ...form, [field]: value }
    setForm(nextForm)
    setSubmitError(null)

    if (field === "iconType") {
      setErrors({})
    } else if (Object.keys(errors).length > 0) {
      setErrors(validate(nextForm))
    }
  }

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true)
      return
    }

    if (isSubmitting) {
      return
    }

    if (!isDeepEqual(normalize(form), baseline)) {
      setIsDiscardConfirmOpen(true)
      return
    }

    onOpenChange(false)
  }

  const handleDiscard = () => {
    setIsDiscardConfirmOpen(false)
    onOpenChange(false)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>, payloadOverride?: T) => {
    event.preventDefault()

    const target = payloadOverride ?? form
    const nextErrors = validate(target)

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      await onSubmit(normalize(target))
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : errorFallbackMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  return {
    baseline,
    errors,
    form,
    handleDialogOpenChange,
    handleDiscard,
    handleSubmit,
    isDiscardConfirmOpen,
    isSubmitting,
    setErrors,
    setForm,
    setIsDiscardConfirmOpen,
    submitError,
    updateField,
  }
}

export { useContentCreateForm }
export type { ContentCreateFormConfig }
