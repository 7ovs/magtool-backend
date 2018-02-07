const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const hash = require('pbkdf2-password')()
const config = require('./etc/config.json')
const jwt = require('jsonwebtoken')
// var RedisStore = require('./lib/store')
// var { timeout } = require('./lib/util')
var { resolve, join } = require('path')
var Promise = require('bluebird')
var execAsync = Promise.promisify(require('child_process').exec)
var fs = require('fs')
var readdirp = require('readdirp')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')

var app = express()

var jsonParser = bodyParser.json()

var main = async () => {
  const adapter = new FileSync(config.db.path)
  const db = low(adapter)

  // const pidPath = path.resolve(path.join(__dirname, config.redis.pidfile))
  // if (!fs.existsSync(pidPath)) {
  //   await RedisStore.startSrever(config.redis)
  //   await timeout(500)
  // } else {
  //   console.log('server already started')
  // }

  // var store = new RedisStore(config.redis)
  // var users = await store.getMap('users')
  await db.defaults({ users: [] }).write()
  const users = await db.get('users').keyBy('name').value()
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

      const session = jwt.verify(token, config.session.secret)

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
    res.send('magtool v0.2.0')
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

      var token = jwt.sign({ username: user.name }, config.session.secret, { expiresIn: config.session.expires_in })
      res.json({
        status: 'OK',
        token
      })
    })
  })

  app.post('/regen', (req, res) => {
    try {
      const token = req.headers['x-access-token']
      if (!token) throw (new Error('token not found'))
      const session = jwt.verify(token, config.session.secret)
      if (!users[session.username]) throw (new Error('user not found'))
      var newToken = jwt.sign({ username: session.username }, config.session.secret, { expiresIn: config.session.expires_in })
      res.json({
        status: 'OK',
        token: newToken
      })
    } catch (error) {
      res.json({
        status: 'FAIL',
        error: error.message
      })
    }
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

  app.post('/control', checkAuth, jsonParser, (req, res) => {
    if (!req.body) return res.sendStatus(400)
    const cmd = req.body.command
    console.log('POST /control', req.body)
    switch (cmd) {
      case 'PING':
        console.log(new Date(), 'COMMAND PING')
        res.json({
          status: 'OK',
          data: 'PONG'
        })
        break
      case 'RESET':
        const cmds = [
          'service apache2 restart',
          'service varnish restart',
          'service nginx restart' ]
        Promise.map(cmds, cmd => {
          return execAsync(cmd)
        }).then((results) => {
          console.log('RESET SUCCESS: ', results)
          res.json({ status: 'OK' })
        }).catch(err => {
          console.log('RESET FAIL: ', err)
          res.json({
            status: 'FAIL',
            error: err.message
          })
        })
        break
      case 'CLEAN_CACHE':
        execAsync('/var/www/magento21/bin/magento cache:flush', { cwd: '/var/www/magento21' })
          .then(result => {
            console.log('cache:flush', result)
            execAsync('service varnish restart')
          })
          .then(result => {
            console.log('service varnish restart', result)
            res.json({ status: 'OK' })
          })
        break
      case 'GET_LOG':
        const readFileAsync = Promise.promisify(fs.readFile)
        readFileAsync(resolve(join(__dirname, 'var/log/server-out-0.log')), 'utf-8')
          .then(result => {
            console.log('GET_LOG', result)
            res.json({
              status: 'OK',
              data: result
            })
          })
        break
      default:
        res.json({
          status: 'FAIL',
          data: 'command not found'
        })
        break
    }
  })

  class FilesTree {
    constructor () {
      this._tree = {}
    }

    _add (tree, pa) {
      if (pa.length === 1) {
        tree[pa[0]] = {
          name: pa[0]
        }
        return tree
      } else {
        if (!tree[pa[0]]) {
          tree[pa[0]] = {
            name: pa[0],
            children: {}
          }
        }
        tree[pa[0]].children = this._add(tree[pa[0]].children, pa.slice(1))
        return tree
      }
    }

    add (entry) {
      let pa = entry.path.split('/')
      this._tree = this._add(this._tree, pa)
    }

    get tree () {
      return this._tree
    }
  }

  app.post('/links', checkAuth, jsonParser, (req, res) => {
    if (!req.body) return res.sendStatus(400)
    const cmd = req.body.command
    console.log('POST /links', req.body)
    switch (cmd) {
      case 'GET_FILES_LIST':
        console.log(new Date(), 'GET_FILES_LIST', config.target_dir)
        var result = new FilesTree()
        readdirp({ root: resolve(config.target_dir), depth: 3 })
          .on('data', entry => {
            result.add(entry)
          })
          .on('end', () => {
            res.json({
              status: 'OK',
              data: result.tree
            })
          })
        break
      default:
        res.json({
          status: 'FAIL',
          data: 'command not found'
        })
        break
    }
  })

  app.listen(config.port)
  console.log(`start server on port ${config.port}`)
}

main()
