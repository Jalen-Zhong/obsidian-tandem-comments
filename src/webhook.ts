import type { CommentsSettings } from "./settings-model";
import type { CommentMap } from "./types";

/**
 * Grok Bot routine wake.
 *
 * The plugin does not store an assistant identity. A wake is sent only when
 * the newest thread entry was written by this device's display name
 * (`currentAuthor`: manual override, otherwise the OS account name, otherwise
 * "Me"). Assistant replies are a different author string (the exported skill
 * tells agents to sign with their own name), and file edits made outside this
 * plugin never reach this hook, so those replies do not wake the bot.
 *
 * A suggestion saved with no explanation has an empty thread, so it does not
 * wake until a message is added.
 */

export const WEBHOOK_DEBOUNCE_MS = 3000;

export type WebhookEvent = "comment_created" | "comment_replied";

/** Body posted to a Grok Bot routine webhook. Field names are the live contract. */
export interface WebhookPayload {
  vaultRelativePath: string;
  commentId: string;
  lastText: string;
  author: string;
  noteTitle?: string;
  event?: WebhookEvent;
}

export interface OpenCommentWake {
  event: WebhookEvent;
  commentId: string;
  author: string;
  lastText: string;
}

export interface WebhookPostResult {
  ok: boolean;
  status: number;
}

export type WebhookPoster = (url: string, senderKey: string, body: string) => Promise<WebhookPostResult>;

export interface WebhookNotifyInput {
  settings: Pick<CommentsSettings, "webhookEnabled" | "webhookUrl" | "webhookSenderKey">;
  vaultRelativePath: string;
  noteTitle: string;
  deviceAuthor: string;
  before: CommentMap;
  after: CommentMap;
  now?: number;
}

export function cloneCommentMap(comments: CommentMap): CommentMap {
  return JSON.parse(JSON.stringify(comments)) as CommentMap;
}

/** True when `author` is this device's display name. Empty names never match. */
export function isDeviceAuthor(author: string, deviceAuthor: string): boolean {
  const device = deviceAuthor.trim();
  return device.length > 0 && author.trim() === device;
}

export function collectOpenCommentWakes(
  before: CommentMap,
  after: CommentMap,
  deviceAuthor: string
): OpenCommentWake[] {
  const wakes: OpenCommentWake[] = [];
  for (const [id, comment] of Object.entries(after)) {
    if (comment.status !== "open") continue;
    const last = comment.thread[comment.thread.length - 1];
    if (!last || last.text.trim() === "") continue;
    if (!isDeviceAuthor(last.author, deviceAuthor)) continue;

    const previous = before[id];
    if (!previous) {
      wakes.push({
        event: "comment_created",
        commentId: id,
        author: last.author,
        lastText: last.text,
      });
      continue;
    }
    if (previous.status !== "open") continue;
    if (comment.thread.length > previous.thread.length) {
      wakes.push({
        event: "comment_replied",
        commentId: id,
        author: last.author,
        lastText: last.text,
      });
    }
  }
  return wakes;
}

export function buildWebhookPayload(
  wake: OpenCommentWake,
  vaultRelativePath: string,
  noteTitle: string
): WebhookPayload {
  const payload: WebhookPayload = {
    vaultRelativePath,
    commentId: wake.commentId,
    lastText: wake.lastText,
    author: wake.author,
  };
  const title = noteTitle.trim();
  if (title) payload.noteTitle = title;
  payload.event = wake.event;
  return payload;
}

export function webhookDebounceKey(payload: WebhookPayload): string {
  return [payload.vaultRelativePath, payload.commentId, payload.event ?? "", payload.lastText].join("\0");
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function webhookHttpRequest(senderKey: string, body: string): {
  method: "POST";
  headers: { Authorization: string; "Content-Type": "application/json" };
  body: string;
} {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${senderKey}`,
      "Content-Type": "application/json",
    },
    body,
  };
}

export async function postWebhookWithFetch(
  url: string,
  senderKey: string,
  body: string
): Promise<WebhookPostResult> {
  const response = await fetch(url, webhookHttpRequest(senderKey, body));
  return { ok: response.ok, status: response.status };
}

/**
 * Drops an identical wake (same note, comment, event, and text) for a few
 * seconds. A later message with different text still sends. Failed requests
 * forget the key so the next save can try again.
 */
export class WebhookDebounce {
  private readonly seen = new Map<string, number>();

  constructor(private readonly windowMs = WEBHOOK_DEBOUNCE_MS) {}

  allow(key: string, now = Date.now()): boolean {
    this.prune(now);
    const previous = this.seen.get(key);
    if (previous !== undefined && now - previous < this.windowMs) return false;
    this.seen.set(key, now);
    return true;
  }

  forget(key: string): void {
    this.seen.delete(key);
  }

  private prune(now: number): void {
    for (const [key, at] of this.seen) {
      if (now - at >= this.windowMs) this.seen.delete(key);
    }
  }
}

export class WebhookNotifier {
  private warned = false;
  private readonly debounce = new WebhookDebounce();

  constructor(private readonly post: WebhookPoster = postWebhookWithFetch) {}

  async notify(input: WebhookNotifyInput): Promise<void> {
    try {
      if (!input.settings.webhookEnabled) return;
      const url = input.settings.webhookUrl.trim();
      const senderKey = input.settings.webhookSenderKey.trim();
      if (!url || !senderKey || !isHttpUrl(url)) {
        this.warnOnce(
          "Tandem Comments webhook is enabled but the URL or sender key is missing or not an http(s) URL."
        );
        return;
      }

      const now = input.now ?? Date.now();
      const wakes = collectOpenCommentWakes(input.before, input.after, input.deviceAuthor);
      for (const wake of wakes) {
        const payload = buildWebhookPayload(wake, input.vaultRelativePath, input.noteTitle);
        const key = webhookDebounceKey(payload);
        if (!this.debounce.allow(key, now)) continue;
        try {
          const result = await this.post(url, senderKey, JSON.stringify(payload));
          if (!result.ok) {
            this.debounce.forget(key);
            this.warnOnce(
              `Tandem Comments webhook failed (HTTP ${result.status}). Commenting is unaffected.`
            );
            continue;
          }
          this.warned = false;
        } catch {
          this.debounce.forget(key);
          this.warnOnce("Tandem Comments webhook request failed. Commenting is unaffected.");
        }
      }
    } catch {
      this.warnOnce("Tandem Comments webhook request failed. Commenting is unaffected.");
    }
  }

  private warnOnce(message: string): void {
    if (this.warned) return;
    this.warned = true;
    console.warn(message);
  }
}
