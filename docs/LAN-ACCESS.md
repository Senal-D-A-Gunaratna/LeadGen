# LAN Access Configuration

This page explains how to access the running LeadGen services from other devices on your local network. For instructions on starting the servers, see `docs/QUICKSTART.md`.

## How it works

- Both frontend and backend bind to all interfaces (0.0.0.0) in development, so the services are reachable via your machine's LAN IP.
- The frontend will usually use the hostname or IP you used to open it in the browser to contact the backend, so cross-device access works out of the box.

## Finding your LAN IP

### Linux
```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
# or
hostname -I
```

### Windows
```bash
ipconfig
```

### macOS
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

## Accessing from other devices

1. Start the services using the steps in `docs/QUICKSTART.md`.
2. From another device on the same network, open a browser and visit:

   http://<YOUR_MACHINE_IP>:9002

   The frontend should automatically connect to the backend at the corresponding IP and port (5000).

## Firewall

Allow the following ports if your firewall blocks local connections:

- 9002/tcp — frontend
- 5000/tcp — backend

Examples (Linux ufw):
```bash
sudo ufw allow 9002/tcp
sudo ufw allow 5000/tcp
```

## Optional: set a fixed backend URL

If you need to force a backend address, create/update `servers/frontend/.env.local` with:

```text
NEXT_PUBLIC_BACKEND_URL=http://<YOUR_MACHINE_IP>:5000
```

This is usually unnecessary because the frontend detects the host automatically.

## Troubleshooting

- Ensure both devices are on the same network.
- Verify servers are running (see `docs/QUICKSTART.md`).
- Check firewall rules and port availability.

