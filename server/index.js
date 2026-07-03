const express = require("express");
const cors    = require("cors");
const multer  = require("multer");
const fs      = require("fs");
const pdfParse = require("pdf-parse");
const { randomUUID } = require("crypto");

require("dotenv").config();

// ── Helpers ───────────────────────────────────────────────────────────────────
const { ai, createEmbedding } = require("./helpers/embedding");
const { chunkText }           = require("./helpers/chunking");
const { storeChunks, searchChunks, qdrant, COLLECTION } = require("./helpers/qdrant");

// ── App setup ─────────────────────────────────────────────────────────────────
const app = express();

app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"] }));
app.use(express.json());

const upload = multer({ dest: "uploads/" });

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Consistent error response */
function sendError(res, status, message) {
    return res.status(status).json({ success: false, message });
}

/** Clean up uploaded temp file silently */
function cleanupFile(path) {
    if (path) fs.unlink(path, () => {});
}

/** Convert a raw Gemini API error into a human-readable message */
function parseGeminiError(err) {
    if (err.status === 429)
        return "Gemini API rate limit reached. Please wait 30 seconds and try again.";
    return err.message || "An unexpected error occurred.";
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/", (req, res) => res.json({ status: "PDF Intelligence API is running" }));

// ─────────────────────────────────────────────────────────────────────────────
// POST /upload
//
// • Accepts: multipart/form-data with field "pdf"
// • Parses PDF → chunks → embeds each chunk → stores in Qdrant
// • Returns: { success, message, documentId, chunkCount }
//
// The PDF is NEVER re-processed when the user asks questions.
// ─────────────────────────────────────────────────────────────────────────────
app.post("/upload", upload.single("pdf"), async (req, res) => {
    const filePath = req.file?.path;

    try {
        // ── Validation ──────────────────────────────────────────────────────
        if (!req.file) {
            return sendError(res, 400, "No PDF file provided.");
        }
        if (req.file.mimetype !== "application/pdf" &&
            !req.file.originalname.toLowerCase().endsWith(".pdf")) {
            cleanupFile(filePath);
            return sendError(res, 400, "Only PDF files are accepted.");
        }

        const documentId = randomUUID();
        console.log(`\n[UPLOAD] documentId=${documentId} file=${req.file.originalname}`);

        // ── Parse PDF ───────────────────────────────────────────────────────
        console.log("[UPLOAD] Parsing PDF…");
        const buffer  = fs.readFileSync(filePath);
        const pdfData = await pdfParse(buffer);

        if (!pdfData.text || pdfData.text.trim().length === 0) {
            cleanupFile(filePath);
            return sendError(res, 422, "Could not extract text from this PDF. The file may be scanned or image-based.");
        }

        // ── Chunk ────────────────────────────────────────────────────────────
        const chunks = chunkText(pdfData.text);
        console.log(`[UPLOAD] ${chunks.length} chunks created.`);

        if (chunks.length === 0) {
            cleanupFile(filePath);
            return sendError(res, 422, "No usable text content found in the PDF.");
        }

        // ── Embed each chunk ─────────────────────────────────────────────────
        console.log("[UPLOAD] Embedding chunks…");
        const chunkEmbeddings = [];

        for (let i = 0; i < chunks.length; i++) {
            console.log(`[UPLOAD] Chunk ${i + 1}/${chunks.length}`);
            const embedding = await createEmbedding(chunks[i]);
            chunkEmbeddings.push({ text: chunks[i], embedding });
        }

        // ── Store in Qdrant ──────────────────────────────────────────────────
        console.log("[UPLOAD] Storing vectors in Qdrant…");
        await storeChunks(documentId, chunkEmbeddings);
        console.log(`[UPLOAD] Done. documentId=${documentId}`);

        cleanupFile(filePath);

        return res.status(200).json({
            success: true,
            message: "Document uploaded and indexed successfully.",
            documentId,
            chunkCount: chunks.length,
        });

    } catch (err) {
        console.error("[UPLOAD] Error:", err.message);
        cleanupFile(filePath);
        return sendError(res, err.status === 429 ? 429 : 500, parseGeminiError(err));
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /ask
//
// • Accepts: JSON body { documentId, question }
// • Embeds ONLY the question (1 API call)
// • Searches Qdrant filtered by documentId (no other PDF's chunks are touched)
// • Sends top-5 chunks as context to Gemini
// • Returns: { success, answer }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/ask", async (req, res) => {
    try {
        const { documentId, question } = req.body;

        // ── Validation ──────────────────────────────────────────────────────
        if (!documentId || typeof documentId !== "string" || !documentId.trim()) {
            return sendError(res, 400, "documentId is required.");
        }
        if (!question || typeof question !== "string" || !question.trim()) {
            return sendError(res, 400, "Question cannot be empty.");
        }

        console.log(`\n[ASK] documentId=${documentId}`);
        console.log(`[ASK] question="${question.slice(0, 80)}…"`);

        // ── Embed question ───────────────────────────────────────────────────
        console.log("[ASK] Embedding question…");
        const questionVector = await createEmbedding(question.trim());

        // ── Semantic search (document-scoped) ────────────────────────────────
        console.log("[ASK] Searching Qdrant…");
        const topChunks = await searchChunks(documentId, questionVector, 5);

        if (!topChunks.length) {
            return sendError(res, 404, "No relevant content found. Make sure the PDF was uploaded successfully.");
        }

        // ── Build context & prompt ───────────────────────────────────────────
        const context = topChunks.join("\n\n---\n\n");

        const prompt = `You are a helpful assistant.

Answer ONLY using the context provided below.
If the answer is not in the context, respond exactly with:
"I could not find that information in the uploaded document."

Do not invent or assume any information.

Context:
${context}

Question:
${question.trim()}`;

        // ── Generate answer ──────────────────────────────────────────────────
        console.log("[ASK] Generating answer…");
        const aiResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: prompt,
        });

        console.log("[ASK] Done.");

        return res.status(200).json({
            success: true,
            answer: aiResponse.text,
        });

    } catch (err) {
        console.error("[ASK] Error:", err.message);
        return sendError(res, err.status === 429 ? 429 : 500, parseGeminiError(err));
    }
});

// ── Utility routes ────────────────────────────────────────────────────────────

app.get("/test-qdrant", async (req, res) => {
    try {
        const collections = await qdrant.getCollections();
        res.json({ success: true, collections });
    } catch (err) {
        sendError(res, 500, err.message);
    }
});

app.get("/create-collection", async (req, res) => {
    try {
        await qdrant.createCollection(COLLECTION, {
            vectors: { size: 3072, distance: "Cosine" },
        });
        res.json({ success: true, message: `Collection '${COLLECTION}' created.` });
    } catch (err) {
        sendError(res, 500, err.message);
    }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(3000, () => {
    console.log("PDF Intelligence server running on http://localhost:3000");
    console.log("  POST /upload  — index a PDF document");
    console.log("  POST /ask     — answer a question from an indexed document");
});