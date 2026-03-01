import type { Plugin } from "@opencode-ai/plugin";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const CONFIG_FILE = join(CONFIG_DIR, "telegram-bridge.json");
const POLL_INTERVAL_MS = 3000;
const TELEGRAM_API_BASE = "https://api.telegram.org/bot";
const TELEGRAM_SEND_RETRIES = 3;
const COMPLETION_STABILITY_MS = 12000;
const COMPLETION_RECHECK_MS = 3000;
const COMPLETION_MAX_EMPTY_RETRIES = 4;
const STATUS_ACTIVITY_WINDOW_MS = 90000;
const STATUS_QUIET_WINDOW_MS = 20000;

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

type LogLevel = "debug" | "info" | "warn" | "error";

function log(client: ReturnType<typeof import("@opencode-ai/sdk").createOpencodeClient>, level: LogLevel, message: string) {
  client.app.log({ body: { service: "TelegramBridge", level, message } }).catch(() => {});
}

async function sendTelegramMessage(botToken: string, chatId: number, text: string): Promise<boolean> {
  const MAX_LENGTH = 4000;
  const url = `${TELEGRAM_API_BASE}${botToken}/sendMessage`;

  const postChunk = async (chunk: string): Promise<boolean> => {
    for (let attempt = 0; attempt < TELEGRAM_SEND_RETRIES; attempt++) {
      try {
        const markdownRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: "Markdown" }),
        });

        if (markdownRes.ok) {
          return true;
        }

        const plainRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: chunk }),
        });

        if (plainRes.ok) {
          return true;
        }
      } catch {
      }

      if (attempt < TELEGRAM_SEND_RETRIES - 1) {
        const delayMs = 300 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    return false;
  };
  
  if (text.length <= MAX_LENGTH) {
    return postChunk(text);
  }
  
  // Split long messages
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }
    // Try to split at newline
    let splitIdx = remaining.lastIndexOf("\n", MAX_LENGTH);
    if (splitIdx < MAX_LENGTH / 2) {
      splitIdx = remaining.lastIndexOf(" ", MAX_LENGTH);
    }
    if (splitIdx < 0) splitIdx = MAX_LENGTH;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trim();
  }
  
  let allOk = true;
  for (const chunk of chunks) {
    const ok = await postChunk(chunk);
    if (!ok) allOk = false;
    await new Promise(r => setTimeout(r, 100));
  }
  return allOk;
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

function formatTimeAgo(timestampMs?: number): string {
  if (!timestampMs) return "unknown";
  const delta = Date.now() - timestampMs;
  if (delta < 0) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

function isLikelySubagentTitle(title?: string): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return t.includes("subagent") || t.includes("@explore") || t.includes("@librarian") || t.includes("@oracle");
}

function extractTextContent(parts: any[] | undefined): string {
  if (!parts) return "";
  return parts
    .filter((part: any) => part.type === "text")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
}

function getLastUserMessageTime(messages: any[]): number | undefined {
  const lastUser = [...messages].reverse().find((message: any) => message.info?.role === "user");
  return lastUser?.info?.time?.created;
}

function getLastAssistantEvidence(messages: any[]): { createdAt?: number; key?: string; content: string } {
  for (const message of [...messages].reverse()) {
    if (message.info?.role !== "assistant") continue;
    const content = extractTextContent(message.parts);
    const createdAt = message.info?.time?.created;
    const key = message.id || createdAt;
    if (content) {
      return { createdAt, key, content };
    }
  }
  return { content: "" };
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
  const completionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const completionFingerprints = new Map<string, string>();
  const completionInFlight = new Set<string>();
  const completionEmptyRetries = new Map<string, number>();
  const sessionLastActivity = new Map<string, number>();
  const sessionIdleState = new Map<string, boolean>();
  const sessionBusyUntil = new Map<string, number>();
  const sessionLastUserMessageAt = new Map<string, number>();
  const sessionLastAssistantNonEmptyAt = new Map<string, number>();
  const sessionLastNotifiedAssistantKey = new Map<string, string>();

  const cancelCompletionTimer = (sessionId: string) => {
    const timer = completionTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      completionTimers.delete(sessionId);
    }
  };

  const buildFingerprint = (messages: any[], todos: any[]): string => {
    const messageTail = messages.slice(-5).map((m: any) => `${m.id || ""}:${m.info?.role || ""}`).join("|");
    const todoTail = todos.map((t: any) => `${t.content}:${t.status}`).join("|");
    return `${messages.length}::${messageTail}::${todoTail}`;
  };

  const markSessionBusy = (sessionId: string, baseTime = Date.now()) => {
    sessionLastActivity.set(sessionId, baseTime);
    sessionIdleState.set(sessionId, false);
    sessionBusyUntil.set(sessionId, baseTime + STATUS_QUIET_WINDOW_MS);
    cancelCompletionTimer(sessionId);
  };

  const sendCompletionIfStable = async (sessionId: string) => {
    if (completionInFlight.has(sessionId)) {
      return;
    }

    completionInFlight.add(sessionId);
    try {
      const [sessionA, messagesResA, todoResA] = await Promise.all([
        client.session.get({ path: { id: sessionId } }),
        client.session.messages({ path: { id: sessionId } }),
        client.session.todo({ path: { id: sessionId } }).catch(() => ({ error: undefined, data: [] as any[] })),
      ]);

      const title = !sessionA.error && sessionA.data?.title ? sessionA.data.title : undefined;
      const parentID = !sessionA.error && sessionA.data ? (sessionA.data as any).parentID : undefined;
      if (typeof parentID === "string" && parentID.length > 0) {
        completionFingerprints.set(sessionId, "subagent-skipped");
        completionEmptyRetries.delete(sessionId);
        log(client, "info", `Skip completion notification for child session ${sessionId}`);
        return;
      }
      if (isLikelySubagentTitle(title)) {
        completionFingerprints.set(sessionId, "subagent-skipped");
        completionEmptyRetries.delete(sessionId);
        log(client, "info", `Skip completion notification for subagent session ${sessionId}`);
        return;
      }

      const messagesA = messagesResA.data || [];
      const todosA = !todoResA.error && todoResA.data ? todoResA.data : [];
      const fingerprintA = buildFingerprint(messagesA, todosA);
      const now = Date.now();
      const busyUntil = sessionBusyUntil.get(sessionId) || 0;
      if (now < busyUntil) {
        scheduleCompletionNotification(sessionId);
        return;
      }

      await new Promise((r) => setTimeout(r, COMPLETION_RECHECK_MS));

      const [messagesResB, todoResB] = await Promise.all([
        client.session.messages({ path: { id: sessionId } }),
        client.session.todo({ path: { id: sessionId } }).catch(() => ({ error: undefined, data: [] as any[] })),
      ]);

      const messagesB = messagesResB.data || [];
      const todosB = !todoResB.error && todoResB.data ? todoResB.data : [];
      const fingerprintB = buildFingerprint(messagesB, todosB);

      if (fingerprintA !== fingerprintB) {
        return;
      }

      const previousFingerprint = completionFingerprints.get(sessionId);
      if (previousFingerprint === fingerprintB) {
        return;
      }

      const lastUserMessageAt = getLastUserMessageTime(messagesB);
      if (lastUserMessageAt) {
        sessionLastUserMessageAt.set(sessionId, lastUserMessageAt);
      }

      const assistantEvidence = getLastAssistantEvidence(messagesB);
      if (assistantEvidence.createdAt) {
        sessionLastAssistantNonEmptyAt.set(sessionId, assistantEvidence.createdAt);
      }

      const finalLastUserAt = sessionLastUserMessageAt.get(sessionId) || lastUserMessageAt;
      const finalAssistantAt = sessionLastAssistantNonEmptyAt.get(sessionId) || assistantEvidence.createdAt;
      const hasAssistantAfterUser =
        typeof finalAssistantAt === "number" && typeof finalLastUserAt === "number"
          ? finalAssistantAt > finalLastUserAt
          : typeof finalAssistantAt === "number";

      if (!hasAssistantAfterUser || !assistantEvidence.content) {
        const retryCount = (completionEmptyRetries.get(sessionId) || 0) + 1;
        if (retryCount <= COMPLETION_MAX_EMPTY_RETRIES) {
          completionEmptyRetries.set(sessionId, retryCount);
          scheduleCompletionNotification(sessionId);
          log(client, "info", `Waiting for assistant final content for ${sessionId}, retry ${retryCount}/${COMPLETION_MAX_EMPTY_RETRIES}`);
          return;
        }
      }

      const durationMs = finalLastUserAt ? Date.now() - finalLastUserAt : undefined;
      const assistantContent = assistantEvidence.content;
      const assistantKey = assistantEvidence.key ? String(assistantEvidence.key) : undefined;
      if (assistantKey && sessionLastNotifiedAssistantKey.get(sessionId) === assistantKey) {
        return;
      }

      const completed = todosB.filter((t: any) => t.status === "completed").length;
      const pending = todosB.filter((t: any) => t.status === "pending");

      const lines = [
        "✅ *OpenCode Session Complete*",
        "",
        `📁 Project: \`${projectName}\``,
      ];

      if (!sessionA.error && sessionA.data?.title) {
        lines.push(`📋 Title: \`${sessionA.data.title}\``);
      }

      if (durationMs) {
        lines.push(`⏱️ Duration: ${formatDuration(durationMs)}`);
      }

      if (assistantContent) {
        lines.push("");
        lines.push("*Response:*");
        lines.push(assistantContent);
      }

      if (todosB.length > 0) {
        lines.push("");
        lines.push(`📝 Progress: ${completed}/${todosB.length} tasks`);
        if (pending.length > 0) {
          lines.push("*Pending:*");
          pending.forEach((t: any) => lines.push(`  • ${t.content}`));
        }
      }

      lines.push("");
      lines.push("Reply to this message to send commands to OpenCode.");
      lines.push(`Session ID: \`${sessionId}\``);

      const ok = await sendTelegramMessage(config.botToken, config.chatId, lines.join("\n"));
      if (!ok) {
        log(client, "error", `Failed to send completion notification to Telegram for session ${sessionId}`);
        return;
      }

      completionFingerprints.set(sessionId, fingerprintB);
      completionEmptyRetries.delete(sessionId);
      if (assistantKey) {
        sessionLastNotifiedAssistantKey.set(sessionId, assistantKey);
      }
      currentSessionId = sessionId;
      log(client, "info", `Completion notification sent to Telegram for session ${sessionId}`);
    } catch (e) {
      log(client, "error", `Failed to send notification: ${e}`);
    } finally {
      completionInFlight.delete(sessionId);
    }
  };

  const scheduleCompletionNotification = (sessionId: string) => {
    cancelCompletionTimer(sessionId);
    const timer = setTimeout(() => {
      completionTimers.delete(sessionId);
      void sendCompletionIfStable(sessionId);
    }, COMPLETION_STABILITY_MS);
    completionTimers.set(sessionId, timer);
  };

  const buildStatusMessage = async (sessionId: string): Promise<string> => {
    try {
      const [sessionRes, messagesRes, todoRes] = await Promise.all([
        client.session.get({ path: { id: sessionId } }),
        client.session.messages({ path: { id: sessionId } }),
        client.session.todo({ path: { id: sessionId } }).catch(() => ({ error: undefined, data: [] as any[] })),
      ]);

      const messages = messagesRes.data || [];
      const todos = !todoRes.error && todoRes.data ? todoRes.data : [];
      const fingerprint = buildFingerprint(messages, todos);
      const parentID = !sessionRes.error && sessionRes.data ? (sessionRes.data as any).parentID : undefined;
      const isChildSession = typeof parentID === "string" && parentID.length > 0;
      const pending = todos.filter((t: any) => t.status === "pending");
      const completed = todos.filter((t: any) => t.status === "completed").length;
      const assistantEvidence = getLastAssistantEvidence(messages);
      const lastAssistantCreated = assistantEvidence.createdAt;
      const lastUserCreated = getLastUserMessageTime(messages);
      if (lastUserCreated) {
        sessionLastUserMessageAt.set(sessionId, lastUserCreated);
      }
      if (lastAssistantCreated) {
        sessionLastAssistantNonEmptyAt.set(sessionId, lastAssistantCreated);
      }
      const lastActivity = sessionLastActivity.get(sessionId) || Math.max(lastAssistantCreated || 0, lastUserCreated || 0);
      const recentlyActive = Date.now() - lastActivity <= STATUS_ACTIVITY_WINDOW_MS;
      const isIdle = sessionIdleState.get(sessionId) === true;
      const busyUntil = sessionBusyUntil.get(sessionId) || 0;
      const busyByWindow = Date.now() < busyUntil;
      const hasAssistantAfterUser =
        typeof lastAssistantCreated === "number" && typeof lastUserCreated === "number"
          ? lastAssistantCreated > lastUserCreated
          : typeof lastAssistantCreated === "number";

      let state = "QUIET (unconfirmed)";
      if (completionInFlight.has(sessionId)) {
        state = "FINALIZING";
      } else if (completionTimers.has(sessionId)) {
        state = "STABILIZING";
      } else if (pending.length > 0 || recentlyActive || !isIdle || busyByWindow || !hasAssistantAfterUser) {
        state = "BUSY";
      } else if (completionFingerprints.get(sessionId) === fingerprint) {
        state = "COMPLETED (notified)";
      } else if (isIdle) {
        state = "IDLE (quiet)";
      }

      let confidence = "medium";
      if (state === "COMPLETED (notified)" || state === "FINALIZING") {
        confidence = "high";
      } else if (state === "QUIET (unconfirmed)" || state === "IDLE (quiet)") {
        confidence = recentlyActive ? "low" : "medium";
      }

      const lines = [
        "📡 *OpenCode Session Status*",
        "",
        `Session ID: \`${sessionId}\``,
        `State: *${state}*`,
        `Confidence: ${confidence}`,
        `Progress: ${completed}/${todos.length || 0} tasks`,
        `Last user input: ${formatTimeAgo(lastUserCreated)}`,
        `Last assistant output: ${formatTimeAgo(lastAssistantCreated)}`,
        `Recent activity: ${recentlyActive ? "yes" : "no"}`,
      ];

      if (!sessionRes.error && sessionRes.data?.title) {
        lines.splice(3, 0, `Title: \`${sessionRes.data.title}\``);
      }

      if (isChildSession) {
        lines.splice(4, 0, "Session kind: child/subagent");
      }

      if (pending.length > 0) {
        lines.push("");
        lines.push("*Pending:*\n" + pending.slice(0, 5).map((t: any) => `• ${t.content}`).join("\n"));
      }

      const preview = assistantEvidence.content.slice(0, 300).trim();
      if (preview) {
        lines.push("");
        lines.push(`Preview: ${preview}${preview.length >= 300 ? "..." : ""}`);
      }

      return lines.join("\n");
    } catch (e) {
      log(client, "error", `Failed to get status for session ${sessionId}: ${e}`);
      return `❌ Failed to check status for session \`${sessionId}\``;
    }
  };

  const processUpdates = async () => {
    try {
      const updates = await getUpdates(config.botToken, lastUpdateId + 1);
      
      for (const update of updates) {
        lastUpdateId = update.update_id;
        
        if (update.message?.chat?.id === config.chatId && update.message.text) {
          const text = update.message.text.trim();
          
          let targetSessionId = currentSessionId;
          
          if (update.message.reply_to_message?.text) {
            const replySessionId = extractSessionId(update.message.reply_to_message.text);
            if (replySessionId) targetSessionId = replySessionId;
          }

          if (text.startsWith("/status")) {
            const [, explicitSessionId] = text.split(/\s+/, 2);
            const statusSessionId = explicitSessionId || targetSessionId;

            if (!statusSessionId) {
              await sendTelegramMessage(config.botToken, config.chatId, "No active session. Reply to a notification or use /status <session_id>.");
              continue;
            }

            const statusMessage = await buildStatusMessage(statusSessionId);
            await sendTelegramMessage(config.botToken, config.chatId, statusMessage);
            continue;
          }

          if (text.startsWith("/help")) {
            await sendTelegramMessage(
              config.botToken,
              config.chatId,
              "Available commands:\n/status - check current session status\n/status <session_id> - check specific session status\n/help - show this help\n\nOr reply to a completion message to send a normal prompt to OpenCode."
            );
            continue;
          }

          if (text.startsWith("/")) continue;
          
          if (targetSessionId) {
            log(client, "info", `Executing command from Telegram: ${text}`);
            
            try {
              await client.session.prompt({
                path: { id: targetSessionId },
                body: { parts: [{ type: "text", text }] },
              });
              currentSessionId = targetSessionId;
              markSessionBusy(targetSessionId);
              sessionLastUserMessageAt.set(targetSessionId, Date.now());
              await sendTelegramMessage(config.botToken, config.chatId, `✅ Command sent: ${text}`);
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
      const maybeSessionId =
        "properties" in event && event.properties && "sessionID" in event.properties
          ? event.properties.sessionID
          : undefined;

      if (typeof maybeSessionId === "string") {
        sessionLastActivity.set(maybeSessionId, Date.now());
        if (event.type !== "session.idle") {
          markSessionBusy(maybeSessionId);
        }
      }

      if (event.type === "session.idle") {
        const sessionId = event.properties.sessionID;
        sessionLastActivity.set(sessionId, Date.now());
        sessionIdleState.set(sessionId, true);
        scheduleCompletionNotification(sessionId);
      }
    },
  };
};

export default TelegramBridge;
