import { Logo } from '@/assets/logo'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className='flex min-h-svh w-full items-start justify-center px-5 py-8 sm:items-center sm:px-8'>
      <div className='mx-auto flex w-full flex-col items-center justify-center gap-6 sm:py-8'>
        <div className='flex items-center justify-center'>
          <Logo className='me-2 size-8' />
          <h1 className='text-xl font-medium'>Synapse</h1>
        </div>
        {children}
      </div>
    </div>
  )
}
