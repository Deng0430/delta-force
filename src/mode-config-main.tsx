import React from 'react'
import ReactDOM from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './index.css'
import './styles/mode-config-v2.css'
import './styles/mobile.css'
import ModeConfigWorkbench from './components/ModeConfigWorkbench'

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <ModeConfigWorkbench />
  </React.StrictMode>,
)
