import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from './auth';
import { App } from './App';
import { signInDestination } from './pages/AuthPage';

describe('authentication startup', () => {
  it('retains the requested complaint destination for both restored and explicit sign-in', () => {
    expect(signInDestination({ from: '/complaints/42' })).toBe('/complaints/42');
  });
  it('falls back to the workspace for missing, invalid, or external destinations', () => {
    for (const from of [undefined, 123, 'https://example.com', '//example.com', '/\\example.com'])
      expect(signInDestination({ from })).toBe('/');
    expect(signInDestination(null)).toBe('/');
  });
  for (const path of ['/login', '/register']) {
    it(`renders ${path} before the initial API connection finishes`, () => {
      const html = renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          createElement(
            MemoryRouter,
            { initialEntries: [path] },
            createElement(AuthProvider, { children: createElement(App) }),
          ),
        ),
      );
      expect(html).toContain('name="email"');
      expect(html).toContain('name="password"');
      expect(html).toContain('Checking your existing sign-in');
      expect(html).toContain('role="status"');
      expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
      expect(html).not.toContain('boot-screen');
    });
  }
});
