import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  useEffect(() => {
    let mounted = true;

    // Safety timeout - if auth check hangs, stop loading after 3s
    const timeout = setTimeout(() => {
      if (mounted) setIsLoadingAuth(false);
    }, 3000);

    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!mounted) return;

        if (session?.user) {
          const { data: profile, error } = await supabase
            .from('users')
            .select('*')
            .eq('auth_id', session.user.id)
            .single();

          if (!mounted) return;

          if (profile && !error) {
            setUser(profile);
            setIsAuthenticated(true);
          } else {
            setAuthError({ type: 'user_not_registered', message: 'User not registered' });
          }
        }
      } catch (err) {
        console.error('Auth init error:', err);
        if (mounted) {
          setAuthError({ type: 'unknown', message: err.message });
        }
      } finally {
        if (mounted) {
          setIsLoadingAuth(false);
        }
      }
    };

    init();

    // Listen for auth changes (login/logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('auth_id', session.user.id)
            .single();

          if (mounted && profile) {
            setUser(profile);
            setIsAuthenticated(true);
            setIsLoadingAuth(false);
          }
        } else if (event === 'SIGNED_OUT') {
          if (mounted) {
            setUser(null);
            setIsAuthenticated(false);
          }
        }
      }
    );

    return () => {
      mounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const logout = async (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    await supabase.auth.signOut();
  };

  const navigateToLogin = () => {
    // kept for backwards compat, but Navigate component is preferred
    window.location.href = `/login`;
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      logout,
      navigateToLogin,
      checkAppState: () => {},
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
