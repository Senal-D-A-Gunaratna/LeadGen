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
import { Separator } from "../ui/separator";
import { Badge } from "../ui/badge";

export function CreditsDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon">
          <Info className="h-4 w-4" />
          <span className="sr-only">Credits</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl glassmorphic glowing-border">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <DialogTitle className="font-headline text-primary text-2xl">Credits</DialogTitle>
            <Badge variant="outline">Version Beta 1.0</Badge>
          </div>
          <DialogDescription className="text-center pt-2">
            Information about the creators and technologies used to create this application
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm text-center">
          <div>
            <h3 className="font-semibold text-accent-foreground">Development Team</h3>
            <p className="text-muted-foreground">Senal D A Gunaratna (Main Developer)</p>
            <p className="text-muted-foreground">W A Dilshan Sethmina</p>
          </div>
          <Separator />
           <div>
            <h3 className="font-semibold text-accent-foreground">Supported by</h3>
            <p className="text-muted-foreground">MR. Nishanta (Vice Principal)</p>
            <p className="text-muted-foreground">Eng. MR Mihiraj Ranaweera (Teacher In charge of R.V.C Robotics Club)</p>
            <p className="text-muted-foreground">MR. Asanka (Teacher In Charge Of R.V.C Prefect Board)</p>
            <p className="text-muted-foreground">Dulina Dinsara (Juniour Prefect)</p>
          </div>
          <Separator />
           <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-accent-foreground">Powered by</h3>
                <p className="text-muted-foreground">R.V.C Robotics Club</p>
              </div>
          </div>
          <Separator />
           <div>
            <h3 className="font-semibold text-accent-foreground">By the request of</h3>
            <p className="text-muted-foreground">The R.V.C Prefect Board</p>
          </div>
          <Separator />
           <div className="text-center pt-2">
              <p className="text-xs text-muted-foreground">Built with Next.js, Python, ShadCN, Tailwind CSS, and a local server backend.</p>
              <p className="text-xs text-muted-foreground">This application was brought to you by the power of AI.</p>
           </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
