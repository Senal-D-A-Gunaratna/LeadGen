import { NextRequest, NextResponse } from 'next/server';
import os from 'os';

/**
 * Detect the server's IP address
 */
function detectServerIP(): string {
  // First, try to detect from request headers (works behind proxies)
  // This is a fallback - we'll use os.networkInterfaces()

  // Get all network interfaces
  const interfaces = os.networkInterfaces();
  
  // Priority: get first non-loopback IPv4 address
  for (const name of Object.keys(interfaces)) {
    const ifaces = interfaces[name];
    if (!ifaces) continue;
    
    for (const iface of ifaces) {
      // Skip loopback and IPv6 for now
      if (iface.family === 'IPv4' && !iface.address.startsWith('127.')) {
        return iface.address;
      }
    }
  }
  
  // Fallback to localhost if no external IP found
  return 'localhost';
}

export async function GET(request: NextRequest) {
  try {
    const serverIP = detectServerIP();
    const backendURL = `http://${serverIP}:5000`;
    
    return NextResponse.json({
      backendURL,
      serverIP,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error detecting server IP:', error);
    return NextResponse.json(
      { error: 'Failed to detect server IP', backendURL: 'http://localhost:5000' },
      { status: 500 }
    );
  }
}
