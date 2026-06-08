import { Logo } from '@/assets/logo'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className='container grid h-svh max-w-none items-center justify-center'>
      <div className='mx-auto flex w-full flex-col items-center justify-center gap-2 py-8 sm:p-8'>
        <div className='mb-4 flex items-center justify-center'>
          <Logo className='me-2 size-8' />
          <h1 className='text-xl font-medium'>Synapse Dashboard</h1>
        </div>
        {children}
      </div>
    </div>
  )
}
