import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/source-sans-3/latin-400.css';
import '@fontsource/source-sans-3/latin-500.css';
import '@fontsource/source-sans-3/latin-600.css';
import '@fontsource/source-sans-3/latin-700.css';
import { AuthProvider } from './auth';
import { App } from './App';
import './styles.css';
const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 3000 }, mutations: { retry: false } },
});
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
