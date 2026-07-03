const express = require('express');
const multer = require('multer');
const app = express();
const upload = multer({dest:"uploads"})
const pdfParse=require('pdf-parse')
const fs=require('fs')
app.get('/',(req,res)=>{
    
     res.send("Najeeb Ullah Khan")
})

app.post('/upload',upload.single("pdf"),async(req,res)=>{
    console.log(req.file);

    const dataBuffer= fs.readFileSync(req.file.path)
      
    const pdfData= await pdfParse(dataBuffer);
    const text=pdfData.text;

    res.send(text)
    

}) 

app.listen(3000,()=>{

console.log("Server is running");


})