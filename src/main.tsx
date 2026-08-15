import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DemoProvider } from './hooks/useDemo'
import './styles/global.css'
import './styles/client-site.css'

createRoot(document.getElementById('root')!).render(<StrictMode><DemoProvider><App/></DemoProvider></StrictMode>)
