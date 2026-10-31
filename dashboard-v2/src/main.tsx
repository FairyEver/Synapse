import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/globals.css'

const root = document.getElementById('root')
if (!root) throw new Error('Dashboard V2 root element is missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
