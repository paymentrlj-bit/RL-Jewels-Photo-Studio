import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Register the Service Worker (showroom offline capability), and make sure a
// new one actually takes over.
//
// A phone kept open on the Shoot screen all day never navigates again, so
// the browser's own "check for a new service worker" - which normally
// happens on navigation - would otherwise not fire until the tab is closed
// and reopened. registration.update() forces that check on a timer instead.
// sw.js itself now changes bytes on every deploy (scripts/stamp-sw.mjs), so
// once this fires it actually finds something new.
//
// The service worker calls skipWaiting()/clients.claim() unconditionally, so
// the moment a new one installs it takes over every open tab - this just
// reloads once that happens, so staff see the update rather than a page that
// silently switched controllers underneath them.
const UPDATE_CHECK_MS = 5 * 60 * 1000;

if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('RL Jewels Service Worker registered:', reg.scope);
        window.setInterval(() => void reg.update().catch(() => undefined), UPDATE_CHECK_MS);
      })
      .catch((err) => {
        console.log('Service Worker registration note:', err);
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
