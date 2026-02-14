
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
import { useAuthStore, type Role } from "@/hooks/use-auth-store";
import { useLogStore } from "@/hooks/use-log-store";
import { validatePasswordAction } from "@/app/actions";

const formSchema = z.object({
  password: z.string().min(1, { message: "Password is required." }),
});

interface UploadAuthDialogProps {
  role: Role;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (password: string) => void;
}

export function UploadAuthDialog({ role, open, onOpenChange, onSuccess }: UploadAuthDialogProps) {
  const [isPending, setIsPending] = useState(false);
  const { addLog } = useLogStore();
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
    const isValid = await validatePasswordAction(role, values.password);

    if (isValid) {
      onSuccess(values.password);
      onOpenChange(false);
    } else {
      addLog(`Failed upload authorization for role: ${role}`);
      form.setError("password", {
        type: "manual",
        message: "Incorrect password. Please try again.",
      });
    }
    setIsPending(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md glassmorphic glowing-border" hideCloseButton>
        <DialogHeader>
          <DialogTitle className="font-headline text-primary">Authenticate to Upload</DialogTitle>
          <DialogDescription>
            As a {roleName}, please enter your password to authorize this bulk data upload
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
                  "Authorize"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
