
'use client';
// This file is no longer used for the local authentication system,
// but is kept to avoid breaking imports in other Firebase-related files
// that are not part of the authentication flow.

export const useUser = () => {
  return {
    user: null,
    loading: true,
    error: null,
    idToken: null
  };
};
