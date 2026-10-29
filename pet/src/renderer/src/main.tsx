import { createRoot } from 'react-dom/client'
import { PetApp } from './pet/App'
import './pet/pet.css'
import './pet/characters/characters.css'
import './pet/extra.css'

const container = document.getElementById('root')
if (!container) throw new Error('missing #root')
createRoot(container).render(<PetApp />)
