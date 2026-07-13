"use client";

/**
 * QR: printing tags and reading them back.
 *
 * A wrapper, and nothing more. What a scanned payload *means* is decided by the verification module —
 * this file has no opinion about whether a tag is genuine, and no way to find out.
 */

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { BrowserQRCodeReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";

/** A tag, printed. The whole payload is in the code — a tag is a pointer into public state, not a link. */
export function TagQR({ value, size = 148 }: { value: string; size?: number }) {
  return (
    <div className="rounded-lg bg-white p-2">
      <QRCodeSVG value={value} size={size} level="M" marginSize={0} />
    </div>
  );
}

/**
 * The camera.
 *
 * A phone is the buyer's whole apparatus: the tag goes in, a verdict comes out, and nothing in between
 * asks the shop for permission. If no camera can be opened, the page says so and falls back to the tags
 * on screen — a demo in a room with no camera should still be able to make its point.
 */
export function Scanner({ onScan }: { onScan: (payload: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    let controls: IScannerControls | undefined;
    let stopped = false;

    new BrowserQRCodeReader()
      .decodeFromVideoDevice(undefined, video.current ?? undefined, (result) => {
        if (result) onScan(result.getText());
      })
      .then((scanner) => {
        controls = scanner;
        if (stopped) scanner.stop();
      })
      .catch((error: unknown) => {
        setProblem(
          error instanceof Error
            ? `No camera: ${error.message}. Click a tag on screen instead — the check is identical.`
            : "No camera. Click a tag on screen instead — the check is identical.",
        );
      });

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [onScan]);

  return (
    <div className="space-y-2">
      <video ref={video} className="w-full rounded-lg border border-neutral-700 bg-black" muted playsInline />
      {problem && <p className="text-sm text-amber-400">{problem}</p>}
    </div>
  );
}
