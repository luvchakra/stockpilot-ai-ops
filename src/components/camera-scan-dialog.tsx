import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface CameraScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (value: string) => void;
}

// Decodes barcodes/QR codes from the device camera using ZXing's decoder
// (a standard scanning library, per the ticket, rather than hand-rolled
// decoding) -- the alternate input path for devices with no external
// keyboard-emulation scanner attached (see ScanInput for that path).
export function CameraScanDialog({ open, onOpenChange, onScan }: CameraScanDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !videoRef.current) return;
    setError(null);
    let cancelled = false;
    let scanned = false;
    const reader = new BrowserMultiFormatReader();

    reader
      .decodeFromConstraints(
        { video: { facingMode: "environment" } },
        videoRef.current,
        (result) => {
          if (cancelled || scanned || !result) return;
          scanned = true;
          onScan(result.getText());
        },
      )
      .then((controls) => {
        if (cancelled) controls.stop();
        else controlsRef.current = controls;
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not access the camera. Check camera permissions and try again.");
        }
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, onScan]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scan with camera</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <video ref={videoRef} className="w-full rounded-md bg-black" muted playsInline />
        )}
      </DialogContent>
    </Dialog>
  );
}
