import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import logo from './assets/logo.png'

// Point the favicon at the app logo
const faviconLink = document.querySelector("link[rel~='icon']") || document.createElement('link')
faviconLink.rel = 'icon'
faviconLink.href = logo
document.head.appendChild(faviconLink)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)