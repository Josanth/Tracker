import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler, TOKEN_STORAGE_KEY } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  const logoutLocal = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logoutLocal);
    if (getToken()) {
      api('/me')
        .then((d) => setUser(d.user))
        .catch(() => logoutLocal())
        .finally(() => setLoading(false));
    }
    // Keep login state consistent across tabs.
    const onStorage = (e) => {
      if (e.key !== TOKEN_STORAGE_KEY) return;
      if (!e.newValue) setUser(null);
      else api('/me').then((d) => setUser(d.user)).catch(() => {});
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [logoutLocal]);

  const login = (token, u) => {
    setToken(token);
    setUser(u);
  };
  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* already logged out server-side */
    }
    logoutLocal();
  };

  return <AuthContext.Provider value={{ user, setUser, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
