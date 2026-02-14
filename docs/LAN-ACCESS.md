# LAN Access Configuration

The application is now configured to work via LAN (Local Area Network) access.

## How It Works

1. **Servers bind to all interfaces**: Both Next.js and Flask servers are configured to listen on `0.0.0.0`, which means they accept connections from any network interface (localhost, LAN IP, etc.)

2. **Automatic hostname detection**: The frontend automatically detects the hostname from the browser's URL. This means:
   - If you access via `http://localhost:9002` → Backend connects to `http://localhost:5000`
   - If you access via `http://192.168.1.100:9002` → Backend connects to `http://192.168.1.100:5000`
   - Works automatically for any IP address!

## Finding Your LAN IP Address

### Linux:
```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
# Or
hostname -I
```

### Windows:
```bash
ipconfig
# Look for IPv4 Address under your network adapter
```

### macOS:
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

## Accessing from Other Devices

1. **Start the servers** (from project root):
   ```bash
   npm run dev
   ```

2. **Find your computer's LAN IP** (e.g., `192.168.1.100`)

3. **Access from any device on the same network**:
   - Open browser on phone/tablet/other computer
   - Go to: `http://YOUR_IP:9002`
   - Example: `http://192.168.1.100:9002`

4. **The frontend will automatically connect to the backend** at `http://YOUR_IP:5000`

## Firewall Configuration

Make sure your firewall allows connections on ports:
- **9002** (Next.js frontend)
- **5000** (Flask backend)

### Linux (firewalld):
```bash
sudo firewall-cmd --permanent --add-port=9002/tcp
sudo firewall-cmd --permanent --add-port=5000/tcp
sudo firewall-cmd --reload
```

### Linux (ufw):
```bash
sudo ufw allow 9002/tcp
sudo ufw allow 5000/tcp
```

### Windows:
- Go to Windows Defender Firewall
- Add inbound rules for ports 9002 and 5000

## Manual Configuration (Optional)


If you want to manually set the backend URL, create/update `.env.local` in the `servers/frontend/` directory:

```bash
NEXT_PUBLIC_BACKEND_URL=http://192.168.1.100:5000
```

But this is **not necessary** - the automatic detection should work for most cases!

## Troubleshooting

**Can't access from other devices:**
- Check firewall settings
- Ensure both devices are on the same network
- Verify the IP address is correct
- Check that servers are running and bound to `0.0.0.0`

**Backend connection fails:**
- The frontend automatically uses the same hostname you accessed it from
- If you access via IP, it will connect to backend via IP
- If you access via localhost, it will connect via localhost
