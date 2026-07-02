'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot='dialog' {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot='dialog-trigger' {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot='dialog-portal' {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot='dialog-close' {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot='dialog-overlay'
      className={cn(
        'fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal data-slot='dialog-portal'>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot='dialog-content'
        className={cn(
          'fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg',
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot='dialog-close'
            className="absolute inset-e-4 top-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className='sr-only'>Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='dialog-header'
      className={cn('flex flex-col gap-2 text-center sm:text-start', className)}
      {...props}
    />
  )
}

function DialogFrame({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='dialog-frame'
      className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}
      {...props}
    />
  )
}

function DialogFrameHeader({
  actions,
  bordered = false,
  center,
  children,
  className,
  description,
  descriptionClassName,
  showCloseButton = true,
  title,
  titleClassName,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  readonly actions?: React.ReactNode
  readonly bordered?: boolean
  readonly center?: React.ReactNode
  readonly description?: React.ReactNode
  readonly descriptionClassName?: string
  readonly showCloseButton?: boolean
  readonly title?: React.ReactNode
  readonly titleClassName?: string
}) {
  const titleBlock = title || description ? (
    <div className='min-w-0'>
      {title ? <DialogTitle className={cn('truncate', titleClassName)}>{title}</DialogTitle> : null}
      {description ? <DialogDescription className={cn('mt-2 truncate', descriptionClassName)}>{description}</DialogDescription> : null}
    </div>
  ) : null
  const rightBlock = actions || showCloseButton ? (
    <div className='flex min-w-0 flex-wrap items-center justify-end gap-2'>
      {actions}
      {showCloseButton ? (
        <DialogClose asChild>
          <Button type='button' variant='ghost' size='icon' className='size-8'>
            <XIcon />
            <span className='sr-only'>关闭</span>
          </Button>
        </DialogClose>
      ) : null}
    </div>
  ) : null

  return (
    <div
      data-slot='dialog-frame-header'
      className={cn(
        'shrink-0 px-5 py-4',
        bordered && 'border-b',
        center && 'grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3',
        className
      )}
      {...props}
    >
      {center ? (
        <>
          {titleBlock ?? <div />}
          <div className='min-w-0'>{center}</div>
          {rightBlock ?? <div />}
          {children ? <div className='col-span-full'>{children}</div> : null}
        </>
      ) : (
        <>
          <div className='flex min-w-0 items-start justify-between gap-3'>
            {titleBlock}
            {rightBlock}
          </div>
          {children}
        </>
      )}
    </div>
  )
}

function DialogFrameBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='dialog-frame-body'
      className={cn('min-h-0 flex-1', className)}
      {...props}
    />
  )
}

function DialogFrameFooter({
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<'div'> & {
  readonly showCloseButton?: boolean
}) {
  return (
    <div
      data-slot='dialog-frame-footer'
      className={cn(
        'mx-0 mb-0 shrink-0 flex flex-col-reverse gap-2 rounded-none rounded-b-lg border-t bg-muted/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-end',
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton ? (
        <DialogClose asChild>
          <Button type='button' variant='outline'>关闭</Button>
        </DialogClose>
      ) : null}
    </div>
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='dialog-footer'
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot='dialog-title'
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot='dialog-description'
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogFrame,
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
