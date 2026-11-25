import { useEffect, useState } from 'react'
import { AlertTriangle, Download, FileText, Image, Paperclip, Upload, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { supabase } from '../../lib/supabase'
import './documents.css'

export type DocumentTargetField = 'asset_id' | 'maintenance_record_id' | 'inventory_item_id'

type DocumentRow = {
  id: string
  storage_path: string
  file_name: string
  content_type: string | null
  uploaded_at: string
}

const bucketName = 'sky-logic-private'
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const maxFileSize = 25 * 1024 * 1024

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function DocumentAttachments({
  orgId,
  entityId,
  entityName,
  targetField,
  canUpload,
  onClose,
}: {
  orgId: string
  entityId: string
  entityName: string
  targetField: DocumentTargetField
  canUpload: boolean
  onClose: () => void
}) {
  const reduceMotion = useReducedMotion()
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    async function loadDocuments() {
      if (!supabase) {
        setError('La conexión con Supabase no está configurada.')
        setLoading(false)
        return
      }
      const { data, error: loadError } = await supabase.from('documents')
        .select('id, storage_path, file_name, content_type, uploaded_at')
        .eq('org_id', orgId)
        .eq(targetField, entityId)
        .order('uploaded_at', { ascending: false })
      if (!active) return
      if (loadError) {
        setError(loadError.message)
      } else {
        setDocuments(data ?? [])
      }
      setLoading(false)
    }
    void loadDocuments()
    return () => { active = false }
  }, [entityId, orgId, targetField])

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !supabase) return
    setError('')
    setNotice('')
    if (!allowedTypes.has(file.type)) {
      setError('Formato no permitido. Usa imágenes JPG, PNG, WebP o documentos PDF.')
      return
    }
    if (file.size <= 0 || file.size > maxFileSize) {
      setError('El archivo debe tener un tamaño mayor que cero y no superar 25 MB.')
      return
    }
    setUploading(true)
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) {
      setError(authError?.message ?? 'No se encontró la sesión activa.')
      setUploading(false)
      return
    }
    const safeFileName = file.name.replace(/[^\w.-]+/g, '_').slice(-120) || 'archivo'
    const storagePath = `${orgId}/${authData.user.id}/${entityId}/${crypto.randomUUID()}-${safeFileName}`
    const { error: uploadError } = await supabase.storage.from(bucketName).upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    })
    if (uploadError) {
      setError(uploadError.message)
      setUploading(false)
      return
    }
    const documentRecord = {
      org_id: orgId,
      storage_path: storagePath,
      file_name: file.name,
      content_type: file.type,
      uploaded_by: authData.user.id,
      asset_id: targetField === 'asset_id' ? entityId : null,
      operation_id: null,
      maintenance_record_id: targetField === 'maintenance_record_id' ? entityId : null,
      inventory_item_id: targetField === 'inventory_item_id' ? entityId : null,
    }
    const { data: insertedDocument, error: insertError } = await supabase.from('documents')
      .insert([documentRecord])
      .select('id, storage_path, file_name, content_type, uploaded_at')
      .single()
    if (insertError) {
      const { error: cleanupError } = await supabase.storage.from(bucketName).remove([storagePath])
      setError(cleanupError
        ? `${insertError.message} Además, no se pudo retirar el archivo incompleto: ${cleanupError.message}`
        : insertError.message)
    } else {
      setDocuments((current) => [insertedDocument, ...current])
      setNotice('Archivo cargado y asociado al registro.')
    }
    setUploading(false)
  }

  async function openDocument(document: DocumentRow) {
    if (!supabase) return
    setError('')
    const newWindow = window.open('about:blank', '_blank')
    if (newWindow) newWindow.opener = null
    const { data, error: signedUrlError } = await supabase.storage.from(bucketName)
      .createSignedUrl(document.storage_path, 60, { download: document.file_name })
    if (signedUrlError) {
      newWindow?.close()
      setError(signedUrlError.message)
      return
    }
    if (!newWindow) {
      setError('El navegador bloqueó la nueva ventana. Permite ventanas emergentes para abrir el archivo.')
      return
    }
    newWindow.location.replace(data.signedUrl)
  }

  return (
    <AnimatePresence>
      <div className="documents-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !uploading) onClose() }}>
        <motion.section
          className="documents-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="documents-title"
          initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
        >
          <header className="documents-heading">
            <div><span className="eyebrow">ARCHIVOS PRIVADOS</span><h2 id="documents-title">Adjuntos</h2><p>{entityName}</p></div>
            <button className="icon-button" type="button" aria-label="Cerrar adjuntos" onClick={onClose} disabled={uploading}><X size={18} /></button>
          </header>
          <div className="documents-content">
            {error && <div className="inline-error" role="alert"><AlertTriangle size={16} />{error}</div>}
            {notice && <div className="inline-success" role="status">{notice}</div>}
            {canUpload && (
              <label className={`documents-upload${uploading ? ' is-uploading' : ''}`}>
                <Upload size={17} />
                <span>{uploading ? 'Cargando archivo…' : 'Adjuntar archivo'}</span>
                <small>JPG, PNG, WebP o PDF · máximo 25 MB</small>
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => void handleUpload(event)} disabled={uploading} />
              </label>
            )}
            {loading ? <div className="documents-empty">Cargando archivos…</div> : documents.length === 0 ? (
              <div className="documents-empty"><Paperclip size={21} /><strong>Sin adjuntos</strong><span>Los archivos de este registro aparecerán aquí.</span></div>
            ) : (
              <div className="documents-list">
                {documents.map((document) => (
                  <article className="documents-row" key={document.id}>
                    <span className="documents-file-icon">{document.content_type?.startsWith('image/') ? <Image size={17} /> : <FileText size={17} />}</span>
                    <div><strong>{document.file_name}</strong><small>{formatDate(document.uploaded_at)} · {document.content_type ?? 'Archivo'}</small></div>
                    <button className="icon-button" type="button" aria-label={`Abrir ${document.file_name}`} onClick={() => void openDocument(document)}><Download size={16} /></button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </motion.section>
      </div>
    </AnimatePresence>
  )
}
