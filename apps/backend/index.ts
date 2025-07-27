import express from "express";  

const app = express()


app.get("/", (req, res)=> {
    res.json({
        message: "we back"
    })
})


app.listen(8080, ()=> {
    console.log("Listening on port 8080")
})