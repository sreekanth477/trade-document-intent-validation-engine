import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  ReactNode,
  createElement,
} from 'react';
import { login as apiLogin } from '../api/client';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredAuth(): { user: User | null; token: string | null } {
  try {
    const token = localStorage.getItem('auth_token');
    const userRaw = localStorage.getItem('auth_user');
    if (token && userRaw) {
      const user = JSON.parse(userRaw) as User;
      return { user, token };
    }
  } catch {
    // corrupted storage — clear it
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
  }
  return { user: null, token: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = loadStoredAuth();

  const [state, setState] = useState<AuthState>({
    user: stored.user,
    token: stored.token,
    isAuthenticated: stored.user !== null && stored.token !== null,
    isLoading: false,
  });

  // Re-verify token hasn't been cleared elsewhere (e.g. 401 interceptor)
  useEffect(() => {
    const handleStorageChange = () => {
      const { user, token } = loadStoredAuth();
      setState((prev) => ({
        ...prev,
        user,
        token,
        isAuthenticated: user !== null && token !== null,
      }));
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const { token, user } = await apiLogin(email, password);
      localStorage.setItem('auth_token', token);
      localStorage.setItem('auth_user', JSON.stringify(user));
      setState({ user, token, isAuthenticated: true, isLoading: false });
    } catch (err) {
      setState((prev) => ({ ...prev, isLoading: false }));
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setState({ user: null, token: null, isAuthenticated: false, isLoading: false });
  }, []);

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
  };

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export { AuthContext };
