import { useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import './serial-number-input.css'

type DetectedBarcode = { rawValue: string }
type BarcodeDetectorLike = { detect: (video: HTMLVideoElement) => Promise<DetectedBarcode[]> }
type BarcodeDetectorConstructor = new (options?: { formats: string[] }) => BarcodeDetectorLike

export function SerialNumberInput({
  value,
  onChange,
  maxLength = 120,
}: {
  value: string
  onChange: (value: string) => void
  maxLength?: number
}) {
  const reduceMotion = useReducedMotion()
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerError, setScannerError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!scannerOpen) return
    let active = true
    let scanning = false
    let stream: MediaStream | null = null
    let frame = 0
    const Detector = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector

    async function startCamera() {
      if (!Detector) {
        setScannerError('Este navegador no permite leer códigos QR. Prueba con Chrome o Edge actualizado.')
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setScannerError('No se puede acceder a la cámara. Abre Sky Logic mediante HTTPS y revisa los permisos.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (!active) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        const detector = new Detector({ formats: ['qr_code'] })
        const scan = async () => {
          if (!active || !videoRef.current || scanning) return
          scanning = true
          try {
            const [barcode] = await detector.detect(videoRef.current)
            if (barcode) {
              const serial = barcode.rawValue.trim()
              if (/^[A-Za-z0-9-]+$/.test(serial)) {
                onChangeRef.current(serial.slice(0, maxLength))
                setScannerOpen(false)
              } else {
                setScannerError('El QR no contiene un número de serie válido (solo letras, números y guiones).')
              }
            }
          } catch {
            setScannerError('No fue posible leer el QR. Ajusta la cámara e inténtalo de nuevo.')
          } finally {
            scanning = false
            if (active) frame = window.requestAnimationFrame(() => void scan())
          }
        }
        frame = window.requestAnimationFrame(() => void scan())
      } catch (error) {
        if (active) {
          setScannerError(error instanceof Error && error.name === 'NotAllowedError'
            ? 'Se denegó el acceso a la cámara. Habilítalo en los permisos del navegador.'
            : 'No fue posible iniciar la cámara. Verifica que no esté siendo usada por otra aplicación.')
        }
      }
    }

    void startCamera()
    return () => {
      active = false
      window.cancelAnimationFrame(frame)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [maxLength, scannerOpen])

  return (
    <>
      <div className="serial-input-wrap">
        <input maxLength={maxLength} value={value} onChange={(event) => onChange(event.target.value)} />
        <button className="serial-scan-button" type="button" aria-label="Leer número de serie desde un código QR" onClick={() => { setScannerError(''); setScannerOpen(true) }}>
          <Camera size={16} /><span>Leer QR</span>
        </button>
      </div>
      <AnimatePresence>
        {scannerOpen && (
          <motion.div className="serial-scanner-backdrop" role="presentation" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduceMotion ? undefined : { opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setScannerOpen(false) }}>
            <motion.section className="serial-scanner" role="dialog" aria-modal="true" aria-labelledby="serial-scanner-title" initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.98 }}>
              <div className="serial-scanner-heading"><div><span className="eyebrow">LECTURA DE SERIAL</span><h2 id="serial-scanner-title">Escanea el código QR</h2><p>Centra el QR dentro del visor; el número de serie se copiará al formulario.</p></div><button className="icon-button" type="button" aria-label="Cerrar lector QR" onClick={() => setScannerOpen(false)}><X size={18} /></button></div>
              <div className="serial-camera-frame"><video ref={videoRef} autoPlay muted playsInline aria-label="Vista de la cámara para leer el código QR" /><span className="serial-camera-target" /></div>
              {scannerError && <p className="serial-scanner-error" role="alert">{scannerError}</p>}
              <div className="serial-scanner-actions"><button className="secondary-button" type="button" onClick={() => setScannerOpen(false)}>Cancelar</button></div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
