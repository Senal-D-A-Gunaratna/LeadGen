export async function clientLog(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: any) {
  try {
    // Fire-and-forget; do not block UI. Best-effort POST to local Next API route.
    fetch('/api/client-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message, meta }),
    }).catch(() => {});
  } catch (e) {
    // swallow errors to avoid breaking UI
  }
}

export default clientLog;
