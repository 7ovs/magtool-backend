var express = require('express')
var cors = require('cors')
var bodyParser = require('body-parser')

var app = express()

var jsonParser = bodyParser.json()

app.use(cors())

app.get('/', (req, res) => {
  res.send('magtool v0.1.0')
})

app.post('/command', jsonParser, (req, res) => {
  if (!req.body) return res.sendStatus(400)
  const cmd = req.body.command
  switch (cmd) {
    case 'PING':
      res.json({
        status: 'OK',
        data: 'PONG'
      })
      break;
    default:
      break;
  }
})

var port = process.env.PORT || 3000
app.listen(port)
console.log(`start server on port ${port}`)