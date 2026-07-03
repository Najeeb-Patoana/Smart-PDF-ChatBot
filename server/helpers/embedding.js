const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/** Wait ms milliseconds */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a Gemini text embedding with exponential-backoff retry on rate limits.
 * A 250 ms pause is added after every successful call to stay within free-tier RPM.
 *
 * @param {string} text
 * @param {number} [maxRetries=4]
 * @returns {Promise<number[]>} embedding vector
 */
async function createEmbedding(text, maxRetries = 4) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await ai.models.embedContent({
                model: "gemini-embedding-2",
                contents: text,
            });
            await sleep(250); // throttle to stay within free-tier limits
            return response.embeddings[0].values;
        } catch (err) {
            const isRateLimit = err.status === 429;
            if (isRateLimit && attempt < maxRetries) {
                const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s, 16s
                console.log(`[Rate limit] Retry ${attempt + 1}/${maxRetries} in ${delay / 1000}s…`);
                await sleep(delay);
            } else {
                throw err;
            }
        }
    }
}

module.exports = { ai, createEmbedding };
