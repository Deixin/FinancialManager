import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopEntry } from './entry.js';
import './entry.css';
import { cssVariables } from '@financial-manager/design-tokens';
for (const [name, value] of Object.entries(cssVariables))
  document.documentElement.style.setProperty(name, value);

const root = document.getElementById('root');
if (!root) throw new Error('DESKTOP_ROOT_UNAVAILABLE');
createRoot(root).render(
  <StrictMode>
    <DesktopEntry />
  </StrictMode>,
);
