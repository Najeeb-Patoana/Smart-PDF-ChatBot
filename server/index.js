const express = require('express');
const multer = require('multer');

const app = express();
const upload = multer({dest:"uploads"})
const pdfParse=require('pdf-parse')
app.get('/',(req,res)=>{
    
     res.send("Najeeb Ullah Khan")
})

app.post('/upload',upload.single("pdf"),(req,res)=>{
    console.log(req.file);

    const dataBuffer= fs.readFileSync(req.file.path)
      
    const pdfData= pdfParse(dataBuffer);


    res.send("file uploaded done!")
    

}) 

app.listen(3000,()=>{

console.log("Server is running");


})