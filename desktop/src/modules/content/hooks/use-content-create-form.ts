import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { isDeepEqual } from "@/lib/deep-equal"

type ContentCreateFormConfig<T> = {
  createEmpty: () => T
  normalize: (payload: T) => T
  validate: (payload: T) => Partial<Record<string, string>>
  errorFallbackMessage: string
}

type ContentCreateFormOptions<T> = {
  initialValue?: T | null
  logContext?: {
    category: string
    contentId?: string | null
    contentType: string
    mode?: "create" | "edit"
  }
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
  const { initialValue = null, logContext, onOpenChange, onSubmit, open } = options
  const logger = useMemo(
    () => logContext ? createRendererLogger(logContext.category) : null,
    [logContext?.category],
  )

  const normalizedValue = normalize(initialValue ?? createEmpty())
  const baselineRef = useRef(normalizedValue)
  if (!isDeepEqual(baselineRef.current, normalizedValue)) {
    baselineRef.current = normalizedValue
  }
  const baseline = baselineRef.current
  const [formSnapshot, setFormSnapshot] = useState<T>(() => baseline)
  const formRef = useRef(formSnapshot)
  const appliedBaselineRef = useRef(baseline)
  if (!isDeepEqual(appliedBaselineRef.current, baseline)) {
    appliedBaselineRef.current = baseline
    formRef.current = baseline
  }
  const form = formRef.current
  const setForm = useCallback<Dispatch<SetStateAction<T>>>((nextValue) => {
    const nextForm = typeof nextValue === "function"
      ? (nextValue as (current: T) => T)(formRef.current)
      : nextValue
    formRef.current = nextForm
    setFormSnapshot(nextForm)
  }, [])
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const previousOpenRef = useRef(open)
  const previousDiscardConfirmOpenRef = useRef(isDiscardConfirmOpen)
  const validationFormRef = useRef<HTMLFormElement | null>(null)

  useEffect(() => {
    setForm(baseline)
    setErrors({})
    setIsSubmitting(false)
    setIsDiscardConfirmOpen(false)
    setSubmitError(null)
  }, [baseline, open, setForm])

  useEffect(() => {
    if (previousOpenRef.current !== open) {
      logger?.info("Content editor dialog visibility changed.", {
        contentId: logContext?.contentId ?? null,
        contentType: logContext?.contentType ?? null,
        mode: logContext?.mode,
        open,
      })
      previousOpenRef.current = open
    }
  }, [logContext?.contentId, logContext?.contentType, logContext?.mode, logger, open])

  useEffect(() => {
    if (previousDiscardConfirmOpenRef.current !== isDiscardConfirmOpen) {
      logger?.info("Content editor discard confirmation visibility changed.", {
        contentId: logContext?.contentId ?? null,
        contentType: logContext?.contentType ?? null,
        mode: logContext?.mode,
        open: isDiscardConfirmOpen,
      })
      previousDiscardConfirmOpenRef.current = isDiscardConfirmOpen
    }
  }, [
    isDiscardConfirmOpen,
    logContext?.contentId,
    logContext?.contentType,
    logContext?.mode,
    logger,
  ])

  useEffect(() => {
    const formElement = validationFormRef.current
    if (!formElement || Object.keys(errors).length === 0) return

    validationFormRef.current = null
    formElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errors])

  const updateField = <K extends keyof T>(field: K, value: T[K]) => {
    const previousValue = formRef.current[field]
    const nextForm = { ...formRef.current, [field]: value }
    setForm(nextForm)
    setSubmitError(null)

    if (
      logger
      && logContext
      && (field === "category" || field === "iconType" || field === "iconBg" || field === "icon")
      && !Object.is(previousValue, value)
    ) {
      logger.info("Content form field changed.", {
        contentId: logContext.contentId ?? null,
        contentType: logContext.contentType,
        field: String(field),
        from: previousValue ?? null,
        mode: logContext.mode,
        to: value,
      })
    }

    if (field === "iconType") {
      setErrors({})
    } else {
      setErrors((currentErrors) => (
        Object.keys(currentErrors).length > 0
          ? validate(nextForm)
          : currentErrors
      ))
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
    logger?.info("Content form changes discarded.", {
      contentId: logContext?.contentId ?? null,
      contentType: logContext?.contentType ?? null,
      mode: logContext?.mode,
    })
    setIsDiscardConfirmOpen(false)
    onOpenChange(false)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>, payloadOverride?: T) => {
    event.preventDefault()
    if (isSubmitting) return

    const formElement = event.currentTarget
    const target = payloadOverride ?? form
    const nextErrors = validate(target)

    if (Object.keys(nextErrors).length > 0) {
      logger?.warn("Content form validation failed.", {
        contentId: logContext?.contentId ?? null,
        contentType: logContext?.contentType ?? null,
        fields: Object.keys(nextErrors),
        mode: logContext?.mode,
      })
      validationFormRef.current = event.currentTarget
      setErrors(nextErrors)
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      await onSubmit(normalize(target))
      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : errorFallbackMessage
      const field = error instanceof Error && "field" in error && typeof error.field === "string"
        ? error.field
        : null
      if (field) {
        validationFormRef.current = formElement
        setErrors({ [field]: message })
        setSubmitError(null)
      } else {
        setSubmitError(message)
      }
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
