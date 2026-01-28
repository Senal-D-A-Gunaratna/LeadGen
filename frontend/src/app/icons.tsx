import { cn } from "@/lib/utils";

export function LeadGenLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="hsl(var(--primary-foreground))"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-8 w-8", className)}
    >
      <rect width="20" height="20" x="2" y="2" rx="4" fill="hsl(var(--primary))" stroke="none" />
      <path d="m13 5-3 6h6L10 19l3-6H7z" fill="hsl(var(--primary-foreground))" />
    </svg>
  );
}

export default LeadGenLogo;
