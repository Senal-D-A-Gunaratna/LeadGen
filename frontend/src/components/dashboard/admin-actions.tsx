
"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "../ui/button";
import { useStudentStore } from "@/hooks/use-student-store";
import { useToast } from "@/hooks/use-toast";
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
import { RolePasswordDialog } from "./role-password-dialog";
import { useAuthStore } from "@/hooks/use-auth-store";
import { useActionLogStore } from "@/hooks/use-action-log-store";

type ActionType = "delete-history" | "delete-students";

export function AdminActions() {
  const { actions } = useStudentStore();
  const { toast } = useToast();
  const { addActionLog } = useActionLogStore();
  const { user } = useAuthStore();
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [actionToConfirm, setActionToConfirm] = useState<ActionType | null>(null);

  const handleDeleteRequest = (action: ActionType) => {
    setActionToConfirm(action);
    setAuthDialogOpen(true);
  };

  const handleAuthorizedAction = async (password?: string) => {
    if (actionToConfirm === 'delete-history') {
      await actions.deleteEntireHistory();
      addActionLog('[Admin] Deleted all attendance history.');
      toast({
        title: "Attendance History Deleted",
        description: "All historical attendance data has been cleared.",
      });
    } else if (actionToConfirm === 'delete-students') {
      await actions.deleteAllStudentData();
      addActionLog('[Admin] Deleted all student data.');
      toast({
        title: "All Student Data Deleted",
        description: "All student profiles and related history have been cleared.",
      });
    }
    setAuthDialogOpen(false);
    setActionToConfirm(null);
  };
  
  if (!user || user.role !== 'admin') {
    return null;
  }

  return (
    <>
      <Card className="glassmorphic glowing-border">
        <CardHeader>
          <CardTitle className="font-headline text-primary">Admin Actions</CardTitle>
          <CardDescription>
            Perform administrative actions on the system data, Requires password authorization
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-destructive/50 rounded-lg">
            <div>
              <h3 className="font-semibold text-destructive">
                Delete All Student Data
              </h3>
              <p className="text-sm text-muted-foreground">
                Permanently delete all students and their history
              </p>
            </div>
             <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Delete Data</Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="glassmorphic glowing-border">
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action is irreversible and requires admin authorization, It will permanently delete all student data and attendance history
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleDeleteRequest('delete-students')}>
                    Continue to Authorization
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <div className="flex items-center justify-between p-4 border border-destructive/50 rounded-lg">
            <div>
              <h3 className="font-semibold text-destructive">
                Delete All Attendance History
              </h3>
              <p className="text-sm text-muted-foreground">
                Permanently delete all historical attendance records
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Delete History</Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="glassmorphic glowing-border">
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action is irreversible and requires admin authorization, It will permanently delete all attendance history
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleDeleteRequest('delete-history')}>
                    Continue to Authorization
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
      
      <RolePasswordDialog
        role="admin"
        open={authDialogOpen}
        onOpenChange={(isOpen) => {
            if (!isOpen) {
                setAuthDialogOpen(false);
                setActionToConfirm(null);
            }
        }}
        onSuccess={handleAuthorizedAction}
        title="Admin Authorization Required"
        description={`Please enter the Admin password to confirm this action.`}
      />
    </>
  );
}
