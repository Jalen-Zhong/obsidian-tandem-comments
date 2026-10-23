import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentEntry, CommentMap } from "../src/types";
import {
  WEBHOOK_DEBOUNCE_MS,
  WebhookNotifier,
  buildWebhookPayload,
  collectOpenCommentWakes,
  postWebhookWithFetch,
  webhookDebounceKey,
  webhookHttpRequest,
  type WebhookPayload,
  type WebhookPoster,
} from "../src/webhook";

const DEVICE = "Leon";

function entry(author: string, text: string, status: "open" | "resolved" = "open"): CommentEntry {
  return {
    anchor: { exact: "cut prices hard" },
    status,
    thread: [{ author, ts: "2026-06-10T10:24:00.000Z", text }],
  };
}

function replied(base: CommentEntry, author: string, text: string): CommentEntry {
  return {
    ...base,
    status: "open",
    thread: [...base.thread, { author, ts: "2026-06-10T11:00:00.000Z", text }],
  };
}

describe("collectOpenCommentWakes", () => {
  it("wakes for a new open comment and a reply on a thread that is still open", () => {
    const before: CommentMap = { a1: entry(DEVICE, "First") };
    const after: CommentMap = {
      a1: replied(before.a1, DEVICE, "Follow-up"),
      b2: entry(DEVICE, "New thread"),
    };

    expect(collectOpenCommentWakes(before, after, DEVICE)).toEqual([
      { event: "comment_replied", commentId: "a1", author: DEVICE, lastText: "Follow-up" },
      { event: "comment_created", commentId: "b2", author: DEVICE, lastText: "New thread" },
    ]);
  });

  it("skips resolved threads, edits, other authors, and suggestions with no message", () => {
    const open = entry(DEVICE, "First");
    const before: CommentMap = {
      open,
      resolved: entry(DEVICE, "Done", "resolved"),
      bot: entry("Claude", "Question"),
    };
    const after: CommentMap = {
      open: {
        ...open,
        thread: [{ ...open.thread[0], text: "Edited in place" }],
      },
      resolved: replied(before.resolved, DEVICE, "Reopened text"),
      bot: replied(before.bot, "Claude", "I changed the wording."),
      bare: {
        anchor: { exact: "prices" },
        status: "open",
        thread: [],
        suggestion: { replacement: "cost", author: DEVICE, ts: "2026-06-10T12:00:00.000Z" },
      },
      closed: entry(DEVICE, "Already resolved", "resolved"),
    };
    after.resolved.status = "resolved";

    expect(collectOpenCommentWakes(before, after, DEVICE)).toEqual([]);
  });

  it("treats only this device's display name as the user", () => {
    const before: CommentMap = {};
    const after: CommentMap = { a1: entry("Claude", "A note from the assistant") };
    expect(collectOpenCommentWakes(before, after, DEVICE)).toEqual([]);
    expect(collectOpenCommentWakes(before, after, "Claude")).toEqual([
      {
        event: "comment_created",
        commentId: "a1",
        author: "Claude",
        lastText: "A note from the assistant",
      },
    ]);
  });

  it("wakes when a suggestion is created with an explanation", () => {
    const after: CommentMap = {
      s1: {
        ...entry(DEVICE, "Prefer the quieter verb."),
        suggestion: { replacement: "reduce prices", author: DEVICE, ts: "2026-06-10T12:00:00.000Z" },
      },
    };
    expect(collectOpenCommentWakes({}, after, DEVICE)).toEqual([
      {
        event: "comment_created",
        commentId: "s1",
        author: DEVICE,
        lastText: "Prefer the quieter verb.",
      },
    ]);
  });
});

describe("webhook payload", () => {
  it("uses the Grok Bot field names and omits the old keys", () => {
    const payload = buildWebhookPayload(
      { event: "comment_created", commentId: "a1f3", author: "Leon", lastText: "Too aggressive?" },
      "notes/draft.md",
      "draft"
    );
    expect(payload).toEqual({
      vaultRelativePath: "notes/draft.md",
      commentId: "a1f3",
      lastText: "Too aggressive?",
      author: "Leon",
      noteTitle: "draft",
      event: "comment_created",
    });
    const keys = Object.keys(payload);
    expect(keys).toEqual([
      "vaultRelativePath",
      "commentId",
      "lastText",
      "author",
      "noteTitle",
      "event",
    ]);
    for (const dropped of ["vaultPath", "text", "status", "createdAt", "plugin"]) {
      expect(keys).not.toContain(dropped);
    }
  });
});

describe("WebhookNotifier", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function harness(poster: WebhookPoster, now = 1_000) {
    const notifier = new WebhookNotifier(poster);
    const settings = {
      webhookEnabled: true,
      webhookUrl: "https://example.test/grok",
      webhookSenderKey: "local-test-sender",
    };
    const notify = (before: CommentMap, after: CommentMap, at = now) =>
      notifier.notify({
        settings,
        vaultRelativePath: "notes/draft.md",
        noteTitle: "draft",
        deviceAuthor: DEVICE,
        before,
        after,
        now: at,
      });
    return { notify, settings };
  }

  it("POSTs the bearer token and JSON body without logging the key", async () => {
    const calls: { url: string; senderKey: string; body: string }[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { notify } = harness(async (url, senderKey, body) => {
      calls.push({ url, senderKey, body });
      return { ok: true, status: 204 };
    });

    await notify({}, { a1f3: entry(DEVICE, "Too aggressive?") });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://example.test/grok");
    expect(calls[0].senderKey).toBe("local-test-sender");
    const parsed = JSON.parse(calls[0].body) as WebhookPayload;
    expect(parsed).toEqual({
      vaultRelativePath: "notes/draft.md",
      commentId: "a1f3",
      lastText: "Too aggressive?",
      author: DEVICE,
      noteTitle: "draft",
      event: "comment_created",
    });
    expect(warn).not.toHaveBeenCalled();
    expect(JSON.stringify(calls)).not.toContain("Bearer ");
  });

  it("collapses a duplicate comment wake and still sends a different reply", async () => {
    const bodies: string[] = [];
    const { notify } = harness(async (_url, _key, body) => {
      bodies.push(body);
      return { ok: true, status: 200 };
    });
    const created: CommentMap = { a1: entry(DEVICE, "Hello") };

    await notify({}, created, 5_000);
    await notify({}, created, 5_000 + WEBHOOK_DEBOUNCE_MS - 1);
    await notify(created, { a1: replied(created.a1, DEVICE, "And another") }, 5_000 + 10);

    expect(bodies).toHaveLength(2);
    expect(JSON.parse(bodies[0]).event).toBe("comment_created");
    expect(JSON.parse(bodies[1]).event).toBe("comment_replied");
    expect(JSON.parse(bodies[1]).lastText).toBe("And another");
    expect(webhookDebounceKey(JSON.parse(bodies[0]) as WebhookPayload)).not.toBe(
      webhookDebounceKey(JSON.parse(bodies[1]) as WebhookPayload)
    );
  });

  it("does not throw or repeat the console warning when the request fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { notify } = harness(async () => {
      throw new Error("network down; token local-test-sender");
    });
    const created: CommentMap = { a1: entry(DEVICE, "Hello") };

    await expect(notify({}, created, 1)).resolves.toBeUndefined();
    await expect(notify({}, { b2: entry(DEVICE, "Second") }, 2)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain("local-test-sender");
  });

  it("stays quiet when the webhook is disabled", async () => {
    const poster = vi.fn<WebhookPoster>(async () => ({ ok: true, status: 200 }));
    const notifier = new WebhookNotifier(poster);
    await notifier.notify({
      settings: { webhookEnabled: false, webhookUrl: "https://example.test/grok", webhookSenderKey: "k" },
      vaultRelativePath: "notes/draft.md",
      noteTitle: "draft",
      deviceAuthor: DEVICE,
      before: {},
      after: { a1: entry(DEVICE, "Hello") },
    });
    expect(poster).not.toHaveBeenCalled();
  });
});

describe("postWebhookWithFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends POST with the bearer header and JSON content type", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await postWebhookWithFetch(
      "https://example.test/grok",
      "local-test-sender",
      "{\"commentId\":\"a1\"}"
    );

    expect(result).toEqual({ ok: true, status: 204 });
    const request = webhookHttpRequest("local-test-sender", "{\"commentId\":\"a1\"}");
    expect(request).toEqual({
      method: "POST",
      headers: {
        Authorization: "Bearer local-test-sender",
        "Content-Type": "application/json",
      },
      body: "{\"commentId\":\"a1\"}",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/grok", request);
  });
});
