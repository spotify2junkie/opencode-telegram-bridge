# OpenCode Telegram Bridge

双向通信：OpenCode ↔ Telegram，无需部署任何服务器。

## 功能

- ✅ OpenCode 任务完成时发送通知到 Telegram
- ✅ 在 Telegram 回复消息发送指令到 OpenCode
- ✅ 显示任务进度（todos）
- ✅ 无需部署，纯本地运行

## 安装

### 1. 创建 Telegram Bot

1. 在 Telegram 中搜索 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot` 创建新 bot
3. 记下返回的 **Bot Token**（格式：`123456789:ABCdefGHI...`）

### 2. 获取你的 Chat ID

1. 在 Telegram 中搜索 [@userinfobot](https://t.me/userinfobot)
2. 发送任意消息，它会返回你的 **Chat ID**

### 3. 配置插件

创建配置文件 `~/.config/opencode/telegram-bridge.json`：

```json
{
  "botToken": "YOUR_BOT_TOKEN",
  "chatId": YOUR_CHAT_ID
}
```

### 4. 安装插件

```bash
# 克隆仓库
git clone https://github.com/spotify2junkie/opencode-telegram-bridge.git
cd opencode-telegram-bridge

# 安装依赖并构建
cd plugin
npm install
npm run build

# 复制插件到 OpenCode
mkdir -p ~/.config/opencode/plugin
cp dist/index.js ~/.config/opencode/plugin/telegram-bridge.js
```

### 5. 重启 OpenCode

重启后，当 OpenCode 任务完成时会收到 Telegram 通知。

## 使用方法

### 发送指令到 OpenCode

1. 当收到通知后，**回复**该通知消息
2. 你发送的内容会作为指令传给 OpenCode

例如：
- 回复 "继续执行"
- 回复 "检查一下测试是否通过"
- 回复 "提交这些改动"

## 安全说明

- Bot Token 和 Chat ID 存储在本地 `~/.config/opencode/telegram-bridge.json`
- 只有你配置的 Chat ID 能控制 OpenCode
- 不会向任何第三方服务器发送数据

## 故障排查

### 没有收到通知

1. 检查配置文件是否正确
2. 确认 Bot Token 有效：访问 `https://api.telegram.org/botYOUR_TOKEN/getMe`
3. 先给你的 Bot 发送一条消息（Bot 只能回复先发起对话的用户）

### 命令没有执行

1. 确保回复的是通知消息（包含 Session ID）
2. 查看 OpenCode 日志确认是否收到命令

## License

MIT
