"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Installing EveryOps as an app (a home-screen or desktop app with its own window): Chrome, Edge and Android offer an
 * install prompt, which is kept here until someone asks for it; iPhone and iPad Safari have none, so people add it
 * from the Share menu. The service worker (public/sw.js) shows an offline page when there's no connection.
 */
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let prompt: InstallPrompt | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export type InstallState = "installed" | "prompt" | "ios" | "unavailable";

function standalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone and iPad Safari (iPadOS reports itself as a Mac with a touch screen). */
function appleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function current(): InstallState {
  if (installed || standalone()) return "installed";
  if (prompt) return "prompt";
  if (appleMobile()) return "ios";
  return "unavailable";
}

let started = false;
/** Registers the service worker and starts listening for the install prompt. Once per page. */
function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    prompt = event as InstallPrompt;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    prompt = null;
    emit();
  });
  if ("serviceWorker" in navigator && window.isSecureContext)
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
}

/** Mounted once in the root layout. */
export function InstallSetup() {
  useEffect(start, []);
  return null;
}

const snapshot = () => current();

/** Whether EveryOps can be installed here, and how. */
export function useInstall(): { state: InstallState; install: () => Promise<boolean> } {
  const state = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    snapshot,
    () => "unavailable" as const,
  );
  return {
    state,
    install: async () => {
      const p = prompt;
      if (!p) return false;
      await p.prompt();
      const { outcome } = await p.userChoice;
      prompt = null;
      if (outcome === "accepted") installed = true;
      emit();
      return outcome === "accepted";
    },
  };
}
