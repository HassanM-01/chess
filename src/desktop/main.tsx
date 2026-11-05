import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/app.css';
import '../styles/extra.css';
import './desktop.css';
import { DesktopApp } from './App';

document.documentElement.setAttribute('data-theme', 'dark');
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <DesktopApp />
  </StrictMode>,
);
