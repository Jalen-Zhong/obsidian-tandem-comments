# Grok Bot webhook

This is a personal fork of [leonpawelzik/obsidian-tandem-comments](https://github.com/leonpawelzik/obsidian-tandem-comments) (MIT). The plugin id is `tandem-comments-grok-webhook`. When you save a new open comment, or a reply on a thread that is still open, it POSTs a wake to a [Grok Bot](https://x.ai) routine webhook so an assistant can run without waiting for the next poll.

The toggle defaults to off. Nothing is sent until you enable it and paste a URL and sender key.

## Settings

Open **Settings → Tandem Comments (Grok webhook) → Grok Bot webhook**.

| Setting | Data key | What to paste |
|---|---|---|
| Wake Grok on new comments | `webhookEnabled` | Off by default |
| Webhook URL | `webhookUrl` | Full webhook URL from the Grok Bot routine panel |
| Webhook sender key | `webhookSenderKey` | Bearer sender key from the same panel |

The key is stored only in this vault's plugin data, `.obsidian/plugins/tandem-comments-grok-webhook/data.json`. It is not written into notes, not committed by this repository, and not written to the console. Do not copy `data.json` into git.

## When it sends

A wake is sent after the note file is saved successfully.

- **`comment_created`** — a new comment id whose status is `open` and whose thread has a message.
- **`comment_replied`** — a new thread entry on a comment that was already `open` and is still `open`.

It does not send when a thread is resolved, when a resolved thread is reopened without a new message, when an existing message is only edited, or when a suggestion is saved with no explanation (the thread is empty until someone writes one).

Author check: this plugin has no assistant account. The newest message must be signed with this device's display name (Settings → Display name, otherwise the OS account name, otherwise `Me`). Assistant replies use their own author name, and edits made by writing the file directly do not go through this save path, so they do not wake the bot. If your display name is exactly the assistant's author string, those messages are treated as yours.

The same note path, comment id, event, and message text are not sent again for 3 seconds. A different reply on that comment still sends. A failed request does not block the comment from saving; the first failure in a row is logged once, without the URL or the key, and the next save can try again.

## Request

`POST` the webhook URL.

```
Authorization: Bearer <sender key>
Content-Type: application/json
```

```json
{
  "vaultRelativePath": "folder/note.md",
  "commentId": "a1f3",
  "lastText": "Too aggressive?",
  "author": "Leon",
  "noteTitle": "note",
  "event": "comment_created"
}
```

`vaultRelativePath` is the note path relative to the vault, including `.md` (`TFile.path`). `noteTitle` is the file basename without the extension. `event` is `comment_created` or `comment_replied`. `lastText` and `author` are the newest thread entry.

## Install

Build, or use the `main.js` already produced at the repo root:

```bash
npm install
npm run build
```

That writes `main.js`. `manifest.json` and `styles.css` are already in the repo.

1. In Obsidian, disable and remove the community plugin **Tandem Comments** (`tandem-comments`). Leaving it enabled loads both plugins.
2. Turn on **Settings → Community plugins**.
3. Copy these three files into `<vault>/.obsidian/plugins/tandem-comments-grok-webhook/`:
   - `main.js`
   - `manifest.json`
   - `styles.css`
4. Reload Obsidian and enable **Tandem Comments (Grok webhook)**.
5. Paste the routine webhook URL and sender key, then turn on **Wake Grok on new comments**.

The folder name must match the manifest id, `tandem-comments-grok-webhook`.

## License

Upstream work is copyright Leon Pawelzik and released under the MIT license in `LICENSE`. This fork keeps that notice.
