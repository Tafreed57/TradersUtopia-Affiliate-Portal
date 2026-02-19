'use client';

/**
 * useSession Hook
 *
 * Manages user session state and provides authentication utilities.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  gs,
  getStoredToken,
  setStoredToken,
  clearStoredToken,
} from '@/lib/client/gs-compat';

export interface SessionUser {
  email: string;
  displayEmail: string;
  name: string;
  isTeacher: boolean;
  isAdmin: boolean;
  isSupervisor?: boolean;
}

export interface UseSessionResult {
  user: SessionUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useSession(): UseSessionResult {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Validate session on mount
  const validateSession = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const result = await gs.validateSessionToken(token);
      if (result.valid && result.user) {
        setUser(result.user);
      } else {
        clearStoredToken();
        setUser(null);
      }
    } catch (error) {
      console.error('Session validation error:', error);
      clearStoredToken();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    validateSession();
  }, [validateSession]);

  // Login function
  const login = useCallback(async (email: string, password: string) => {
    try {
      const result = await gs.loginAndCreateSession(email, password);

      if (result.success && result.token) {
        setStoredToken(result.token);
        await validateSession();
        return { success: true };
      }

      return { success: false, error: result.error || 'Login failed' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      return { success: false, error: message };
    }
  }, [validateSession]);

  // Logout function
  const logout = useCallback(async () => {
    const token = getStoredToken();
    if (token) {
      try {
        await gs.logoutSession(token);
      } catch (error) {
        console.error('Logout error:', error);
      }
    }
    clearStoredToken();
    setUser(null);
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
    refresh: validateSession,
  };
}

export default useSession;
