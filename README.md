# OpenCode Telegram Bridge

Bidirectional communication between OpenCode and Telegram — no deployment required.

## Features

- ✅ Get Telegram notifications when OpenCode sessions complete
- ✅ Send commands back to OpenCode by replying to notifications
- ✅ View task progress (todos) in notifications
- ✅ See full assistant response content
- ✅ No server deployment needed — runs entirely locally

## Installation

### 1. Create a Telegram Bot

1. Search for [@BotFather](https://t.me/BotFather) in Telegram
2. Send `/newbot` and follow the prompts
3. Save the **Bot Token** (format: `123456789:ABCdefGHI...`)

### 2. Get Your Chat ID

1. Search for [@userinfobot](https://t.me/userinfobot) in Telegram
2. Send any message — it will reply with your **Chat ID**

### 3. Configure the Plugin

Create `~/.config/opencode/telegram-bridge.json`:

```json
{
  "botToken": "YOUR_BOT_TOKEN",
  "chatId": YOUR_CHAT_ID
}
```

### 4. Install the Plugin

```bash
# Clone the repository
git clone https://github.com/spotify2junkie/opencode-telegram-bridge.git
cd opencode-telegram-bridge

# Install dependencies and build
cd plugin
npm install
npm run build

# Copy plugin to OpenCode
mkdir -p ~/.config/opencode/plugin
cp dist/index.js ~/.config/opencode/plugin/telegram-bridge.js
```

### 5. Restart OpenCode

After restarting, you'll receive Telegram notifications when OpenCode sessions complete.

## Usage

### Sending Commands to OpenCode

1. When you receive a notification, **reply** to that message
2. Your reply will be sent as a command to OpenCode

Examples:
- Reply "continue with the current task"
- Reply "run the tests"
- Reply "commit these changes"

## How It Works

1. The plugin listens for `session.idle` events from OpenCode
2. When triggered, it fetches session details, todos, and the last assistant response
3. Sends a formatted notification to your Telegram
4. Continuously polls Telegram for replies to your notifications
5. When you reply, the message is sent to OpenCode via `session.prompt` API

## Security

- Bot Token and Chat ID are stored locally in `~/.config/opencode/telegram-bridge.json`
- Only your configured Chat ID can control OpenCode
- No data is sent to any third-party servers

## Troubleshooting

### Not receiving notifications

1. Verify your config file is correct
2. Test your Bot Token: visit `https://api.telegram.org/botYOUR_TOKEN/getMe`
3. Send a message to your bot first (bots can only reply to users who initiated conversation)

### Commands not executing

1. Make sure you're replying to a notification message (contains Session ID)
2. Check OpenCode logs to confirm commands are being received

## Credits

This project was inspired by and learned from:
- [Davasny/opencode-telegram-notification-plugin](https://github.com/Davasny/opencode-telegram-notification-plugin) — Original notification plugin architecture

This version adds:
- Bidirectional communication (send commands back to OpenCode)
- Full response content in notifications
- Long message chunking
- Simplified setup without server deployment

## License

MIT
