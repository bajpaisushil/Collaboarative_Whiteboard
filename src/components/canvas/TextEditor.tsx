"use client";
/**
 * In-place text editor for sticky notes and text shapes: a transparent <textarea> laid
 * exactly over the shape in screen space (follows pan/zoom).
 *
 * Every keystroke is derived from the native `beforeinput` (using the selection *before*
 * the change) and applied as precise RGA ops via the session, so concurrent typing from
 * another tab weaves in character-exactly. IME composition is left to the browser and
 * committed on `compositionend`. Remote changes keep the local caret in place by mapping
 * it through stable character ids.
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CharId } from "@/lib/crdt/types";
import { useReplicaView, useSession } from "@/lib/session/react";
import { useUi, useUiStore } from "@/lib/ui/store";
import { shapeBounds } from "@/lib/ui/geometry";
import { displayShape, INK, paint } from "./shapeUtils";
import { decideInput, diffSpan, normalizeNewlines, type TextEdit } from "./textInput";
import { STICKY_PADDING, TEXT_FONT_STACK, TEXT_LINE_HEIGHT, TEXT_PADDING } from "./textLayout";
import { useSelfThread } from "./useThreads";

export const TextEditor = memo(function TextEditor() {
  const editing = useUi((s) => s.editingText);
  const scrubbing = useUi((s) => s.scrub !== null);
  if (!editing || scrubbing) return null;
  return <Editor key={editing} id={editing} />;
});

function fitHeight(el: HTMLTextAreaElement, auto: boolean) {
  if (!auto) return;
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
}

function Editor({ id }: { id: string }) {
  const session = useSession();
  const ui = useUiStore();
  const shape = useReplicaView((v) => v.shapeById.get(id) ?? null);
  const cam = useUi((s) => s.camera);
  const self = useSelfThread();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [initial] = useState(() => session.replica.getShape(id)?.text ?? "");
  const isText = shape?.type === "text";

  // The shape was deleted (locally or remotely) or isn't text-bearing: stop editing.
  const gone = !shape || (shape.type !== "sticky" && shape.type !== "text");
  useEffect(() => {
    if (gone && ui.getState().editingText === id) ui.getState().set({ editingText: null });
  }, [gone, id, ui]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = session.replica;
    const auto = r.getShape(id)?.type === "text";
    const st = {
      local: false,
      composing: false,
      sel: { start: null as CharId | null, end: null as CharId | null, backward: false },
      comp: null as { text: string; ids: (CharId | null)[] } | null,
    };
    const viewText = () => r.getShape(id)?.text ?? "";

    /** Remember the selection as character ids (stable under remote edits). */
    const capture = () => {
      if (st.composing || el.value !== viewText()) return;
      st.sel = {
        start: r.charIdAt(id, el.selectionStart),
        end: r.charIdAt(id, el.selectionEnd),
        backward: el.selectionDirection === "backward",
      };
    };

    const apply = (edit: TextEdit) => {
      st.local = true;
      try {
        session.transact(
          (tx) => {
            if (edit.deleteLen > 0) tx.deleteText(id, edit.start, edit.deleteLen);
            if (edit.insert) tx.insertText(id, edit.start, edit.insert);
          },
          { label: "Type" },
        );
      } finally {
        st.local = false;
      }
      const text = viewText();
      if (el.value !== text) el.value = text;
      const caret = Math.min(text.length, edit.start + edit.insert.length);
      el.setSelectionRange(caret, caret);
      capture();
      fitHeight(el, auto);
    };

    /** Native change we didn't intercept (drag-and-drop, exotic input types): diff it in. */
    const reconcile = () => {
      const next = normalizeNewlines(el.value);
      const text = viewText();
      if (next === text) return;
      const caret = el.selectionEnd;
      st.local = true;
      try {
        session.transact((tx) => tx.setText(id, next), { label: "Type" });
      } finally {
        st.local = false;
      }
      const now = viewText();
      if (el.value !== now) el.value = now;
      const c = Math.min(now.length, caret);
      el.setSelectionRange(c, c);
      capture();
      fitHeight(el, auto);
    };

    /** The view changed under us (remote op, undo): keep the caret on the same characters. */
    const syncFromView = () => {
      if (st.local || st.composing) return;
      const text = viewText();
      if (text === el.value) return;
      const a = r.indexAfterChar(id, st.sel.start);
      const b = r.indexAfterChar(id, st.sel.end);
      el.value = text;
      if (document.activeElement === el) el.setSelectionRange(Math.min(a, b), Math.max(a, b), st.sel.backward ? "backward" : "forward");
      capture();
      fitHeight(el, auto);
    };

    const onBeforeInput = (e: InputEvent) => {
      if (st.composing || e.isComposing || e.inputType === "insertCompositionText" || e.inputType === "insertFromComposition") return;
      const data = e.data ?? e.dataTransfer?.getData("text/plain") ?? null;
      const d = decideInput(e.inputType, el.value, el.selectionStart, el.selectionEnd, data);
      switch (d.kind) {
        case "native":
          return;
        case "noop":
          e.preventDefault();
          return;
        case "undo":
          e.preventDefault();
          session.undo();
          return;
        case "redo":
          e.preventDefault();
          session.redo();
          return;
        case "edit":
          e.preventDefault();
          apply(d.edit);
          return;
      }
    };

    const onInput = () => {
      if (!st.composing) reconcile();
    };

    const onCompositionStart = () => {
      const text = viewText();
      // Snapshot char ids so the composed span can be re-anchored if remote ops land meanwhile.
      st.comp = el.value === text && text.length <= 4000 ? { text, ids: Array.from({ length: text.length + 1 }, (_, i) => r.charIdAt(id, i)) } : null;
      st.composing = true;
    };

    const onCompositionEnd = () => {
      st.composing = false;
      const comp = st.comp;
      st.comp = null;
      if (!comp || comp.text === viewText()) {
        reconcile();
        return;
      }
      const span = diffSpan(comp.text, normalizeNewlines(el.value));
      if (!span) {
        el.value = comp.text;
        syncFromView();
        return;
      }
      const start = r.indexAfterChar(id, comp.ids[span.start] ?? null);
      const end = r.indexAfterChar(id, comp.ids[span.start + span.deleteLen] ?? null);
      apply({ start, deleteLen: Math.max(0, end - start), insert: span.insert });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape" || (mod && e.key === "Enter")) {
        e.preventDefault();
        e.stopPropagation();
        ui.getState().set({ editingText: null });
        (el.closest("[data-canvas-root]") as HTMLElement | null)?.focus({ preventScroll: true });
        return;
      }
      if (mod && !e.altKey && (e.key === "z" || e.key === "Z" || e.key === "y")) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "y" || e.shiftKey) session.redo();
        else session.undo();
      }
    };

    const onBlur = () => {
      // Window switches (another tab, the other /split pane) keep the editor open.
      if (!document.hasFocus()) return;
      if (ui.getState().editingText === id) ui.getState().set({ editingText: null });
    };

    const onSelectionChange = () => {
      if (document.activeElement === el) capture();
    };

    el.addEventListener("beforeinput", onBeforeInput);
    el.addEventListener("input", onInput);
    el.addEventListener("compositionstart", onCompositionStart);
    el.addEventListener("compositionend", onCompositionEnd);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("keyup", capture);
    el.addEventListener("mouseup", capture);
    el.addEventListener("select", capture);
    el.addEventListener("focus", capture);
    el.addEventListener("blur", onBlur);
    document.addEventListener("selectionchange", onSelectionChange);
    const unsubscribe = r.subscribe(syncFromView);

    el.focus({ preventScroll: true });
    const len = el.value.length;
    el.setSelectionRange(len, len);
    capture();
    fitHeight(el, auto);
    syncFromView();

    return () => {
      unsubscribe();
      el.removeEventListener("beforeinput", onBeforeInput);
      el.removeEventListener("input", onInput);
      el.removeEventListener("compositionstart", onCompositionStart);
      el.removeEventListener("compositionend", onCompositionEnd);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("keyup", capture);
      el.removeEventListener("mouseup", capture);
      el.removeEventListener("select", capture);
      el.removeEventListener("focus", capture);
      el.removeEventListener("blur", onBlur);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [session, ui, id]);

  const z = cam.zoom;
  const width = shape ? Math.abs(shape.w) : 0;
  const fontSize = shape?.fontSize ?? 20;
  useLayoutEffect(() => {
    if (ref.current) fitHeight(ref.current, isText);
  }, [isText, z, width, fontSize]);

  if (gone || !shape) return null;
  const sticky = shape.type === "sticky";
  const b = shapeBounds(sticky ? shape : displayShape(shape));
  const pad = (sticky ? STICKY_PADDING : TEXT_PADDING) * z;
  return (
    <textarea
      ref={ref}
      defaultValue={initial}
      rows={1}
      spellCheck
      aria-label={sticky ? "Sticky note text" : "Text"}
      aria-multiline
      data-canvas-editor=""
      className="absolute z-10 m-0 block resize-none border-0 bg-transparent p-0 outline-none"
      style={{
        left: (b.x - cam.x) * z,
        top: (b.y - cam.y) * z,
        width: Math.max(8, b.w * z),
        height: sticky ? Math.max(8, b.h * z) : undefined,
        minHeight: sticky ? undefined : Math.max(8, b.h * z),
        padding: pad,
        fontSize: fontSize * z,
        lineHeight: TEXT_LINE_HEIGHT,
        fontFamily: TEXT_FONT_STACK,
        color: sticky ? INK : paint(shape.stroke),
        caretColor: self.color,
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        wordBreak: "break-word",
        overflow: "hidden",
        boxSizing: "border-box",
        opacity: shape.opacity,
        borderRadius: sticky ? 6 * z : 4,
        boxShadow: sticky ? `inset 0 0 0 1.5px color-mix(in oklab, ${self.color} 55%, transparent)` : `0 0 0 1.5px color-mix(in oklab, ${self.color} 70%, transparent)`,
      }}
    />
  );
}
