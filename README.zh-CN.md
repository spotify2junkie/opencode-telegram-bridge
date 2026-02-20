# OpenCode Telegram Bridge

中文 | [English](README.md)

OpenCode 与 Telegram 之间的双向通信 —— 无需部署任何服务器。

## 功能

- ✅ OpenCode 任务完成时发送通知到 Telegram
- ✅ 在 Telegram 回复消息发送指令到 OpenCode
- ✅ 在通知中查看任务进度（todos）
- ✅ 查看完整的助手回复内容
- ✅ 无需服务器部署 —— 完全本地运行

## 安装

### 1. 创建 Telegram Bot

1. 在 Telegram 中搜索 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot` 并按提示操作
3. 保存返回的 **Bot Token**（格式：`123456789:ABCdefGHI...`）

### 2. 获取你的 Chat ID

1. 在 Telegram 中搜索 [@userinfobot](https://t.me/userinfobot)
2. 发送任意消息 —— 它会返回你的 **Chat ID**

### 3. 配置插件

创建 `~/.config/opencode/telegram-bridge.json`：

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
2. 你的回复会作为指令发送给 OpenCode

示例：
- 回复 "继续当前任务"
- 回复 "运行测试"
- 回复 "提交这些改动"

## 工作原理

1. 插件监听 OpenCode 的 `session.idle` 事件
2. 触发时，获取会话详情、待办事项和最后一条助手回复
3. 发送格式化的通知到你的 Telegram
4. 持续轮询 Telegram 获取对通知的回复
5. 当你回复时，消息通过 `session.prompt` API 发送给 OpenCode

## 安全说明

- Bot Token 和 Chat ID 存储在本地 `~/.config/opencode/telegram-bridge.json`
- 只有你配置的 Chat ID 能控制 OpenCode
- 不会向任何第三方服务器发送数据

## 故障排查

### 没有收到通知

1. 检查配置文件是否正确
2. 测试 Bot Token：访问 `https://api.telegram.org/botYOUR_TOKEN/getMe`
3. 先给你的 Bot 发送一条消息（Bot 只能回复先发起对话的用户）

### 命令没有执行

1. 确保回复的是通知消息（包含 Session ID）
2. 查看 OpenCode 日志确认是否收到命令

## 致谢

本项目参考并学习了：
- [Davasny/opencode-telegram-notification-plugin](https://github.com/Davasny/opencode-telegram-notification-plugin) —— 原始通知插件架构

本版本新增：
- 双向通信（发送指令回 OpenCode）
- 通知中显示完整回复内容
- 长消息分片发送
- 简化配置，无需服务器部署

## 许可证

MIT
