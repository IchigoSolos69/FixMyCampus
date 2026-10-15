import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthResponse, User } from '@fixmycampus/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  configureSession,
  endSession,
  isActive,
  recordActivity,
  refreshSession,
  setToken,
} from './api';

interface AuthContext {
  user: User | null;
  loading: boolean;
  accept: (data: AuthResponse) => void;
  update: (user: User) => void;
  logout: () => Promise<void>;
}
const Context = createContext<AuthContext>(null!);
export const useAuth = () => useContext(Context);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const client = useQueryClient();
  function clear() {
    setToken('');
    setUser(null);
    client.clear();
  }
  useEffect(() => {
    configureSession(clear);
    let alive = true;
    refreshSession()
      .then((data) => {
        if (alive) setUser(data.user);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    let lastRefresh = Date.now();
    const activity = () => {
      if (!isActive()) {
        clear();
        return;
      }
      recordActivity();
      if (Date.now() - lastRefresh > 60000) {
        lastRefresh = Date.now();
        refreshSession()
          .then((data) => setUser(data.user))
          .catch(clear);
      }
    };
    const timeout = setInterval(() => {
      if (!isActive()) clear();
    }, 15000);
    window.addEventListener('pointerdown', activity);
    window.addEventListener('keydown', activity);
    window.addEventListener('scroll', activity, { passive: true });
    return () => {
      clearInterval(timeout);
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('keydown', activity);
      window.removeEventListener('scroll', activity);
    };
  }, [!!user]);
  const accept = (data: AuthResponse) => {
    setToken(data.accessToken, data.csrfToken);
    recordActivity();
    client.clear();
    setUser(data.user);
  };
  const logout = async () => {
    try {
      await endSession();
    } finally {
      clear();
    }
  };
  return (
    <Context.Provider value={{ user, loading, accept, update: setUser, logout }}>
      {children}
    </Context.Provider>
  );
}
