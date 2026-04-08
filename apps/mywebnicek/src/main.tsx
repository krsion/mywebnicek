import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { DenicekProvider } from '@mydenicek/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';

// LocalStorage key for persisting peer ID across sessions
const PEER_ID_STORAGE_KEY = "mydenicek-peer-id";

/**
 * Get or generate a persistent peer ID.
 * This ensures the same user keeps the same peer ID across page refreshes,
 * which is essential for consistent peer identification in CRDT operations.
 */
function getOrCreatePeerId(): string {
  const stored = localStorage.getItem(PEER_ID_STORAGE_KEY);
  if (stored) return stored;

  const newPeerId = crypto.randomUUID();
  localStorage.setItem(PEER_ID_STORAGE_KEY, newPeerId);
  return newPeerId;
}

const peerId = getOrCreatePeerId();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FluentProvider theme={webLightTheme}>
      <DenicekProvider peerId={peerId}>
        <App />
      </DenicekProvider>
    </FluentProvider>
  </StrictMode>
);
