const express = require('express')

const app = express();




app.get('/',(req,res)=>{
    
     res.send("Najeeb Ullah Khan")
})


app.listen(3000,()=>{

console.log("Server is running");


})