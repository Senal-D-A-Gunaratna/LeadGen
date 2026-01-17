
"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from "@/components/ui/card";
import { useActionLogStore } from "@/hooks/use-action-log-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { Activity, Trash2 } from "lucide-react";
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

export function ActionLog() {
  const { actionLogs, clearActionLogs } = useActionLogStore();

  return (
    <Card className="glassmorphic glowing-border flex flex-col">
      <CardHeader>
        <CardTitle className="font-headline text-primary">Action Log</CardTitle>
        <CardDescription>
          Live feed of privileged user actions.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-grow h-64">
        <ScrollArea className="h-full pr-4">
          {actionLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p>No actions logged yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {actionLogs.map((log, index) => (
                <div key={index} className="flex items-start gap-3 text-sm">
                  <div><Activity className="h-4 w-4 text-muted-foreground" /></div>
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
              disabled={actionLogs.length === 0}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear Log
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="glassmorphic glowing-border">
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently clear the action log. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={clearActionLogs}>Continue</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardFooter>
    </Card>
  );
}
