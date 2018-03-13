const ENV = process.env.NODE_ENV || 'development'

const _ = require('lodash') // eslint-disable-line
const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const hasher = require('pbkdf2-password')()
const jwt = require('jsonwebtoken')
const { resolve, join } = require('path')
const Promise = require('bluebird')
const { exec } = require('child_process')
const fs = require('fs')
const readdirp = require('readdirp')
const low = require('lowdb')
const FileAsync = require('lowdb/adapters/FileAsync')
const uuid = require('uuid/v4')
const crypto = require('crypto')
const base32Encode = require('base32-encode')
const moment = require('moment')

const access = require('./etc/access.json')
const config = {
  ...require(`./etc/config.json`),
  ...require(`./etc/${ENV}.config.json`)
}

var app = express()
var downloadServer = express()

const jsonParser = bodyParser.json()

function execAsync (...args) {
  return new Promise((resolve, reject) => {
    exec(...args, (error, stdout, stderr) => {
      if (error) reject(new Error(error))
      return resolve({error, stdout, stderr})
    })
  })
}

var main = async () => {
  const adapter = new FileAsync(config.db.path)
  const db = await low(adapter)
  await db.defaults({ users: [], links: [] }).write()
  // await db.set('links', []).write()
  var users = await db.get('users').keyBy('name').value()

  async function auth (name, password, callback) {
    await db.read()
    users = db.get('users').keyBy('name').value()
    const user = users[name]
    if (!user) return callback(new Error('cannot find user'))
    hasher({ password, salt: user.salt }, (err, pass, salt, hash) => {
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
      console.log('login ', user.name)
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
    switch (cmd) {
      case 'PING':
        res.json({
          status: 'OK',
          data: 'PONG'
        })
        break
      case 'RESET_APACHE':
        execAsync('sudo /usr/sbin/service apache2 restart')
          .then((results) => {
            console.log('RESET_APACHE SUCCESS: ', results)
            res.json({ status: 'OK' })
          }).catch(err => {
            console.log('RESET_APACHE FAIL: ', err)
            res.json({
              status: 'FAIL',
              error: err.message
            })
          })
        break
      case 'RESET_VARNISH':
        execAsync('sudo /usr/sbin/service varnish restart')
          .then((results) => {
            console.log('RESET_VARNISH SUCCESS: ', results)
            res.json({ status: 'OK' })
          }).catch(err => {
            console.log('RESET_VARNISH FAIL: ', err)
            res.json({
              status: 'FAIL',
              error: err.message
            })
          })
        break
      case 'CLEAN_CACHE':
        execAsync('sudo /var/www/magento21/bin/magento cache:flush', { cwd: '/var/www/magento21' })
          .then(result => {
            console.log('cache:flush', result)
            return execAsync('sudo /usr/sbin/service varnish restart')
          })
          .then(result => {
            console.log('sudo /usr/sbin/service varnish restart', result)
            res.json({ status: 'OK' })
          })
          .catch(err => {
            console.log('CLEAN_CACHE FAIL: ', err)
            res.json({
              status: 'FAIL',
              error: err.message
            })
          })
        break
      case 'GET_LOG':
        const count = req.body.count || 100
        const logPath = resolve(join(__dirname, config.log_file))
        execAsync(`tail -n ${count} ${logPath}`)
          .then(result => {
            const logs = result.stdout.trim().split('\n').map(it => JSON.parse(it.trim())) || []
            res.json({
              status: 'OK',
              data: logs
            })
          })
          .catch(err => {
            console.log('GET_LOG FAIL: ', err)
            res.json({
              status: 'FAIL',
              error: err.message
            })
          })
        break
      default:
        console.log('POST /control', req.body)
        console.log('WARN: command not found')
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

  app.post('/profile', checkAuth, jsonParser, (req, res) => {
    if (!req.body) return res.sendStatus(400)
    const cmd = req.body.command
    switch (cmd) {
      case 'CHANGE_PASSWORD':
        console.log('CHANGE_PASSWORD')
        try {
          const password = req.body.data.password
          const newPassword = req.body.data.new_password
          const token = req.headers['x-access-token']
          if (!token) throw (new Error('token is required'))
          const session = jwt.verify(token, access.session)
          if (!users[session.username]) throw (new Error('user not found'))
          const user = users[session.username]
          hasher({
            password,
            salt: user.salt
          }, (err, pass, salt, hash) => {
            if (err) return res.json({ status: 'FAIL', error: 'validation failed, ' + err })
            if (hash !== user.hash) return res.json({ status: 'FAIL', error: 'invalid password' })
            hasher({
              password: newPassword,
              salt: user.salt
            }, (err, pass, salt, hash) => {
              if (err) return res.json({ status: 'FAIL', error: 'update password failed' })
              user.hash = hash
              db.get('users').find({name: user.name}).assign(user).write().then(() => {
                res.json({ status: 'OK' })
              })
              users = db.get('users')
              console.log(`CHANGE_PASSWORD for ${user.name} - OK!`)
            })
          })
        } catch (error) {
          res.json({ status: 'FAIL', error: error.message })
        }
    }
  })

  app.post('/links', checkAuth, jsonParser, (req, res) => {
    if (!req.body) return res.sendStatus(400)
    const cmd = req.body.command
    switch (cmd) {
      case 'GET_FILES_LIST':
        console.log('GET_FILES_LIST', config.target_dir)
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
        console.log('CREATE_LINK', req.body)
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
        linkData.link = `/get/${linkData.hash}/archive.zip`
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

  downloadServer.get('/get/:hash/:filename*?', (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
    const cursor = db.get('links').find({ hash: req.params.hash })
    const linkData = cursor.value()
    const session = req.query.token ? jwt.verify(req.query.token, access.session) : undefined
    console.log('DOWNLOAD GET', req.params.hash, req.headers) // , linkData)
    if (!linkData) return res.send('not found')
    if (linkData.downloadsCount >= linkData.downloadsLimit && !(session && users[session.username])) {
      return res.send('download limit exceeded')
    }

    const ZipStream = require('./lib/zipstream')
    let zstream = new ZipStream({ level: 1 })
    zstream.pipe(res)
    Promise.mapSeries(linkData.files, (file) => {
      const fullpath = resolve(join(config.target_dir, file))
      // console.log('add file', file)
      return zstream.addFile(fs.createReadStream(fullpath), { name: file })
    }).then(() => {
      return zstream.finalize()
    }).then(written => {
      console.log('File successfully sended,', written, 'bytes written')
      let dontIncrementCount = false
      if (req.query.token) {
        try {
          if (users[session.username]) {
            dontIncrementCount = true
            console.log('detect logged in user, do not increment downloads counter')
          }
        } catch (error) {}
      }
      if (!dontIncrementCount) {
        const ts = moment().toISOString()
        cursor.assign({ downloadsCount: ++linkData.downloadsCount }).write()
        cursor.defaults({ 'access_log': [] }).get('access_log').push({ ts, ip }).write()
      }
      if (session) console.log(`safe download ${req.params.hash} for ${session.username}`)
      else console.log(`download ${req.params.hash} for ${ip} counter ${linkData.downloadsCount}`)
    })
  })

  app.listen(config.api_port)
  downloadServer.listen(config.download_port)
  console.log(`start server on port ${config.api_port}`)
  console.log(`start download server on port ${config.download_port}`)
}

main()
