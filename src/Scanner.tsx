import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";

export function Scanner({
  onScan,
  onClose,
}: {
  onScan: (value: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const scanCallback = useRef(onScan);
  scanCallback.current = onScan;
  const [error, setError] = useState("");
  useEffect(() => {
    if (!ref.current) return;
    let disposed = false;
    const scanner = new QrScanner(
      ref.current,
      (result) => {
        scanner.stop();
        scanCallback.current(result.data);
      },
      {
        preferredCamera: "environment",
        highlightScanRegion: true,
        returnDetailedScanResult: true,
      },
    );
    scanner.start().catch(() => {
      if (!disposed)
        setError(
          "Camera unavailable. Allow camera access over HTTPS, use your phone camera, or paste the shared link below.",
        );
    });
    return () => {
      disposed = true;
      scanner.destroy();
    };
  }, []);
  return (
    <section className="card">
      <h2>Scan their Handshake</h2>
      <video ref={ref} muted playsInline aria-label="QR scanner camera" />
      {error && <p role="alert">{error}</p>}
      <button className="secondary" onClick={onClose}>
        Close camera
      </button>
    </section>
  );
}
