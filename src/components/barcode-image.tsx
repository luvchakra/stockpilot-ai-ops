import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";

export type BarcodeFormat = "qr" | "code128" | "ean13";

export const BARCODE_FORMATS: { value: BarcodeFormat; label: string }[] = [
  { value: "code128", label: "Code 128" },
  { value: "ean13", label: "EAN-13" },
  { value: "qr", label: "QR code" },
];

interface BarcodeImageProps {
  value: string;
  format: BarcodeFormat;
  size?: number;
  className?: string;
}

// Renders a value as a scannable barcode/QR image. QR encoding (via the
// `qrcode` package, already used for e-invoice QR -- see qr-code.tsx) is
// async and produces a data URL; linear barcodes (via jsbarcode) render
// synchronously straight into an inline <svg>.
export function BarcodeImage({ value, format, size = 96, className }: BarcodeImageProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (format === "qr" || !svgRef.current) return;
    JsBarcode(svgRef.current, value, {
      format: format === "ean13" ? "EAN13" : "CODE128",
      displayValue: true,
      fontSize: 14,
      height: size,
      margin: 4,
      valid: (isValid) => setInvalid(!isValid),
    });
  }, [value, format, size]);

  useEffect(() => {
    if (format !== "qr") return;
    let cancelled = false;
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, format, size]);

  if (format === "qr") {
    if (!qrDataUrl) {
      return (
        <div
          className={className}
          style={{ width: size, height: size }}
          aria-label="Generating QR code"
        />
      );
    }
    return (
      <img
        src={qrDataUrl}
        alt={`QR code for ${value}`}
        width={size}
        height={size}
        className={className}
      />
    );
  }

  return (
    <div className={className}>
      <svg ref={svgRef} role="img" aria-label={`Barcode for ${value}`} />
      {invalid ? (
        <p className="mt-1 text-xs text-destructive">
          "{value}" isn't a valid {format === "ean13" ? "EAN-13" : "Code 128"} value.
        </p>
      ) : null}
    </div>
  );
}
