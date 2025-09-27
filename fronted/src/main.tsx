import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './pages/App'
import './styles/global.scss'
import { MessagesProvider } from '@/api/contexts/MessagesContext'

const root = document.getElementById('root')!
createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <MessagesProvider>
        <App />
      </MessagesProvider>
    </BrowserRouter>
  </React.StrictMode>
)
