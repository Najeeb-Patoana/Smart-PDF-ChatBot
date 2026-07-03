const { QdrantClient } = require("@qdrant/js-client-rest");

/** Singleton Qdrant client shared across all route handlers */
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    checkCompatibility: false,
});

const COLLECTION = "pdf-docs";

/**
 * Store an array of chunk embeddings for a specific document.
 *
 * Each point payload includes:
 *   { documentId, chunkIndex, text }
 *
 * This allows Qdrant filters to isolate chunks per document.
 *
 * @param {string} documentId
 * @param {{ text: string, embedding: number[] }[]} chunkEmbeddings
 */
async function storeChunks(documentId, chunkEmbeddings) {
    const { randomUUID } = require("crypto");

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
}

/**
 * Search for the top-k most relevant chunks for a given document.
 *
 * Uses a Qdrant payload filter so only vectors belonging to `documentId`
 * are considered — chunks from other PDFs are never mixed in.
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

module.exports = { qdrant, COLLECTION, storeChunks, searchChunks };
