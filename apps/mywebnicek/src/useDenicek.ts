import type { PlainNode } from "@jsr/mydenicek__core";
import { Denicek } from "@jsr/mydenicek__core";
import { useCallback, useRef, useState } from "react";

export function useDenicek(peer?: string) {
  const dkRef = useRef<Denicek>(null!);
  if (!dkRef.current) {
    dkRef.current = new Denicek(peer ?? crypto.randomUUID());
  }
  const dk = dkRef.current;
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion(v => v + 1), []);

  const add = useCallback((target: string, field: string, value: PlainNode) => {
    const id = dk.add(target, field, value); bump(); return id;
  }, [dk, bump]);

  const del = useCallback((target: string, field: string) => {
    const id = dk.delete(target, field); bump(); return id;
  }, [dk, bump]);

  const set = useCallback((target: string, value: string | number | boolean) => {
    dk.set(target, value); bump();
  }, [dk, bump]);

  const rename = useCallback((target: string, from: string, to: string) => {
    const id = dk.rename(target, from, to); bump(); return id;
  }, [dk, bump]);

  const pushBack = useCallback((target: string, value: PlainNode) => {
    const id = dk.pushBack(target, value); bump(); return id;
  }, [dk, bump]);

  const pushFront = useCallback((target: string, value: PlainNode) => {
    const id = dk.pushFront(target, value); bump(); return id;
  }, [dk, bump]);

  const popBack = useCallback((target: string) => {
    const id = dk.popBack(target); bump(); return id;
  }, [dk, bump]);

  const popFront = useCallback((target: string) => {
    const id = dk.popFront(target); bump(); return id;
  }, [dk, bump]);

  const updateTag = useCallback((target: string, tag: string) => {
    const id = dk.updateTag(target, tag); bump(); return id;
  }, [dk, bump]);

  const wrapRecord = useCallback((target: string, field: string, tag: string) => {
    const id = dk.wrapRecord(target, field, tag); bump(); return id;
  }, [dk, bump]);

  const wrapList = useCallback((target: string, tag: string) => {
    const id = dk.wrapList(target, tag); bump(); return id;
  }, [dk, bump]);

  const copy = useCallback((target: string, source: string) => {
    const id = dk.copy(target, source); bump(); return id;
  }, [dk, bump]);

  const undo = useCallback(() => {
    if (dk.canUndo) { dk.undo(); bump(); }
  }, [dk, bump]);

  const redo = useCallback(() => {
    if (dk.canRedo) { dk.redo(); bump(); }
  }, [dk, bump]);

  return {
    denicek: dk,
    doc: dk.materialize(),
    version,
    bump,
    add, delete: del, set, rename,
    pushBack, pushFront, popBack, popFront,
    updateTag, wrapRecord, wrapList, copy,
    undo, redo,
    canUndo: dk.canUndo,
    canRedo: dk.canRedo,
  };
}
