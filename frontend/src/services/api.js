import axios from 'axios'

const api = axios.create({
  baseURL: 'http://localhost:3000',
  // Upload can take a while (many chunks to embed with rate-limit delays)
  // Ask is fast (1 embedding + 1 search + 1 generation)
  timeout: 300_000, // 5 minutes max for very large PDFs
})

/**
 * Upload a PDF and index it.
 * The PDF is processed ONCE. The returned documentId is all you need
 * to ask unlimited follow-up questions without re-uploading.
 *
 * @param {File} pdfFile
 * @returns {Promise<{ documentId: string, chunkCount: number, message: string }>}
 */
export async function uploadPDF(pdfFile) {
  const formData = new FormData()
  formData.append('pdf', pdfFile)

  const response = await api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })

  return response.data // { success, message, documentId, chunkCount }
}

/**
 * Ask a question about an already-indexed PDF.
 * Only the question is embedded — the document is NOT re-processed.
 *
 * @param {string} documentId - returned by uploadPDF()
 * @param {string} question
 * @returns {Promise<string>} AI-generated answer
 */
export async function askQuestion(documentId, question) {
  const response = await api.post(
    '/ask',
    { documentId, question },
    { headers: { 'Content-Type': 'application/json' } }
  )

  return response.data.answer
}

export default api
