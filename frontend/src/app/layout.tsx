import type { Metadata } from 'next';
import './globals.css';
import favicon from '@/icons/favicon.ico';
import iconPng from '@/icons/icon.png';
import { Inter, Space_Grotesk } from 'next/font/google';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/hooks/auth-provider';
import { enableMapSet } from 'immer';
import WsInitializer from '@/components/ws-initializer';

// Enable Immer MapSet plugin for Zustand store
enableMapSet();

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
  description: 'A cutting-edge school management application with a futuristic GUI and real-time fingerprint attendance tracking',
  icons: {
    icon: [
      { url: (favicon as any).src ?? (favicon as any), sizes: '48x48', type: 'image/x-icon' },
      { url: (iconPng as any).src ?? (iconPng as any), sizes: '512x512', type: 'image/png' },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn('font-body antialiased', fontInter.variable, fontSpaceGrotesk.variable)} suppressHydrationWarning>
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { try { document.documentElement.classList.add('dark'); } catch (e) {} })();`,
          }}
        />
          <AuthProvider>
            <WsInitializer />
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
