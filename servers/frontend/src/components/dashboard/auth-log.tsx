
"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from "@/components/ui/card";
import { useLogStore } from "@/hooks/use-log-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { ShieldCheck, LogOut, Terminal, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function AuthLog() {
  const { logs, clearLogs } = useLogStore();

  const getIconForMessage = (message: string) => {
    if (message.includes("signed in")) {
      return <ShieldCheck className="h-4 w-4 text-green-500" />;
    }
    if (message.includes("signed out")) {
      return <LogOut className="h-4 w-4 text-red-500" />;
    }
    return <Terminal className="h-4 w-4 text-muted-foreground" />;
  }

  return (
    <Card className="glassmorphic glowing-border flex flex-col">
      <CardHeader>
        <CardTitle className="font-headline text-primary">Authentication Log</CardTitle>
        <CardDescription>
          Live feed of user sign-ins and sign-outs
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-grow h-64">
        <ScrollArea className="h-full pr-4">
          {logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p>No authentication events yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {logs.map((log, index) => (
                <div key={index} className="flex items-start gap-3 text-sm">
                  <div>{getIconForMessage(log.message)}</div>
                  <div className="flex-1">
                    <p className="text-foreground">{log.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(log.timestamp, "PPP, HH:mm")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
      <CardFooter>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={logs.length === 0}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear Log
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="glassmorphic glowing-border">
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently clear the authentication log, This action cannot be undone
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={clearLogs}>Continue</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardFooter>
    </Card>
  );
}
