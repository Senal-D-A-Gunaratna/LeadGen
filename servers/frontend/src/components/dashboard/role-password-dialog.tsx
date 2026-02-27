
"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import type { Role } from "@/hooks/use-auth-store";
import { useLogStore } from "@/hooks/use-log-store";
import { validatePasswordAction } from "@/app/actions";
import { apiClient } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  password: z.string().min(1, { message: "Password is required." }),
});

interface RolePasswordDialogProps {
  role: Role;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (password: string) => boolean | Promise<boolean> | void | Promise<void>;
  title?: string;
  description?: string;
  isUnlockAttempt?: boolean;
}

export function RolePasswordDialog({ role, open, onOpenChange, onSuccess, title, description, isUnlockAttempt = false }: RolePasswordDialogProps) {
  const [isPending, setIsPending] = useState(false);
  const { addLog } = useLogStore();
  const { toast } = useToast();
  const roleName = role.charAt(0).toUpperCase() + role.slice(1);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      password: "",
    },
  });
  
  useEffect(() => {
    if (open) {
      form.reset();
      form.clearErrors();
    }
  }, [open, form]);


  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsPending(true);
    
    // For unlock attempts, we pass the password up to the parent component.
    if (isUnlockAttempt) {
      const shouldClose = await onSuccess(values.password);
      if (!shouldClose) {
        form.setError("password", {
          type: "manual",
          message: "Incorrect password. Please try again.",
        });
      } else {
        // Close dialog after successful unlock
        onOpenChange(false);
      }
      setIsPending(false);
      return;
    }

    // Original logic for sign-in/authorization
    const isValid = await validatePasswordAction(role, values.password);
    
    if (isValid) {
      // Authenticate WebSocket session
      try {
        const wsAuthenticated = await apiClient.authenticate(role, values.password);
        if (wsAuthenticated) {
          try {
            onSuccess(values.password);
          } finally {
            // Close dialog after successful authentication
            onOpenChange(false);
          }
        } else {
          addLog(`WebSocket authentication failed for role: ${role}`);
          toast({ variant: 'destructive', title: 'Authentication Failed', description: 'WebSocket authentication failed.' });
          // Close dialog even on failure per requested behavior
          onOpenChange(false);
        }
      } catch (error) {
        console.error('WebSocket authentication error:', error);
        addLog(`WebSocket authentication error for role: ${role}`);
        form.setError("password", {
          type: "manual",
          message: "Connection error. Please try again.",
        });
      }
    } else {
      addLog(`Failed login attempt for role: ${role}`);
      toast({ variant: 'destructive', title: 'Authentication Failed', description: 'Password incorrect.' });
      onOpenChange(false);
    }
    setIsPending(false);
  }
  
  const getButtonText = () => {
      if (title?.toLowerCase().includes("sign in")) return "Sign In";
      if (isUnlockAttempt) return "Unlock";
      return "Authorize";
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md glassmorphic glowing-border">
        <DialogHeader>
          <DialogTitle className="font-headline text-primary">{title || `${roleName} Access`}</DialogTitle>
          <DialogDescription>
            {description || 'This role has elevated permissions. Please enter the password to continue.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} className="glassmorphic"/>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
               <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...</>
                ) : (
                  getButtonText()
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

    