const express = require('express');
const multer = require('multer');
const fs = require('fs');
const pdfParse = require("pdf-parse");
const { GoogleGenAI } = require("@google/genai");
const { QdrantClient } = require('@qdrant/js-client-rest');

require('dotenv').config();

const app = express();
app.use(express.json());

const upload = multer({
    dest: 'uploads/',
})

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
});

async function createEmbedding(text) {
    const response = await ai.models.embedContent({
        model: "gemini-embedding-2",
        contents: text,
    });

    return response.embeddings[0].values;
}

function cosineSimilarity(vecA, vecB){
    let dotProduct = 0;

    for(let i=0; i< vecA.length; i++){
        dotProduct += vecA[i] * vecB[i];
    }

    return dotProduct;
}


app.get('/', (req, res)=>{
    res.send('<h1>Server is running</h1>');
});

app.post('/upload', upload.single('pdf'), async (req, res)=>{
    console.log(req.body);
    try{
        const dataBuffer = fs.readFileSync(req.file.path);
        const pdfData = await pdfParse(dataBuffer);
        const text = pdfData.text;

        const chunks = text.split("\n\n").filter((chunk) => chunk.trim() !== "");
        const chunkEmbeddings = [];
        
        for(const chunk of chunks){
            const embedding = await createEmbedding(chunk);

            chunkEmbeddings.push({
                text: chunk,
                embedding
            });
        }

        const points = chunkEmbeddings.map((item, index) => ({
            id: index+1,
            vector: item.embedding,
            payload: {
                text: item.text,
            }
        }));

        await qdrant.upsert('pdf-docs', {
            points,
        });

        const question = req.body.question;
        const questionEmbedding = await createEmbedding(question);
        console.log(questionEmbedding.length);

        /*
        let bestChunk = null;
        let bestScore = -Infinity;

        // const matchedChunk = chunks.find((chunk)=> chunk.toLowerCase().includes(question.toLowerCase()));

        
        for (const item of chunkEmbeddings){
            let score = cosineSimilarity(questionEmbedding, item.embedding);
            if(score > bestScore){
                bestScore = score;
                bestChunk = item.text;
            }
        }

        console.log(bestChunk);
        console.log(bestScore);
        */

        const searchResult = await qdrant.search('pdf-docs', {
            vector: questionEmbedding,
            limit: 1,
        });

        const bestChunk = searchResult[0].payload.text;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: `Answer the question using this context: ${bestChunk} Question: ${question}`,
        })
        res.send(response.text);
    }catch(err){
        console.log(err);
        res.status(500).send("Error reading pdf");
    }
})


app.get('/create-collection', async (req, res)=>{
    await qdrant.createCollection("pdf-docs", {
        vectors:{
            size: 3072,
            distance: "Cosine",
        },
    })

    res.send("collection created");
})

app.listen(3000, ()=>{
    console.log('server is running on port 3000');
})