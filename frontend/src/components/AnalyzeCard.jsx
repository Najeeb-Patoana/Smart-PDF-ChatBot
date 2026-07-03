import { useState, useRef, useCallback } from 'react'
import {
  FiUploadCloud, FiFile, FiX, FiSend,
  FiAlertCircle, FiCheckCircle, FiZap
} from 'react-icons/fi'
import Button from './Button.jsx'
import Loader from './Loader.jsx'
import ResponseCard from './ResponseCard.jsx'
import { askQuestion } from '../services/api.js'
import styles from './AnalyzeCard.module.css'

/**
 * AnalyzeCard — single unified card with:
 *  • Drag-and-drop PDF selector
 *  • Question textarea
 *  • ONE "Analyze" button that uploads + asks in a single request
 */
export default function AnalyzeCard() {
  const [file, setFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState(null)
  const [timestamp, setTimestamp] = useState(null)
  const [notification, setNotification] = useState(null) // { type, message }
  const inputRef = useRef(null)

  // ── File helpers ────────────────────────────────────────────────────────────
  const selectFile = useCallback((selected) => {
    if (!selected) return
    if (selected.type !== 'application/pdf') {
      setNotification({ type: 'error', message: 'Only PDF files are allowed.' })
      return
    }
    setFile(selected)
    setNotification(null)
    setResponse(null)
  }, [])

  const removeFile = () => {
    setFile(null)
    setResponse(null)
    setNotification(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    selectFile(e.dataTransfer.files[0])
  }

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!file) {
      setNotification({ type: 'error', message: 'Please select a PDF file first.' })
      return
    }
    if (!question.trim()) {
      setNotification({ type: 'error', message: 'Question cannot be empty.' })
      return
    }

    setLoading(true)
    setNotification(null)
    setResponse(null)

    try {
      const answer = await askQuestion(file, question.trim())
      setResponse(answer)
      setTimestamp(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    } catch (err) {
      let msg = 'Something went wrong. Please try again.'

      if (err.code === 'ERR_NETWORK' || err.message?.includes('Network Error')) {
        msg = 'Cannot reach the server. Make sure the backend is running on port 3000.'
      } else if (err?.response?.status === 429) {
        msg = 'Gemini API rate limit reached. Please wait 30 seconds and try again.'
      } else if (err?.response?.status === 404) {
        msg = 'No relevant content found in the document for that question.'
      } else if (err?.response?.data?.message) {
        // Use the server's clean message — never dump raw JSON
        msg = err.response.data.message
      }

      setNotification({ type: 'error', message: msg })
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.ctrlKey && e.key === 'Enter') handleAnalyze()
  }

  const canSubmit = !!file && question.trim().length > 0 && !loading

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className={`${styles.card} animate-fade-in`}>

      {/* ── PDF Drop Zone ── */}
      <div className={styles.section}>
        <label className={styles.sectionLabel}>
          <FiUploadCloud size={14} /> PDF Document
        </label>

        {!file ? (
          <div
            className={[styles.dropzone, isDragging ? styles.dragging : ''].filter(Boolean).join(' ')}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
            aria-label="Drop PDF here or click to browse"
          >
            <input
              ref={inputRef}
              id="pdf-file-input"
              type="file"
              accept=".pdf,application/pdf"
              className={styles.hiddenInput}
              onChange={(e) => selectFile(e.target.files[0])}
            />
            <div className={styles.dropIcon}>
              <FiUploadCloud size={26} />
            </div>
            <p className={styles.dropTitle}>Drag &amp; drop your PDF</p>
            <p className={styles.dropHint}>
              or <span className={styles.browseLink}>click to browse</span>
            </p>
          </div>
        ) : (
          <div className={styles.filePreview}>
            <div className={styles.fileIconWrap}>
              <FiFile size={20} />
            </div>
            <div className={styles.fileInfo}>
              <p className={styles.fileName}>{file.name}</p>
              <p className={styles.fileSize}>{formatSize(file.size)}</p>
            </div>
            <button
              className={styles.removeBtn}
              onClick={removeFile}
              aria-label="Remove file"
              title="Remove"
            >
              <FiX size={15} />
            </button>
          </div>
        )}
      </div>

      {/* ── Question ── */}
      <div className={styles.section}>
        <label htmlFor="question-textarea" className={styles.sectionLabel}>
          <FiZap size={14} /> Your Question
        </label>
        <textarea
          id="question-textarea"
          className={styles.textarea}
          placeholder="Ask anything about your uploaded PDF… (Ctrl+Enter to submit)"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={5}
          disabled={loading}
        />
      </div>

      {/* ── Notification ── */}
      {notification && (
        <div
          className={`${styles.notification} ${styles[notification.type]} animate-fade-in`}
          role="alert"
        >
          {notification.type === 'error'
            ? <FiAlertCircle size={15} />
            : <FiCheckCircle size={15} />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* ── Loader or Button ── */}
      {loading ? (
        <Loader message="Uploading PDF, embedding & generating answer… this may take a minute." />
      ) : (
        <Button
          id="analyze-btn"
          variant="primary"
          size="lg"
          onClick={handleAnalyze}
          disabled={!canSubmit}
          style={{ width: '100%' }}
        >
          <FiSend size={16} />
          Analyze &amp; Answer
        </Button>
      )}

      {/* ── AI Response ── */}
      {response && <ResponseCard response={response} timestamp={timestamp} />}
    </div>
  )
}
