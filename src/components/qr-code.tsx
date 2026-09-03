import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QrCodeImageProps {
  value: string;
  size?: number;
  className?: string;
}

// Renders a data string (e.g. the IRP's signed QR payload) as an actual
// scannable QR image -- the provider returns the QR contents as a string,
// not an image, so this is the client-side encode step.
export function QrCodeImage({ value, size = 96, className }: QrCodeImageProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        className={className}
        style={{ width: size, height: size }}
        aria-label="Generating QR code"
      />
    );
  }

  return (
    <img src={dataUrl} alt="e-Invoice QR code" width={size} height={size} className={className} />
  );
}
