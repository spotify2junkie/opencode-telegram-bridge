import type { Plugin } from "@opencode-ai/plugin";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const CONFIG_FILE = join(CONFIG_DIR, "telegram-bridge.json");
const POLL_INTERVAL_MS = 3000;
const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

interface Config {
  botToken: string;
  chatId: number;
  lastUpdateId?: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    reply_to_message?: {
      text?: string;
    };
  };
}

function loadConfig(): Config | null {
  try {
    if (existsSync(CONFIG_FILE)) {
      const data = readFileSync(CONFIG_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch {}
  return null;
}

function saveConfig(config: Config): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch {}
}

function log(client: ReturnType<typeof import("@opencode-ai/sdk").createOpencodeClient>, level: string, message: string) {
  client.app.log({ body: { service: "TelegramBridge", level, message } }).catch(() => {});
}

async function sendTelegramMessage(botToken: string, chatId: number, text: string): Promise<boolean> {
  const url = `${TELEGRAM_API_BASE}${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  return res.ok;
}

async function getUpdates(botToken: string, offset?: number): Promise<TelegramUpdate[]> {
  const url = `${TELEGRAM_API_BASE}${botToken}/getUpdates?timeout=0${offset ? `&offset=${offset}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.result || [];
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function extractSessionId(text: string): string | null {
  const match = text.match(/Session ID: `([^`]+)`/);
  return match ? match[1] : null;
}

export const TelegramBridge: Plugin = async ({ client, directory }) => {
  const config = loadConfig();
  
  if (!config) {
    log(client, "error", `Config not found. Create ${CONFIG_FILE} with { "botToken": "YOUR_TOKEN", "chatId": YOUR_CHAT_ID }`);
    return { event: async () => {} };
  }

  const projectName = directory?.split("/").pop() || "Unknown";
  let currentSessionId: string | null = null;
  let lastUpdateId = config.lastUpdateId || 0;

  const processUpdates = async () => {
    try {
      const updates = await getUpdates(config.botToken, lastUpdateId + 1);
      
      for (const update of updates) {
        lastUpdateId = update.update_id;
        
        if (update.message?.chat?.id === config.chatId && update.message.text) {
          const text = update.message.text;
          
          if (text.startsWith("/")) continue;
          
          let targetSessionId = currentSessionId;
          
          if (update.message.reply_to_message?.text) {
            const replySessionId = extractSessionId(update.message.reply_to_message.text);
            if (replySessionId) targetSessionId = replySessionId;
          }
          
          if (targetSessionId) {
            log(client, "info", `Executing command from Telegram: ${text}`);
            
            try {
              await client.session.prompt({
                path: { id: targetSessionId },
                body: { parts: [{ type: "text", text }] },
              });
              await sendTelegramMessage(config.botToken, config.chatId, `✅ Command sent: ${text.substring(0, 50)}...`);
            } catch (e) {
              log(client, "error", `Failed to execute command: ${e}`);
            }
          } else {
            await sendTelegramMessage(config.botToken, config.chatId, "No active session. Reply to a notification to send commands.");
          }
        }
      }
      
      if (updates.length > 0) {
        config.lastUpdateId = lastUpdateId;
        saveConfig(config);
      }
    } catch (e) {
      log(client, "error", `Polling error: ${e}`);
    }
  };

  const pollLoop = async () => {
    while (true) {
      await processUpdates();
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  };

  pollLoop();

  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        const sessionId = event.properties.sessionID;
        currentSessionId = sessionId;

        try {
          const session = await client.session.get({ path: { id: sessionId } });
          const messages = await client.session.messages({ path: { id: sessionId } });
          
          const lastUserMsg = [...(messages.data || [])].reverse().find((m: any) => m.info?.role === "user");
          const durationMs = lastUserMsg?.info?.time?.created ? Date.now() - lastUserMsg.info.time.created : undefined;

          let todos: any[] = [];
          try {
            const todoRes = await client.session.todo({ path: { id: sessionId } });
            if (!todoRes.error && todoRes.data) {
              todos = todoRes.data;
            }
          } catch {}

          const completed = todos.filter((t) => t.status === "completed").length;
          const pending = todos.filter((t) => t.status === "pending");

          const lines = [
            "✅ *OpenCode Session Complete*",
            "",
            `📁 Project: \`${projectName}\``,
          ];

          if (!session.error && session.data?.title) {
            lines.push(`📋 Title: \`${session.data.title}\``);
          }

          if (durationMs) {
            lines.push(`⏱️ Duration: ${formatDuration(durationMs)}`);
          }

          if (todos.length > 0) {
            lines.push(`📝 Progress: ${completed}/${todos.length} tasks`);
            if (pending.length > 0) {
              lines.push("");
              lines.push("*Pending:*");
              pending.slice(0, 3).forEach((t) => lines.push(`  • ${t.content}`));
            }
          }

          lines.push("");
          lines.push("Reply to this message to send commands to OpenCode.");
          lines.push(`Session ID: \`${sessionId}\``);

          await sendTelegramMessage(config.botToken, config.chatId, lines.join("\n"));
          log(client, "info", "Notification sent to Telegram");
        } catch (e) {
          log(client, "error", `Failed to send notification: ${e}`);
        }
      }

      if (event.type === "session.active") {
        currentSessionId = event.properties.sessionID;
      }
    },
  };
};

export default TelegramBridge;
