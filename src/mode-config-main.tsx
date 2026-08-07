import React from 'react'
import ReactDOM from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './index.css'
import ModeConfigWorkbench from './components/ModeConfigWorkbench'

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <ModeConfigWorkbench />
  </React.StrictMode>,
)
