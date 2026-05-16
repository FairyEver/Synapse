import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="p-8 text-foreground">auto web — scaffold ok</div>
  </StrictMode>,
)
