import { NextRequest, NextResponse } from 'next/server';

// Simple proxy for backend health check to avoid 404s from the Next.js
// development server when frontend probes `/api/health` as same-origin.
// This route runs on the Next.js server and forwards the request to the
// real backend (usually on port 5000).

const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';

export async function GET(request: NextRequest) {
  try {
    const res = await fetch(`${BACKEND}/api/health`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('frontend health proxy failed', err);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
