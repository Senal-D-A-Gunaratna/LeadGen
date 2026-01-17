
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
import { useLogStore } from "@/hooks/use-log-store";
import { validatePasswordAction } from "@/app/actions";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  password: z.string().min(1, { message: "Password is required." }),
});

interface DevAuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (password: string) => void;
}

export function DevAuthDialog({ open, onOpenChange, onSuccess }: DevAuthDialogProps) {
  const [isPending, setIsPending] = useState(false);
  const { addLog } = useLogStore();
  const { toast } = useToast();

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
    
    const isValid = await validatePasswordAction('dev', values.password);

    if (isValid) {
      try {
        onSuccess(values.password);
      } finally {
        // Close dialog after the attempt regardless of parent handling
        onOpenChange(false);
      }
    } else {
      addLog('Failed dev authorization attempt.');
      // Show a short toast and close the dialog to let the parent show result popup
      toast({ variant: 'destructive', title: 'Authorization Failed', description: 'Developer password incorrect.' });
      onOpenChange(false);
    }
    setIsPending(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md glassmorphic glowing-border" hideCloseButton>
        <DialogHeader>
          <DialogTitle className="font-headline text-primary">Developer Authorization</DialogTitle>
          <DialogDescription>
            Please enter the Developer password to authorize this sensitive action.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Developer Password</FormLabel>
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
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Authorizing...</>
                ) : (
                  "Authorize Action"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

    