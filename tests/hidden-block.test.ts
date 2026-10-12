import { EditorState, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { buildHiddenBlockExtension, hiddenBlockField } from "../src/hidden-block";
import { findBlockRange, parseDocument, SCHEMA_HINT_LINES } from "../src/store";

const BLOCK = "```tandem-comments\n" + SCHEMA_HINT_LINES.join("\n") + '\n{\n  "a1": {}\n}\n```';

describe("findBlockRange", () => {
  it("returns null without a block", () => {
    expect(findBlockRange("# Title\n\nProse.\n")).toBeNull();
  });

  it("covers the fence lines of a trailing block", () => {
    const prose = "Prose line.\n";
    const raw = prose + BLOCK + "\n";
    const range = findBlockRange(raw);
    expect(range).toEqual({ from: prose.length, to: prose.length + BLOCK.length });
    expect(raw.slice(range!.from, range!.to)).toBe(BLOCK);
  });

  it("keeps trailing content after the closing fence outside the range", () => {
    const prose = "Prose[^1].\n";
    const raw = prose + BLOCK + "\n[^1]: footnote\n";
    const range = findBlockRange(raw)!;
    expect(raw.slice(range.to)).toBe("\n[^1]: footnote\n");
  });

  it("handles a block at the very start of the file", () => {
    const range = findBlockRange(BLOCK + "\n")!;
    expect(range).toEqual({ from: 0, to: BLOCK.length });
  });

  it("returns null for an unclosed fence", () => {
    expect(findBlockRange("Prose.\n```tandem-comments\n{}\n")).toBeNull();
  });
});

// Simulates Obsidian's editorLivePreviewField.
function livePreviewField(initial: boolean) {
  return StateField.define<boolean>({ create: () => initial, update: (v) => v });
}

function stateWith(raw: string, livePreview: boolean) {
  const field = livePreviewField(livePreview);
  return EditorState.create({ doc: raw, extensions: [field, buildHiddenBlockExtension(field)] });
}

function ranges(state: EditorState) {
  const out: { from: number; to: number }[] = [];
  state.field(hiddenBlockField).between(0, state.doc.length, (from, to) => { out.push({ from, to }); });
  return out;
}

describe("hidden block extension", () => {
  const prose = "Prose line.\n";
  const raw = prose + BLOCK + "\n";

  it("replaces the fence range in Live Preview", () => {
    expect(ranges(stateWith(raw, true))).toEqual([{ from: prose.length, to: prose.length + BLOCK.length }]);
  });

  it("decorates nothing in Source mode", () => {
    expect(ranges(stateWith(raw, false))).toEqual([]);
  });

  it("decorates nothing without a block", () => {
    expect(ranges(stateWith(prose, true))).toEqual([]);
  });

  it("follows document changes", () => {
    const state = stateWith(raw, true);
    const next = state.update({ changes: { from: 0, insert: "New first line.\n" } }).state;
    expect(ranges(next)).toEqual([{ from: prose.length + 16, to: prose.length + 16 + BLOCK.length }]);
    const removed = state.update({ changes: { from: prose.length, to: raw.length, insert: "" } }).state;
    expect(ranges(removed)).toEqual([]);
  });

  it("exposes the range as atomic so the cursor skips it", () => {
    const state = stateWith(raw, true);
    const atomic = state.facet(EditorView.atomicRanges);
    expect(atomic.length).toBe(1);
  });
});

describe("hidden block deletion guard", () => {
  const prose = "Prose line.\n";
  const raw = prose + BLOCK + "\n";
  const range = { from: prose.length, to: prose.length + BLOCK.length };

  function apply(state: EditorState, from: number, to: number, userEvent: string) {
    return state.update({ changes: { from, to }, userEvent }).state.doc.toString();
  }

  it("blocks a caret Backspace that would swallow the whole block (atomic skip)", () => {
    expect(apply(stateWith(raw, true), range.from, range.to, "delete.backward")).toBe(raw);
  });

  it("blocks a forward Delete of the newline that separates prose and fence", () => {
    expect(apply(stateWith(raw, true), range.from - 1, range.from, "delete.forward")).toBe(raw);
  });

  it("blocks a caret delete that starts inside the block", () => {
    expect(apply(stateWith(raw, true), range.from + 5, range.from + 6, "delete.backward")).toBe(raw);
  });

  it("allows caret deletes in the prose and after the block", () => {
    expect(apply(stateWith(raw, true), 0, 1, "delete.backward")).toBe(raw.slice(1));
    const trailing = raw + "Text";
    expect(apply(stateWith(trailing, true), range.to + 1, range.to + 2, "delete.backward")).toBe(raw + "ext");
  });

  it.each(["delete.backward", "delete.forward"])("protects the closing newline from %s with trailing prose", (userEvent) => {
    const trailing = raw + "Text";
    const next = apply(stateWith(trailing, true), range.to, range.to + 1, userEvent);
    expect(next).toBe(trailing);
    expect(parseDocument(next).comments).toEqual({ a1: {} });
  });

  it("preserves comments when Backspace on the final blank line is followed by typing", () => {
    const state = stateWith(raw, true).update({ selection: { anchor: raw.length } }).state;
    const afterDelete = state.update({
      changes: { from: range.to, to: range.to + 1 },
      selection: { anchor: range.to },
      userEvent: "delete.backward",
    }).state;
    expect(afterDelete.doc.toString()).toBe(raw);
    expect(afterDelete.selection.main.head).toBe(raw.length);
    const next = afterDelete.update({
      changes: { from: afterDelete.selection.main.head, insert: "X" },
      userEvent: "input.type",
    }).state;
    expect(next.doc.toString()).toBe(raw + "X");
    expect(parseDocument(next.doc.toString()).comments).toEqual({ a1: {} });
  });

  it("allows an explicit selection delete that spans the block", () => {
    expect(apply(stateWith(raw, true), 0, raw.length, "delete.selection")).toBe("");
  });

  it("allows plugin rewrites of the block", () => {
    expect(apply(stateWith(raw, true), range.from, range.to, "")).toBe(prose + "\n");
  });

  it("does not guard in Source mode", () => {
    expect(apply(stateWith(raw, false), range.from, range.to, "delete.backward")).toBe(prose + "\n");
  });

  it("maps the range instead of rescanning when the edit stays before the block", () => {
    const state = stateWith(raw, true);
    const spy = vi.spyOn(state.doc.constructor.prototype as { toString(): string }, "toString");
    const next = state.update({ changes: { from: 0, insert: "AB" } }).state;
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    expect(ranges(next)).toEqual([{ from: range.from + 2, to: range.to + 2 }]);
    expect(calls).toBe(0);
  });

  it("rescans when the edit touches the block or the newline before it", () => {
    const state = stateWith(raw, true);
    const broken = state.update({ changes: { from: range.from - 1, to: range.from, insert: " " } }).state;
    expect(ranges(broken)).toEqual([]);
  });
});

describe("hidden block typing guard", () => {
  const prose = "Prose line.\n";
  const raw = prose + BLOCK + "\n";
  const range = { from: prose.length, to: prose.length + BLOCK.length };

  function type(state: EditorState, at: number, userEvent = "input.type") {
    return state.update({ changes: { from: at, insert: "X" }, userEvent }).state.doc.toString();
  }

  it("blocks typing at the fence start and inside the hidden block", () => {
    expect(type(stateWith(raw, true), range.from)).toBe(raw);
    expect(type(stateWith(raw, true), range.from + 25)).toBe(raw);
    expect(type(stateWith(raw, true), range.from + 25, "input.paste")).toBe(raw);
  });

  it("allows typing at the prose end and after the block", () => {
    expect(type(stateWith(raw, true), range.from - 1)).toBe(prose.slice(0, -1) + "X\n" + BLOCK + "\n");
    expect(type(stateWith(raw, true), range.to + 1)).toBe(raw + "X");
  });

  it.each(["input.type", "input.paste"])("blocks %s at the closing fence end with or without a trailing newline", (userEvent) => {
    for (const doc of [raw, raw.slice(0, -1)]) {
      const next = type(stateWith(doc, true), range.to, userEvent);
      expect(next).toBe(doc);
      expect(parseDocument(next).comments).toEqual({ a1: {} });
    }
  });

  it("allows plugin rewrites inside the block", () => {
    expect(type(stateWith(raw, true), range.from + 25, "")).not.toBe(raw);
  });

  it("does not guard typing in Source mode", () => {
    expect(type(stateWith(raw, false), range.from + 25)).not.toBe(raw);
  });
});
