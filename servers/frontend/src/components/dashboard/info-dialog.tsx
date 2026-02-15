
"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Info } from "lucide-react";

export function CreditsDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon">
          <Info className="h-4 w-4" />
          <span className="sr-only">Credits</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md glowing-border opacity-70" style={{ backgroundColor: 'hsl(var(--card) / 0.93)' }}>
        <DialogHeader>
          <DialogTitle className="font-headline text-primary">Credits</DialogTitle>
          <DialogDescription>
            Information about the creators and technologies used in this application
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center justify-center h-48 space-y-4">
          <p className="text-center">This application was brought to you by the power of AI</p>
          <p className="text-sm text-muted-foreground text-center">Built with Next.js, ShadCN, Tailwind CSS, Python ,Flask ,FastAPI and Soket.Io</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
