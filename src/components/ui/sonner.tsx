"use client";

import { CheckCircleIcon, InfoIcon, SpinnerGapIcon, WarningIcon, XCircleIcon } from "@phosphor-icons/react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * EveryOps toasts: Geist, a tinted icon chip per type, and Sonner's own motion (interruptible
 * transitions, swipe to dismiss) on the project's ease-out curve. Styles live in globals.css
 * under "Toasts". Dark only, so the theme is pinned.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className="toaster"
      gap={8}
      icons={{
        success: <CheckCircleIcon weight="fill" />,
        info: <InfoIcon weight="fill" />,
        warning: <WarningIcon weight="fill" />,
        error: <XCircleIcon weight="fill" />,
        loading: <SpinnerGapIcon className="animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast: "eo-toast",
          title: "eo-toast-title",
          description: "eo-toast-description",
          actionButton: "eo-toast-action",
          cancelButton: "eo-toast-cancel",
          closeButton: "eo-toast-close",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
