import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import App from './app';
import { fetchCsrfToken } from './utils/csrf';

// Test backend connection in development
if (import.meta.env.DEV) {
  import('./utils/testConnection');
}

// Fetch CSRF token before rendering app
fetchCsrfToken().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
