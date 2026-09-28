import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/app.css'
import { App } from '@/App'
import { bootstrap } from '@/store/session'
import { registerMath } from '@/ui/math'

registerMath()
void bootstrap()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
