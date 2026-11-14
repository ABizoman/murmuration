#!/bin/bash
# Double-click to run Murmuration locally. Phones on the same Wi-Fi can use the LAN address.
cd "$(dirname "$0")"
PORT=8000
IP=$(ipconfig getifaddr en0 2>/dev/null || echo "your-laptop-ip")
echo ""
echo "  Murmuration running:"
echo "    this Mac:  http://localhost:$PORT"
echo "    phones:    http://$IP:$PORT"
echo "  Close this window (or Ctrl+C) to stop."
echo ""
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server $PORT --bind 0.0.0.0
else
  npx --yes http-server -p $PORT -c-1
fi
