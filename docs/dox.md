Scanner token for automatic scans

- Purpose: allow fingerprint scanners (or other automatic devices) to submit `scan_student` events without performing full user authentication.
- Configuration: set an environment variable `SCANNER_TOKEN` on the backend host.

  Example (Linux/macOS):
  ```bash
  export SCANNER_TOKEN="your-secret-token-here"
  python servers/backend/app.py
  ```

- Scanner payload: include the token in the `scan_student` payload JSON:
  {
    "fingerprint": "<fingerprint-id>",
    "scanner_token": "your-secret-token-here"
  }

- Behavior:
  - If a client socket is authenticated (regular UI users), scans continue to work as before.
  - If a client socket is unauthenticated, the server will accept the scan only if the `scanner_token` matches `SCANNER_TOKEN`.
  - If `SCANNER_TOKEN` is not set, unauthenticated scans are rejected (normal auth requirement).

- Notes:
  - Manual attendance marking from the UI remains unchanged.
  - For future MQTT-based scanners, the MQTT bridge should include the `scanner_token` when forwarding events to the backend.
  - Protect `SCANNER_TOKEN`; treat it like a secret key.
