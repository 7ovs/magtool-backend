var express = require('express')
var cors = require('cors')
var bodyParser = require('body-parser')

var app = express()

var jsonParser = bodyParser.json()

app.use(cors())

app.get('/', (req, res) => {
  res.send('magtool v0.1.0')
})

var port = process.env.PORT || 3000
app.listen(port)
console.log(`start server on port ${port}`)