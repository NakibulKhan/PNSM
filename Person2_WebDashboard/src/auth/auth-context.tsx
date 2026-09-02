/**
 * Global authentication state.
 *
 * Server state (employees, attendance, KPIs) is owned by TanStack Query.
 * This context owns only the identity of the signed-in administrator, which is
 * genuinely global, rarely changes, and is needed by the router guards, the
 * navigation and every RBAC check.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { setSessionExpiredHandler } from '@/api/http';
import { bootstrapSession, login as performLogin, logout as performLogout } from './session';
import type { SessionUser } from '@/types/models';

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'authenticated'; user: SessionUser }
  | { status: 'anonymous'; user: null };

type AuthAction =
  | { type: 'RESOLVED'; user: SessionUser }
  | { type: 'CLEARED' };

function reducer(_state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'RESOLVED':
      return { status: 'authenticated', user: action.user };
    case 'CLEARED':
      return { status: 'anonymous', user: null };
    default:
      return _state;
  }
}

interface AuthContextValue {
  status: AuthState['status'];
  user: SessionUser | null;
  signIn: (email: string, password: string) => Promise<SessionUser>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { status: 'loading', user: null } as AuthState);
  const navigate = useNavigate();

  // Silent refresh on boot — recovers the session the memory-only token lost.
  useEffect(() => {
    let cancelled = false;
    bootstrapSession().then((user) => {
      if (cancelled) return;
      dispatch(user ? { type: 'RESOLVED', user } : { type: 'CLEARED' });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * When the refresh token itself expires, the Axios layer gives up. It has no
   * access to the router, so it calls this handler instead — keeping the
   * transport layer free of navigation concerns.
   */
  useEffect(() => {
    setSessionExpiredHandler(() => {
      dispatch({ type: 'CLEARED' });
      navigate('/login', { replace: true, state: { reason: 'expired' } });
    });
    return () => setSessionExpiredHandler(null);
  }, [navigate]);

  const signIn = useCallback(async (email: string, password: string) => {
    const user = await performLogin(email, password);
    dispatch({ type: 'RESOLVED', user });
    return user;
  }, []);

  const signOut = useCallback(async () => {
    await performLogout();
    dispatch({ type: 'CLEARED' });
    navigate('/login', { replace: true });
  }, [navigate]);

  const value = useMemo<AuthContextValue>(
    () => ({ status: state.status, user: state.user, signIn, signOut }),
    [state.status, state.user, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth was called outside AuthProvider.');
  return context;
}

/** The signed-in user, or null. Named for the components carried over from v1. */
export function useSession(): SessionUser | null {
  return useContext(AuthContext)?.user ?? null;
}
