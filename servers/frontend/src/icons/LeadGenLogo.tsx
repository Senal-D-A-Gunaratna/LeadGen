import { cn } from "@/lib/utils";

export function LeadGenLogo({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="none" className={cn("h-8 w-8", className)} viewBox="0 0 24 24"><rect width="20" height="20" x="2" y="2" fill="#3b82f6" rx="4"/><path fill="#fff" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" d="m13 5-3 6h6l-6 8 3-6H7z"/></svg>
  );
}
