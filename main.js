"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => CommentsPlugin
});
module.exports = __toCommonJS(main_exports);

// src/pending-anchor-saves.ts
var PendingAnchorSaves = class {
  constructor(process) {
    this.process = process;
    this.pending = /* @__PURE__ */ new Map();
    this.running = /* @__PURE__ */ new Map();
    this.changed = /* @__PURE__ */ new Set();
    this.requeued = /* @__PURE__ */ new Set();
    this.deleted = /* @__PURE__ */ new WeakSet();
  }
  queue(file, before, after) {
    if (this.deleted.has(file)) return Promise.resolve();
    this.pending.set(file, { before, after });
    this.changed.delete(file);
    this.requeued.add(file);
    return this.flush(file);
  }
  modified(file) {
    if (!this.pending.has(file)) return Promise.resolve();
    this.changed.add(file);
    return this.flush(file);
  }
  /** A deleted file object must not be saved by subsequent editor teardown. */
  forget(file) {
    this.deleted.add(file);
    this.pending.delete(file);
    this.changed.delete(file);
    this.requeued.delete(file);
  }
  clear() {
    this.pending.clear();
    this.changed.clear();
    this.requeued.clear();
  }
  flush(file) {
    const running = this.running.get(file);
    if (running) return running;
    const job = Promise.resolve().then(async () => {
      do {
        this.requeued.delete(file);
        const discardMismatch = this.changed.delete(file);
        const snapshot = this.pending.get(file);
        if (!snapshot) break;
        await this.process(file, (raw) => {
          if (this.pending.get(file) !== snapshot) return raw;
          if (raw === snapshot.before) {
            this.pending.delete(file);
            return snapshot.after;
          }
          if (raw === snapshot.after || discardMismatch) this.pending.delete(file);
          return raw;
        });
      } while (this.requeued.has(file) || this.changed.has(file));
    }).finally(() => {
      this.running.delete(file);
      if (this.requeued.has(file) || this.changed.has(file)) return this.flush(file);
    });
    this.running.set(file, job);
    return job;
  }
};

// src/main.ts
var import_obsidian5 = require("obsidian");

// src/author.ts
var AUTHOR_OVERRIDE_KEY = "tandem-comments:author-name-override";
var LEGACY_AUTHOR_OVERRIDE_KEY = "author-name-override";
var FALLBACK_AUTHOR = "Me";
function detectOsUsername() {
  var _a, _b;
  try {
    if (typeof require !== "function") return null;
    const os = require("os");
    const name = (_b = (_a = os.userInfo) == null ? void 0 : _a.call(os).username) == null ? void 0 : _b.trim();
    return name ? name : null;
  } catch (e) {
    return null;
  }
}
function resolveAuthorName(override, osUsername) {
  const trimmedOverride = override == null ? void 0 : override.trim();
  if (trimmedOverride) return trimmedOverride;
  if (osUsername) return osUsername;
  return FALLBACK_AUTHOR;
}

// src/confirm-action.ts
var import_obsidian = require("obsidian");
function confirmAction(app, options) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const modal = new class extends import_obsidian.Modal {
      onOpen() {
        this.setTitle(options.title);
        this.contentEl.createEl("p", { text: options.message });
        new import_obsidian.Setting(this.contentEl).addButton((button) => button.setButtonText("Cancel").onClick(() => this.close())).addButton(
          (button) => button.setButtonText(options.confirmLabel).setWarning().onClick(() => {
            finish(true);
            this.close();
          })
        );
      }
      onClose() {
        this.contentEl.empty();
        finish(false);
      }
    }(app);
    modal.open();
  });
}

// src/editor-extension.ts
var import_state2 = require("@codemirror/state");
var import_view = require("@codemirror/view");

// src/reanchor.ts
function mapAnchors(anchors, changes) {
  return anchors.map((a) => ({ id: a.id, from: changes.mapPos(a.from, 1), to: changes.mapPos(a.to, -1) })).filter((a) => a.to > a.from);
}
function isFullReplace(changes) {
  let covered = 0;
  changes.iterChangedRanges((fromA, toA) => {
    covered += toA - fromA;
  });
  return changes.length > 0 && covered / changes.length > 0.5;
}
function changesTouchCommentBlock(changes, oldProseLength, newProseLength) {
  let touches = false;
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (fromA >= oldProseLength || toA > oldProseLength || fromB >= newProseLength || toB > newProseLength) {
      touches = true;
    }
  });
  return touches;
}
function canPreservePendingAnchors(changes, oldProseLength) {
  let ranges = 0;
  let touchesProse = false;
  changes.iterChangedRanges((fromA) => {
    ranges++;
    if (fromA < oldProseLength) touchesProse = true;
  });
  return !isFullReplace(changes) || ranges > 1 || !touchesProse;
}
function shouldPreservePendingAnchors(changes, oldProseLength, isSuggestionAcceptance) {
  return isSuggestionAcceptance || canPreservePendingAnchors(changes, oldProseLength);
}
function mergePendingAnchors(current, pending, recoverableIds) {
  const result = [...current];
  const present = new Set(current.map((anchor) => anchor.id));
  for (const anchor of pending) {
    if (present.has(anchor.id) || !recoverableIds.has(anchor.id) || anchor.to <= anchor.from) continue;
    result.push(anchor);
    present.add(anchor.id);
  }
  result.sort((a, b) => a.from - b.from);
  return result;
}

// src/store.ts
var import_state = require("@codemirror/state");
var SCHEMA_HINT_LINES = [
  '// Schema: { "<id>": { anchor:{exact,prefix,suffix,pos?}, status:open|resolved, thread:[{author,ts,text}], suggestion?:{replacement,author,ts,result?} } }',
  '// Anchor = quote from the prose. To locate: search for "exact", disambiguate via prefix/suffix.',
  // Ohne diese Zeile editieren Agents ohne Skill oft nur die Prosa und lassen
  // Threads unbeantwortet mit veralteten Ankern zurück (Issue #35).
  "// Addressing comments: handle every open id. After acting, append a reply {author: your name, ts, text} to its thread, and if you edited the quoted text, update its anchor to the new wording."
];
var FENCE_OPEN = "```tandem-comments";
var CONTEXT_LEN = 20;
function parseBlockBody(body) {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i].startsWith("//") || lines[i].trim() === "")) i++;
  const data = JSON.parse(lines.slice(i).join("\n"));
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("tandem-comments: top level must be an object");
  }
  return data;
}
function findBlock(raw) {
  const idx = raw.lastIndexOf("\n" + FENCE_OPEN + "\n");
  let proseEnd;
  let from;
  if (idx >= 0) {
    proseEnd = idx;
    from = idx + 1;
  } else if (raw.startsWith(FENCE_OPEN + "\n")) {
    proseEnd = 0;
    from = 0;
  } else {
    return null;
  }
  const bodyStart = from + FENCE_OPEN.length + 1;
  const rest = raw.slice(bodyStart);
  let closeIdx = rest.indexOf("\n```");
  while (closeIdx >= 0 && closeIdx + 4 < rest.length && rest[closeIdx + 4] !== "\n") {
    closeIdx = rest.indexOf("\n```", closeIdx + 1);
  }
  if (closeIdx < 0) return null;
  const trailing = closeIdx + 5 <= rest.length ? rest.slice(closeIdx + 5) : "";
  return { proseEnd, body: rest.slice(0, closeIdx), trailing, from, to: bodyStart + closeIdx + 4 };
}
function findBlockRange(raw) {
  const match = findBlock(raw);
  return match ? { from: match.from, to: match.to } : null;
}
function parseDocument(raw) {
  const blk = findBlock(raw);
  if (!blk) return { prose: raw, comments: {} };
  try {
    const comments = parseBlockBody(blk.body);
    const doc = { prose: raw.slice(0, blk.proseEnd), comments };
    if (blk.trailing) doc.trailing = blk.trailing;
    return doc;
  } catch (e) {
    return { prose: raw, comments: {}, error: e instanceof Error ? e.message : String(e) };
  }
}
function serializeDocument(doc, schemaHint) {
  var _a;
  if (doc.error) throw new Error("refusing to serialize a document with a parse error: " + doc.error);
  const trailing = (_a = doc.trailing) != null ? _a : "";
  if (Object.keys(doc.comments).length === 0) {
    const separator = doc.prose && trailing && !doc.prose.endsWith("\n") && !trailing.startsWith("\n") ? "\n" : "";
    return doc.prose + separator + trailing;
  }
  const hint = schemaHint ? SCHEMA_HINT_LINES.join("\n") + "\n" : "";
  return doc.prose + "\n" + FENCE_OPEN + "\n" + hint + JSON.stringify(doc.comments, null, 2) + "\n```\n" + trailing;
}
function normalizeTrailingChanges(raw, doc) {
  if (doc.error || !doc.trailing || doc.trailing.trim() === "") return null;
  const blockStart = doc.prose.length;
  const blockEnd = raw.length - doc.trailing.length;
  const block = raw.slice(blockStart, blockEnd);
  const blockText = block.startsWith("\n") ? block.slice(1) : block;
  const sep = raw.endsWith("\n") ? "" : "\n";
  return [
    { from: blockStart, to: blockEnd, insert: blockStart === 0 ? "" : "\n" },
    { from: raw.length, to: raw.length, insert: sep + blockText }
  ];
}
function contextMatches(prose, at, len, anchor) {
  if (anchor.prefix && prose.slice(Math.max(0, at - anchor.prefix.length), at) !== anchor.prefix) return false;
  if (anchor.suffix && prose.slice(at + len, at + len + anchor.suffix.length) !== anchor.suffix) return false;
  return true;
}
function resolveAnchor(prose, anchor) {
  var _a, _b, _c, _d, _e, _f;
  const exact = anchor.exact;
  if (!exact) return { kind: "orphaned" };
  if (anchor.prefix || anchor.suffix) {
    const context = ((_a = anchor.prefix) != null ? _a : "") + exact + ((_b = anchor.suffix) != null ? _b : "");
    let at = prose.indexOf(context);
    if (at !== -1) {
      let best2 = at + ((_d = (_c = anchor.prefix) == null ? void 0 : _c.length) != null ? _d : 0);
      let count = 0;
      while (at !== -1) {
        const position = at + ((_f = (_e = anchor.prefix) == null ? void 0 : _e.length) != null ? _f : 0);
        count++;
        if (anchor.pos != null && Math.abs(position - anchor.pos) < Math.abs(best2 - anchor.pos)) best2 = position;
        at = prose.indexOf(context, at + 1);
      }
      return count === 1 ? { kind: "resolved", start: best2, end: best2 + exact.length } : { kind: "resolved", start: best2, end: best2 + exact.length, ambiguous: true };
    }
  }
  const matches = [];
  let i = prose.indexOf(exact);
  while (i !== -1) {
    matches.push(i);
    i = prose.indexOf(exact, i + 1);
  }
  if (matches.length === 0) return { kind: "orphaned" };
  let cands = matches;
  if (cands.length > 1) {
    const filtered = cands.filter((m) => contextMatches(prose, m, exact.length, anchor));
    if (filtered.length > 0) cands = filtered;
  }
  if (cands.length === 1) return { kind: "resolved", start: cands[0], end: cands[0] + exact.length };
  let best = cands[0];
  if (anchor.pos != null) {
    const pos = anchor.pos;
    best = cands.reduce((a, b) => Math.abs(b - pos) < Math.abs(a - pos) ? b : a);
  }
  return { kind: "resolved", start: best, end: best + exact.length, ambiguous: true };
}
function makeAnchor(prose, start, end) {
  const anchor = { exact: prose.slice(start, end), pos: start };
  const prefix = prose.slice(Math.max(0, start - CONTEXT_LEN), start);
  const suffix = prose.slice(end, Math.min(prose.length, end + CONTEXT_LEN));
  if (prefix) anchor.prefix = prefix;
  if (suffix) anchor.suffix = suffix;
  return anchor;
}
function addComment(comments, id, anchor, author, ts, text) {
  comments[id] = { anchor, status: "open", thread: [{ author, ts, text }] };
}
function addSuggestion(comments, id, anchor, author, ts, replacement, note) {
  comments[id] = {
    anchor,
    status: "open",
    thread: note ? [{ author, ts, text: note }] : [],
    suggestion: { replacement, author, ts }
  };
}
function addReply(comments, id, author, ts, text) {
  const c = comments[id];
  if (!c) throw new Error(`tandem-comments: unknown comment id "${id}"`);
  c.thread.push({ author, ts, text });
}
function editThreadEntry(comments, id, index, expected, text) {
  var _a;
  const entry = (_a = comments[id]) == null ? void 0 : _a.thread[index];
  if (!entry) return { ok: false, reason: "missing" };
  if (entry.author !== expected.author || entry.ts !== expected.ts || entry.text !== expected.text) {
    return { ok: false, reason: "conflict" };
  }
  entry.text = text;
  return { ok: true };
}
function setStatus(comments, id, status) {
  const c = comments[id];
  if (!c) throw new Error(`tandem-comments: unknown comment id "${id}"`);
  c.status = status;
}
function removeThreadEntry(comments, id, index) {
  const comment = comments[id];
  if (!comment) throw new Error(`tandem-comments: unknown comment id "${id}"`);
  if (!comment.thread[index]) {
    throw new Error(`tandem-comments: thread entry ${index} out of range for comment "${id}"`);
  }
  if (index === 0 && !comment.suggestion) {
    delete comments[id];
    return;
  }
  comment.thread.splice(index, 1);
}
function removeComment(comments, id) {
  delete comments[id];
}
function isSuggestionObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finishSuggestion(comments, id, result, behavior) {
  if (behavior === "remove") {
    delete comments[id];
    return;
  }
  const comment = comments[id];
  const suggestion = comment == null ? void 0 : comment.suggestion;
  if (!comment || !isSuggestionObject(suggestion)) return;
  comment.status = "resolved";
  suggestion.result = result;
}
function acceptSuggestion(doc, id, behavior) {
  const comment = doc.comments[id];
  if (!comment) return { ok: false, reason: "missing" };
  const suggestion = comment.suggestion;
  if (suggestion === void 0) return { ok: false, reason: "not-suggestion" };
  if (!isSuggestionObject(suggestion)) return { ok: false, reason: "invalid-suggestion" };
  if (comment.status !== "open" || suggestion.result) {
    return { ok: false, reason: "already-resolved" };
  }
  const replacement = suggestion.replacement;
  if (typeof replacement !== "string") return { ok: false, reason: "invalid-suggestion" };
  if (replacement.length === 0) return { ok: false, reason: "empty-replacement" };
  const resolution = resolveAnchor(doc.prose, comment.anchor);
  if (resolution.kind === "orphaned") return { ok: false, reason: "orphaned" };
  if (resolution.ambiguous) return { ok: false, reason: "ambiguous" };
  if (doc.prose.slice(resolution.start, resolution.end) !== comment.anchor.exact) {
    return { ok: false, reason: "orphaned" };
  }
  const oldProse = doc.prose;
  const survivingAnchors = Object.entries(doc.comments).flatMap(([otherId, other]) => {
    if (otherId === id || other.status !== "open") return [];
    const otherResolution = resolveAnchor(oldProse, other.anchor);
    return otherResolution.kind === "resolved" && !otherResolution.ambiguous ? [{ id: otherId, from: otherResolution.start, to: otherResolution.end }] : [];
  });
  const replacementChange = import_state.ChangeSet.of(
    { from: resolution.start, to: resolution.end, insert: replacement },
    oldProse.length
  );
  doc.prose = oldProse.slice(0, resolution.start) + replacement + oldProse.slice(resolution.end);
  for (const mapped of mapAnchors(survivingAnchors, replacementChange)) {
    const surviving = doc.comments[mapped.id];
    if (surviving && mapped.to <= doc.prose.length) {
      surviving.anchor = makeAnchor(doc.prose, mapped.from, mapped.to);
    }
  }
  finishSuggestion(doc.comments, id, "accepted", behavior);
  return { ok: true, start: resolution.start, end: resolution.end, replacement };
}
function declineSuggestion(comments, id, behavior) {
  const comment = comments[id];
  if (!comment) return { ok: false, reason: "missing" };
  const suggestion = comment.suggestion;
  if (suggestion === void 0) return { ok: false, reason: "not-suggestion" };
  if (!isSuggestionObject(suggestion)) return { ok: false, reason: "invalid-suggestion" };
  if (comment.status !== "open" || suggestion.result) {
    return { ok: false, reason: "already-resolved" };
  }
  finishSuggestion(comments, id, "declined", behavior);
  return { ok: true };
}
function planSuggestionAcceptance(raw, id, behavior, schemaHint) {
  const doc = parseDocument(raw);
  if (doc.error) return { ok: false, reason: "invalid-document", error: doc.error };
  const oldProseLength = doc.prose.length;
  const result = acceptSuggestion(doc, id, behavior);
  if (!result.ok) return result;
  const serialized = serializeDocument(doc, schemaHint);
  return {
    ok: true,
    changes: [
      { from: result.start, to: result.end, insert: result.replacement },
      { from: oldProseLength, to: raw.length, insert: serialized.slice(doc.prose.length) }
    ],
    cursor: result.start + result.replacement.length
  };
}
function generateId(existing) {
  for (; ; ) {
    const id = Math.floor(Math.random() * 65535).toString(16).padStart(4, "0");
    if (!(id in existing)) return id;
  }
}
function resolveAll(prose, comments) {
  return Object.entries(comments).map(([id, comment]) => {
    const acceptedHistory = comment.status === "resolved" && isSuggestionObject(comment.suggestion) && comment.suggestion.result === "accepted";
    return {
      id,
      comment,
      // The retained anchor describes the text that was replaced, not a safe
      // navigation target in the resulting prose.
      resolution: acceptedHistory ? { kind: "orphaned" } : resolveAnchor(prose, comment.anchor)
    };
  });
}
function createDocumentReader() {
  let body;
  let comments = {};
  return (raw) => {
    const block = findBlock(raw);
    if (!block) return { prose: raw, comments: {} };
    if (block.body !== body) {
      try {
        comments = parseBlockBody(block.body);
        body = block.body;
      } catch (e) {
        return parseDocument(raw);
      }
    }
    const doc = { prose: raw.slice(0, block.proseEnd), comments };
    if (block.trailing) doc.trailing = block.trailing;
    return doc;
  };
}

// src/table-highlight.ts
var DELIMITER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
function splitLines(text, limit) {
  const lines = [];
  let from = 0;
  for (const part of text.slice(0, limit).split("\n")) {
    lines.push({ text: part, from });
    from += part.length + 1;
  }
  return lines;
}
function splitRow(line) {
  const segments = [];
  let start = 0;
  for (let i = 0; i < line.text.length; i++) {
    if (line.text[i] === "\\") {
      i++;
      continue;
    }
    if (line.text[i] === "|") {
      segments.push({ start, end: i });
      start = i + 1;
    }
  }
  segments.push({ start, end: line.text.length });
  if (segments.length > 1 && line.text.slice(segments[0].start, segments[0].end).trim() === "") {
    segments.shift();
  }
  if (segments.length > 1) {
    const last = segments[segments.length - 1];
    if (line.text.slice(last.start, last.end).trim() === "") segments.pop();
  }
  return segments.map((s) => ({ from: line.from + s.start, to: line.from + s.end }));
}
function findTables(text, limit = text.length) {
  const lines = splitLines(text, limit);
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    const delim = lines[i + 1];
    if (!delim || !header.text.includes("|") || !DELIMITER.test(delim.text)) continue;
    if (splitRow(header).length !== splitRow(delim).length) continue;
    let end = i;
    for (let j = i + 2; j < lines.length; j++) {
      if (lines[j].text.trim() === "" || !lines[j].text.includes("|")) break;
      end = j;
    }
    if (end < i + 2) end = i;
    const cells = [];
    for (let r = i; r <= end; r++) {
      if (r === i + 1) continue;
      const rowIndex = r - i;
      splitRow(lines[r]).forEach((span, col) => cells.push({ row: rowIndex, col, ...span }));
    }
    const last = lines[end];
    tables.push({ from: header.from, to: last.from + last.text.length, cells });
    i = end;
  }
  return tables;
}
function rangesTouchTable(text, proseLen, ranges, tables = findTables(text, proseLen)) {
  return tables.some((t) => ranges.some((r) => r.from <= t.to && r.to >= t.from));
}
function locateCell(table, pos) {
  for (const c of table.cells) {
    if (pos >= c.from && pos < c.to) return c;
  }
  return null;
}
function visibleText(md) {
  return md.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/(\*|_)(.+?)\1/g, "$2").replace(/~~(.+?)~~/g, "$1").replace(/==(.+?)==/g, "$1").replace(/`([^`]+)`/g, "$1");
}
function findDomTable(view, table, tables) {
  for (const el of tables) {
    let pos;
    try {
      pos = view.posAtDOM(el);
    } catch (e) {
      continue;
    }
    if (pos >= table.from && pos <= table.to) return el;
  }
  return null;
}
function domCell(domTable, cell) {
  var _a, _b, _c, _d, _e;
  if (cell.row === 0) {
    const headerRow = (_b = (_a = domTable.tHead) == null ? void 0 : _a.rows[0]) != null ? _b : domTable.rows[0];
    return (_c = headerRow == null ? void 0 : headerRow.cells[cell.col]) != null ? _c : null;
  }
  const body = domTable.tBodies[0];
  return (_e = (_d = body == null ? void 0 : body.rows[cell.row - 2]) == null ? void 0 : _d.cells[cell.col]) != null ? _e : null;
}
function wrapRange(root, start, len, id, onClick) {
  var _a, _b;
  const doc = root.ownerDocument;
  const end = start + len;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  let pos = 0;
  let n;
  while (n = walker.nextNode()) {
    const node = n;
    const nodeLen = (_b = (_a = node.nodeValue) == null ? void 0 : _a.length) != null ? _b : 0;
    const nodeStart = pos;
    const nodeEnd = pos + nodeLen;
    if (nodeEnd > start && nodeStart < end) {
      targets.push({ node, s: Math.max(0, start - nodeStart), e: Math.min(nodeLen, end - nodeStart) });
    }
    pos = nodeEnd;
    if (pos >= end) break;
  }
  if (targets.length === 0) return false;
  for (const t of targets) {
    const range = doc.createRange();
    range.setStart(t.node, t.s);
    range.setEnd(t.node, t.e);
    const span = doc.createElement("span");
    span.className = "tc-highlight";
    span.dataset.tcId = id;
    span.dataset.tcTable = "1";
    const swallow = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    span.addEventListener("pointerdown", (e) => {
      swallow(e);
      onClick(id);
    });
    span.addEventListener("mousedown", swallow);
    span.addEventListener("click", swallow);
    try {
      range.surroundContents(span);
    } catch (e) {
      return false;
    }
  }
  return true;
}
var highlightedViews = /* @__PURE__ */ new WeakMap();
function clearTableHighlights(view) {
  highlightedViews.delete(view);
  view.contentDOM.querySelectorAll("span.tc-highlight[data-tc-table]").forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  });
}
function applyTableHighlights(view, anchors, text, proseLen, onClick, tables = findTables(text, proseLen)) {
  var _a, _b;
  const domTables = Array.from(view.contentDOM.querySelectorAll("table"));
  const signature = JSON.stringify(anchors.map((a) => [a.id, a.from, a.to, text.slice(a.from, a.to)]));
  const previous = highlightedViews.get(view);
  const spans = Array.from(view.contentDOM.querySelectorAll("span.tc-highlight[data-tc-table]"));
  if (previous && previous.signature === signature && previous.tables.length === domTables.length && domTables.every((table, i) => table === previous.tables[i] && table.innerHTML === previous.contents[i]) && spans.length === previous.spans.length && spans.every((span, i) => span === previous.spans[i])) return;
  clearTableHighlights(view);
  if (tables.length === 0) return;
  for (const a of anchors) {
    try {
      const table = tables.find((t) => a.from >= t.from && a.to <= t.to);
      if (!table) continue;
      const cell = locateCell(table, a.from);
      if (!cell) continue;
      const domTable = findDomTable(view, table, domTables);
      if (!domTable) continue;
      const cellEl = domCell(domTable, cell);
      if (!cellEl) continue;
      const visible = visibleText(text.slice(a.from, a.to));
      if (!visible) continue;
      const k = (_b = (_a = cellEl.textContent) == null ? void 0 : _a.indexOf(visible)) != null ? _b : -1;
      if (k >= 0) wrapRange(cellEl, k, visible.length, a.id, onClick);
    } catch (e) {
    }
  }
  highlightedViews.set(view, {
    signature,
    tables: domTables,
    contents: domTables.map((table) => table.innerHTML),
    spans: Array.from(view.contentDOM.querySelectorAll("span.tc-highlight[data-tc-table]"))
  });
}

// src/editor-extension.ts
var selfEdit = import_state2.Annotation.define();
var REANCHOR_DEBOUNCE_MS = 800;
var NORMALIZE_DEBOUNCE_MS = 500;
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isOpenSuggestion(value) {
  if (!isObject(value) || value.status !== "open") return false;
  const suggestion = value.suggestion;
  return isObject(suggestion) && suggestion.result == null;
}
function isAcceptedSuggestion(value) {
  if (!isObject(value) || value.status !== "resolved") return false;
  const suggestion = value.suggestion;
  return isObject(suggestion) && suggestion.result === "accepted";
}
function isSuggestionAcceptanceHistoryUpdate(u, oldText, text) {
  if (!u.transactions.some((tr) => tr.isUserEvent("undo") || tr.isUserEvent("redo"))) return false;
  const oldDoc = parseDocument(oldText);
  const newDoc = parseDocument(text);
  if (oldDoc.error || newDoc.error || oldDoc.prose === newDoc.prose) return false;
  const ids = /* @__PURE__ */ new Set([...Object.keys(oldDoc.comments), ...Object.keys(newDoc.comments)]);
  for (const id of ids) {
    const before = oldDoc.comments[id];
    const after = newDoc.comments[id];
    if (isOpenSuggestion(before) && (after === void 0 || isAcceptedSuggestion(after)) || isOpenSuggestion(after) && (before === void 0 || isAcceptedSuggestion(before))) {
      return true;
    }
  }
  return false;
}
function editorAnchorTrackerClass(plugin) {
  return class {
    constructor(view) {
      this.view = view;
      this.anchors = [];
      this.readDocument = createDocumentReader();
      this.dirty = false;
      this.destroyed = false;
      this.timer = null;
      this.normalizeTimer = null;
      this.tableDoc = null;
      this.tableSnapshot = null;
      var _a;
      this.saveOnClose = (_a = plugin.captureAnchorSave) == null ? void 0 : _a.call(plugin, view);
      this.syncFromDoc(view.state.doc.toString());
      this.decorations = this.buildDecorations();
      this.scheduleTableHighlight();
      this.scheduleNormalize();
    }
    tablesFor(text, proseLen) {
      if (this.tableDoc !== this.view.state.doc || !this.tableSnapshot) {
        const raw = text != null ? text : this.view.state.doc.toString();
        const length = proseLen != null ? proseLen : this.readDocument(raw).prose.length;
        this.tableDoc = this.view.state.doc;
        this.tableSnapshot = { text: raw, proseLen: length, tables: findTables(raw, length) };
      }
      return this.tableSnapshot;
    }
    destroy() {
      this.destroyed = true;
      if (this.dirty && this.saveOnClose) {
        const before = this.view.state.doc.toString();
        const after = this.reanchoredText(before);
        if (after) this.saveOnClose.save(before, after);
      }
      if (this.timer !== null) window.clearTimeout(this.timer);
      if (this.normalizeTimer !== null) window.clearTimeout(this.normalizeTimer);
    }
    syncFromDoc(text) {
      const doc = this.readDocument(text);
      this.anchors = [];
      this.dirty = false;
      if (doc.error) return;
      for (const [id, c] of Object.entries(doc.comments)) {
        if (c.status === "resolved") continue;
        const r = resolveAnchor(doc.prose, c.anchor);
        if (r.kind === "resolved") this.anchors.push({ id, from: r.start, to: r.end });
      }
      this.anchors.sort((a, b) => a.from - b.from);
    }
    update(u) {
      var _a, _b;
      const target = (_a = plugin.captureAnchorSave) == null ? void 0 : _a.call(plugin, this.view, this.saveOnClose);
      if (target && target.key !== ((_b = this.saveOnClose) == null ? void 0 : _b.key)) {
        if (this.dirty && this.saveOnClose) {
          const before = u.startState.doc.toString();
          const after = this.reanchoredText(before);
          if (after) this.saveOnClose.save(before, after);
        }
        this.saveOnClose = target;
      }
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.scheduleTableHighlight();
      if (!u.docChanged) return;
      this.scheduleNormalize();
      const text = u.state.doc.toString();
      const isSelf = u.transactions.some((tr) => tr.annotation(selfEdit));
      const oldText = u.startState.doc.toString();
      const oldDoc = this.readDocument(oldText);
      const oldProseLen = oldDoc.prose.length;
      const newDoc = this.readDocument(text);
      const newProseLen = newDoc.prose.length;
      const fullReplace = isFullReplace(u.changes);
      const touchesBlock = changesTouchCommentBlock(u.changes, oldProseLen, newProseLen);
      const acceptanceHistory = isSuggestionAcceptanceHistoryUpdate(u, oldText, text);
      const preservePending = shouldPreservePendingAnchors(
        u.changes,
        oldProseLen,
        plugin.isApplyingSuggestion() || acceptanceHistory
      );
      const pending = !isSelf && touchesBlock && preservePending ? mapAnchors(this.anchors, u.changes).filter((anchor) => anchor.to <= newProseLen) : [];
      if (isSelf || fullReplace || touchesBlock) {
        this.syncFromDoc(text);
        if (pending.length > 0) {
          const doc = this.readDocument(text);
          if (!doc.error) {
            const recoverable = new Set(
              Object.entries(doc.comments).filter(
                ([id, comment]) => {
                  var _a2;
                  return comment.status === "open" && (acceptanceHistory || JSON.stringify(comment.anchor) === JSON.stringify((_a2 = oldDoc.comments[id]) == null ? void 0 : _a2.anchor)) && resolveAnchor(doc.prose, comment.anchor).kind === "orphaned";
                }
              ).map(([id]) => id)
            );
            const merged = mergePendingAnchors(this.anchors, pending, recoverable);
            if (merged.length > this.anchors.length) {
              this.anchors = merged;
              this.dirty = true;
              this.scheduleReanchor();
            }
          }
        }
      } else {
        const ranges = [];
        u.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
          ranges.push({ from: fromB, to: toB });
        });
        const hasOpenComments = this.anchors.length > 0 || Object.values(newDoc.comments).some((comment) => comment.status === "open");
        if (hasOpenComments && rangesTouchTable(text, newProseLen, ranges, this.tablesFor(text, newProseLen).tables)) {
          const mapped = mapAnchors(this.anchors, u.changes);
          const survived = new Set(mapped.map((a) => a.id));
          this.anchors = mapped;
          const doc = this.readDocument(text);
          for (const [id, c] of Object.entries(doc.comments)) {
            if (c.status === "resolved" || survived.has(id)) continue;
            const r = resolveAnchor(doc.prose, c.anchor);
            if (r.kind === "resolved") this.anchors.push({ id, from: r.start, to: r.end });
          }
          this.anchors.sort((a, b) => a.from - b.from);
          this.dirty = true;
          this.scheduleReanchor();
        } else {
          this.anchors = mapAnchors(this.anchors, u.changes);
          this.dirty = this.anchors.length > 0;
          if (this.dirty) this.scheduleReanchor();
        }
      }
      this.decorations = this.anchors.length ? this.buildDecorations() : import_view.Decoration.none;
    }
    buildDecorations() {
      const b = new import_state2.RangeSetBuilder();
      const len = this.view.state.doc.length;
      for (const a of this.anchors) {
        if (a.from >= a.to || a.to > len) continue;
        b.add(a.from, a.to, import_view.Decoration.mark({ class: "tc-highlight", attributes: { "data-tc-id": a.id } }));
      }
      return b.finish();
    }
    /**
     * Highlights innerhalb gerenderter Tabellen-Widgets müssen direkt ins DOM
     * geschrieben werden (CM-mark-Dekorationen werden dort verschluckt). Das
     * läuft in der Measure-/Write-Phase, nachdem Obsidian die Widgets gebaut hat.
     */
    scheduleTableHighlight() {
      this.view.requestMeasure({
        key: "tc-table-highlight",
        read: () => null,
        write: () => {
          if (this.destroyed) return;
          if (this.anchors.length === 0) {
            clearTableHighlights(this.view);
            return;
          }
          const { text, proseLen, tables } = this.tablesFor();
          applyTableHighlights(this.view, this.anchors, text, proseLen, (id) => void plugin.openSidebar(id), tables);
        }
      });
    }
    scheduleNormalize() {
      if (this.normalizeTimer !== null) window.clearTimeout(this.normalizeTimer);
      this.normalizeTimer = window.setTimeout(() => {
        this.normalizeTimer = null;
        this.performNormalize();
      }, NORMALIZE_DEBOUNCE_MS);
    }
    /**
     * Faltet Inhalt hinter dem Block (getippte Prosa, Fußnoten-Definitionen)
     * zurück vor den Block, damit der Block das letzte Element der Datei bleibt —
     * sonst landet der Text im nicht kommentierbaren trailing-Bereich.
     */
    performNormalize() {
      if (this.dirty) this.performReanchor();
      const text = this.view.state.doc.toString();
      const changes = normalizeTrailingChanges(text, this.readDocument(text));
      if (!changes) return;
      this.view.dispatch({
        changes,
        annotations: [selfEdit.of(true), import_state2.Transaction.addToHistory.of(false)]
      });
    }
    scheduleReanchor() {
      if (this.timer !== null) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        this.timer = null;
        this.performReanchor();
      }, REANCHOR_DEBOUNCE_MS);
    }
    /**
     * Schreibt nach editierter Prosa die aktuellen Zitate/Kontexte der noch
     * lebenden Anker zurück in den Block (nur die Block-Region wird ersetzt).
     */
    performReanchor() {
      if (this.timer !== null) {
        window.clearTimeout(this.timer);
        this.timer = null;
      }
      if (!this.dirty || this.destroyed) return;
      this.dirty = false;
      const text = this.view.state.doc.toString();
      const serialized = this.reanchoredText(text);
      if (!serialized) return;
      const proseLen = this.readDocument(text).prose.length;
      this.view.dispatch({
        changes: { from: proseLen, to: text.length, insert: serialized.slice(proseLen) },
        annotations: [selfEdit.of(true), import_state2.Transaction.addToHistory.of(false)]
      });
    }
    reanchoredText(text) {
      const doc = parseDocument(text);
      if (doc.error || Object.keys(doc.comments).length === 0) return;
      let changed = false;
      for (const t of this.anchors) {
        const c = doc.comments[t.id];
        if (!c || c.status === "resolved") continue;
        if (t.to > doc.prose.length) continue;
        const cur = c.anchor;
        if (cur.exact && doc.prose.includes(cur.exact)) continue;
        const next = makeAnchor(doc.prose, t.from, t.to);
        if (next.exact && (next.exact !== cur.exact || next.prefix !== cur.prefix || next.suffix !== cur.suffix || next.pos !== cur.pos)) {
          c.anchor = next;
          changed = true;
        }
      }
      if (!changed) return;
      return serializeDocument(doc, plugin.settings.schemaHint);
    }
  };
}
function buildEditorExtension(plugin) {
  return import_view.ViewPlugin.fromClass(editorAnchorTrackerClass(plugin), {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e) {
        var _a;
        const target = e.target;
        const el = (_a = target.closest) == null ? void 0 : _a.call(target, ".tc-highlight");
        if (!el) return false;
        const id = el.getAttribute("data-tc-id");
        if (id) void plugin.openSidebar(id);
        return false;
      }
    }
  });
}

// src/hidden-block.ts
var import_state3 = require("@codemirror/state");
var import_view2 = require("@codemirror/view");
var livePreviewSource = import_state3.Facet.define();
function isLivePreview(state) {
  const field = state.facet(livePreviewSource)[0];
  return field ? state.field(field, false) === true : false;
}
function build(state) {
  if (!isLivePreview(state)) return import_view2.Decoration.none;
  const range = findBlockRange(state.doc.toString());
  if (!range) return import_view2.Decoration.none;
  return import_view2.Decoration.set([import_view2.Decoration.replace({ block: true }).range(range.from, range.to)]);
}
function rangeOf(set) {
  let found = null;
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to) => {
    found = { from, to };
    return false;
  });
  return found;
}
var hiddenBlockField = import_state3.StateField.define({
  create: build,
  update(value, tr) {
    if (isLivePreview(tr.startState) !== isLivePreview(tr.state)) return build(tr.state);
    if (!tr.docChanged) return value;
    const range = rangeOf(value);
    if (range && !tr.changes.touchesRange(range.from - 1, tr.startState.doc.length)) return value.map(tr.changes);
    return build(tr.state);
  },
  provide: (field) => import_view2.EditorView.decorations.from(field)
});
function guardHiddenBlockEdits(tr) {
  if (!tr.docChanged || !(tr.isUserEvent("input") || tr.isUserEvent("delete"))) return tr;
  const range = rangeOf(tr.startState.field(hiddenBlockField));
  if (!range) return tr;
  const caretDelete = tr.isUserEvent("delete.backward") || tr.isUserEvent("delete.forward");
  const zoneFrom = range.from - 1;
  const zoneTo = range.to + 1;
  let blocked = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (fromA === toA) {
      if (fromA >= range.from && fromA <= range.to) blocked = true;
    } else if (fromA < zoneTo && toA > zoneFrom) {
      const coversBlock = fromA <= range.from && toA >= range.to;
      if (caretDelete || !coversBlock) blocked = true;
    }
  });
  return blocked ? [] : tr;
}
function buildHiddenBlockExtension(livePreviewField) {
  return [
    livePreviewSource.of(livePreviewField),
    hiddenBlockField,
    // Cursor überspringt den unsichtbaren Bereich statt unsichtbar darin zu landen.
    import_view2.EditorView.atomicRanges.of((view) => view.state.field(hiddenBlockField)),
    import_state3.EditorState.transactionFilter.of(guardHiddenBlockEdits)
  ];
}

// src/export.ts
function formatTs(ts) {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleString();
}
function formatComment(r, opts) {
  var _a;
  const fmt = (_a = opts.formatTs) != null ? _a : ((ts) => ts);
  const thread = r.comment.thread.map((e) => `**${e.author}** (${fmt(e.ts)}): ${e.text}`).join("\n");
  const suggestion = r.comment.suggestion;
  const replacement = typeof (suggestion == null ? void 0 : suggestion.replacement) === "string" ? suggestion.replacement : "[Invalid suggestion: replacement must be text]";
  const proposal = suggestion ? [
    `**Suggested edit by ${suggestion.author}** (${fmt(suggestion.ts)})${suggestion.result ? ` \u2014 ${suggestion.result}` : ""}:`,
    replacement.split("\n").map((line) => `> ${line}`).join("\n")
  ].join("\n") : "";
  const body = [proposal, thread].filter(Boolean).join("\n\n");
  if (!opts.includeQuote) return body;
  const quote = r.comment.anchor.exact.split("\n").map((l) => "> " + l).join("\n");
  return body ? quote + "\n\n" + body : quote;
}
var INVALID_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g;
function renderExportFileName(template, filename, date) {
  const rendered = template.replaceAll("{{filename}}", filename).replaceAll("{{date}}", date).replace(INVALID_FILENAME_CHARS, "-").trim();
  return rendered || `${filename.replace(INVALID_FILENAME_CHARS, "-")} \u2013 Comments`;
}
function resolveExportDirectory(sourceParentPath, destination, selectedFolder) {
  if (destination === "folder") return selectedFolder;
  return sourceParentPath && sourceParentPath !== "/" ? sourceParentPath : "";
}
function buildExportNote(sourceName, all, opts) {
  const startOf = (r) => r.resolution.kind === "resolved" ? r.resolution.start : 0;
  const open = all.filter((r) => r.comment.status === "open" && r.resolution.kind === "resolved").sort((a, b) => startOf(a) - startOf(b));
  const orphans = all.filter((r) => r.comment.status === "open" && r.resolution.kind === "orphaned");
  const done = opts.scope === "all" ? all.filter((r) => r.comment.status === "resolved") : [];
  if (!open.length && !orphans.length && !done.length) return null;
  const fmt = (r) => formatComment(r, { includeQuote: true, formatTs: opts.formatTs });
  const sections = [`# Comments: ${sourceName}`, `Exported from [[${sourceName}]] on ${opts.date}`];
  if (open.length) sections.push("## Open", ...open.map(fmt));
  if (done.length) sections.push("## Resolved", ...done.map(fmt));
  if (orphans.length) sections.push("## Orphaned", ...orphans.map(fmt));
  return sections.join("\n\n") + "\n";
}

// src/reading-view.ts
var import_obsidian2 = require("obsidian");
function registerReadingView(plugin) {
  plugin.registerMarkdownCodeBlockProcessor("tandem-comments", (source, el, ctx) => {
    ctx.addChild(new BlockPill(el, source, plugin));
  });
}
var BlockPill = class extends import_obsidian2.MarkdownRenderChild {
  constructor(containerEl, source, plugin) {
    super(containerEl);
    this.source = source;
    this.plugin = plugin;
    this.unloaded = false;
  }
  onload() {
    this.render();
  }
  onunload() {
    this.unloaded = true;
  }
  render() {
    const el = this.containerEl;
    el.empty();
    if (!el.isConnected) {
      requestAnimationFrame(() => {
        if (!this.unloaded) this.render();
      });
      return;
    }
    if (!el.closest(".markdown-preview-view")) {
      const widget = el.closest(".cm-embed-block");
      if (widget instanceof HTMLElement) widget.addClass("tc-lp-hidden");
      return;
    }
    let open = 0;
    let resolved = 0;
    try {
      for (const c of Object.values(parseBlockBody(this.source))) {
        if (c.status === "resolved") resolved++;
        else open++;
      }
    } catch (e) {
      el.createDiv({ text: "\u{1F4AC} tandem-comments \u2014 invalid JSON", cls: "tc-pill tc-pill-error" });
      return;
    }
    if (open === 0) return;
    const label = resolved > 0 ? `\u{1F4AC} ${open} open \xB7 ${resolved} resolved` : `\u{1F4AC} ${open} thread${open === 1 ? "" : "s"}`;
    const pill = el.createEl("button", { text: label, cls: "tc-pill" });
    pill.onclick = () => void this.plugin.openSidebar();
  }
};

// src/settings.ts
var import_obsidian3 = require("obsidian");

// src/author-color.ts
function authorHue(author) {
  let hash = 0;
  for (let i = 0; i < author.length; i++) {
    hash = hash * 31 + author.charCodeAt(i) | 0;
  }
  return Math.abs(hash) % 360;
}
var AUTHOR_COLOR_SATURATION = 55;
var AUTHOR_COLOR_LIGHTNESS = { light: 28, dark: 72 };
var STANDARD_THEME_BACKGROUNDS = {
  light: "#ffffff",
  dark: "#202020"
};
var MINIMUM_TEXT_CONTRAST = 4.5;
function normalizeHue(hue) {
  return Math.round((hue % 360 + 360) % 360) % 360;
}
function resolveAuthorHue(author, overrides) {
  const override = overrides[author];
  return typeof override === "number" && Number.isFinite(override) ? normalizeHue(override) : authorHue(author);
}
function authorColorHsl(hue, theme) {
  return {
    h: normalizeHue(hue),
    s: AUTHOR_COLOR_SATURATION,
    l: AUTHOR_COLOR_LIGHTNESS[theme]
  };
}
function authorColorCss(hue, theme) {
  const color = authorColorHsl(hue, theme);
  return `hsl(${color.h} ${color.s}% ${color.l}%)`;
}
function resolveAuthorColor(author, overrides, theme) {
  const override = overrides[author];
  if (typeof override === "string" && /^#[0-9a-f]{6}$/i.test(override)) return override;
  return authorColorCss(resolveAuthorHue(author, overrides), theme);
}
function hasAuthorColorOverride(overrides, author) {
  return Object.prototype.hasOwnProperty.call(overrides, author);
}
function hueOverrideHex(hue) {
  const normalized = normalizeHue(hue);
  const saturation = 0.7;
  const lightness = 0.5;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(normalized / 60 % 2 - 1));
  const offset = lightness - chroma / 2;
  const rgbPrime = normalized < 60 ? [chroma, x, 0] : normalized < 120 ? [x, chroma, 0] : normalized < 180 ? [0, chroma, x] : normalized < 240 ? [0, x, chroma] : normalized < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return "#" + rgbPrime.map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, "0")).join("");
}
function normalizeAuthorColorOverrides(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const normalized = {};
  for (const [author, color] of Object.entries(value)) {
    if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) {
      normalized[author] = color.toLowerCase();
    } else if (typeof color === "number" && Number.isFinite(color)) {
      normalized[author] = hueOverrideHex(color);
    }
  }
  return normalized;
}
function hexRgb(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
}
function relativeLuminance(hex) {
  const rgb = hexRgb(hex);
  if (!rgb) return null;
  const [red, green, blue] = rgb.map(
    (channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
function colorContrast(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  if (foregroundLuminance === null || backgroundLuminance === null) return null;
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}
function authorColorReadability(color) {
  const lightContrast = colorContrast(color, STANDARD_THEME_BACKGROUNDS.light);
  const darkContrast = colorContrast(color, STANDARD_THEME_BACKGROUNDS.dark);
  if (lightContrast === null || darkContrast === null) return null;
  const lowContrastThemes = [];
  if (lightContrast < MINIMUM_TEXT_CONTRAST) lowContrastThemes.push("light");
  if (darkContrast < MINIMUM_TEXT_CONTRAST) lowContrastThemes.push("dark");
  return { lightContrast, darkContrast, lowContrastThemes };
}
function renameAuthorColorOverride(overrides, previousAuthor, nextAuthor) {
  const trimmed = nextAuthor.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed !== previousAuthor && hasAuthorColorOverride(overrides, trimmed)) {
    return { ok: false, reason: "duplicate" };
  }
  const renamed = { ...overrides, [trimmed]: overrides[previousAuthor] };
  delete renamed[previousAuthor];
  return { ok: true, overrides: renamed };
}

// src/settings-model.ts
var SETTINGS_VERSION = 1;
var DEFAULT_SETTINGS = {
  settingsVersion: SETTINGS_VERSION,
  highlightColor: "#ffd54a",
  highlightOpacity: 30,
  colorAuthorNames: true,
  showResolvedByDefault: false,
  resolveBehavior: "remove",
  sidebarSortOrder: "document",
  submitShortcut: "enter",
  timestampDisplay: "full",
  confirmDestructiveActions: true,
  showReadingViewIndicator: true,
  schemaHint: true,
  copyIncludeQuote: true,
  exportNameTemplate: "{{filename}} \u2013 Comments",
  exportScope: "all",
  exportDestination: "source",
  exportFolder: "",
  authorColorOverrides: {},
  webhookEnabled: false,
  webhookUrl: "",
  webhookSenderKey: ""
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function booleanSetting(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function stringSetting(value, fallback) {
  return typeof value === "string" ? value : fallback;
}
function enumSetting(value, values, fallback) {
  return typeof value === "string" && values.includes(value) ? value : fallback;
}
function opacitySetting(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SETTINGS.highlightOpacity;
  return Math.min(80, Math.max(10, Math.round(value)));
}
function normalizeVaultFolderPath(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}
function validateVaultFolderPath(value) {
  const path = normalizeVaultFolderPath(value);
  if (path.split("/").some((part) => part === "." || part === "..")) {
    return "Choose a folder inside the vault.";
  }
  return null;
}
function parseCommentsSettings(value) {
  const raw = isRecord(value) ? value : {};
  const template = stringSetting(raw.exportNameTemplate, DEFAULT_SETTINGS.exportNameTemplate).trim().replace(/\.md$/i, "");
  const resolveBehavior = enumSetting(
    raw.resolveBehavior,
    ["keep", "remove"],
    DEFAULT_SETTINGS.resolveBehavior
  );
  const settings = {
    settingsVersion: SETTINGS_VERSION,
    highlightColor: typeof raw.highlightColor === "string" && /^#[0-9a-f]{6}$/i.test(raw.highlightColor) ? raw.highlightColor.toLowerCase() : DEFAULT_SETTINGS.highlightColor,
    highlightOpacity: opacitySetting(raw.highlightOpacity),
    colorAuthorNames: booleanSetting(raw.colorAuthorNames, DEFAULT_SETTINGS.colorAuthorNames),
    showResolvedByDefault: resolveBehavior === "keep" && booleanSetting(raw.showResolvedByDefault, DEFAULT_SETTINGS.showResolvedByDefault),
    resolveBehavior,
    sidebarSortOrder: enumSetting(
      raw.sidebarSortOrder,
      ["document", "newest", "oldest"],
      DEFAULT_SETTINGS.sidebarSortOrder
    ),
    submitShortcut: enumSetting(
      raw.submitShortcut,
      ["enter", "mod-enter"],
      DEFAULT_SETTINGS.submitShortcut
    ),
    timestampDisplay: enumSetting(
      raw.timestampDisplay,
      ["full", "compact", "relative", "hidden"],
      DEFAULT_SETTINGS.timestampDisplay
    ),
    confirmDestructiveActions: booleanSetting(
      raw.confirmDestructiveActions,
      DEFAULT_SETTINGS.confirmDestructiveActions
    ),
    showReadingViewIndicator: booleanSetting(
      raw.showReadingViewIndicator,
      DEFAULT_SETTINGS.showReadingViewIndicator
    ),
    schemaHint: booleanSetting(raw.schemaHint, DEFAULT_SETTINGS.schemaHint),
    copyIncludeQuote: booleanSetting(raw.copyIncludeQuote, DEFAULT_SETTINGS.copyIncludeQuote),
    exportNameTemplate: template || DEFAULT_SETTINGS.exportNameTemplate,
    exportScope: enumSetting(raw.exportScope, ["all", "open"], DEFAULT_SETTINGS.exportScope),
    exportDestination: enumSetting(
      raw.exportDestination,
      ["source", "folder"],
      DEFAULT_SETTINGS.exportDestination
    ),
    exportFolder: validateVaultFolderPath(stringSetting(raw.exportFolder, DEFAULT_SETTINGS.exportFolder)) === null ? normalizeVaultFolderPath(raw.exportFolder) : DEFAULT_SETTINGS.exportFolder,
    authorColorOverrides: normalizeAuthorColorOverrides(raw.authorColorOverrides),
    webhookEnabled: booleanSetting(raw.webhookEnabled, DEFAULT_SETTINGS.webhookEnabled),
    webhookUrl: stringSetting(raw.webhookUrl, DEFAULT_SETTINGS.webhookUrl).trim(),
    webhookSenderKey: stringSetting(raw.webhookSenderKey, DEFAULT_SETTINGS.webhookSenderKey).trim()
  };
  const legacyAuthorName = typeof raw.authorName === "string" ? raw.authorName.trim() : void 0;
  return {
    settings,
    legacyAuthorName: legacyAuthorName || void 0,
    changed: JSON.stringify(value != null ? value : {}) !== JSON.stringify(settings)
  };
}
function validateExportNameTemplate(value) {
  if (!value.trim()) return "Enter an export note name.";
  if (/\.md\s*$/i.test(value)) return "Leave off the .md extension; Tandem Comments adds it automatically.";
  return null;
}
function settingsEffects(previous, next) {
  const resetResolvedVisibility = previous.showResolvedByDefault !== next.showResolvedByDefault;
  return {
    refreshHighlights: previous.highlightColor !== next.highlightColor || previous.highlightOpacity !== next.highlightOpacity,
    refreshAuthorColors: previous.colorAuthorNames !== next.colorAuthorNames || JSON.stringify(previous.authorColorOverrides) !== JSON.stringify(next.authorColorOverrides),
    refreshSidebar: resetResolvedVisibility || previous.sidebarSortOrder !== next.sidebarSortOrder || previous.timestampDisplay !== next.timestampDisplay,
    refreshReadingViewIndicator: previous.showReadingViewIndicator !== next.showReadingViewIndicator,
    resetResolvedVisibility
  };
}

// src/skill-export.ts
var SKILL_MARKDOWN = `---
name: obsidian-tandem-comments
description: Read, write, reply to and resolve comments and edit suggestions in Markdown files that use the tandem-comments format (a \`\`\`tandem-comments fenced JSON block near the end of the file, quote-anchored via W3C TextQuoteSelector). Trigger whenever a Markdown file contains a tandem-comments block, or the user asks to comment on / annotate / review text in an Obsidian note, suggest an edit, address or work through review comments, reply to a comment, or resolve comments.
---

# Obsidian Tandem Comments \u2014 comments and edit suggestions in Markdown

Comments live in a fenced block at the **end of the file** (footnote definitions
that Obsidian appends after the block are fine and must be preserved). The prose
stays **100% untouched** \u2014 never write markers into the body text.

~~~markdown
\`\`\`tandem-comments
// Schema: { "<id>": { anchor:{exact,prefix,suffix,pos?}, status:open|resolved, thread:[{author,ts,text}], suggestion?:{replacement,author,ts,result?} } }
// Anchor = quote from the prose. To locate: search for "exact", disambiguate via prefix/suffix.
// Addressing comments: handle every open id. After acting, append a reply {author: your name, ts, text} to its thread, and if you edited the quoted text, update its anchor to the new wording.
{
  "a1f3": {
    "anchor": { "exact": "cut prices hard", "prefix": "we should ", "suffix": " in Q3", "pos": 22 },
    "status": "open",
    "thread": [
      { "author": "Leon", "ts": "2026-06-10T10:24:00Z", "text": "Too aggressive?" }
    ]
  }
}
\`\`\`
~~~

## Addressing comments: cover every open thread

When asked to address, work through, or fix the comments in a note, handle
**every** open thread, not just the ones you happen to notice:

1. **Inventory first.** Read the whole file. If your tool output may be cut off
   (long notes, large blocks), do not rely on what you saw: parse the JSON block
   with a script and list every id whose \`status\` is \`"open"\`. That list is your
   checklist.
2. **Work the checklist in order.** For each open id, locate the anchor and act:
   - a requested change: edit only the anchored passage (and what the comment
     explicitly asks for), then reply in the thread saying what you changed;
   - a question or a request for your opinion: reply, do not edit the prose;
   - missing facts you would have to invent: ask in the thread instead of guessing;
   - an edit suggestion: reply with your view; apply it only if the user asked
     you to accept suggestions (see below);
   - an anchor you cannot locate: keep the entry, reply that the quoted text was
     not found, and mention it in your summary;
   - the last thread entry is already yours and nobody answered: it is waiting
     for the human, leave it alone.
3. **Keep threads attached.** After editing a passage, regenerate \`anchor.exact\`,
   \`prefix\`, \`suffix\` and \`pos\` of every open entry whose quoted text or
   context you changed, so its highlight follows the new wording.
4. **Leave threads open** after replying so the human can review and resolve them
   in Obsidian, unless the user asked you to resolve them.
5. **Verify and report.** Re-read the file and check that the block still opens
   with a line that is exactly \`\`\`tandem-comments (three backticks, nothing
   else) and closes with a line that is exactly three backticks, that its JSON
   parses, and that every id from your checklist is still present unless you
   deliberately removed it. Then check your checklist: every open id got a reply,
   an edit, or a stated reason why not. End with a short per-id summary. Never
   skip an id silently.

When you rewrite the block with a script, rebuild it from the parsed object
(fence line, hint lines, \`JSON.stringify(obj, null, 2)\`, closing fence) instead of
patching backticks with string replacement.

## Rules

- **Locating a passage:** search the prose for \`anchor.exact\`; on multiple hits
  disambiguate via \`prefix\`/\`suffix\`, falling back to the hit closest to \`pos\`
  (character offset into the prose).
- **Replying:** append \`{ "author": "<your name>", "ts": "<ISO-8601 UTC>", "text": "..." }\`
  to the \`thread\` array. Use your own assistant name as author (e.g. \`"Claude"\`,
  \`"Codex"\`), never the name of a human reviewer.
- **New comment:** add a new key (4-digit hex id, e.g. \`"7c2e"\`) with \`anchor\` +
  \`status: "open"\` + \`thread\`. Anchor: \`exact\` = exact quote from the prose,
  \`prefix\`/\`suffix\` = ~20 chars of context before/after, \`pos\` = character offset.
- **New edit suggestion:** create a normal open comment entry and add
  \`"suggestion": { "replacement": "<proposed text>", "author": "<name>", "ts": "<ISO-8601 UTC>" }\`.
  The replacement must be non-empty. Put the reason for the change in the
  \`thread\`. **Do not edit the prose when proposing a suggestion.**
- **Accepting a suggestion:** only when the user explicitly asks. Resolve the
  anchor immediately before editing and refuse if it is missing or ambiguous.
  Before editing, also resolve every other open entry against the old prose and
  remember its range only when it resolves uniquely; leave missing or ambiguous
  anchors unchanged and never choose among duplicate matches. Map each remembered
  range through the replacement (range start with forward affinity, range end with
  backward affinity), then regenerate its \`anchor.exact\`, \`prefix\`, \`suffix\`,
  and \`pos\` from the resulting prose. Do not search again using stale anchor
  metadata or retarget a collapsed range. Replace the accepted range, update all
  surviving uniquely resolved open anchors, and remove the accepted entry in the
  same file update. If history was explicitly requested, keep it with
  \`status: "resolved"\` and
  \`suggestion.result: "accepted"\`.
- **Declining a suggestion:** leave the prose untouched and remove the entry.
  If history was explicitly requested, keep it with \`status: "resolved"\` and
  \`suggestion.result: "declined"\`.
- **Resolving:** **remove the entry entirely** \u2014 the user wants Markdown files kept
  clean. Only if history is explicitly requested, set \`status\` to \`"resolved"\` instead.
- **Block lifecycle:** when no comments remain, **remove the block entirely**
  (including the single separating newline before it). If no block exists yet, append
  it at the end of the file: exactly one \\n between prose and the \`\`\`tandem-comments line.
- **Content after the block:** anything following the closing \`\`\` (e.g. footnote
  definitions like \`[^1]: ...\` that Obsidian appends at the very end) is legitimate \u2014
  keep it byte-exact and leave it after the block when rewriting. If removing the
  block would join non-empty prose directly to this content, retain one separating
  newline.
- **Never** modify the prose while commenting. Comment text may contain Markdown;
  JSON strings escape newlines as \\\\n.
`;
var SKILL_ROOTS = {
  claude: [".claude", "skills"],
  codex: [".agents", "skills"]
};
function writeSkill(target, { fs, os, path }) {
  const dir = path.join(os.homedir(), ...SKILL_ROOTS[target], "obsidian-tandem-comments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  fs.writeFileSync(file, SKILL_MARKDOWN, "utf8");
  return file;
}
function exportSkill(target) {
  if (typeof require !== "function") {
    throw new Error("Skill export is only available in the desktop app.");
  }
  return writeSkill(target, {
    fs: require("fs"),
    os: require("os"),
    path: require("path")
  });
}

// src/settings.ts
var VaultFolderSuggest = class extends import_obsidian3.AbstractInputSuggest {
  getSuggestions(query) {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return this.app.vault.getAllFolders(true).filter((folder) => {
      const label = folder.isRoot() ? "Vault root" : folder.path;
      return label.toLocaleLowerCase().includes(normalizedQuery);
    });
  }
  renderSuggestion(folder, element) {
    element.setText(folder.isRoot() ? "Vault root" : folder.path);
  }
};
function renderColorReadability(container, color) {
  container.empty();
  const previews = container.createDiv({ cls: "tc-color-previews" });
  for (const theme of ["light", "dark"]) {
    const preview = previews.createSpan({
      text: theme === "light" ? "Aa Light" : "Aa Dark",
      cls: `tc-color-preview tc-color-preview-${theme}`
    });
    preview.style.color = color;
  }
  const readability = authorColorReadability(color);
  if (!readability || readability.lowContrastThemes.length === 0) {
    container.createDiv({
      text: "Good contrast in standard light and dark themes.",
      cls: "tc-setting-success"
    });
    return;
  }
  const themes = readability.lowContrastThemes.join(" and ");
  container.createDiv({
    text: `Low contrast in the standard ${themes} theme${readability.lowContrastThemes.length === 1 ? "" : "s"}.`,
    cls: "tc-setting-warning"
  });
}
var REPO_URL = "https://github.com/leonpawelzik/obsidian-tandem-comments";
var CommentsSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.authorColorsExpanded = false;
  }
  display() {
    var _a;
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian3.Setting(containerEl).setName("Identity & appearance").setHeading();
    const detected = this.plugin.detectedAuthor();
    new import_obsidian3.Setting(containerEl).setName("Display name").setDesc(
      `Name added to new comments on this device. Leave empty to use \u201C${detected}\u201D. This value is not synced, so collaborators can use their own names.`
    ).addText((text) => {
      text.setPlaceholder(detected).setValue(this.plugin.authorOverride()).onChange((value) => this.plugin.setAuthorOverride(value));
      text.inputEl.name = "tandem-comments-display-name";
      text.inputEl.autocomplete = "off";
      text.inputEl.spellcheck = false;
      text.inputEl.setAttr("aria-label", "Display name");
    });
    const highlightColorSetting = new import_obsidian3.Setting(containerEl).setName("Highlight color").setDesc("Color used for open review-thread highlights in the editor.").addColorPicker((picker) => {
      picker.setValue(this.plugin.settings.highlightColor).onChange(
        (value) => this.plugin.updateSettings({ highlightColor: value })
      );
    });
    (_a = highlightColorSetting.controlEl.querySelector('input[type="color"]')) == null ? void 0 : _a.setAttr("aria-label", "Highlight color");
    new import_obsidian3.Setting(containerEl).setName("Highlight opacity").setDesc("Strength of the highlight background. The underline remains fully visible.").addSlider((slider) => {
      slider.sliderEl.setAttr("aria-label", "Highlight opacity");
      slider.setLimits(10, 80, 5).setValue(this.plugin.settings.highlightOpacity).setDynamicTooltip().onChange((value) => this.plugin.updateSettings({ highlightOpacity: value }));
    });
    new import_obsidian3.Setting(containerEl).setName("Color author names").setDesc("Give authors stable, theme-aware colors in the comment sidebar.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.colorAuthorNames).onChange(async (value) => {
        await this.plugin.updateSettings({ colorAuthorNames: value });
        this.redisplayPreservingScroll();
      })
    );
    if (this.plugin.settings.colorAuthorNames) this.renderAuthorColors(containerEl);
    new import_obsidian3.Setting(containerEl).setName("Review workflow").setHeading();
    new import_obsidian3.Setting(containerEl).setName("Resolved review threads").setDesc("Choose whether resolved comments and completed suggestions remain in the note as history.").addDropdown(
      (dropdown) => dropdown.addOption("remove", "Remove immediately").addOption("keep", "Keep as history").setValue(this.plugin.settings.resolveBehavior).onChange(async (value) => {
        const resolveBehavior = value === "keep" ? "keep" : "remove";
        await this.plugin.updateSettings({
          resolveBehavior,
          showResolvedByDefault: resolveBehavior === "keep" ? this.plugin.settings.showResolvedByDefault : false
        });
        this.redisplayPreservingScroll();
      })
    );
    const showResolved = new import_obsidian3.Setting(containerEl).setName("Show resolved by default").setDesc(
      this.plugin.settings.resolveBehavior === "keep" ? "Show retained review history when the sidebar opens." : "Available when resolved review threads are kept as history."
    ).addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.showResolvedByDefault).setDisabled(this.plugin.settings.resolveBehavior !== "keep").onChange((value) => this.plugin.updateSettings({ showResolvedByDefault: value }));
    });
    if (this.plugin.settings.resolveBehavior !== "keep") showResolved.setDisabled(true);
    new import_obsidian3.Setting(containerEl).setName("Sidebar order").setDesc("Order comments within the open, orphaned, and resolved sections.").addDropdown(
      (dropdown) => dropdown.addOption("document", "Document position").addOption("newest", "Newest activity first").addOption("oldest", "Oldest activity first").setValue(this.plugin.settings.sidebarSortOrder).onChange(
        (value) => this.plugin.updateSettings({
          sidebarSortOrder: value === "newest" || value === "oldest" ? value : "document"
        })
      )
    );
    new import_obsidian3.Setting(containerEl).setName("Submit comments with").setDesc("Choose the keyboard shortcut used for comments, replies, suggestions, and edits.").addDropdown(
      (dropdown) => dropdown.addOption("enter", "Enter").addOption("mod-enter", "Cmd/Ctrl + Enter").setValue(this.plugin.settings.submitShortcut).onChange(
        (value) => this.plugin.updateSettings({ submitShortcut: value === "mod-enter" ? "mod-enter" : "enter" })
      )
    );
    new import_obsidian3.Setting(containerEl).setName("Timestamp display").setDesc("Choose how timestamps appear in the sidebar. Copies and exports keep their full timestamps.").addDropdown(
      (dropdown) => dropdown.addOption("full", "Full date and time").addOption("compact", "Compact date and time").addOption("relative", "Relative time").addOption("hidden", "Hidden").setValue(this.plugin.settings.timestampDisplay).onChange(
        (value) => this.plugin.updateSettings({
          timestampDisplay: value === "compact" || value === "relative" || value === "hidden" ? value : "full"
        })
      )
    );
    new import_obsidian3.Setting(containerEl).setName("Confirm destructive actions").setDesc("Ask before permanently deleting a comment, reply, suggestion, or resolved thread.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.confirmDestructiveActions).onChange((value) => this.plugin.updateSettings({ confirmDestructiveActions: value }))
    );
    new import_obsidian3.Setting(containerEl).setName("Copy & export").setHeading();
    new import_obsidian3.Setting(containerEl).setName("Include quote when copying").setDesc("Include the quoted passage when the Copy menu action copies a review thread.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.copyIncludeQuote).onChange((value) => this.plugin.updateSettings({ copyIncludeQuote: value }))
    );
    this.renderExportNameSetting(containerEl);
    new import_obsidian3.Setting(containerEl).setName("Export scope").setDesc("Choose which comments and suggestions are included in an exported review note.").addDropdown(
      (dropdown) => dropdown.addOption("all", "Open, resolved, and orphaned").addOption("open", "Open and orphaned only").setValue(this.plugin.settings.exportScope).onChange(
        (value) => this.plugin.updateSettings({ exportScope: value === "open" ? "open" : "all" })
      )
    );
    new import_obsidian3.Setting(containerEl).setName("Export destination").setDesc("Choose where exported review notes are saved inside the vault.").addDropdown(
      (dropdown) => dropdown.addOption("source", "Next to the source note").addOption("folder", "Selected vault folder").setValue(this.plugin.settings.exportDestination).onChange(async (value) => {
        await this.plugin.updateSettings({
          exportDestination: value === "folder" ? "folder" : "source"
        });
        this.redisplayPreservingScroll();
      })
    );
    if (this.plugin.settings.exportDestination === "folder") {
      this.renderExportFolderSetting(containerEl);
    }
    new import_obsidian3.Setting(containerEl).setName("Advanced & integrations").setHeading();
    new import_obsidian3.Setting(containerEl).setName("Reading View indicator").setDesc("Show a comment-count pill below notes that contain open review threads.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showReadingViewIndicator).onChange((value) => this.plugin.updateSettings({ showReadingViewIndicator: value }))
    );
    new import_obsidian3.Setting(containerEl).setName("Include schema hints").setDesc(
      "Add format instructions to the tandem-comments block for tools that read the Markdown directly. Existing blocks update the next time a review thread changes."
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.schemaHint).onChange((value) => this.plugin.updateSettings({ schemaHint: value }))
    );
    new import_obsidian3.Setting(containerEl).setName("Grok Bot webhook").setHeading();
    new import_obsidian3.Setting(containerEl).setName("Wake Grok on new comments").setDesc(
      "Off until you turn it on. Paste the webhook URL and sender key from the Grok Bot routine panel. The key stays in this plugin's data.json on this device and is not written into notes. A wake is sent after a new open comment, or a reply on a thread that is still open. Resolved threads and messages from another author do not send."
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.webhookEnabled).onChange((value) => this.plugin.updateSettings({ webhookEnabled: value }))
    );
    new import_obsidian3.Setting(containerEl).setName("Webhook URL").setDesc("Paste the full webhook URL from the Grok Bot routine panel.").addText((text) => {
      text.setPlaceholder("https://").setValue(this.plugin.settings.webhookUrl).onChange((value) => this.plugin.updateSettings({ webhookUrl: value.trim() }));
      text.inputEl.name = "tandem-comments-webhook-url";
      text.inputEl.autocomplete = "off";
      text.inputEl.spellcheck = false;
      text.inputEl.setAttr("aria-label", "Grok Bot webhook URL");
    });
    new import_obsidian3.Setting(containerEl).setName("Webhook sender key").setDesc("Sender key from the same panel. Stored only in plugin data and not logged.").addText((text) => {
      text.setPlaceholder("Sender key").setValue(this.plugin.settings.webhookSenderKey).onChange((value) => this.plugin.updateSettings({ webhookSenderKey: value.trim() }));
      text.inputEl.type = "password";
      text.inputEl.name = "tandem-comments-webhook-sender-key";
      text.inputEl.autocomplete = "off";
      text.inputEl.spellcheck = false;
      text.inputEl.setAttr("aria-label", "Grok Bot webhook sender key");
    });
    if (import_obsidian3.Platform.isDesktopApp) {
      const exportButton = (target) => () => {
        try {
          new import_obsidian3.Notice("Skill exported: " + exportSkill(target));
        } catch (error) {
          new import_obsidian3.Notice("Export failed: " + (error instanceof Error ? error.message : String(error)));
        }
      };
      new import_obsidian3.Setting(containerEl).setName("AI assistant skill").setDesc(
        "Teach your coding agent the comment format. Claude Code reads ~/.claude/skills, Codex reads ~/.agents/skills. Export again after updating the plugin."
      ).addButton((button) => button.setButtonText("Export for Claude Code").onClick(exportButton("claude"))).addButton((button) => button.setButtonText("Export for Codex").onClick(exportButton("codex")));
    }
    new import_obsidian3.Setting(containerEl).setName("Feedback").setHeading();
    new import_obsidian3.Setting(containerEl).setName("Enjoying Tandem Comments?").setDesc("A star on GitHub helps other people find the plugin. Bugs and ideas are welcome as issues.").addButton(
      (button) => button.setButtonText("Report an issue").onClick(() => window.open(`${REPO_URL}/issues`))
    ).addButton(
      (button) => button.setButtonText("Star on GitHub").setCta().onClick(() => window.open(REPO_URL))
    );
  }
  renderAuthorColors(containerEl) {
    var _a, _b;
    const authorColorNames = Object.keys(this.plugin.settings.authorColorOverrides).sort(
      (a, b) => a.localeCompare(b)
    );
    const authorColors = containerEl.createEl("details", { cls: "tc-author-colors-collapse" });
    authorColors.open = this.authorColorsExpanded;
    authorColors.ontoggle = () => {
      this.authorColorsExpanded = authorColors.open;
    };
    const summary = authorColors.createEl("summary", { cls: "tc-author-colors-summary" });
    summary.createSpan({
      text: `Author color overrides${authorColorNames.length ? ` (${authorColorNames.length})` : ""}`
    });
    const content = authorColors.createDiv({ cls: "tc-author-colors-content" });
    content.createDiv({
      text: "Authors receive an automatic accessible color. Add an override only when you need a specific color, then use the previews to check it in light and dark themes.",
      cls: "tc-author-colors-description"
    });
    let newAuthor = "";
    let newColor = "#2680d9";
    let authorInput = null;
    let updateNewColorReadability = (_color) => void 0;
    const addAuthorRow = new import_obsidian3.Setting(content).setName("Add author override").setDesc("Enter the exact author name used in comment threads.").addText((text) => {
      authorInput = text.inputEl;
      text.setPlaceholder("Author name\u2026").onChange((value) => {
        newAuthor = value;
        if (value.trim()) validationEl.empty();
      });
      text.inputEl.name = "tandem-author-color-name";
      text.inputEl.autocomplete = "off";
      text.inputEl.spellcheck = false;
      text.inputEl.setAttr("aria-label", "Author name for color override");
    }).addColorPicker((picker) => {
      picker.setValue(newColor).onChange((value) => {
        newColor = value;
        updateNewColorReadability(value);
      });
    }).addButton(
      (button) => button.setButtonText("Add override").setCta().onClick(async () => {
        const author = newAuthor.trim();
        if (!author) {
          validationEl.setText("Enter an author name before adding an override.");
          authorInput == null ? void 0 : authorInput.focus();
          return;
        }
        if (hasAuthorColorOverride(this.plugin.settings.authorColorOverrides, author)) {
          validationEl.setText(`An override for ${author} already exists. Edit it below.`);
          authorInput == null ? void 0 : authorInput.focus();
          return;
        }
        await this.plugin.updateSettings({
          authorColorOverrides: {
            ...this.plugin.settings.authorColorOverrides,
            [author]: newColor
          }
        });
        this.redisplayPreservingScroll();
      })
    );
    const validationEl = addAuthorRow.descEl.createDiv({
      cls: "tc-setting-error",
      attr: { "aria-live": "polite" }
    });
    const newColorReadabilityEl = addAuthorRow.descEl.createDiv({
      cls: "tc-color-readability",
      attr: { "aria-live": "polite" }
    });
    updateNewColorReadability = (color) => renderColorReadability(newColorReadabilityEl, color);
    updateNewColorReadability(newColor);
    (_a = addAuthorRow.controlEl.querySelector('input[type="color"]')) == null ? void 0 : _a.setAttr("aria-label", "Color for new author override");
    if (authorColorNames.length > 0) {
      content.createDiv({ text: "Existing overrides", cls: "tc-author-colors-list-title" });
    }
    for (const author of authorColorNames) {
      const currentColor = String(this.plugin.settings.authorColorOverrides[author]);
      let updateReadability = (_color) => void 0;
      const row = new import_obsidian3.Setting(content).setClass("tc-author-color-row").setDesc(`Automatic hue: ${authorHue(author)}\xB0.`).addColorPicker(
        (picker) => picker.setValue(currentColor).onChange((value) => {
          updateReadability(value);
          return this.plugin.updateSettings({
            authorColorOverrides: {
              ...this.plugin.settings.authorColorOverrides,
              [author]: value
            }
          });
        })
      ).addButton(
        (button) => button.setButtonText("Reset").setTooltip(`Reset ${author} to its automatic color`).onClick(async () => {
          const overrides = { ...this.plugin.settings.authorColorOverrides };
          delete overrides[author];
          await this.plugin.updateSettings({ authorColorOverrides: overrides });
          this.redisplayPreservingScroll();
        })
      );
      const nameInput = row.nameEl.createEl("input", {
        cls: "tc-author-color-name",
        attr: {
          type: "text",
          name: `tandem-author-color-${author}`,
          autocomplete: "off",
          spellcheck: "false",
          "aria-label": `Author name for ${author} color override`
        }
      });
      nameInput.value = author;
      const renameError = row.descEl.createDiv({
        cls: "tc-setting-error",
        attr: { "aria-live": "polite" }
      });
      const readabilityEl = row.descEl.createDiv({
        cls: "tc-color-readability",
        attr: { "aria-live": "polite" }
      });
      updateReadability = (color) => renderColorReadability(readabilityEl, color);
      updateReadability(currentColor);
      nameInput.oninput = () => renameError.empty();
      nameInput.onchange = () => {
        const result = renameAuthorColorOverride(
          this.plugin.settings.authorColorOverrides,
          author,
          nameInput.value
        );
        if (!result.ok) {
          renameError.setText(
            result.reason === "empty" ? "Enter an author name." : `An override for ${nameInput.value.trim()} already exists.`
          );
          nameInput.focus();
          return;
        }
        void this.plugin.updateSettings({ authorColorOverrides: result.overrides }).then(
          () => this.redisplayPreservingScroll()
        );
      };
      nameInput.onkeydown = (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          nameInput.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          nameInput.value = author;
          renameError.empty();
          nameInput.blur();
        }
      };
      (_b = row.controlEl.querySelector('input[type="color"]')) == null ? void 0 : _b.setAttr("aria-label", `Color for ${author}`);
    }
  }
  renderExportNameSetting(containerEl) {
    let draft = this.plugin.settings.exportNameTemplate;
    const row = new import_obsidian3.Setting(containerEl).setName("Export note name").setDesc("Use {{filename}} and {{date}} as placeholders. Tandem Comments adds the .md extension.").addText((text) => {
      text.setPlaceholder(DEFAULT_SETTINGS.exportNameTemplate).setValue(draft).onChange((value) => {
        draft = value;
        renderFeedback();
      });
      text.inputEl.name = "tandem-comments-export-name";
      text.inputEl.autocomplete = "off";
      text.inputEl.spellcheck = false;
      text.inputEl.setAttr("aria-label", "Export note name");
      text.inputEl.onblur = () => void save();
      text.inputEl.onkeydown = (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          text.inputEl.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          draft = this.plugin.settings.exportNameTemplate;
          text.setValue(draft);
          renderFeedback();
          text.inputEl.blur();
        }
      };
    });
    const errorEl = row.descEl.createDiv({ cls: "tc-setting-error", attr: { "aria-live": "polite" } });
    const previewEl = row.descEl.createDiv({ cls: "tc-setting-preview", attr: { "aria-live": "polite" } });
    const renderFeedback = () => {
      const error = validateExportNameTemplate(draft);
      const now = /* @__PURE__ */ new Date();
      const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0")
      ].join("-");
      errorEl.setText(error != null ? error : "");
      previewEl.setText(
        error ? "" : `Example: ${renderExportFileName(draft, "My note", date)}.md`
      );
    };
    const save = async () => {
      const error = validateExportNameTemplate(draft);
      if (error) {
        errorEl.setText(error);
        return;
      }
      const value = draft.trim();
      if (value !== this.plugin.settings.exportNameTemplate) {
        await this.plugin.updateSettings({ exportNameTemplate: value });
      }
    };
    renderFeedback();
  }
  renderExportFolderSetting(containerEl) {
    let draft = this.plugin.settings.exportFolder;
    let setInputValue = (_value) => void 0;
    const row = new import_obsidian3.Setting(containerEl).setName("Export folder").setDesc("Choose an existing folder. Leave empty to use the vault root.").addText((text) => {
      text.setPlaceholder("Vault root").setValue(draft).onChange((value) => {
        draft = value;
        renderFeedback();
      });
      setInputValue = (value) => text.setValue(value);
      text.inputEl.name = "tandem-comments-export-folder";
      text.inputEl.autocomplete = "off";
      text.inputEl.spellcheck = false;
      text.inputEl.setAttr("aria-label", "Export folder");
      text.inputEl.onblur = () => void save();
      text.inputEl.onkeydown = (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          text.inputEl.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          draft = this.plugin.settings.exportFolder;
          text.setValue(draft);
          renderFeedback();
          text.inputEl.blur();
        }
      };
      new VaultFolderSuggest(this.app, text.inputEl).onSelect((folder) => {
        draft = folder.isRoot() ? "" : folder.path;
        text.setValue(draft);
        renderFeedback();
        void save();
      });
    });
    const errorEl = row.descEl.createDiv({ cls: "tc-setting-error", attr: { "aria-live": "polite" } });
    const previewEl = row.descEl.createDiv({ cls: "tc-setting-preview", attr: { "aria-live": "polite" } });
    const errorForDraft = () => {
      const pathError = validateVaultFolderPath(draft);
      if (pathError) return pathError;
      const path = normalizeVaultFolderPath(draft);
      if (path && !this.app.vault.getFolderByPath(path)) return "Choose an existing vault folder.";
      return null;
    };
    const renderFeedback = () => {
      const error = errorForDraft();
      const path = normalizeVaultFolderPath(draft);
      errorEl.setText(error != null ? error : "");
      previewEl.setText(error ? "" : `Exports to: ${path || "Vault root"}`);
    };
    const save = async () => {
      const error = errorForDraft();
      if (error) {
        errorEl.setText(error);
        return;
      }
      const value = normalizeVaultFolderPath(draft);
      draft = value;
      setInputValue(value);
      if (value !== this.plugin.settings.exportFolder) {
        await this.plugin.updateSettings({ exportFolder: value });
      }
      renderFeedback();
    };
    renderFeedback();
  }
  redisplayPreservingScroll() {
    var _a;
    const scrollEl = (_a = this.containerEl.closest(".vertical-tab-content-container")) != null ? _a : this.containerEl;
    const scrollTop = scrollEl.scrollTop;
    this.display();
    window.requestAnimationFrame(() => {
      scrollEl.scrollTop = scrollTop;
    });
  }
};

// src/sidebar.ts
var import_obsidian4 = require("obsidian");

// src/sidebar-preferences.ts
function shouldSubmitComment(event, shortcut) {
  if (event.key !== "Enter") return false;
  return shortcut === "enter" ? !event.shiftKey && !event.metaKey && !event.ctrlKey : event.metaKey || event.ctrlKey;
}
function activityTimestamp(item) {
  var _a, _b;
  const threadTs = (_a = item.comment.thread[item.comment.thread.length - 1]) == null ? void 0 : _a.ts;
  const suggestionTs = (_b = item.comment.suggestion) == null ? void 0 : _b.ts;
  const parsedThreadTs = threadTs ? Date.parse(threadTs) : 0;
  const parsedSuggestionTs = suggestionTs ? Date.parse(suggestionTs) : 0;
  return Math.max(
    Number.isFinite(parsedThreadTs) ? parsedThreadTs : 0,
    Number.isFinite(parsedSuggestionTs) ? parsedSuggestionTs : 0
  );
}
function sortSidebarComments(items, order) {
  if (order === "document") {
    return [...items].sort(
      (a, b) => (a.resolution.kind === "resolved" ? a.resolution.start : Number.MAX_SAFE_INTEGER) - (b.resolution.kind === "resolved" ? b.resolution.start : Number.MAX_SAFE_INTEGER)
    );
  }
  const direction = order === "newest" ? -1 : 1;
  return [...items].sort((a, b) => direction * (activityTimestamp(a) - activityTimestamp(b)));
}

// src/timestamp.ts
var compactCache;
var relativeCache;
function formatSidebarTimestamp(timestamp, display, options = {}) {
  var _a;
  if (display === "hidden") return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return timestamp;
  if (display === "full") return date.toLocaleString(options.locale);
  if (display === "compact") {
    const current = /* @__PURE__ */ new Date();
    const offset = current.getTimezoneOffset();
    const now2 = current.getTime();
    if (!compactCache || compactCache.locale !== options.locale || compactCache.offset !== offset || now2 < compactCache.createdAt || now2 - compactCache.createdAt >= 6e4) {
      compactCache = { locale: options.locale, offset, createdAt: now2, formatter: new Intl.DateTimeFormat(options.locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }) };
    }
    return compactCache.formatter.format(date);
  }
  const now = (_a = options.now) != null ? _a : /* @__PURE__ */ new Date();
  const deltaSeconds = (date.getTime() - now.getTime()) / 1e3;
  const absoluteSeconds = Math.abs(deltaSeconds);
  const [divisor, unit] = absoluteSeconds < 60 ? [1, "second"] : absoluteSeconds < 3600 ? [60, "minute"] : absoluteSeconds < 86400 ? [3600, "hour"] : absoluteSeconds < 2592e3 ? [86400, "day"] : absoluteSeconds < 31536e3 ? [2592e3, "month"] : [31536e3, "year"];
  if (!relativeCache || relativeCache.locale !== options.locale) {
    relativeCache = { locale: options.locale, formatter: new Intl.RelativeTimeFormat(options.locale, { numeric: "auto" }) };
  }
  return relativeCache.formatter.format(
    Math.round(deltaSeconds / divisor),
    unit
  );
}

// src/sidebar.ts
var VIEW_TYPE_COMMENTS = "tandem-comments-sidebar";
function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n - 1) + "\u2026";
}
function paintAuthor(el, author, overrides, enabled) {
  el.dataset.tcAuthor = author;
  if (!enabled) {
    el.removeClass("tc-author-colored");
    el.style.removeProperty("--tc-author-color-light");
    el.style.removeProperty("--tc-author-color-dark");
    return;
  }
  el.style.setProperty("--tc-author-color-light", resolveAuthorColor(author, overrides, "light"));
  el.style.setProperty("--tc-author-color-dark", resolveAuthorColor(author, overrides, "dark"));
  el.addClass("tc-author-colored");
}
function suggestionFailureMessage(reason) {
  switch (reason) {
    case "no-editor":
      return "Open this file in a Markdown editor before accepting the suggestion.";
    case "invalid-document":
      return "The tandem-comments block is invalid. Fix its JSON before accepting the suggestion.";
    case "invalid-suggestion":
      return "The suggestion data is invalid. Its replacement must be text.";
    case "orphaned":
      return "The original passage no longer exists. Re-anchor the suggestion before accepting it.";
    case "ambiguous":
      return "The original passage appears more than once. Re-anchor the suggestion before accepting it.";
    case "empty-replacement":
      return "Empty replacements are not supported yet.";
    case "already-resolved":
      return "This suggestion has already been resolved.";
    case "not-suggestion":
      return "This entry is not an edit suggestion.";
    case "missing":
      return "The suggestion or its editor is no longer available.";
  }
}
var CommentSidebar = class extends import_obsidian4.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.hoverPopover = null;
    this.draft = null;
    this.focusedId = null;
    this.renderVersion = 0;
    this.scheduledRender = null;
    this.closed = false;
    this.cards = /* @__PURE__ */ new Map();
    this.cardContext = "";
    this.renderedFile = null;
    this.showResolved = plugin.settings.showResolvedByDefault;
  }
  async onClose() {
    this.closed = true;
    this.renderVersion++;
    this.clearCards();
  }
  clearCards() {
    for (const card of this.cards.values()) this.removeChild(card.component);
    this.cards.clear();
  }
  clearFocus() {
    for (const card of this.cards.values()) card.element.removeClass("tc-focused");
  }
  focusExisting() {
    var _a;
    if (!this.focusedId || this.renderedFile !== this.app.workspace.getActiveFile()) return false;
    const card = (_a = this.cards.get(this.focusedId)) == null ? void 0 : _a.element;
    if (!(card == null ? void 0 : card.isConnected)) return false;
    this.clearFocus();
    card.addClass("tc-focused");
    card.scrollIntoView({ block: "nearest" });
    this.focusedId = null;
    return true;
  }
  getViewType() {
    return VIEW_TYPE_COMMENTS;
  }
  getDisplayText() {
    return "Comments";
  }
  getIcon() {
    return "message-square";
  }
  async onOpen() {
    this.closed = false;
    this.registerEvent(this.app.workspace.on("file-open", () => void this.render()));
    this.registerEvent(
      this.app.vault.on("modify", (f) => {
        var _a;
        if (f.path === ((_a = this.app.workspace.getActiveFile()) == null ? void 0 : _a.path) && !this.hasPendingInput()) {
          void this.render();
        }
      })
    );
    this.registerInterval(
      window.setInterval(() => {
        if (this.plugin.settings.timestampDisplay === "relative") this.refreshTimestamps();
      }, 6e4)
    );
    await this.render();
  }
  startDraft(file, anchor) {
    this.draft = { filePath: file.path, anchor, kind: "comment" };
    void this.render();
  }
  startSuggestionDraft(file, anchor) {
    this.draft = { filePath: file.path, anchor, kind: "suggestion" };
    void this.render();
  }
  focusComment(id) {
    this.clearFocus();
    this.focusedId = id;
    if (!this.focusExisting()) void this.render();
  }
  toggleResolved() {
    this.showResolved = !this.showResolved;
    void this.render();
  }
  settingsChanged(resetResolved) {
    if (resetResolved) this.showResolved = this.plugin.settings.showResolvedByDefault;
    void this.render();
  }
  refreshAuthorColors() {
    for (const el of Array.from(this.contentEl.querySelectorAll(".tc-author[data-tc-author]"))) {
      const author = el.dataset.tcAuthor;
      if (author != null) {
        paintAuthor(
          el,
          author,
          this.plugin.settings.authorColorOverrides,
          this.plugin.settings.colorAuthorNames
        );
      }
    }
  }
  /** Nicht neu rendern, während in einem Eingabefeld getippter Text verloren ginge. */
  hasPendingInput() {
    return Array.from(this.contentEl.querySelectorAll("textarea")).some(
      (t) => t.value.length > 0 || t.classList.contains("tc-edit-input")
    );
  }
  render() {
    if (this.closed) return Promise.resolve();
    this.renderVersion++;
    if (!this.scheduledRender) {
      this.scheduledRender = Promise.resolve().then(() => {
        this.scheduledRender = null;
        return this.renderLatest(this.renderVersion);
      });
    }
    return this.scheduledRender;
  }
  async renderLatest(version) {
    const live = this.contentEl;
    const file = this.app.workspace.getActiveFile();
    const doc = (file == null ? void 0 : file.extension) === "md" ? await this.plugin.readDoc(file) : null;
    if (this.closed || version !== this.renderVersion || file !== this.app.workspace.getActiveFile()) return;
    this.clearFocus();
    this.renderedFile = file;
    const prevScroll = live.scrollTop;
    const container = live.ownerDocument.createElement("div");
    const desired = [];
    const context = JSON.stringify([file == null ? void 0 : file.path, this.plugin.settings]);
    if (context !== this.cardContext) {
      this.clearCards();
      this.cardContext = context;
    }
    live.addClass("tc-sidebar");
    const commit = () => {
      const nodes = desired.length ? desired : Array.from(container.children);
      const retained = new Set(nodes);
      for (const node of Array.from(live.children)) if (!retained.has(node)) live.removeChild(node);
      let cursor = live.firstChild;
      for (const node of nodes) {
        if (node === cursor) cursor = cursor.nextSibling;
        else live.insertBefore(node, cursor);
      }
      while (cursor) {
        const next = cursor.nextSibling;
        live.removeChild(cursor);
        cursor = next;
      }
      live.scrollTop = prevScroll;
      this.focusExisting();
    };
    if (!doc || !file) {
      this.clearCards();
      container.createDiv({ text: "No active Markdown file.", cls: "tc-empty" });
      commit();
      return;
    }
    if (doc.error) {
      this.clearCards();
      container.createDiv({ text: "tandem-comments block is invalid: " + doc.error, cls: "tc-error" });
      commit();
      return;
    }
    const header = container.createDiv({ cls: "tc-header" });
    header.createSpan({ text: "Comments", cls: "tc-title" });
    const toggle = header.createEl("button", {
      text: this.showResolved ? "Hide resolved" : "Show resolved",
      cls: "tc-toggle"
    });
    toggle.onclick = () => this.toggleResolved();
    const exportBtn = header.createEl("button", { text: "Export", cls: "tc-toggle" });
    exportBtn.onclick = () => void this.plugin.exportComments(file);
    if (this.draft && this.draft.filePath === file.path) this.renderDraft(container, file);
    else this.draft = null;
    const visibleComments = this.showResolved ? doc.comments : Object.fromEntries(
      Object.entries(doc.comments).filter(([, comment]) => comment.status === "open")
    );
    const all = resolveAll(doc.prose, visibleComments);
    const open = this.sortComments(
      all.filter((r) => r.comment.status === "open" && r.resolution.kind === "resolved")
    );
    const orphans = this.sortComments(
      all.filter((r) => r.comment.status === "open" && r.resolution.kind === "orphaned")
    );
    const done = this.sortComments(all.filter((r) => r.comment.status === "resolved"));
    desired.push(...Array.from(container.children));
    const visible = /* @__PURE__ */ new Set();
    const appendCard = (r) => {
      visible.add(r.id);
      const signature = JSON.stringify([
        r.comment,
        r.resolution.kind,
        r.resolution.kind === "resolved" && !!r.resolution.ambiguous
      ]);
      let cached = this.cards.get(r.id);
      if (cached && (cached.signature !== signature || cached.element.querySelector(".tc-edit-input"))) {
        this.removeChild(cached.component);
        this.cards.delete(r.id);
        cached = void 0;
      }
      if (!cached) {
        const component = this.addChild(new import_obsidian4.Component());
        const element = this.renderComment(container, file, r, component);
        cached = { element, component, signature, record: r };
        this.cards.set(r.id, cached);
      } else {
        Object.assign(cached.record, r);
      }
      desired.push(cached.element);
    };
    for (const r of open) appendCard(r);
    if (orphans.length) {
      desired.push(container.createDiv({ text: "Orphaned \u2014 text passage not found", cls: "tc-section" }));
      for (const r of orphans) appendCard(r);
    }
    if (this.showResolved && done.length) {
      desired.push(container.createDiv({ text: "Resolved", cls: "tc-section" }));
      for (const r of done) appendCard(r);
    }
    for (const [id, card] of this.cards) {
      if (!visible.has(id)) {
        this.removeChild(card.component);
        this.cards.delete(id);
      }
    }
    if (!visible.size && !this.draft) desired.push(container.createDiv({ text: "No comments or suggestions in this file.", cls: "tc-empty" }));
    commit();
  }
  renderDraft(container, file) {
    const draft = this.draft;
    if (!draft) return;
    const card = container.createDiv({ cls: "tc-card tc-draft" });
    card.createDiv({ text: `"${truncate(draft.anchor.exact, 80)}"`, cls: "tc-quote" });
    if (draft.kind === "suggestion") {
      this.renderSuggestionDraft(card, file, draft);
      return;
    }
    const input = card.createEl("textarea", {
      cls: "tc-input",
      attr: {
        placeholder: this.plugin.settings.submitShortcut === "enter" ? "Comment\u2026 (Enter = save, Esc = cancel)" : "Comment\u2026 (Cmd/Ctrl+Enter = save, Esc = cancel)",
        rows: "3"
      }
    });
    window.setTimeout(() => input.focus(), 0);
    input.onkeydown = (e) => {
      if (e.key === "Escape") {
        this.draft = null;
        void this.render();
      } else if (this.shouldSubmit(e)) {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        void this.plugin.updateDoc(file, (d) => {
          addComment(
            d.comments,
            generateId(d.comments),
            draft.anchor,
            this.plugin.currentAuthor(),
            this.plugin.nowTs(),
            text
          );
        }).then((ok) => {
          if (ok) {
            this.draft = null;
            void this.render();
          }
        });
      }
    };
  }
  renderSuggestionDraft(card, file, draft) {
    card.createDiv({ text: "Suggested replacement", cls: "tc-field-label" });
    const replacement = card.createEl("textarea", {
      cls: "tc-input",
      attr: { placeholder: "Replacement text\u2026", rows: "3", "aria-label": "Suggested replacement" }
    });
    card.createDiv({ text: "Explanation (optional)", cls: "tc-field-label" });
    const note = card.createEl("textarea", {
      cls: "tc-input",
      attr: { placeholder: "Why this change?", rows: "2", "aria-label": "Suggestion explanation" }
    });
    const actions = card.createDiv({ cls: "tc-actions" });
    const save = actions.createEl("button", { text: "Add suggestion", cls: "mod-cta" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    const submit = () => {
      if (save.disabled) return;
      if (replacement.value.length === 0) {
        new import_obsidian4.Notice("Enter replacement text first.");
        replacement.focus();
        return;
      }
      save.disabled = true;
      const proposedText = replacement.value;
      const explanation = note.value.trim();
      void this.plugin.updateDoc(file, (d) => {
        addSuggestion(
          d.comments,
          generateId(d.comments),
          draft.anchor,
          this.plugin.currentAuthor(),
          this.plugin.nowTs(),
          proposedText,
          explanation || void 0
        );
      }).then((ok) => {
        if (ok) {
          this.draft = null;
          void this.render();
        } else {
          save.disabled = false;
        }
      });
    };
    save.onclick = submit;
    cancel.onclick = () => {
      this.draft = null;
      void this.render();
    };
    replacement.onkeydown = (e) => {
      if (e.key === "Escape") {
        this.draft = null;
        void this.render();
      } else if (this.shouldSubmit(e)) {
        e.preventDefault();
        submit();
      }
    };
    note.onkeydown = (e) => {
      if (e.key === "Escape") {
        this.draft = null;
        void this.render();
      } else if (this.shouldSubmit(e)) {
        e.preventDefault();
        submit();
      }
    };
    window.setTimeout(() => replacement.focus(), 0);
  }
  renderComment(container, file, r, component) {
    var _a;
    const cls = ["tc-card"];
    if (r.comment.status === "resolved") cls.push("tc-resolved");
    if (r.resolution.kind === "orphaned" && !(((_a = r.comment.suggestion) == null ? void 0 : _a.result) === "accepted" && r.comment.status === "resolved")) {
      cls.push("tc-orphan");
    }
    if (r.comment.suggestion) cls.push("tc-suggestion-card");
    if (r.resolution.kind === "resolved" && r.resolution.ambiguous) cls.push("tc-ambiguous");
    const card = container.createDiv({ cls: cls.join(" ") });
    const copyThread = () => {
      void navigator.clipboard.writeText(formatComment(r, { includeQuote: this.plugin.settings.copyIncludeQuote, formatTs })).then(() => new import_obsidian4.Notice("Thread copied."));
    };
    const showMenu = (trigger, build2) => {
      const menu = new import_obsidian4.Menu();
      build2(menu);
      trigger.setAttr("aria-expanded", "true");
      menu.onHide(() => trigger.setAttr("aria-expanded", "false"));
      const rect = trigger.getBoundingClientRect();
      menu.showAtPosition({ x: rect.right, y: rect.bottom, left: true }, trigger.ownerDocument);
    };
    const addCopyMenuItem = (menu) => {
      menu.addItem((item) => item.setTitle("Copy").setIcon("copy").onClick(copyThread));
    };
    const addResolveButton = (controls) => {
      const resolveBtn = controls.createEl("button", {
        cls: "tc-entry-action clickable-icon",
        attr: {
          "aria-label": "Resolve comment"
        }
      });
      (0, import_obsidian4.setIcon)(resolveBtn, "check");
      (0, import_obsidian4.setTooltip)(resolveBtn, "Resolve");
      resolveBtn.onclick = () => {
        void (async () => {
          if (this.plugin.settings.resolveBehavior === "remove" && this.plugin.settings.confirmDestructiveActions && !await confirmAction(this.app, {
            title: "Resolve comment?",
            message: "This will permanently remove the comment thread from the note.",
            confirmLabel: "Resolve"
          })) {
            return;
          }
          await this.plugin.updateDoc(file, (d) => {
            if (this.plugin.settings.resolveBehavior === "remove") removeComment(d.comments, r.id);
            else setStatus(d.comments, r.id, "resolved");
          });
        })();
      };
    };
    const addMenuTrigger = (controls, ariaLabel, deleteTitle, deleteMessage, deleteAction) => {
      const trigger = controls.createEl("button", {
        cls: "tc-entry-menu-trigger clickable-icon",
        attr: {
          "aria-label": ariaLabel,
          "aria-haspopup": "menu",
          "aria-expanded": "false"
        }
      });
      (0, import_obsidian4.setIcon)(trigger, "ellipsis");
      trigger.onclick = () => showMenu(trigger, (menu) => {
        addCopyMenuItem(menu);
        menu.addItem(
          (item) => item.setTitle(deleteTitle).setIcon("trash-2").setWarning(true).onClick(() => {
            void (async () => {
              if (this.plugin.settings.confirmDestructiveActions && !await confirmAction(this.app, {
                title: `${deleteTitle}?`,
                message: deleteMessage,
                confirmLabel: deleteTitle
              })) {
                return;
              }
              await deleteAction();
            })();
          })
        );
      });
    };
    if (r.comment.suggestion) {
      const suggestion = r.comment.suggestion;
      const replacement = typeof suggestion.replacement === "string" ? suggestion.replacement : "";
      const suggestionResult = suggestion.result === "accepted" || suggestion.result === "declined" ? suggestion.result : void 0;
      const heading = card.createDiv({ cls: "tc-suggestion-heading" });
      heading.createSpan({ text: "Suggested edit", cls: "tc-suggestion-title" });
      if (suggestionResult) {
        heading.createSpan({
          text: suggestionResult === "accepted" ? "Accepted" : "Declined",
          cls: `tc-suggestion-result tc-suggestion-${suggestionResult}`
        });
      }
      const meta = card.createDiv({ cls: "tc-meta" });
      paintAuthor(
        meta.createSpan({ text: suggestion.author, cls: "tc-author" }),
        suggestion.author,
        this.plugin.settings.authorColorOverrides,
        this.plugin.settings.colorAuthorNames
      );
      this.addTimestamp(meta, suggestion.ts);
      const suggestionControls = meta.createDiv({ cls: "tc-entry-controls" });
      addMenuTrigger(
        suggestionControls,
        "More options for suggestion",
        "Delete Suggestion",
        "This will permanently remove the suggestion and its discussion from the note.",
        () => this.plugin.updateDoc(file, (d) => removeComment(d.comments, r.id))
      );
      const change = card.createDiv({ cls: "tc-suggestion-change" });
      const original = change.createDiv({ text: r.comment.anchor.exact, cls: "tc-suggestion-original" });
      if (r.resolution.kind === "resolved") {
        original.addClass("tc-quote-link");
        original.onclick = () => this.plugin.revealAnchor(file, r.comment.anchor);
      }
      change.createDiv({ text: "\u2193", cls: "tc-suggestion-arrow", attr: { "aria-hidden": "true" } });
      change.createDiv({
        text: replacement || (typeof suggestion.replacement === "string" ? "" : "Invalid replacement data"),
        cls: "tc-suggestion-replacement"
      });
      if (r.comment.status === "open" && r.resolution.kind === "orphaned") {
        card.createDiv({ text: "Original passage not found.", cls: "tc-suggestion-warning" });
      } else if (r.comment.status === "open" && r.resolution.kind === "resolved" && r.resolution.ambiguous) {
        card.createDiv({
          text: "Original passage appears more than once. Re-anchor before accepting.",
          cls: "tc-suggestion-warning"
        });
      } else if (r.comment.status === "open" && replacement.length === 0) {
        card.createDiv({
          text: typeof suggestion.replacement === "string" ? "Empty replacements are not supported yet." : "Replacement must be text.",
          cls: "tc-suggestion-warning"
        });
      }
    } else {
      const quote = card.createDiv({ text: `"${truncate(r.comment.anchor.exact, 80)}"`, cls: "tc-quote" });
      if (r.resolution.kind === "resolved") {
        quote.addClass("tc-quote-link");
        quote.onclick = () => this.plugin.revealAnchor(file, r.comment.anchor);
      }
      if (r.comment.thread.length === 0) {
        const fallbackMeta = card.createDiv({ cls: "tc-meta" });
        const fallbackControls = fallbackMeta.createDiv({ cls: "tc-entry-controls" });
        if (r.comment.status === "open") addResolveButton(fallbackControls);
        addMenuTrigger(
          fallbackControls,
          "More options for comment",
          "Delete Comment",
          "This will permanently remove the comment thread from the note.",
          () => this.plugin.updateDoc(file, (d) => removeComment(d.comments, r.id))
        );
      }
    }
    for (const [entryIndex, entry] of r.comment.thread.entries()) {
      const row = card.createDiv({ cls: "tc-entry" });
      const meta = row.createDiv({ cls: "tc-meta" });
      paintAuthor(
        meta.createSpan({ text: entry.author, cls: "tc-author" }),
        entry.author,
        this.plugin.settings.authorColorOverrides,
        this.plugin.settings.colorAuthorNames
      );
      this.addTimestamp(meta, entry.ts);
      const entryControls = meta.createDiv({ cls: "tc-entry-controls" });
      if (entryIndex === 0 && r.comment.status === "open" && !r.comment.suggestion) {
        addResolveButton(entryControls);
      }
      addMenuTrigger(
        entryControls,
        `More options for comment by ${entry.author}`,
        "Delete Comment",
        entryIndex === 0 ? "This will permanently remove the comment thread from the note." : "This will permanently remove this reply from the comment thread.",
        () => this.plugin.updateDoc(file, (d) => removeThreadEntry(d.comments, r.id, entryIndex))
      );
      const textEl = row.createDiv({
        cls: "tc-text tc-text-editable",
        attr: {
          tabindex: "0",
          title: "Double-click to edit",
          "aria-label": `Comment by ${entry.author}. Double-click or press Enter to edit.`
        }
      });
      void import_obsidian4.MarkdownRenderer.render(this.app, entry.text, textEl, file.path, component);
      this.wireCommentLinks(textEl, file);
      const beginEdit = () => {
        const expected = { ...entry };
        const input = row.createEl("textarea", {
          cls: "tc-input tc-edit-input",
          attr: { rows: "3", "aria-label": `Edit comment by ${entry.author}` }
        });
        input.value = entry.text;
        textEl.replaceWith(input);
        const editActions = row.createDiv({ cls: "tc-actions tc-edit-actions" });
        const save = editActions.createEl("button", { text: "Save", cls: "mod-cta" });
        const cancel = editActions.createEl("button", { text: "Cancel" });
        const submit = () => {
          if (save.disabled) return;
          const text = input.value.trim();
          if (!text) {
            new import_obsidian4.Notice("Comment cannot be empty.");
            input.focus();
            return;
          }
          if (text === expected.text) {
            void this.render();
            return;
          }
          save.disabled = true;
          cancel.disabled = true;
          let failure = null;
          void this.plugin.updateDoc(file, (d) => {
            const result = editThreadEntry(d.comments, r.id, entryIndex, expected, text);
            if (!result.ok) failure = result.reason;
          }).then((ok) => {
            if (!ok) {
              save.disabled = false;
              cancel.disabled = false;
              return;
            }
            if (failure === "conflict") {
              new import_obsidian4.Notice("This comment changed while you were editing it. Your edit was not saved.");
            } else if (failure === "missing") {
              new import_obsidian4.Notice("This comment no longer exists. Your edit was not saved.");
            }
            void this.render();
          });
        };
        save.onclick = submit;
        cancel.onclick = () => void this.render();
        input.onkeydown = (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            void this.render();
          } else if (this.shouldSubmit(e)) {
            e.preventDefault();
            submit();
          }
        };
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      };
      textEl.ondblclick = (e) => {
        if (e.target instanceof Element && e.target.closest("a")) return;
        e.preventDefault();
        beginEdit();
      };
      textEl.onkeydown = (e) => {
        if (e.target !== textEl) return;
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          beginEdit();
        }
      };
    }
    const actions = card.createDiv({ cls: "tc-actions" });
    if (r.comment.status === "open" && r.comment.suggestion && !r.comment.suggestion.result) {
      const canAccept = r.resolution.kind === "resolved" && !r.resolution.ambiguous && typeof r.comment.suggestion.replacement === "string" && r.comment.suggestion.replacement.length > 0;
      const acceptBtn = actions.createEl("button", { text: "Accept", cls: "mod-cta" });
      acceptBtn.disabled = !canAccept;
      acceptBtn.onclick = () => {
        const result = this.plugin.acceptEditSuggestion(file, r.id);
        if (!result.ok) {
          new import_obsidian4.Notice(suggestionFailureMessage(result.reason));
          return;
        }
        card.remove();
      };
      const declineBtn = actions.createEl("button", { text: "Decline" });
      declineBtn.onclick = () => {
        void (async () => {
          if (this.plugin.settings.resolveBehavior === "remove" && this.plugin.settings.confirmDestructiveActions && !await confirmAction(this.app, {
            title: "Decline suggestion?",
            message: "This will permanently remove the suggestion and its discussion from the note.",
            confirmLabel: "Decline"
          })) {
            return;
          }
          await this.plugin.updateDoc(file, (d) => {
            const result = declineSuggestion(d.comments, r.id, this.plugin.settings.resolveBehavior);
            if (!result.ok) new import_obsidian4.Notice(suggestionFailureMessage(result.reason));
          });
        })();
      };
    } else if (r.comment.status === "resolved" && !r.comment.suggestion) {
      const reopenBtn = actions.createEl("button", { text: "Reopen" });
      reopenBtn.onclick = () => void this.plugin.updateDoc(file, (d) => setStatus(d.comments, r.id, "open"));
    }
    if (r.comment.status === "open" && (r.resolution.kind === "orphaned" || r.comment.suggestion && r.resolution.kind === "resolved" && r.resolution.ambiguous)) {
      const reBtn = actions.createEl("button", { text: "Re-anchor to selection" });
      reBtn.onclick = () => this.reanchorFromSelection(file, r.id);
    }
    if (!actions.hasChildNodes()) actions.remove();
    if (r.comment.status === "open") {
      const reply = card.createEl("textarea", {
        cls: "tc-input",
        attr: {
          placeholder: this.plugin.settings.submitShortcut === "enter" ? "Reply\u2026 (Enter = send)" : "Reply\u2026 (Cmd/Ctrl+Enter = send)",
          rows: "2"
        }
      });
      reply.onkeydown = (e) => {
        if (this.shouldSubmit(e)) {
          e.preventDefault();
          const text = reply.value.trim();
          if (!text) return;
          reply.value = "";
          void this.plugin.updateDoc(
            file,
            (d) => addReply(d.comments, r.id, this.plugin.currentAuthor(), this.plugin.nowTs(), text)
          );
        }
      };
    }
    return card;
  }
  shouldSubmit(event) {
    return shouldSubmitComment(event, this.plugin.settings.submitShortcut);
  }
  /**
   * MarkdownRenderer.render() produces link elements, but outside a Markdown
   * view they are inert: internal links navigate only if the host view calls
   * openLinkText() itself, and hover previews only appear if the view fires
   * the hover-link event. Wire both up for links inside comment text.
   */
  wireCommentLinks(textEl, file) {
    const findInternalLink = (evt) => {
      var _a, _b;
      const link = (_b = (_a = evt.target) == null ? void 0 : _a.closest) == null ? void 0 : _b.call(_a, "a.internal-link");
      return link && textEl.contains(link) ? link : null;
    };
    const getLinkTarget = (link) => {
      var _a;
      return (_a = link.getAttribute("data-href")) != null ? _a : link.getAttribute("href");
    };
    const openInternalLink = (evt, newLeaf) => {
      const link = findInternalLink(evt);
      if (!link) return;
      const target = getLinkTarget(link);
      if (!target) return;
      evt.preventDefault();
      evt.stopPropagation();
      void this.app.workspace.openLinkText(target, file.path, newLeaf);
    };
    textEl.addEventListener("click", (evt) => {
      openInternalLink(evt, import_obsidian4.Keymap.isModEvent(evt));
    });
    textEl.addEventListener("auxclick", (evt) => {
      if (evt.button === 1) openInternalLink(evt, true);
    });
    textEl.addEventListener("mouseover", (evt) => {
      const link = findInternalLink(evt);
      if (!link) return;
      const target = getLinkTarget(link);
      if (!target) return;
      this.app.workspace.trigger("hover-link", {
        event: evt,
        source: this.plugin.manifest.id,
        hoverParent: this,
        targetEl: link,
        linktext: target,
        sourcePath: file.path
      });
    });
  }
  addTimestamp(container, timestamp) {
    const formatted = formatSidebarTimestamp(timestamp, this.plugin.settings.timestampDisplay);
    if (formatted === null) return;
    const element = container.createSpan({ text: formatted, cls: "tc-ts" });
    element.dataset.tcTimestamp = timestamp;
    if (this.plugin.settings.timestampDisplay !== "full") {
      (0, import_obsidian4.setTooltip)(element, formatTs(timestamp));
    }
  }
  refreshTimestamps() {
    for (const element of Array.from(
      this.contentEl.querySelectorAll(".tc-ts[data-tc-timestamp]")
    )) {
      const timestamp = element.dataset.tcTimestamp;
      if (!timestamp) continue;
      const formatted = formatSidebarTimestamp(timestamp, this.plugin.settings.timestampDisplay);
      if (formatted !== null) element.setText(formatted);
    }
  }
  sortComments(items) {
    return sortSidebarComments(items, this.plugin.settings.sidebarSortOrder);
  }
  reanchorFromSelection(file, id) {
    const sel = this.plugin.getProseSelection(file);
    if (!sel) {
      new import_obsidian4.Notice("Select the new text passage in the editor first.");
      return;
    }
    void this.plugin.updateDoc(file, (d) => {
      const c = d.comments[id];
      if (c) c.anchor = sel.anchor;
    });
  }
};

// src/suggestion-editor.ts
function commitSuggestionAcceptance(editor, plan) {
  editor.transaction({
    changes: plan.changes.map((change) => ({
      from: editor.offsetToPos(change.from),
      to: editor.offsetToPos(change.to),
      text: change.insert
    }))
  });
  editor.setCursor(editor.offsetToPos(plan.cursor));
}

// src/webhook.ts
var WEBHOOK_DEBOUNCE_MS = 3e3;
function cloneCommentMap(comments) {
  return JSON.parse(JSON.stringify(comments));
}
function isDeviceAuthor(author, deviceAuthor) {
  const device = deviceAuthor.trim();
  return device.length > 0 && author.trim() === device;
}
function collectOpenCommentWakes(before, after, deviceAuthor) {
  const wakes = [];
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
        lastText: last.text
      });
      continue;
    }
    if (previous.status !== "open") continue;
    if (comment.thread.length > previous.thread.length) {
      wakes.push({
        event: "comment_replied",
        commentId: id,
        author: last.author,
        lastText: last.text
      });
    }
  }
  return wakes;
}
function buildWebhookPayload(wake, vaultRelativePath, noteTitle) {
  const payload = {
    vaultRelativePath,
    commentId: wake.commentId,
    lastText: wake.lastText,
    author: wake.author
  };
  const title = noteTitle.trim();
  if (title) payload.noteTitle = title;
  payload.event = wake.event;
  return payload;
}
function webhookDebounceKey(payload) {
  var _a;
  return [payload.vaultRelativePath, payload.commentId, (_a = payload.event) != null ? _a : "", payload.lastText].join("\0");
}
function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch (e) {
    return false;
  }
}
function webhookHttpRequest(senderKey, body) {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${senderKey}`,
      "Content-Type": "application/json"
    },
    body
  };
}
async function postWebhookWithFetch(url, senderKey, body) {
  const response = await fetch(url, webhookHttpRequest(senderKey, body));
  return { ok: response.ok, status: response.status };
}
var WebhookDebounce = class {
  constructor(windowMs = WEBHOOK_DEBOUNCE_MS) {
    this.windowMs = windowMs;
    this.seen = /* @__PURE__ */ new Map();
  }
  allow(key, now = Date.now()) {
    this.prune(now);
    const previous = this.seen.get(key);
    if (previous !== void 0 && now - previous < this.windowMs) return false;
    this.seen.set(key, now);
    return true;
  }
  forget(key) {
    this.seen.delete(key);
  }
  prune(now) {
    for (const [key, at] of this.seen) {
      if (now - at >= this.windowMs) this.seen.delete(key);
    }
  }
};
var WebhookNotifier = class {
  constructor(post = postWebhookWithFetch) {
    this.post = post;
    this.warned = false;
    this.debounce = new WebhookDebounce();
  }
  async notify(input) {
    var _a;
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
      const now = (_a = input.now) != null ? _a : Date.now();
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
        } catch (e) {
          this.debounce.forget(key);
          this.warnOnce("Tandem Comments webhook request failed. Commenting is unaffected.");
        }
      }
    } catch (e) {
      this.warnOnce("Tandem Comments webhook request failed. Commenting is unaffected.");
    }
  }
  warnOnce(message) {
    if (this.warned) return;
    this.warned = true;
    console.warn(message);
  }
};

// src/main.ts
function postGrokWebhook(url, senderKey, body) {
  const request = webhookHttpRequest(senderKey, body);
  return (0, import_obsidian5.requestUrl)({
    url,
    method: request.method,
    contentType: "application/json",
    headers: request.headers,
    body: request.body,
    throw: false
  }).then((response) => ({
    ok: response.status >= 200 && response.status < 300,
    status: response.status
  }));
}
var CommentsPlugin = class extends import_obsidian5.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.applyingSuggestion = false;
    this.anchorSaves = new PendingAnchorSaves((file, update) => this.app.vault.process(file, update));
    this.settingsWriteQueue = Promise.resolve();
    this.webhook = new WebhookNotifier(postGrokWebhook);
  }
  captureAnchorSave(view, previous) {
    var _a;
    const file = (_a = view.state.field(import_obsidian5.editorInfoField, false)) == null ? void 0 : _a.file;
    if (!file) return;
    if ((previous == null ? void 0 : previous.key) === file) return previous;
    return { key: file, save: (before, after) => {
      void this.anchorSaves.queue(file, before, after).catch((error) => console.error("Tandem anchor save failed", error));
    } };
  }
  async onload() {
    await this.loadSettings();
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof import_obsidian5.TFile) void this.anchorSaves.modified(file).catch((error) => console.error("Tandem anchor save failed", error));
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof import_obsidian5.TFile) this.anchorSaves.forget(file);
    }));
    this.applyHighlightAppearance();
    this.applyReadingViewPreference();
    this.registerHoverLinkSource(this.manifest.id, {
      display: this.manifest.name,
      defaultMod: false
    });
    this.registerView(VIEW_TYPE_COMMENTS, (leaf) => new CommentSidebar(leaf, this));
    this.registerEditorExtension([buildEditorExtension(this), buildHiddenBlockExtension(import_obsidian5.editorLivePreviewField)]);
    registerReadingView(this);
    this.addSettingTab(new CommentsSettingTab(this.app, this));
    this.addCommand({
      id: "add-comment",
      name: "Add comment",
      icon: "message-square-plus",
      editorCallback: (editor) => this.addCommentFromSelection(editor)
    });
    this.addCommand({
      id: "suggest-edit",
      name: "Suggest edit",
      icon: "replace",
      editorCallback: (editor) => this.addSuggestionFromSelection(editor)
    });
    this.addCommand({
      id: "open-sidebar",
      name: "Open comment sidebar",
      icon: "message-square",
      callback: () => void this.openSidebar()
    });
    this.addCommand({
      id: "toggle-resolved",
      name: "Toggle resolved threads",
      icon: "check-check",
      callback: () => void this.openSidebar().then((v) => v == null ? void 0 : v.toggleResolved())
    });
    this.addCommand({
      id: "purge-resolved",
      name: "Remove resolved threads from file",
      icon: "trash-2",
      callback: () => void this.removeResolvedThreads()
    });
    this.addCommand({
      id: "export-comments",
      name: "Export review threads of active file",
      icon: "file-output",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new import_obsidian5.Notice("No active Markdown file.");
          return;
        }
        void this.exportComments(file);
      }
    });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (!editor.somethingSelected()) return;
        menu.addItem(
          (item) => item.setTitle("Add comment").setIcon("message-square").onClick(() => this.addCommentFromSelection(editor))
        );
        menu.addItem(
          (item) => item.setTitle("Suggest edit").setIcon("replace").onClick(() => this.addSuggestionFromSelection(editor))
        );
      })
    );
    this.registerEvent(
      this.app.workspace.on("window-open", (win) => {
        this.applyHighlightAppearanceTo(win.doc);
        this.applyReadingViewPreferenceTo(win.doc);
      })
    );
  }
  onunload() {
    this.anchorSaves.clear();
    for (const doc of this.allDocuments()) {
      doc.body.style.removeProperty("--tc-highlight-color");
      doc.body.style.removeProperty("--tc-highlight-opacity");
      doc.body.classList.remove("tc-hide-reading-indicator");
    }
  }
  async loadSettings() {
    const parsed = parseCommentsSettings(await this.loadData());
    this.migrateLegacyAuthorName(parsed.legacyAuthorName);
    this.settings = parsed.settings;
    if (parsed.changed) await this.saveData(this.settings);
  }
  async updateSettings(patch) {
    const previous = this.settings;
    const next = parseCommentsSettings({ ...previous, ...patch }).settings;
    this.settings = next;
    const write = this.settingsWriteQueue.catch(() => void 0).then(() => this.saveData(next));
    this.settingsWriteQueue = write;
    await write;
    const effects = settingsEffects(previous, next);
    if (effects.refreshHighlights) this.applyHighlightAppearance();
    if (effects.refreshAuthorColors) this.refreshAuthorColors();
    if (effects.refreshReadingViewIndicator) this.applyReadingViewPreference();
    if (effects.refreshSidebar) {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)) {
        if (leaf.view instanceof CommentSidebar) {
          leaf.view.settingsChanged(effects.resetResolvedVisibility);
        }
      }
    }
  }
  async removeResolvedThreads() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") return;
    if (this.settings.confirmDestructiveActions && !await confirmAction(this.app, {
      title: "Remove resolved threads?",
      message: "This will permanently remove every resolved review thread from the active note.",
      confirmLabel: "Remove threads"
    })) {
      return;
    }
    await this.updateDoc(file, (doc) => {
      let count = 0;
      for (const [id, comment] of Object.entries(doc.comments)) {
        if (comment.status === "resolved") {
          delete doc.comments[id];
          count++;
        }
      }
      new import_obsidian5.Notice(
        count > 0 ? `${count} resolved thread${count === 1 ? "" : "s"} removed.` : "No resolved threads in this file."
      );
    });
  }
  /**
   * The author label attached to new comments/replies from this device: the
   * manual override if set, otherwise the detected OS account username, else a
   * generic fallback. See {@link resolveAuthorName}.
   */
  currentAuthor() {
    return resolveAuthorName(this.authorOverride(), detectOsUsername());
  }
  /** The name auto-detection would use — shown as the settings placeholder. */
  detectedAuthor() {
    var _a;
    return (_a = detectOsUsername()) != null ? _a : FALLBACK_AUTHOR;
  }
  /** Device-local manual override for the author label ("" when unset). Never synced. */
  authorOverride() {
    const v = this.app.loadLocalStorage(AUTHOR_OVERRIDE_KEY);
    return typeof v === "string" ? v : "";
  }
  /** Persist the override to per-vault localStorage; an empty value clears it. */
  setAuthorOverride(value) {
    const trimmed = value.trim();
    this.app.saveLocalStorage(AUTHOR_OVERRIDE_KEY, trimmed || null);
  }
  /**
   * One-time transition: the author name used to live in synced settings. Seed
   * it as this device's local override (unless one already exists) and drop it
   * from the settings object so it stops being synced.
   */
  migrateLegacyAuthorName(syncedAuthorName) {
    const current = this.app.loadLocalStorage(AUTHOR_OVERRIDE_KEY);
    const oldLocal = this.app.loadLocalStorage(LEGACY_AUTHOR_OVERRIDE_KEY);
    const legacy = typeof oldLocal === "string" && oldLocal.trim() ? oldLocal.trim() : syncedAuthorName == null ? void 0 : syncedAuthorName.trim();
    if (typeof current !== "string" && legacy && legacy !== FALLBACK_AUTHOR) {
      this.app.saveLocalStorage(AUTHOR_OVERRIDE_KEY, legacy);
    }
    if (oldLocal !== null) this.app.saveLocalStorage(LEGACY_AUTHOR_OVERRIDE_KEY, null);
  }
  /** Haupt-Fenster + alle Popout-Fenster. */
  allDocuments() {
    const docs = /* @__PURE__ */ new Set([activeDocument]);
    this.app.workspace.iterateAllLeaves((leaf) => docs.add(leaf.view.containerEl.ownerDocument));
    return docs;
  }
  applyHighlightAppearance() {
    for (const doc of this.allDocuments()) {
      this.applyHighlightAppearanceTo(doc);
    }
  }
  applyHighlightAppearanceTo(doc) {
    doc.body.style.setProperty("--tc-highlight-color", this.settings.highlightColor);
    doc.body.style.setProperty("--tc-highlight-opacity", `${this.settings.highlightOpacity}%`);
  }
  applyReadingViewPreference() {
    for (const doc of this.allDocuments()) this.applyReadingViewPreferenceTo(doc);
  }
  applyReadingViewPreferenceTo(doc) {
    doc.body.classList.toggle(
      "tc-hide-reading-indicator",
      !this.settings.showReadingViewIndicator
    );
  }
  nowTs() {
    return (/* @__PURE__ */ new Date()).toISOString();
  }
  async readDoc(file) {
    return parseDocument(await this.app.vault.read(file));
  }
  /** Alle Mutationen laufen hierdurch: read → parse → mutate → serialize → write. */
  async updateDoc(file, mutate) {
    const raw = await this.app.vault.read(file);
    const doc = parseDocument(raw);
    if (doc.error) {
      new import_obsidian5.Notice("tandem-comments block is invalid \u2014 please fix the JSON: " + doc.error);
      return false;
    }
    const before = cloneCommentMap(doc.comments);
    mutate(doc);
    const out = serializeDocument(doc, this.settings.schemaHint);
    if (out === raw) return true;
    await this.app.vault.modify(file, out);
    void this.webhook.notify({
      settings: this.settings,
      vaultRelativePath: file.path,
      noteTitle: file.basename,
      deviceAuthor: this.currentAuthor(),
      before,
      after: doc.comments
    });
    return true;
  }
  /** Exportiert alle Kommentare der Datei als Notiz und überschreibt sie bei erneutem Export. */
  async exportComments(file) {
    var _a, _b;
    const doc = await this.readDoc(file);
    if (doc.error) {
      new import_obsidian5.Notice("tandem-comments block is invalid \u2014 please fix the JSON: " + doc.error);
      return;
    }
    const now = /* @__PURE__ */ new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const content = buildExportNote(file.basename, resolveAll(doc.prose, doc.comments), {
      scope: this.settings.exportScope,
      date,
      formatTs
    });
    if (!content) {
      new import_obsidian5.Notice("No review threads to export.");
      return;
    }
    const name = renderExportFileName(this.settings.exportNameTemplate, file.basename, date);
    const folder = resolveExportDirectory(
      (_b = (_a = file.parent) == null ? void 0 : _a.path) != null ? _b : null,
      this.settings.exportDestination,
      this.settings.exportFolder
    );
    const targetFolder = folder ? this.app.vault.getFolderByPath((0, import_obsidian5.normalizePath)(folder)) : this.app.vault.getRoot();
    if (!targetFolder) {
      new import_obsidian5.Notice("The selected export folder no longer exists. Choose another folder in settings.");
      return;
    }
    const path = (0, import_obsidian5.normalizePath)((folder ? folder + "/" : "") + name + ".md");
    if (path === file.path) {
      new import_obsidian5.Notice("Export name matches the source file \u2014 change the template in settings.");
      return;
    }
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof import_obsidian5.TFile) await this.app.vault.modify(existing, content);
    else if (existing) {
      new import_obsidian5.Notice("Export target is a folder: " + path);
      return;
    } else await this.app.vault.create(path, content);
    new import_obsidian5.Notice("Review threads exported to " + path);
  }
  addCommentFromSelection(editor) {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const anchor = this.anchorFromSelection(editor);
    if (!anchor) return;
    void this.openSidebar().then((view) => view == null ? void 0 : view.startDraft(file, anchor));
  }
  addSuggestionFromSelection(editor) {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const anchor = this.anchorFromSelection(editor);
    if (!anchor) return;
    void this.openSidebar().then((view) => view == null ? void 0 : view.startSuggestionDraft(file, anchor));
  }
  anchorFromSelection(editor) {
    if (!editor.somethingSelected()) {
      new import_obsidian5.Notice("Select some text first.");
      return null;
    }
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    const doc = parseDocument(editor.getValue());
    if (to > doc.prose.length) {
      new import_obsidian5.Notice("Only prose can be commented or suggested (not the comment block).");
      return null;
    }
    return makeAnchor(doc.prose, from, to);
  }
  editorForFile(file) {
    var _a;
    const active = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    if (((_a = active == null ? void 0 : active.file) == null ? void 0 : _a.path) === file.path) return active.editor;
    const leaf = this.app.workspace.getLeavesOfType("markdown").find((l) => {
      var _a2;
      return l.view instanceof import_obsidian5.MarkdownView && ((_a2 = l.view.file) == null ? void 0 : _a2.path) === file.path;
    });
    return leaf ? leaf.view.editor : null;
  }
  /**
   * Applies the prose replacement and comment-block mutation as one editor
   * transaction, so a single Undo restores both the text and the suggestion.
   */
  isApplyingSuggestion() {
    return this.applyingSuggestion;
  }
  acceptEditSuggestion(file, id) {
    const editor = this.editorForFile(file);
    if (!editor) return { ok: false, reason: "no-editor" };
    const raw = editor.getValue();
    const plan = planSuggestionAcceptance(
      raw,
      id,
      this.settings.resolveBehavior,
      this.settings.schemaHint
    );
    if (!plan.ok) return plan;
    this.applyingSuggestion = true;
    try {
      commitSuggestionAcceptance(editor, plan);
    } finally {
      this.applyingSuggestion = false;
    }
    return plan;
  }
  /** Aktuelle Editor-Selektion als Anker (für Re-Anchoring von Orphans). */
  getProseSelection(file) {
    const editor = this.editorForFile(file);
    if (!editor) return null;
    if (!editor.somethingSelected()) return null;
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    const doc = parseDocument(editor.getValue());
    if (to > doc.prose.length || from === to) return null;
    return { anchor: makeAnchor(doc.prose, from, to) };
  }
  async openSidebar(focusId) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) return null;
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_COMMENTS, active: true });
    }
    await workspace.revealLeaf(leaf);
    const view = leaf.view instanceof CommentSidebar ? leaf.view : null;
    if (view && focusId) view.focusComment(focusId);
    return view;
  }
  refreshAuthorColors() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)) {
      if (leaf.view instanceof CommentSidebar) leaf.view.refreshAuthorColors();
    }
  }
  /** Scrollt im Markdown-Editor zur aufgelösten Anker-Stelle. */
  revealAnchor(file, anchor) {
    const leaf = this.app.workspace.getLeavesOfType("markdown").find((l) => {
      var _a;
      return l.view instanceof import_obsidian5.MarkdownView && ((_a = l.view.file) == null ? void 0 : _a.path) === file.path;
    });
    if (!leaf) {
      new import_obsidian5.Notice("File is not open in any editor.");
      return;
    }
    const view = leaf.view;
    void this.app.workspace.revealLeaf(leaf);
    const editor = view.editor;
    const doc = parseDocument(editor.getValue());
    const r = resolveAnchor(doc.prose, anchor);
    if (r.kind !== "resolved") {
      new import_obsidian5.Notice("Thread is orphaned \u2014 text passage not found.");
      return;
    }
    const fromPos = editor.offsetToPos(r.start);
    const toPos = editor.offsetToPos(r.end);
    editor.setSelection(fromPos, toPos);
    editor.scrollIntoView({ from: fromPos, to: toPos }, true);
  }
};
