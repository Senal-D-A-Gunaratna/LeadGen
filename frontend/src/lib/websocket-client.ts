/**
 * WebSocket client for real-time communication with Flask backend.
 * Replaces long-polling with WebSocket connections.
 */
import { io, Socket } from 'socket.io-client';

// Get backend URL - automatically detects hostname for LAN access
function getBackendUrl(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:5000';
  }
  
  // Use environment variable if set
  if (process.env.NEXT_PUBLIC_BACKEND_URL) {
    return process.env.NEXT_PUBLIC_BACKEND_URL;
  }
  
  // Automatically detect hostname from current page URL (works for LAN access)
  let hostname = window.location.hostname;
  // Normalize dev host 0.0.0.0 to localhost so browsers can reach it
  if (hostname === '0.0.0.0') {
    hostname = 'localhost';
  }
  return `http://${hostname}:5000`;
}

const BACKEND_URL = getBackendUrl();

class WebSocketClient {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private authenticated: boolean = false;
  private currentRole: string | null = null;

  connect() {
    if (this.socket?.connected) {
      return;
    }

    this.socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    this.socket.on('connect', () => {
      console.log('WebSocket connected');
    });

    this.socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      this.authenticated = false;
      this.currentRole = null;
    });

    this.socket.on('auth_response', (data: { success: boolean; role?: string; message: string }) => {
      if (data.success) {
        this.authenticated = true;
        this.currentRole = data.role || null;
      }
    });

    this.socket.on('data_changed', (data: { type: string; data: any }) => {
      // Broadcast to all listeners
      const listeners = this.listeners.get('data_changed') || new Set();
      listeners.forEach(listener => listener(data));
    });

    this.socket.on('scan_response', (data: { success: boolean; student?: any; message?: string }) => {
      const listeners = this.listeners.get('scan_response') || new Set();
      listeners.forEach(listener => listener(data));
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.authenticated = false;
      this.currentRole = null;
    }
  }

  authenticate(role: string, password: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.socket || !this.socket.connected) {
        this.connect();
        // Wait for connection
        setTimeout(() => {
          this.authenticate(role, password).then(resolve);
        }, 500);
        return;
      }

      const handler = (data: { success: boolean; role?: string; message: string }) => {
        this.socket?.off('auth_response', handler);
        if (data.success) {
          this.authenticated = true;
          this.currentRole = data.role || null;
          resolve(true);
        } else {
          resolve(false);
        }
      };

      this.socket.on('auth_response', handler);
      this.socket.emit('authenticate', { role, password });

      // Timeout after 5 seconds
      setTimeout(() => {
        this.socket?.off('auth_response', handler);
        resolve(false);
      }, 5000);
    });
  }

  scanStudent(fingerprint: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const handler = (data: { success: boolean; student?: any; message?: string }) => {
        this.socket?.off('scan_response', handler);
        if (data.success) {
          resolve(data.student);
        } else {
          reject(new Error(data.message || 'Scan failed'));
        }
      };

      this.socket.on('scan_response', handler);
      this.socket.emit('scan_student', { fingerprint });

      // Timeout after 10 seconds
      setTimeout(() => {
        this.socket?.off('scan_response', handler);
        reject(new Error('Scan timeout'));
      }, 10000);
    });
  }

  on(event: string, callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: (data: any) => void) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  getCurrentRole(): string | null {
    return this.currentRole;
  }
}

// Export singleton instance
export const wsClient = new WebSocketClient();
