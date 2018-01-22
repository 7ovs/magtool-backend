var express = require('express')
var cors = require('cors')
var bodyParser = require('body-parser')
var session = require('express-session')
var hash = require('pbkdf2-password')()

var app = express()

app.use(session({
  resave: false, // don't save session if unmodified
  saveUninitialized: false, // don't create session until something stored
  secret: 'shhhh, very secret'
}))

var jsonParser = bodyParser.json()

var users = {
  admin: {
    name: 'admin'
  }
}

// генерируем первоначальный хэш для admin пользователя
hash({ password: 'secret' }, (err, pass, salt, hash) => {
  if (err) throw err
  users.admin.salt = salt
  users.admin.hash = hash
})

var auth = (name, password, callback) => {
  const user = users[name]
  if (!user) return callback(new Error('cannot find user'))
  hash({ password, salt: user.salt }, (err, pass, salt, hash) => {
    if (err) return callback(err)
    if (hash === user.hash) return callback(null, user)
    callback(new Error('invalid password'))
  })
}
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