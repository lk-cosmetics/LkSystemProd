/**
 * POSCameraScanner – Cross-platform camera barcode scanner.
 *
 * Uses html5-qrcode library which works on:
 *   - Desktop: Chrome, Firefox, Edge, Safari
 *   - Mobile:  Chrome Android, Safari iOS (14.3+), Firefox Android
 *
 * The native BarcodeDetector API only works on Chrome Android/ChromeOS,
 * so we use html5-qrcode for universal support.
 *
 * Flow:
 *   1. Dialog opens → starts camera scanning
 *   2. On barcode detected → calls onBarcodeDetected(rawValue)
 *   3. Parent handles product lookup + cart add
 *   4. Manual fallback input always available
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  Keyboard,
  Loader2,
  AlertTriangle,
  Copy,
  Check,
} from 'lucide-react';
import type { Html5Qrcode as Html5QrcodeType } from 'html5-qrcode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import {
  POSDialogBody,
  POSDialogContent,
  POSDialogFooter,
  POSDialogHeader,
  POSPrimaryButton,
  POSSecondaryButton,
} from './POSDialog';

/* ── Constants ────────────────────────────────────────────────────────── */

const SCANNER_ELEMENT_ID = 'pos-barcode-scanner';
const SCAN_COOLDOWN_MS = 2000;
const HTML_TAG_RE = /<[^>]+>/;

const sanitizeFeedbackMessage = (message: string): string => {
  const trimmed = message.trim();
  if (!trimmed) return '';

  const looksLikeHtml =
    trimmed.includes('<!DOCTYPE html') || HTML_TAG_RE.test(trimmed);
  const normalized = looksLikeHtml
    ? trimmed
        .replace(/<[^>]+>/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim()
    : trimmed;

  if (!normalized) return '';

  if (looksLikeHtml || normalized.length > 220) {
    return 'Unexpected server error. Please retry. You can use Copy error to share details.';
  }

  return normalized;
};

/* ── Component ────────────────────────────────────────────────────────── */

interface POSCameraScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBarcodeDetected: (barcode: string) => void;
  feedbackMessage?: string | null;
  feedbackType?: 'success' | 'error' | null;
}

export function POSCameraScanner({
  open,
  onOpenChange,
  onBarcodeDetected,
  feedbackMessage,
  feedbackType,
}: POSCameraScannerProps) {
  const scannerRef = useRef<Html5QrcodeType | null>(null);
  const lastDetectedRef = useRef<string>('');
  const cooldownRef = useRef<number>(0);

  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
    'idle'
  );
  const safeFeedbackMessage = feedbackMessage
    ? sanitizeFeedbackMessage(feedbackMessage)
    : null;

  // Stable ref for the callback to avoid restarting the scanner
  const onBarcodeRef = useRef(onBarcodeDetected);
  onBarcodeRef.current = onBarcodeDetected;

  // ── Stop scanner ──
  const stopScanner = useCallback(async () => {
    try {
      if (scannerRef.current?.isScanning) {
        await scannerRef.current.stop();
      }
      scannerRef.current?.clear();
    } catch {
      // Ignore cleanup errors
    }
    scannerRef.current = null;
    setScanning(false);
  }, []);

  // ── Start scanner ──
  const startScanner = useCallback(async () => {
    setCameraError(null);
    setScanning(false);

    // Ensure the DOM element exists before creating the scanner
    await new Promise(resolve => setTimeout(resolve, 100));

    const container = document.getElementById(SCANNER_ELEMENT_ID);
    if (!container) {
      setCameraError('Le scanner n’est pas prêt. Veuillez réessayer.');
      return;
    }

    // Clean up any previous instance
    await stopScanner();

    try {
      // Lazy-load html5-qrcode — only downloaded when scanner dialog opens
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, { verbose: false });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 280, height: 150 },
          aspectRatio: 16 / 9,
          disableFlip: false,
        },
        decodedText => {
          const now = Date.now();
          // Cooldown: prevent rapid duplicate detections
          if (
            decodedText === lastDetectedRef.current &&
            now < cooldownRef.current
          ) {
            return;
          }
          lastDetectedRef.current = decodedText;
          cooldownRef.current = now + SCAN_COOLDOWN_MS;
          onBarcodeRef.current(decodedText);
        },
        () => {
          // QR code not found in this frame — expected, ignore
        }
      );

      setScanning(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Check if running in an insecure context (HTTP instead of HTTPS)
      const isInsecure =
        window.isSecureContext === false ||
        window.location.protocol === 'http:';

      if (
        isInsecure &&
        (msg.includes('not supported') ||
          msg.includes('getUserMedia') ||
          msg.includes('NotAllowedError') ||
          msg.includes('undefined'))
      ) {
        setCameraError('La caméra nécessite une connexion HTTPS sécurisée.');
      } else if (
        msg.includes('NotAllowedError') ||
        msg.includes('Permission')
      ) {
        setCameraError(
          'Accès à la caméra refusé. Autorisez la caméra puis réessayez.'
        );
      } else if (msg.includes('NotFoundError') || msg.includes('no camera')) {
        setCameraError('Aucune caméra détectée sur cet appareil.');
      } else if (
        msg.includes('NotReadableError') ||
        msg.includes('Could not start')
      ) {
        setCameraError(
          'La caméra est déjà utilisée par une autre application.'
        );
      } else if (
        msg.includes('not supported') ||
        msg.includes('getUserMedia')
      ) {
        setCameraError(
          'La caméra n’est pas prise en charge par ce navigateur. Vérifiez que la page utilise HTTPS.'
        );
      } else {
        setCameraError(`Erreur caméra : ${msg}`);
      }
    }
  }, [stopScanner]);

  // ── Start/stop based on dialog open state + mode ──
  useEffect(() => {
    if (open && mode === 'camera') {
      void startScanner();
    }

    return () => {
      void stopScanner();
    };
  }, [open, mode, startScanner, stopScanner]);

  // ── Reset state when dialog closes ──
  useEffect(() => {
    if (!open) {
      setManualBarcode('');
      setCameraError(null);
      setMode('camera');
      lastDetectedRef.current = '';
      cooldownRef.current = 0;
    }
  }, [open]);

  // ── Manual submit ──
  const handleManualSubmit = () => {
    const trimmed = manualBarcode.trim();
    if (trimmed.length >= 3) {
      onBarcodeDetected(trimmed);
      setManualBarcode('');
    }
  };

  // ── Switch mode ──
  const handleSwitchMode = async () => {
    if (mode === 'camera') {
      await stopScanner();
      setMode('manual');
    } else {
      setCameraError(null);
      setMode('camera');
    }
  };

  const handleCopyError = useCallback(async () => {
    if (!cameraError) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(cameraError);
        setCopyState('copied');
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = cameraError;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        const copied = document.execCommand('copy');
        document.body.removeChild(textArea);

        setCopyState(copied ? 'copied' : 'failed');
      }
    } catch {
      setCopyState('failed');
    }
  }, [cameraError]);

  useEffect(() => {
    if (copyState === 'idle') return;

    const timer = window.setTimeout(() => setCopyState('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <POSDialogContent size="default">
        <POSDialogHeader
          title="Scanner un code-barres"
          description={
            mode === 'camera'
              ? 'Placez le code-barres du produit devant la caméra.'
              : 'Saisissez le code-barres manuellement.'
          }
          aside={<Camera className="size-6" />}
        />

        <POSDialogBody className="space-y-5">
          {/* ── Camera view ── */}
          {mode === 'camera' && (
            <div className="relative">
              {/* Scanner renders into this div */}
              <div
                id={SCANNER_ELEMENT_ID}
                className="rounded-lg overflow-hidden bg-black min-h-[220px]"
              />

              {/* Loading overlay */}
              {!scanning && !cameraError && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg">
                  <div className="flex flex-col items-center gap-2 text-white">
                    <Loader2 className="size-8 animate-spin" />
                    <p className="text-sm">Démarrage de la caméra…</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Camera error ── */}
          {cameraError && mode === 'camera' && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-destructive">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Caméra indisponible</p>
                  <p className="mt-1 text-sm leading-5 break-words whitespace-pre-wrap">
                    {cameraError}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-h-5 text-xs">
                  {copyState === 'copied' && (
                    <span className="text-emerald-700">Erreur copiée</span>
                  )}
                  {copyState === 'failed' && (
                    <span className="text-destructive">Copie impossible.</span>
                  )}
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <Button
                    variant="outline"
                    className="h-11 flex-1 sm:flex-none"
                    onClick={handleCopyError}
                  >
                    {copyState === 'copied' ? (
                      <>
                        <Check className="mr-1 size-3.5" />
                        Copié
                      </>
                    ) : (
                      <>
                        <Copy className="mr-1 size-3.5" />
                        Copier l’erreur
                      </>
                    )}
                  </Button>
                  <Button
                    variant="default"
                    className="h-11 flex-1 sm:flex-none"
                    onClick={() => startScanner()}
                  >
                    Réessayer
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ── Manual entry ── */}
          {mode === 'manual' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Saisir le code-barres…"
                  value={manualBarcode}
                  onChange={e => setManualBarcode(e.target.value)}
                  className="flex-1"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleManualSubmit();
                  }}
                />
                <Button
                  onClick={handleManualSubmit}
                  disabled={manualBarcode.trim().length < 3}
                >
                  Rechercher
                </Button>
              </div>
            </div>
          )}

          {/* ── Feedback message ── */}
          {safeFeedbackMessage && (
            <div
              className={`rounded-md p-3 text-center text-sm font-medium ${
                feedbackType === 'success'
                  ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400'
                  : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400'
              }`}
            >
              <p className="break-words whitespace-pre-wrap leading-5">
                {safeFeedbackMessage}
              </p>
            </div>
          )}
        </POSDialogBody>

        <POSDialogFooter>
          <POSSecondaryButton onClick={handleSwitchMode}>
            {mode === 'camera' ? (
              <>
                <Keyboard className="size-4" />
                Saisie manuelle
              </>
            ) : (
              <>
                <Camera className="size-4" />
                Utiliser la caméra
              </>
            )}
          </POSSecondaryButton>
          <POSPrimaryButton onClick={() => onOpenChange(false)}>
            Fermer
          </POSPrimaryButton>
        </POSDialogFooter>
      </POSDialogContent>
    </Dialog>
  );
}
