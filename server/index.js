const express = require('express');
const multer = require('multer');

const app = express();


const upload = multer({dest:"uploads"})

app.get('/',(req,res)=>{
    
     res.send("Najeeb Ullah Khan")
})

app.post('/upload',upload.single("pdf"),(req,res)=>{
    console.log(res.file);
    res.send("file uploaded done!")
    

}) 

app.listen(3000,()=>{

console.log("Server is running");


})