
"use client";

import { useState, useEffect } from "react";
import { useAuthStore } from "@/hooks/use-auth-store";
import { Button } from "@/components/ui/button";
import { LogIn, LogOut, Shield, Code, User, Settings, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { RolePasswordDialog } from "./role-password-dialog";
import type { Role } from "@/hooks/use-auth-store";
import { ChangePasswordDialog } from "./change-password-dialog";
import { useUIStateStore } from "@/hooks/use-ui-state-store";
import { wsClient } from "@/lib/websocket-client";


export function Authentication() {
  const { user, login, logout, isInitialized, initializeAuth } = useAuthStore();
  const { setActiveTab } = useUIStateStore();
  const [dialogRole, setDialogRole] = useState<Role | null>(null);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [showDevOption, setShowDevOption] = useState(false);

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  const handleSignInRequest = (role: Role) => {
    setDialogRole(role);
  };

  const handleSignOut = () => {
    logout();
    wsClient.disconnect();
    setActiveTab('dashboard');
  };

  const handleSuccessfulLogin = (role: Role) => {
    login(role);
    setDialogRole(null);
    setActiveTab('dashboard');
  };

  const handleTriggerPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.altKey && e.shiftKey) {
      setShowDevOption(true);
    }
  };


  if (!isInitialized) {
    return (
       <Button variant="outline" disabled>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading...
        </Button>
    )
  }

  if (!user) {
    return (
      <>
        <DropdownMenu onOpenChange={(isOpen) => !isOpen && setShowDevOption(false)}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" onPointerDown={handleTriggerPointerDown}>
              <LogIn className="mr-2 h-4 w-4" />
              Sign in
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleSignInRequest('moderator')}>
                  <Shield className="mr-2 h-4 w-4 text-yellow-500" />
                  <span>Moderator</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSignInRequest('admin')}>
                  <Shield className="mr-2 h-4 w-4 text-red-500" />
                  <span>Admin</span>
              </DropdownMenuItem>
              {showDevOption && (
                <DropdownMenuItem onClick={() => handleSignInRequest('dev')}>
                    <Code className="mr-2 h-4 w-4 text-blue-500" />
                    <span>Dev</span>
                </DropdownMenuItem>
              )}
          </DropdownMenuContent>
        </DropdownMenu>
        {dialogRole && (
             <RolePasswordDialog
                role={dialogRole}
                open={!!dialogRole}
                onOpenChange={(isOpen) => !isOpen && setDialogRole(null)}
                onSuccess={(password) => handleSuccessfulLogin(dialogRole)}
                title={`Sign In as ${dialogRole.charAt(0).toUpperCase() + dialogRole.slice(1)}`}
                description="Please enter the password to access this role."
            />
        )}
      </>
    );
  }

  const getRoleBadge = () => {
      if (user.role === 'admin') return <span className="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-red-500 ring-2 ring-background" title="Admin"></span>;
      if (user.role === 'moderator') return <span className="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-yellow-500 ring-2 ring-background" title="Moderator"></span>;
      if (user.role === 'dev') return <span className="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-blue-500 ring-2 ring-background" title="Dev"></span>;
      return null;
  }
  
  const getRoleName = () => {
    if (!user.role) return "User";
    return user.role.charAt(0).toUpperCase() + user.role.slice(1);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="rounded-full">
            <div className="relative">
              <Avatar className="h-8 w-8">
                  <AvatarFallback><User /></AvatarFallback>
              </Avatar>
              {getRoleBadge()}
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{getRoleName()}</DropdownMenuLabel>
          <DropdownMenuSeparator />
           {user.role === 'moderator' && (
            <DropdownMenuItem onClick={() => setIsChangePasswordOpen(true)}>
              <Settings className="mr-2 h-4 w-4" />
              <span>Settings</span>
            </DropdownMenuItem>
           )}
          <DropdownMenuItem onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Sign out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog
        open={isChangePasswordOpen}
        onOpenChange={setIsChangePasswordOpen}
        role={user.role}
      />
    </>
  );
}

    