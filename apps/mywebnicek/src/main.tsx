import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { DenicekProvider } from '@mydenicek/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { initializeDocument } from './initializeDocument.ts';

const PEER_ID_STORAGE_KEY = "mydenicek-peer-id";

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
      <DenicekProvider peerId={peerId} initializer={initializeDocument}>
        <App />
      </DenicekProvider>
    </FluentProvider>
  </StrictMode>
);
