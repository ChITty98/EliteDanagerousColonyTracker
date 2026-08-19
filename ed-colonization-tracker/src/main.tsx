import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { TokenGate } from './app/TokenGate';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TokenGate>
      <App />
    </TokenGate>
  </StrictMode>
);
