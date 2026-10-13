"use client";

/**
 * Remembers whether the last interaction came from the keyboard. Keyboard-driven
 * changes (arrow keys, shortcuts) should not animate; they happen too often.
 */
let lastWasKeyboard = false;
let attached = false;

function attach() {
  if (attached || typeof window === "undefined") return;
  attached = true;
  window.addEventListener(
    "keydown",
    () => {
      lastWasKeyboard = true;
    },
    true,
  );
  window.addEventListener(
    "pointerdown",
    () => {
      lastWasKeyboard = false;
    },
    true,
  );
}

export function lastInputWasKeyboard(): boolean {
  attach();
  return lastWasKeyboard;
}

attach();
