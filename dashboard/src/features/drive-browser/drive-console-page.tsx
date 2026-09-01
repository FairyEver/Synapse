import type { DriveBrowserSurface } from '@synapse/shared'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import {
  DriveBrowserPage,
  DriveConsoleBrowserPage,
  DriveConsoleRootBrowser,
  type DriveBrowserPageProps,
} from './drive-browser-page'
import { DriveTelemetryBoundary } from './shared/drive-telemetry-boundary'

export function DriveConsolePage() {
  return (
    <DriveTelemetryBoundary scope='console'>
      <Header fixed>
        <h1 className='text-lg font-semibold'>网盘</h1>
      </Header>
      <Main fixed fluid>
        <DriveConsoleRootBrowser />
      </Main>
    </DriveTelemetryBoundary>
  )
}

export function DriveConsoleItemPage(
  props: Omit<Extract<DriveBrowserPageProps, { context: 'owner' }>, 'context' | 'surface'> & {
    readonly surface?: DriveBrowserSurface
  }
) {
  const { surface = 'console', ...browserProps } = props
  if (surface === 'standalone') {
    return <DriveBrowserPage {...browserProps} context='owner' surface='standalone' />
  }

  return (
    <DriveTelemetryBoundary scope='console'>
      <Header fixed>
        <h1 className='text-lg font-semibold'>网盘</h1>
      </Header>
      <Main fixed fluid>
        <DriveConsoleBrowserPage {...browserProps} />
      </Main>
    </DriveTelemetryBoundary>
  )
}
