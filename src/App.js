const express = require('express')
const cors = require('cors')
// const cookieParser = require('cookie-parser')

module.exports = class App {
  constructor (rootdir) {
    this.$rootdir = rootdir
    this.$config = require('./lib/config')
    this.$log = require('loglevel')
    this.$log.setLevel(this.$config.loglevel)
    this.apiServer = express()
    this.apiServer.use((req, res, next) => {
      res.success = (data) => res.json({ status: 'OK', data })
      res.error = (error) => res.json({ status: 'FAIL', error })
      next()
    })
    this.dlServer = express()
    this.apiServer.use(cors({
      // origin: this.$config.frontend_origin,
      // optionsSuccessStatus: 200
    }))
  }

  async init () {
    try {
      const jsonParser = require('body-parser').json()

      this.$db    = await require('./lib/database')(this)
      this.$users = await require('./models/users')(this)
      this.$links = await require('./models/links')(this)

      const { loginRoute, regenRoute, checkAuth } = await require('./controllers/auth')(this)
      const { linksRoute, downloadRoute } = await require('./controllers/links')(this)
      const controlRoute = await require('./controllers/control')(this)
      const profileRoute = await require('./controllers/profile')(this)
      const mailerRoute  = await require('./controllers/mailer')(this)

      this.apiServer.post('/login', jsonParser, loginRoute)
      this.apiServer.post('/regen', jsonParser, regenRoute)

      this.apiServer.post('/control', checkAuth, jsonParser, controlRoute)
      this.apiServer.post('/links',   checkAuth, jsonParser, linksRoute)
      this.apiServer.post('/profile', checkAuth, jsonParser, profileRoute)
      this.apiServer.post('/mailer',  checkAuth, jsonParser, mailerRoute)

      // this.dlServer.use(cookieParser())
      this.dlServer.get('/get/:hash/:filename*?', downloadRoute)
    } catch (error) {
      this.$log.error('App init FAIL:', error)
      return false
    }
    return true
  }

  start () {
    try {
      this.apiServer.listen(this.$config.api_port)
      this.dlServer.listen(this.$config.download_port)
      this.$log.info(`start server on port ${this.$config.api_port}`)
      this.$log.info(`start download server on port ${this.$config.download_port}`)
    } catch (error) {
      this.$log.error('Start servers FAIL:', error.message)
    }
  }
}
