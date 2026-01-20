#!/usr/bin/env python3
"""
Simple test scanner client for sending `scan_student` events to the backend.

Usage:
  pip install "python-socketio[client]"
  export SCANNER_TOKEN="your-secret-token"  # optional
  python tools/test_scanner.py --url http://localhost:5000

At the prompt enter fingerprints separated by commas, e.g.:
  #5,#7

The script will emit a `scan_student` event per fingerprint and print server responses.
"""

import os
import sys
import argparse
import threading
import time

try:
    import socketio
except Exception:
    print("Missing dependency: python-socketio. Install with: pip install 'python-socketio[client]'")
    sys.exit(1)

parser = argparse.ArgumentParser(description='Test scanner client')
parser.add_argument('--url', default=os.environ.get('BACKEND_URL', 'http://localhost:5000'), help='Backend base URL (default http://localhost:5000)')
parser.add_argument('--token', default=os.environ.get('SCANNER_TOKEN'), help='Scanner token (or set SCANNER_TOKEN env var)')
parser.add_argument('--fingerprints', help='Comma-separated fingerprint ids to send (skips interactive prompt)')
parser.add_argument('--timeout', type=float, default=6.0, help='Seconds to wait for server response per scan')
args = parser.parse_args()

BACKEND_URL = args.url.rstrip('/')
SCANNER_TOKEN = args.token
TIMEOUT = args.timeout

sio = socketio.Client(logger=False, engineio_logger=False)
response_event = threading.Event()
last_response = None


@sio.event
def connect():
    print('Connected to', BACKEND_URL)


@sio.event
def disconnect():
    print('Disconnected')


@si  o_on = None
def _scan_response_handler(data):
    global last_response
    last_response = data
    response_event.set()

# Register handler for the scan response
@sio.on('scan_response')
def on_scan_response(data):
    _scan_response_handler(data)


def send_scan(fp):
    response_event.clear()
    payload = {'fingerprint': fp}
    if SCANNER_TOKEN:
        payload['scanner_token'] = SCANNER_TOKEN
    print('-> sending', payload)
    try:
        sio.emit('scan_student', payload)
    except Exception as e:
        print('Emit failed:', e)
        return

    if response_event.wait(TIMEOUT):
        print('<- response:', last_response)
    else:
        print('<- no response (timeout)')


def parse_fingerprints(raw: str):
    return [p.strip() for p in raw.split(',') if p.strip()]


def main():
    try:
        sio.connect(BACKEND_URL, namespaces=['/'])
    except Exception as e:
        print('Failed to connect:', e)
        sys.exit(2)

    fps = []
    if args.fingerprints:
        fps = parse_fingerprints(args.fingerprints)
    else:
        try:
            raw = input('Enter fingerprint(s) (comma-separated): ').strip()
        except KeyboardInterrupt:
            print('\nAborted')
            sio.disconnect()
            return
        fps = parse_fingerprints(raw)

    if not fps:
        print('No fingerprints provided; exiting')
        sio.disconnect()
        return

    for fp in fps:
        send_scan(fp)
        # slight delay to avoid overwhelming the server
        time.sleep(0.2)

    sio.disconnect()


if __name__ == '__main__':
    main()
