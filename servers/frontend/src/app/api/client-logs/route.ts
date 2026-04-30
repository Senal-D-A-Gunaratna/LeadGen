import { NextResponse } from 'next/server';
import { appendFile } from 'fs/promises';
import path from 'path';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const level = body.level || 'debug';
    const message = body.message || '';
    const meta = body.meta ? JSON.stringify(body.meta) : '';
    const ts = new Date().toISOString();
    const logLine = `${ts} [${level}] ${message}${meta ? ' ' + meta : ''}\n`;

    // process.cwd() when running the frontend dev server is servers/frontend
    const logPath = path.join(process.cwd(), 'frontend.log');
    await appendFile(logPath, logLine, { encoding: 'utf8' });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    // Keep server-side console error for dev visibility
    // and return a JSON error to callers
    console.error('client-logs POST error', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
