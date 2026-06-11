import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import {
  DriveConsoleBrowserPage,
  DriveConsoleRootBrowser,
  type DriveBrowserPageProps,
} from './drive-browser-page'

export function DriveConsolePage() {
  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>网盘</h1>
      </Header>
      <Main fixed fluid>
        <DriveConsoleRootBrowser />
      </Main>
    </>
  )
}

export function DriveConsoleItemPage(
  props: Omit<Extract<DriveBrowserPageProps, { context: 'owner' }>, 'context' | 'surface'>
) {
  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>网盘</h1>
      </Header>
      <Main fixed fluid>
        <DriveConsoleBrowserPage {...props} />
      </Main>
    </>
  )
}
