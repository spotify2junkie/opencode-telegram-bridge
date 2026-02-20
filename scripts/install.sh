#!/bin/bash

set -e

PLUGIN_DIR="$HOME/.config/opencode/plugin"
PLUGIN_FILE="$PLUGIN_DIR/telegram-bridge.js"
WORKER_URL="$2"
INSTALL_KEY="$1"

if [ -z "$INSTALL_KEY" ] || [ -z "$WORKER_URL" ]; then
    echo "Usage: $0 <install-key> <worker-url>"
    echo "Example: $0 abc-123-def https://your-worker.workers.dev"
    exit 1
fi

echo "🔧 Installing OpenCode Telegram Bridge Plugin..."

mkdir -p "$PLUGIN_DIR"

TEMP_FILE=$(mktemp)
curl -fsSL "https://raw.githubusercontent.com/YOUR_USERNAME/opencode-telegram-bridge/main/plugin/dist/telegram-bridge.js" -o "$TEMP_FILE"

sed -i.bak "s/__INSTALL_KEY__/$INSTALL_KEY/g" "$TEMP_FILE"
sed -i.bak "s|__WORKER_URL__|$WORKER_URL|g" "$TEMP_FILE"
rm -f "${TEMP_FILE}.bak"

mv "$TEMP_FILE" "$PLUGIN_FILE"

echo "✅ Plugin installed to $PLUGIN_FILE"
echo ""
echo "Restart OpenCode to start receiving Telegram notifications!"
echo "You can also send commands back to OpenCode by replying to notifications."
