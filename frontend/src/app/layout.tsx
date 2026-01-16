import type { Metadata } from 'next';
import './globals.css';
import { Inter, Space_Grotesk } from 'next/font/google';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/hooks/auth-provider';

const fontInter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const fontSpaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

export const metadata: Metadata = {
  title: 'LeadGen',
  description: 'A cutting-edge school management application with a futuristic GUI and real-time fingerprint attendance tracking.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={cn('font-body antialiased', fontInter.variable, fontSpaceGrotesk.variable)} suppressHydrationWarning>
          <AuthProvider>
            <div className="fixed inset-0 -z-10 h-full w-full bg-gradient-to-br from-blue-200 via-blue-100 to-blue-50 dark:from-blue-950 dark:via-slate-900 dark:to-slate-950">
            </div>
            {children}
            <Toaster />
            <footer className="fixed bottom-2 right-4 text-base text-muted-foreground/50">
              Powered By R.V.C Robotics Club
            </footer>
          </AuthProvider>
      </body>
    </html>
  );
}
