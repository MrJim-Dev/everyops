"use client";

import { BarcodeIcon, CameraIcon, ImageIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { barcodeDetector } from "@/lib/scan/detector";

type Camera = "starting" | "on" | "off";

/**
 * Scans a barcode or QR code: with the camera (the back one on phones), a photo of it, or a handheld scanner, which
 * types the code and presses Enter into the box below. Calls onScan with the code and closes.
 */
export function ScanDialog({
  open,
  onOpenChange,
  title,
  description,
  onScan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  onScan: (code: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<Camera>("starting");
  const [problem, setProblem] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const done = (code: string) => {
    const value = code.trim();
    if (!value) return;
    onScan(value);
    onOpenChange(false);
  };
  // The camera loop reads the latest done, so it isn't restarted when the parent re-renders.
  const doneRef = useRef(done);
  doneRef.current = done;

  useEffect(() => {
    if (!open) return;
    setTyped("");
    setProblem(null);
    setCamera("starting");
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera("off");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        if (!stopped) setCamera("off");
        return;
      }
      if (stopped || !video.current) return;
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});
      setCamera("on");
      const detector = await barcodeDetector().catch(() => null);
      if (!detector) {
        setProblem("This browser can't read codes from the camera. Type the code or use a handheld scanner.");
        return;
      }
      const look = async () => {
        if (stopped || !video.current) return;
        if (video.current.readyState >= 2) {
          const [found] = await detector.detect(video.current).catch(() => []);
          if (found?.rawValue && !stopped) {
            stopped = true;
            doneRef.current(found.rawValue);
            return;
          }
        }
        timer = setTimeout(look, 250);
      };
      void look();
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      for (const t of stream?.getTracks() ?? []) t.stop();
    };
  }, [open]);

  const fromPhoto = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    try {
      const detector = await barcodeDetector();
      const [found] = await detector.detect(await createImageBitmap(file));
      if (found?.rawValue) done(found.rawValue);
      else
        setProblem(
          "No barcode or QR code found in that photo. Try again closer, with the code flat and in focus.",
        );
    } catch {
      setProblem("That photo couldn't be read. Try another, or type the code.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ?? "Point the camera at a barcode or QR code, or scan it with a handheld scanner."}
          </DialogDescription>
        </DialogHeader>
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted">
          <video
            ref={video}
            muted
            playsInline
            aria-label="Camera"
            className={camera === "on" ? "size-full object-cover" : "hidden"}
          />
          {camera === "on" ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-md border-2 border-primary/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]"
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-[13px] text-muted-foreground">
              <CameraIcon className="size-6" />
              {camera === "starting"
                ? "Starting the camera…"
                : "No camera here, or it isn't allowed. Take a photo of the code, type it, or use a handheld scanner."}
            </div>
          )}
        </div>
        {problem ? <p className="text-[12.5px] text-destructive">{problem}</p> : null}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            done(typed);
          }}
        >
          <div className="relative flex-1">
            <BarcodeIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Code"
              // Ready for a handheld scanner; on phones the keyboard would cover the camera.
              autoFocus={typeof matchMedia === "function" && !matchMedia("(pointer: coarse)").matches}
              className="pl-8"
              placeholder="Type or scan a code"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!typed.trim()}>
            Use code
          </Button>
        </form>
        <label className="flex cursor-pointer items-center gap-2 self-start text-[12.5px] text-muted-foreground hover:text-foreground">
          <ImageIcon className="size-4" />
          Scan a photo instead
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => void fromPhoto(e.target.files?.[0])}
          />
        </label>
      </DialogContent>
    </Dialog>
  );
}
