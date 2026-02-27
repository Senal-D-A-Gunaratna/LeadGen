"use client";

import { useEffect, useState } from "react";
import { useStudentStore } from "@/hooks/use-student-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "../ui/button";
import { useToast } from "@/hooks/use-toast";
import { Server, Activity, Database, Wifi } from "lucide-react";
import { ActionLog } from "../dashboard/action-log";
import { AuthLog } from "../dashboard/auth-log";
import { BackupManagement } from "../dashboard/backup-management";
// Use HTTP polling for server connection counts instead of WebSocket events

export function ServerTab() {
  const { toast } = useToast();
  const [serverStatus, setServerStatus] = useState<'online' | 'offline'>('online');
  const [totalConnections, setTotalConnections] = useState<number | null>(null);
  const [authenticatedConnections, setAuthenticatedConnections] = useState<number | null>(null);

  // Global handler clears filters on tab change; no per-tab cleanup needed here.

  const handleRestartServer = () => {
    toast({ title: "Server Restart", description: "Server restart functionality would be implemented here." });
  };

  const handleCheckStatus = () => {
    toast({ title: "Server Status", description: `Server is currently ${serverStatus}.` });
  };

  useEffect(() => {
    let mounted = true;
    const fetchCounts = async () => {
      try {
        const resp = await fetch('/api/server/connections');
        const data = await resp.json();
        if (!mounted) return;
        if (data && data.success) {
          setTotalConnections(data.total ?? 0);
          setAuthenticatedConnections(data.authenticated ?? 0);
        }
      } catch (e) {
        // ignore network errors; keep existing state
      }
    };
    fetchCounts();
    const interval = setInterval(fetchCounts, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Server Status</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">Online</div>
            <p className="text-xs text-muted-foreground">All systems operational</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Connections</CardTitle>
            <Wifi className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalConnections === null ? '-' : totalConnections}</div>
            <p className="text-xs text-muted-foreground">WebSocket connections</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Database Health</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">Healthy</div>
            <p className="text-xs text-muted-foreground">All tables accessible</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ActionLog />
        <AuthLog />
      </div>

      <BackupManagement />

      <Card>
        <CardHeader>
          <CardTitle>Server Management</CardTitle>
          <CardDescription>Administrative controls for server operations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button onClick={handleCheckStatus} variant="outline">
              <Activity className="h-4 w-4 mr-2" />
              Check Status
            </Button>
            <Button onClick={handleRestartServer} variant="destructive">
              <Server className="h-4 w-4 mr-2" />
              Restart Server
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}