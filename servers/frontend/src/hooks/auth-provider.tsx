
"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "./use-auth-store";

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [isHydrated, setIsHydrated] = useState(false);
  const { initializeAuth } = useAuthStore();

  useEffect(() => {
    // This effect ensures that the auth state is initialized on the client,
    // after the initial render.
    const init = async () => {
      await initializeAuth();
      setIsHydrated(true);
    };
    init();
  }, [initializeAuth]);

  if (!isHydrated) {
    // You can render a loading spinner here if you want
    return null; 
  }

  return <>{children}</>;
};

    