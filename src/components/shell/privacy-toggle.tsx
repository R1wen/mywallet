"use client";

import { Eye, EyeOff } from "lucide-react";
import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Mode privé (ADR-044): hides every amount on this device (CSS on `html[data-private]`).
 * The choice is kept in localStorage; `public/private-mode.js` applies it before paint.
 */
const KEY = "mw.private";
const EVENT = "mw:private";

const subscribe = (notify: () => void) => {
  window.addEventListener(EVENT, notify);
  return () => window.removeEventListener(EVENT, notify);
};
const isPrivate = () => document.documentElement.hasAttribute("data-private");

export function setPrivateMode(on: boolean) {
  if (on) document.documentElement.dataset.private = "";
  else delete document.documentElement.dataset.private;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function togglePrivateMode() {
  setPrivateMode(!isPrivate());
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export function PrivacyToggle() {
  const on = useSyncExternalStore(subscribe, isPrivate, () => false);
  const toggle = useCallback(() => togglePrivateMode(), []);

  useEffect(() => {
    // "H" hides or shows the amounts (outside text fields).
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "h" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      togglePrivateMode();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Afficher les montants" : "Masquer les montants"}
      title={on ? "Afficher les montants (H)" : "Masquer les montants (H)"}
      className="flex size-8 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-text pointer-coarse:size-11"
    >
      {on ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  );
}
