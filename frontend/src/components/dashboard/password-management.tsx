
"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "../ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";
import { Input } from "../ui/input";
import { useAuthStore, Role } from "@/hooks/use-auth-store";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Lock, Unlock } from "lucide-react";
import { Skeleton } from "../ui/skeleton";
import { DevAuthDialog } from "./dev-auth-dialog";
import { RolePasswordDialog } from "./role-password-dialog";
import { cn } from "@/lib/utils";
import { useActionLogStore } from "@/hooks/use-action-log-store";

const formSchema = z.object({
  admin: z.string().min(4, { message: "Password must be at least 4 characters." }).optional(),
  moderator: z.string().min(4, { message: "Password must be at least 4 characters." }).optional(),
  dev: z.string().min(4, { message: "Password must be at least 4 characters." }).optional(),
});

type PasswordFormValues = z.infer<typeof formSchema>;

const roleColors: Record<Role, string> = {
  moderator: "text-yellow-500",
  admin: "text-red-500",
  dev: "text-blue-500",
};

function DevLocker({ title, onUnlock }: { title: string, onUnlock: () => void }) {
  const { isDevUnlocked } = useAuthStore();
  return (
    <Button variant="ghost" size="icon" onClick={onUnlock} className="h-6 w-6">
      {isDevUnlocked ? <Unlock className="text-green-500" /> : <Lock className="text-red-500" />}
       <span className="sr-only">Toggle lock for {title}</span>
    </Button>
  )
}

export function PasswordManagement({ onUnlockRequest }: { onUnlockRequest?: () => void }) {
  const { isInitialized, changePasswordForRole, user, isDevUnlocked } = useAuthStore();
  const { toast } = useToast();
  const { addActionLog } = useActionLogStore();
  const [isPending, setIsPending] = useState<Role | null>(null);
  const [authDialog, setAuthDialog] = useState<{ isOpen: boolean; roleToChange: Role | null, newPass: string | null, authorizer: Role | null, authorizerPassword?: string }>({ isOpen: false, roleToChange: null, newPass: null, authorizer: null });

  const form = useForm<PasswordFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      admin: "••••••••",
      moderator: "••••••••",
      dev: "••••••••",
    },
  });

  useEffect(() => {
    // We no longer fetch passwords, so we just keep the masked values.
    // The form is only for setting new passwords.
  }, []);

  const handleSaveClick = (roleToChange: Role) => {
    const newPassword = form.getValues(roleToChange);
    
    if (!newPassword || newPassword === '••••••••') {
      toast({
        variant: "destructive",
        title: "No Change",
        description: "Please enter a new password.",
      });
      return;
    }

    let authorizer: Role | null = 'dev';
    if (user?.role === 'admin' && (roleToChange === 'moderator' || roleToChange === 'admin')) {
      authorizer = 'admin';
    } else if (user?.role === 'dev') {
      authorizer = 'dev';
    } else {
        toast({ variant: "destructive", title: "Unauthorized", description: "You do not have permission to perform this action."});
        return;
    }

    setAuthDialog({ isOpen: true, roleToChange, newPass: newPassword, authorizer });
  };

  const handleAuthorizedSave = async (authorizerPassword?: string) => {
    if (!authDialog.roleToChange || !authDialog.newPass || !authDialog.authorizer) return;
    
    setIsPending(authDialog.roleToChange);
    try {
      await changePasswordForRole(authDialog.roleToChange, authDialog.newPass, authDialog.authorizer, authorizerPassword);
      addActionLog(`[${authDialog.authorizer}] Changed password for ${authDialog.roleToChange}.`);
      toast({
        title: "Password Updated",
        description: `The password for ${authDialog.roleToChange} has been updated.`,
      });
      // Reset form field to masked value after successful save
      form.setValue(authDialog.roleToChange, '••••••••');
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: "An unexpected error occurred while saving the password.",
      });
    } finally {
      setIsPending(null);
      setAuthDialog({ isOpen: false, roleToChange: null, newPass: null, authorizer: null });
    }
  };

  const handleAuthDialogClose = () => {
    setAuthDialog({ isOpen: false, roleToChange: null, newPass: null, authorizer: null });
  };


  if (!isInitialized) {
    return (
       <Card className="glassmorphic glowing-border">
          <CardHeader>
             <CardTitle className="font-headline text-primary">System Passwords</CardTitle>
             <CardDescription>Manage passwords for user roles</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
          </CardContent>
       </Card>
    )
  }

  const isSaveDisabled = (role: Role) => {
      if (!!isPending) return true;
      if (user?.role === 'dev' && !isDevUnlocked) return true; // Lock for dev
      if (user?.role === 'admin' && (role === 'dev')) return true;
      if (user?.role === 'moderator') return true;
      return false;
  }

  const rolesToShow: Role[] = user?.role === 'admin' 
    ? ['moderator', 'admin'] 
    : ['moderator', 'admin', 'dev'];

  const getTitle = () => {
    if (user?.role === 'admin') return "Manage Passwords";
    return "System Passwords";
  }

  const getDescription = () => {
     if (user?.role === 'admin') return "Change passwords for yourself or the Moderator.";
     if (user?.role === 'dev') return "Manage passwords for all user roles.";
     return "Password management panel."
  }

  return (
    <>
      <Card className="glassmorphic glowing-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="font-headline text-primary">{getTitle()}</CardTitle>
            <CardDescription>
              {getDescription()}
            </CardDescription>
          </div>
          {user?.role === 'dev' && onUnlockRequest && (
            <DevLocker title="System Passwords" onUnlock={onUnlockRequest} />
          )}
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="space-y-6">
              {rolesToShow.map((role) => (
                <FormField
                  key={role}
                  control={form.control}
                  name={role}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={cn(roleColors[role])}>{role.charAt(0).toUpperCase() + role.slice(1)} Password</FormLabel>
                      <div className="flex items-center gap-2">
                        <FormControl>
                          <Input type="password" {...field} className="glassmorphic" disabled={isSaveDisabled(role)} />
                        </FormControl>
                        <Button type="button" size="icon" onClick={() => handleSaveClick(role)} disabled={isSaveDisabled(role)}>
                           {isPending === role ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                           <span className="sr-only">Save {role} password</span>
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </form>
          </Form>
        </CardContent>
      </Card>
      
      {authDialog.authorizer === 'dev' && (
        <DevAuthDialog 
            open={authDialog.isOpen}
            onOpenChange={(isOpen) => !isOpen && handleAuthDialogClose()}
            onSuccess={handleAuthorizedSave}
        />
      )}

      {authDialog.authorizer === 'admin' && (
        <RolePasswordDialog 
            role="admin"
            open={authDialog.isOpen}
            onOpenChange={(isOpen) => !isOpen && handleAuthDialogClose()}
            onSuccess={handleAuthorizedSave}
            title="Admin Authorization"
            description={`Please enter the Admin password to change the ${authDialog.roleToChange} password.`}
        />
      )}
    </>
  );
}

    