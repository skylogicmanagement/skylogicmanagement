import { useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import QrScanner from 'qr-scanner'
import './serial-number-input.css'

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
    let scanner: QrScanner | null = null

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setScannerError('No se puede acceder a la cámara. Abre Sky Logic mediante HTTPS y revisa los permisos.')
        return
      }

      const video = videoRef.current
      if (!video) return

      scanner = new QrScanner(video, (result) => {
        const serial = result.data.trim()
        if (/^[A-Za-z0-9-]+$/.test(serial)) {
          onChangeRef.current(serial.slice(0, maxLength))
          setScannerOpen(false)
        } else {
          setScannerError('El QR no contiene un número de serie válido (solo letras, números y guiones).')
        }
      }, {
        preferredCamera: 'environment',
        maxScansPerSecond: 5,
        calculateScanRegion: (video) => {
          const width = video.videoWidth
          const height = video.videoHeight
          if (!width || !height) return {}
          const scale = 640 / Math.max(width, height)
          return {
            x: 0,
            y: 0,
            width,
            height,
            downScaledWidth: Math.round(width * scale),
            downScaledHeight: Math.round(height * scale),
          }
        },
        returnDetailedScanResult: true,
      })
      scanner.setInversionMode('both')

      try {
        await scanner.start()
      } catch (error) {
        if (!active) return
        scanner.destroy()
        scanner = null
        const errorName = error instanceof Error ? error.name : ''
        const message = errorName === 'NotAllowedError'
          ? 'Se denegó el acceso a la cámara. Habilítalo en los permisos del navegador.'
          : errorName === 'NotFoundError'
            ? 'No se encontró una cámara disponible en este dispositivo.'
            : errorName === 'NotReadableError'
              ? 'La cámara está ocupada por otra aplicación.'
              : `No fue posible iniciar la cámara${error instanceof Error && error.message ? `: ${error.message}` : '.'}`
        setScannerError(message)
      }
    }

    void startCamera()
    return () => {
      active = false
      scanner?.destroy()
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
              <p className="serial-scanner-hint">Centra el código completo, acércalo para que se vea nítido y asegúrate de tener buena iluminación.</p>
              {scannerError && <p className="serial-scanner-error" role="alert">{scannerError}</p>}
              <div className="serial-scanner-actions"><button className="secondary-button" type="button" onClick={() => setScannerOpen(false)}>Cancelar</button></div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
