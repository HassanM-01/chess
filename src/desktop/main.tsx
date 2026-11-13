import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/app.css';
import '../styles/extra.css';
import './desktop.css';
import { DesktopApp } from './App';
import { installRemoteBridge } from './remote';

document.documentElement.setAttribute('data-theme', 'dark');
// Opened from a phone: talk to the desktop app over the network instead of Electron IPC.
void installRemoteBridge().finally(() => {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <DesktopApp />
    </StrictMode>,
  );
});
