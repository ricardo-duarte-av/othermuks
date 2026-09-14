import * as Tooltip from '@radix-ui/react-tooltip'
import { useSession } from '@/store/session'
import { BackendScreen } from '@/ui/BackendScreen'
import { Shell } from '@/ui/layout/Shell'
import { ErrorScreen, LoginScreen, Splash } from '@/ui/LoginScreen'

export function App() {
  const phase = useSession(s => s.phase)
  const error = useSession(s => s.error)
  return (
    <Tooltip.Provider delayDuration={400}>
      {phase === 'checking' && <Splash />}
      {phase === 'backend' && <BackendScreen />}
      {phase === 'login' && <LoginScreen />}
      {phase === 'error' && <ErrorScreen error={error} />}
      {phase === 'ready' && <Shell />}
    </Tooltip.Provider>
  )
}
