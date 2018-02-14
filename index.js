const _ = require('lodash') // eslint-disable-line
const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const hash = require('pbkdf2-password')()
const access = require('./etc/access.json')
const config = require('./etc/config.json')
const jwt = require('jsonwebtoken')
const { resolve, join } = require('path')
const Promise = require('bluebird')
const execAsync = Promise.promisify(require('child_process').exec)
const fs = require('fs')
const readdirp = require('readdirp')
const low = require('lowdb')
const FileAsync = require('lowdb/adapters/FileAsync')
const uuid = require('uuid/v4')
const crypto = require('crypto')
const base32Encode = require('base32-encode')
const moment = require('moment')

var app = express()
var downloadServer = express()

const jsonParser = bodyParser.json()

var main = async () => {
  const adapter = new FileAsync(config.db.path)
  const db = await low(adapter)
  await db.defaults({ users: [], links: [] }).write()
  // await db.set('links', []).write()
  const users = await db.get('users').keyBy('name').value()

  var auth = (name, password, callback) => {
    const user = users[name]
    if (!user) return callback(new Error('cannot find user'))
    hash({ password, salt: user.salt }, (err, pass, salt, hash) => {
      if (err) return callback(err)
      if (hash === user.hash) return callback(null, user)
      callback(new Error('invalid password'))
    })
  }

  var checkAuth = (req, res, next) => {
    try {
      const token = req.headers['x-access-token']
      if (!token) throw (new Error('login is required'))

      const session = jwt.verify(token, access.session)

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

      var token = jwt.sign({ username: user.name }, access.session, { expiresIn: config.session.expires_in })
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
      const session = jwt.verify(token, access.session)
      if (!users[session.username]) throw (new Error('user not found'))
      var newToken = jwt.sign({ username: session.username }, access.session, { expiresIn: config.session.expires_in })
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

  // TODO: delete?
  // app.post('/logout', jsonParser, (req, res) => {
  //   res.json({
  //     status: 'OK'
  //   })
  // })

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
          error: 'command not found'
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

  function generateHash (linkData) {
    let hash = crypto.createHmac('sha224', access.links)
      .update(linkData.id)
      .update(linkData.email + '') // if null...
      .update(linkData.orderId + '')
      .update(linkData.downloadsLimit.toString())
      .update(linkData.files.join(';'))
      .update(linkData.created_by)
      .update(linkData.created_at)
      .digest()
    hash = base32Encode(hash, 'Crockford').toLowerCase()
    return hash
  }

  app.post('/links', checkAuth, jsonParser, (req, res) => {
    if (!req.body) return res.sendStatus(400)
    const cmd = req.body.command
    switch (cmd) {
      case 'GET_FILES_LIST':
        console.log(new Date(), 'GET_FILES_LIST', config.target_dir)
        var result = new FilesTree()
        readdirp({ root: resolve(config.target_dir), fileFilter: ['!.*'] })
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
      case 'CREATE_LINK':
        console.log(new Date(), 'CREATE_LINK', req.body)
        if (!req.body.data) return res.status(500)
        let linkData = req.body.data
        linkData.downloadsLimit = +linkData.downloadsLimit // Force save as Number, not String
        linkData = {
          id: uuid(),
          ...linkData,
          downloadsCount: 0,
          created_at: moment().toISOString(),
          updated_at: moment().toISOString(),
          access_log: []
        }
        linkData.hash = generateHash(linkData)
        linkData.link = `/get/${linkData.hash}`
        db.get('links')
          .push(linkData)
          .write()
          .then(() => {
            res.json({
              status: 'OK',
              data: linkData
            })
          })
          .catch(err => {
            res.json({
              status: 'FAIL',
              error: err.message
            })
          })
        break
      case 'GET_LINKS':
        const linkList = db.get('links').value()
        res.json({
          status: 'OK',
          data: linkList
        })
        break
      case 'DELETE_LINK':
        console.log('DELETE_LINK', req.body)
        if (!req.body.id) return res.status(500)
        const id = req.body.id
        db.get('links').remove({id}).write().then(() => {
          const linkList = db.get('links').value()
          res.json({
            status: 'OK',
            data: linkList
          })
        })
        break
      case 'RESET_COUNTER':
        console.log('RESET_COUNTER', req.body)
        if (!req.body.id) return res.status(500)
        const newCount = parseInt(req.body.count, 10) || 0
        const cursor = db.get('links').find({ id: req.body.id }).assign({ downloadsCount: newCount })
        cursor.write().then(() => {
          res.json({
            status: 'OK',
            data: cursor.value()
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

  downloadServer.get('/get/:hash', (req, res) => {
    const cursor = db.get('links').find({ hash: req.params.hash })
    const linkData = cursor.value()
    console.log('DOWNLOAD GET', req.params.hash, linkData)
    if (!linkData) return res.json({ status: 'FAIL', error: 'not found' })    

    if (linkData.downloadsCount >= linkData.downloadsLimit) {
      return res.json({ status: 'FAIL', error: 'download limit exceeded' })
    }

    const ZipStream = require('./lib/zipstream')
    let zstream = new ZipStream({ level: 1 })
    zstream.pipe(res)
    Promise.mapSeries(linkData.files, (file) => {
      const fullpath = resolve(join(config.target_dir, file))
      console.log('add file', file)
      return zstream.addFile(fs.createReadStream(fullpath), { name: file })
    }).then(() => {
      return zstream.finalize()
    }).then(written => {
      console.log('File successfully sended,', written, 'bytes written')
      let dontIncrementCount = false
      if (req.query.token) {
        try {
          const session = jwt.verify(req.query.token, access.session)
          if (users[session.username]) {
            dontIncrementCount = true
            console.log('detect logged in user, do not increment downloads counter')
          }
        } catch (error) {}
      }
      if (!dontIncrementCount) {
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
        const ts = moment().toISOString()
        cursor.assign({ downloadsCount: ++linkData.downloadsCount }).write()
        cursor.defaults({ 'access_log': [] }).get('access_log').push({ ts, ip }).write()
        console.log(cursor.value())
        // cursor.write()
      }
    })
  })

  app.listen(config.port)
  downloadServer.listen(5000)
  // console.log(crypto.getHashes())
  console.log(`start server on port ${config.port}`)
  console.log(`start download server on port ${5000}`)
}

main()
