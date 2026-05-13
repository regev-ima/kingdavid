import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
  import('@/api/base44Client').then(({ base44 }) => {
    window.base44 = base44;
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
