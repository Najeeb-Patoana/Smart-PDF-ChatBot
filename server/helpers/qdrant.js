const { QdrantClient } = require("@qdrant/js-client-rest");
const { randomUUID } = require("crypto");

/** Singleton Qdrant client shared across all route handlers */
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    checkCompatibility: false,
});

const COLLECTION = "pdf-docs";

/**
 * Ensure the `documentId` keyword payload index exists on the collection.
 *
 * Qdrant Cloud REQUIRES a payload index before a field can be used in a filter.
 * This is idempotent — calling it when the index already exists is safe.
 */
async function ensurePayloadIndex() {
    try {
        await qdrant.createPayloadIndex(COLLECTION, {
            field_name: "documentId",
            field_schema: "keyword",
        });
        console.log("[Qdrant] Payload index on 'documentId' ready.");
    } catch (err) {
        // "already exists" errors are expected and harmless on subsequent calls
        const msg = err?.message || "";
        if (!msg.toLowerCase().includes("already") && !msg.toLowerCase().includes("conflict")) {
            console.warn("[Qdrant] Warning ensuring payload index:", msg);
        }
    }
}

/**
 * Store chunk embeddings for a specific document.
 *
 * Each point payload: { documentId, chunkIndex, text }
 * The documentId payload index is created/confirmed before every upload
 * so that Qdrant filter queries always work.
 *
 * @param {string} documentId
 * @param {{ text: string, embedding: number[] }[]} chunkEmbeddings
 */
async function storeChunks(documentId, chunkEmbeddings) {
    const points = chunkEmbeddings.map((item, index) => ({
        id: randomUUID(),
        vector: item.embedding,
        payload: {
            documentId,
            chunkIndex: index,
            text: item.text,
        },
    }));

    await qdrant.upsert(COLLECTION, { points });

    // Always ensure the payload index exists so filters work on Qdrant Cloud
    await ensurePayloadIndex();
}

/**
 * Search for the top-k most relevant chunks scoped to a single document.
 *
 * The `documentId` filter ensures chunks from other PDFs are never returned.
 *
 * @param {string} documentId
 * @param {number[]} queryVector
 * @param {number} [limit=5]
 * @returns {Promise<string[]>} ordered array of matching chunk texts
 */
async function searchChunks(documentId, queryVector, limit = 5) {
    const results = await qdrant.search(COLLECTION, {
        vector: queryVector,
        limit,
        filter: {
            must: [
                {
                    key: "documentId",
                    match: { value: documentId },
                },
            ],
        },
    });

    return results.map((r) => r.payload.text);
}

module.exports = { qdrant, COLLECTION, storeChunks, searchChunks, ensurePayloadIndex };
