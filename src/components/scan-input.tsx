import { lazy, Suspense, useState } from "react";
import { Camera, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Lazy-loaded: it pulls in @zxing/browser, which is large and only ever
// needed once someone actually taps the camera button, not on every page
// that renders a ScanInput (Products, Purchase Orders, Sales Orders,
// Inventory all do).
const CameraScanDialog = lazy(() =>
  import("@/components/camera-scan-dialog").then((m) => ({ default: m.CameraScanDialog })),
);

interface ScanInputProps {
  onScan: (value: string) => void;
  placeholder?: string;
  className?: string;
}

// The integration point for a keyboard-emulation external scanner: those
// devices "type" the scanned characters into whatever field has focus and
// then send Enter, so a plain input plus an Enter handler is the entire
// integration -- no scanner SDK needed. It doubles as a manual-entry
// field for typing a SKU/barcode by hand. The camera icon opens an
// alternate, actual-camera scan path for devices with no scanner attached.
export function ScanInput({ onScan, placeholder, className }: ScanInputProps) {
  const [value, setValue] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);

  const submit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    onScan(trimmed);
    setValue("");
  };

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit(value);
              }
            }}
            placeholder={placeholder ?? "Scan or type a barcode / SKU"}
            className="pl-8"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setCameraOpen(true)}
          title="Scan with camera"
        >
          <Camera className="size-4" />
          <span className="sr-only">Scan with camera</span>
        </Button>
      </div>
      {cameraOpen ? (
        <Suspense fallback={null}>
          <CameraScanDialog
            open={cameraOpen}
            onOpenChange={setCameraOpen}
            onScan={(v) => {
              setCameraOpen(false);
              submit(v);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
