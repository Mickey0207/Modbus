import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { BrowserRouter } from 'react-router-dom'
import './styles/global.scss'
import { ConfigProvider, theme } from 'antd'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: [theme.compactAlgorithm],
        token: {
          colorPrimary: '#5865F2',
          borderRadius: 8,
          fontSize: 14,
        },
        components: {
          Button: { controlHeight: 36, fontSize: 14 },
          Input: { controlHeight: 36, fontSize: 14 },
          Select: { controlHeight: 36, fontSize: 14 },
          Table: { cellPaddingBlock: 10, padding: 10 },
        }
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>,
)
