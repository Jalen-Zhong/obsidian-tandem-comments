import { EditorState, Facet, StateField, type Extension, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { findBlockRange } from "./store";

/**
 * Live Preview: blendet den tandem-comments-Block als Block-Replace-Decoration
 * aus einem StateField aus — unabhängig vom Viewport.
 *
 * Hintergrund (Issue #36): Obsidian ersetzt Code-Blöcke nur in Viewport-Nähe
 * durch sein Embed-Widget (das die CSS-Klasse tc-lp-hidden dann auf 0 px
 * stellt). Weiter entfernt schätzt CodeMirror die rohen Fence-Zeilen als
 * umgebrochenen Text — bei großen Blöcken viele tausend Pixel. Taucht das
 * Widget auf, kollabiert die Dokumenthöhe schlagartig und die Scroll-Position
 * springt. Eine StateField-Decoration gilt für das ganze Dokument, die
 * Höhenkarte bleibt daher überall konsistent.
 */

/** Obsidians editorLivePreviewField, von außen hereingereicht (testbar ohne obsidian-Modul). */
const livePreviewSource = Facet.define<StateField<boolean>>();

function isLivePreview(state: EditorState): boolean {
  const field = state.facet(livePreviewSource)[0];
  return field ? state.field(field, false) === true : false;
}

function build(state: EditorState): DecorationSet {
  if (!isLivePreview(state)) return Decoration.none;
  const range = findBlockRange(state.doc.toString());
  if (!range) return Decoration.none;
  return Decoration.set([Decoration.replace({ block: true }).range(range.from, range.to)]);
}

function rangeOf(set: DecorationSet): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to) => { found = { from, to }; return false; });
  return found;
}

export const hiddenBlockField = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    if (isLivePreview(tr.startState) !== isLivePreview(tr.state)) return build(tr.state);
    if (!tr.docChanged) return value;
    // Edits vor dem Block (inkl. des trennenden Newlines) können ihn nicht
    // verändern — nur verschieben. Dann reicht Mapping statt doc.toString().
    const range = rangeOf(value);
    if (range && !tr.changes.touchesRange(range.from - 1, tr.startState.doc.length)) return value.map(tr.changes);
    return build(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Nutzer-Edits dürfen den unsichtbaren Block samt seiner Grenz-Newlines nicht
 * anfassen: atomicRanges würde ein Backspace am Blockende sonst auf den ganzen
 * Block ausdehnen, Löschen oder Überschreiben des Newlines vor der Fence (bzw.
 * dahinter, wenn Fußnoten folgen) macht den Block unlesbar, Tippen im Block
 * korrumpiert das JSON — Obsidians eigene Pfeiltasten-Keymap setzt den Cursor
 * trotz atomicRanges dorthin. Erlaubt bleiben Edits, die den ganzen Block
 * umfassen (bewusstes Löschen/Ersetzen per Selektion), sowie Plugin-Rewrites
 * (ohne userEvent) und Undo/Redo.
 */
function guardHiddenBlockEdits(tr: Transaction): Transaction | readonly [] {
  if (!tr.docChanged || !(tr.isUserEvent("input") || tr.isUserEvent("delete"))) return tr;
  const range = rangeOf(tr.startState.field(hiddenBlockField));
  if (!range) return tr;
  // Caret-Löschungen (ohne Selektion) bekommen durch atomicRanges den ganzen
  // Block als Bereich untergeschoben — das ist nie Absicht, daher keine Ausnahme.
  const caretDelete = tr.isUserEvent("delete.backward") || tr.isUserEvent("delete.forward");
  // Schutzzone: Newline vor der Fence bis einschließlich Newline hinter dem Block.
  const zoneFrom = range.from - 1;
  const zoneTo = range.to + 1;
  let blocked = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (fromA === toA) {
      // Einfügen: ab Fence-Anfang bis direkt hinter der schließenden Fence.
      if (fromA >= range.from && fromA <= range.to) blocked = true;
    } else if (fromA < zoneTo && toA > zoneFrom) {
      const coversBlock = fromA <= range.from && toA >= range.to;
      if (caretDelete || !coversBlock) blocked = true;
    }
  });
  return blocked ? [] : tr;
}

export function buildHiddenBlockExtension(livePreviewField: StateField<boolean>): Extension {
  return [
    livePreviewSource.of(livePreviewField),
    hiddenBlockField,
    // Cursor überspringt den unsichtbaren Bereich statt unsichtbar darin zu landen.
    EditorView.atomicRanges.of((view) => view.state.field(hiddenBlockField)),
    EditorState.transactionFilter.of(guardHiddenBlockEdits),
  ];
}
