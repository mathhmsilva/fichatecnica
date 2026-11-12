import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Sem internet, o app ainda abre (as telas ficam guardadas; os dados já estão no aparelho).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* sem cache offline: o app funciona normalmente com internet */
    });
  });
}
