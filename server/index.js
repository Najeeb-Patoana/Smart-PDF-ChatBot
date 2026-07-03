const express = require("express");
const multer = require("multer");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const { randomUUID } = require("crypto");
const { GoogleGenAI } = require("@google/genai");
const { QdrantClient } = require("@qdrant/js-client-rest");

require("dotenv").config();

const app = express();
app.use(express.json());

const upload = multer({
    dest: "uploads/",
});

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    checkCompatibility: false,
});

async function createEmbedding(text) {
    const response = await ai.models.embedContent({
        model: "gemini-embedding-2",
        contents: text,
    });

    return response.embeddings[0].values;
}

app.get("/", (req, res) => {
    res.send("<h1>Server is running</h1>");
});

app.get("/test-qdrant", async (req, res) => {
    try {
        console.log("Testing Qdrant connection...");
        const collections = await qdrant.getCollections();
        console.log(collections);
        res.json(collections);
    } catch (err) {
        console.error("Qdrant Test Error:", err);
        console.error("Cause:", err.cause);
        console.error(err.stack);
        res.status(500).json({
            message: err.message,
            cause: err.cause,
        });
    }
});

app.post("/upload", upload.single("pdf"), async (req, res) => {
    try {
        console.log("========== NEW REQUEST ==========");
        console.log("Body:", req.body);

        console.log("1. Reading PDF...");
        const dataBuffer = fs.readFileSync(req.file.path);

        console.log("2. Parsing PDF...");
        const pdfData = await pdfParse(dataBuffer);

        console.log("3. PDF Parsed");

        const text = pdfData.text;

        const chunks = text
            .split("\n\n")
            .filter((chunk) => chunk.trim() !== "");

        console.log(`4. Total Chunks: ${chunks.length}`);

        const chunkEmbeddings = [];

        for (const chunk of chunks) {
            console.log("Creating embedding...");

            const embedding = await createEmbedding(chunk);

            console.log("Embedding created");

            chunkEmbeddings.push({
                text: chunk,
                embedding,
            });
        }

        console.log("5. Creating points...");

        const points = chunkEmbeddings.map((item) => ({
            id: randomUUID(),
            vector: item.embedding,
            payload: {
                text: item.text,
            },
        }));

        console.log("6. Uploading to Qdrant...");

        await qdrant.upsert("pdf-docs", {
            points,
        });

        console.log("7. Upsert Complete");

        const question = req.body.question;

        console.log("8. Creating question embedding...");

        const questionEmbedding = await createEmbedding(question);

        console.log("Question embedding length:", questionEmbedding.length);

        console.log("9. Searching Qdrant...");

        const searchResult = await qdrant.search("pdf-docs", {
            vector: questionEmbedding,
            limit: 1,
        });

        console.log("10. Search Complete");

        if (!searchResult.length) {
            return res.status(404).send("No matching content found.");
        }

        const bestChunk = searchResult[0].payload.text;

        console.log("11. Generating AI response...");

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: `Answer the question using this context:

${bestChunk}

Question:
${question}`,
        });

        console.log("12. Response Generated");

        fs.unlink(req.file.path, () => {});

        res.send(response.text);
    } catch (err) {
        console.error("========== ERROR ==========");
        console.error(err);
        console.error("Cause:", err.cause);
        console.error(err.stack);

        if (req.file) {
            fs.unlink(req.file.path, () => {});
        }

        res.status(500).json({
            message: err.message,
            cause: err.cause?.message,
            stack: err.stack,
        });
    }
});

app.get("/create-collection", async (req, res) => {
    try {
        console.log("Creating collection...");

        await qdrant.createCollection("pdf-docs", {
            vectors: {
                size: 3072,
                distance: "Cosine",
            },
        });

        console.log("Collection created");

        res.send("Collection created");
    } catch (err) {
        console.error(err);
        console.error("Cause:", err.cause);
        console.error(err.stack);

        res.status(500).json({
            message: err.message,
            cause: err.cause,
        });
    }
});

app.listen(3000, () => {
    console.log("Server is running on port 3000");
});