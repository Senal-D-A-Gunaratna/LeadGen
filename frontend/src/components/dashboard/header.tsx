
"use client";

import { LeadGenLogo } from "@/components/icons";
import { Wifi, WifiOff, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { wsClient } from "@/lib/websocket-client";
import { Button } from "@/components/ui/button";
import { CreditsDialog } from "./credits-dialog";
import { Authentication } from "./authentication";
import { Badge } from "../ui/badge";

export function Header() {
  const [isOnline, setIsOnline] = useState(true);
  const [theme, setTheme] = useState("dark");
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    // Prefer WebSocket connection state for "Live Sync" indicator
    const initial = typeof navigator !== 'undefined' ? navigator.onLine : true;
    setIsOnline(wsClient.isConnected() ?? initial);

    const handler = (connected: boolean) => setIsOnline(connected);
    wsClient.on('connection', handler);

    // Ensure websocket client attempts to connect
    try {
      wsClient.connect();
    } catch (e) {
      // ignore
    }

    // Theme handling
    // If user previously saved a theme in localStorage, respect it.
    // Otherwise, auto-detect via `prefers-color-scheme` and listen for changes.
    const savedTheme = localStorage.getItem("theme");
    const prefersDark = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialTheme = savedTheme ?? (prefersDark ? "dark" : "light");
    setTheme(initialTheme);
    document.documentElement.classList.toggle("dark", initialTheme === "dark");

    // If no explicit saved theme, listen to system changes and update theme automatically.
    let mq: MediaQueryList | null = null;
    const mqHandler = (e: MediaQueryListEvent) => {
      // Only auto-update when user hasn't chosen a theme
      if (localStorage.getItem("theme") === null) {
        const newTheme = e.matches ? "dark" : "light";
        setTheme(newTheme);
        document.documentElement.classList.toggle("dark", newTheme === "dark");
      }
    };
    if (typeof window !== "undefined" && window.matchMedia) {
      mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) {
        mq.addEventListener("change", mqHandler as EventListener);
      } else if ((mq as any).addListener) {
        // Safari
        (mq as any).addListener(mqHandler);
      }
    }


    return () => {
      wsClient.off('connection', handler);
      if (mq) {
        if (mq.removeEventListener) {
          mq.removeEventListener("change", mqHandler as EventListener);
        } else if ((mq as any).removeListener) {
          (mq as any).removeListener(mqHandler);
        }
      }
    };
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };
  
  if (!isClient) {
    return (
      <div className="flex items-center justify-between space-y-2">
        <div className="flex items-center gap-3">
          <LeadGenLogo />
          <h1 className="text-3xl font-bold tracking-tight font-headline holographic-text">
            LeadGen
          </h1>
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex items-center gap-2 text-sm font-medium p-2 rounded-md glassmorphic">
            <Wifi className="h-4 w-4" />
            <span></span>
            <div className="h-2 w-2 rounded-full"></div>
          </div>
          <Button variant="outline" size="icon">
            <Sun className="h-[1.2rem] w-[1.2rem]" />
          </Button>
          <CreditsDialog />
        </div>
      </div>
    );
  }


  return (
    <div className="flex items-center justify-between space-y-2">
      <div className="flex items-center gap-3">
        <LeadGenLogo />
        <div className="flex items-baseline gap-2">
          <h1 className="text-3xl font-bold tracking-tight font-headline holographic-text">
            LeadGen
          </h1>
          <Badge variant="secondary">Beta 1.0V</Badge>
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <div className={`flex items-center gap-2 text-sm font-medium p-2 rounded-md glassmorphic ${isOnline ? 'text-green-500' : 'text-red-500'}`}>
          {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
          <span>{isOnline ? 'Live Sync' : 'Failed To Reach Server'}</span>
          <div className={`h-2 w-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
        </div>
        <Button variant="outline" size="icon" onClick={toggleTheme}>
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
        <CreditsDialog />
        <Authentication />
      </div>
    </div>
  );
}
