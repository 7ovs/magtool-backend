var _ = require('lodash')
var redis = require('redis')
var Promise = require('bluebird')
var path = require('path')

const DEFAULT_REDIS_PORT = 6400
const DEFAULT_REDIS_DBFILENAME = 'data.rdb'
const DEFAULT_REDIS_DB_DIR = path.resolve('../var/db')
const DEFAULT_REDIS_PID_PATH = path.resolve('../var/pid/redis.pid')
const DEFAULT_REDIS_CONFIG = [
  `port ${DEFAULT_REDIS_PORT}`,
  `bind 127.0.0.1`,
  `loglevel notice`,
  `databases 1`,
  `save 300 1`,
  `save 60 100`,
  `dir ${DEFAULT_REDIS_DB_DIR}`,
  `dbfilename ${DEFAULT_REDIS_DBFILENAME}`,
  `pidfile ${DEFAULT_REDIS_PID_PATH}`
].join('\n')

var _server = null
var _client = null

Promise.promisifyAll(redis.RedisClient.prototype)
Promise.promisifyAll(redis.Multi.prototype)

const pack = (items) => { return items.map(it => { return JSON.stringify(it) }) } // eslint-disable-line
const unpack = (items) => { return items.map(it => { return JSON.parse(it) }) }

const packMap = (obj) => {
  let res = {}
  for (let key in obj) {
    res[key] = JSON.stringify(obj[key])
  }
  return res
}

const unpackMap = (obj) => {
  let res = {}
  for (let key in obj) {
    res[key] = JSON.parse(obj[key])
  }
  return res
}

class RedisStore {
  constructor (config) {
    this.prefix = config.prefix ? `${config.prefix}.` : ''

    if (!_client) {
      console.log('start redis client')
      _client = redis.createClient(config.port || DEFAULT_REDIS_PORT)
    }

    this.rdb = _client
  }

  _getMapKey (name) {
    return `${this.prefix}map.${_.kebabCase(name)}`
  }

  _getKey (name) {
    return `${this.prefix}value.${_.kebabCase(name)}`
  }

  async setMap (name, map) {
    const key = this._getMapKey(name)
    await this.rdb.multi()
      .del(key)
      .hmset(key, packMap(map))
      .execAsync()
    return true
  }

  async delMap (name) {
    const key = this._getMapKey(name)
    await this.rdb.delAsync(key)
    return true
  }

  async setMapVal (name, hkey, val) {
    const key = this._getMapKey(name)
    await this.rdb.hsetAsync(key, hkey, JSON.stringify(val))
    return true
  }

  async getMapVal (name, hkey) {
    const key = this._getMapKey(name)
    let result = await this.rdb.hgetAsync(key, hkey)
    result = JSON.parse(result)
    return result
  }

  async getMapKeys (name) {
    const key = this._getMapKey(name)
    let result = await this.rdb.hkeysAsync(key)
    return result
  }

  async getMapVals (name) {
    const key = this._getMapKey(name)
    let result = await this.rdb.hvalsAsync(key)
    result = unpack(result)
    return result
  }

  async getMap (name) {
    const key = this._getMapKey(name)
    let result = await this.rdb.hgetallAsync(key)
    result = unpackMap(result)
    return result
  }

  async setValue (name, value) {
    const key = this._getKey(name)
    await this.rdb.setAsync(key, JSON.stringify(value))
    return true
  }

  async getValue (name) {
    const key = this._getKey(name)
    let result = await this.rdb.getAsync(key)
    result = JSON.parse(result)
    return result
  }
}

var generateConfig = (config) => {
  if (!config) {
    return DEFAULT_REDIS_CONFIG
  }
  let result = []
  result.push(`port ${config.port || DEFAULT_REDIS_PORT}`)
  result.push(`dbfilename ${config.dbfilename || DEFAULT_REDIS_DBFILENAME}`)
  if (config.bind) result.push(`bind ${config.bind}`)
  if (config.loglevel) result.push(`loglevel ${config.loglevel}`)
  if (config.dir) result.push(`dir ${path.resolve(path.join('../', config.dir))}`)
  if (config.pidfile) result.push(`pidfile ${path.resolve(path.join('../', config.pidfile))}`)
  result.push(`databases 1`)
  result.push(`save 300 1`)
  result.push(`save 60 100`)
  return result.join('\n')
}

RedisStore.startSrever = async (config) => {
  console.log(config)
  let configString = generateConfig(config)
  console.log(configString)
  return new Promise((resolve, reject) => {
    var complete = false
    const { spawn } = require('child_process')
    _server = spawn('redis-server', ['-'], { cwd: '../' })
    process.stdin.setEncoding('utf8')
    _server.stdin.write(configString)
    _server.stdin.end()
    _server.stdout.on('data', (data) => {
      data = data.toString().trim().split('\n').map(s => { return `  REDIS: ${s}` }).join('\n')
      process.stdout.write(data + '\n')
      if (!complete) { resolve() }
    })
    _server.on('close', (code) => { process.stdout.write(`redis server exited with code ${code}\n`) })
    console.log('start redis server')
    process.on('SIGINT', () => {
      setTimeout(() => { process.exit(0) }, 100)
    })
  })
}

RedisStore.stopServer = () => {
  _client.end(true)
  _client = null
  if (!_server) {
    return
  }
  _server.kill()
  _server = null
}

module.exports = RedisStore
