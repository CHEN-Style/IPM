// H2 (audit U3): single source of truth for auth state in the renderer.
//
// `App.jsx` loads `auth/getStatus` once at startup and provides the result
// here. Components consume `useAuth()` instead of each calling getStatus
// themselves (legacy components migrate opportunistically in later phases).

import React, { createContext, useContext } from 'react';

const AuthContext = createContext({
  loggedIn: false,
  offline: false,
  user: null,
  orgRole: null,
  refresh: async () => {},
});

export const AuthProvider = AuthContext.Provider;

export function useAuth() {
  return useContext(AuthContext);
}

export function buildAuthValue(authStatus, refresh) {
  return {
    loggedIn: Boolean(authStatus?.loggedIn),
    offline: Boolean(authStatus?.offline),
    user: authStatus?.user || null,
    orgRole: authStatus?.user?.orgRole || null,
    refresh: refresh || (async () => {}),
  };
}
