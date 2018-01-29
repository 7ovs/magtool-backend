var express = require('express')
var cors = require('cors')
var bodyParser = require('body-parser')
var hash = require('pbkdf2-password')()
var config = require('./etc/config.json')
var jwt = require('jsonwebtoken')
var RedisStore = require('./lib/store')
var { timeout } = require('./lib/util')

var app = express()

var jsonParser = bodyParser.json()

var main = async () => {
  if (!require('fs').existsSync(require('path').resolve('../' + config.redis.pidfile))) {
    await RedisStore.startSrever(config.redis)
    await timeout(500)
  } else {
    console.log('server already started')
  }

  var store = new RedisStore(config.redis)
  var users = await store.getMap('users')

  console.log(users)

  var auth = (name, password, callback) => {
    const user = users[name]
    if (!user) return callback(new Error('cannot find user'))
    hash({ password, salt: user.salt }, (err, pass, salt, hash) => {
      if (err) return callback(err)
      if (hash === user.hash) return callback(null, user)
      callback(new Error('invalid password'))
    })
  }

  // TODO
  var checkAuth = (req, res, next) => {
    try {
      const token = req.headers['x-access-token']
      if (!token) throw (new Error('login is required'))

      const session = jwt.verify(token, config.jwt_secret)

      if (!users[session.username]) throw (new Error('user not found'))
      next()
    } catch (error) {
      res.json({
        status: 'FAIL',
        error: error.message
      })
    }
  }

  app.use(cors())

  app.get('/', (req, res) => {
    res.send('magtool v0.1.0')
  })

  app.post('/login', jsonParser, (req, res) => {
    if (!req.body) return res.sendStatus(400)
    auth(req.body.username, req.body.password, (err, user) => {
      if (err || !user) {
        res.json({
          status: 'FAIL',
          error: 'invalid username or password'
        })
        return
      }

      var token = jwt.sign({ username: user.name }, config.jwt_secret)
      res.json({
        status: 'OK',
        token
      })
    })
  })

  app.post('/logout', jsonParser, (req, res) => {
    res.json({
      status: 'OK'
    })
  })

  app.post('/command', checkAuth, jsonParser, (req, res) => {
    if (!req.body) return res.sendStatus(400)
    const cmd = req.body.command
    switch (cmd) {
      case 'PING':
        res.json({
          status: 'OK',
          data: 'PONG'
        })
        break
      default:
        break
    }
  })

  app.listen(config.port)
  console.log(`start server on port ${config.port}`)
}

main()
