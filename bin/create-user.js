var path = require('path')
var RedisStore = require('../lib/store')
var config = require('../etc/config.json')
var hash = require('pbkdf2-password')()
var { timeout } = require('../lib/util')

var readInput = async () => {
  var question = async (query, password = false) => {
    return new Promise((resolve, reject) => {
      var result = ''
      process.stdin.setEncoding('utf8')
      process.stdin.setRawMode(true)
      process.stdout.write(query)
      const onReadable = () => {
        const chunk = process.stdin.read()
        if (chunk !== null) {
          if (chunk === '\n' || chunk === '\r' || chunk === '\u0004') {
            process.stdout.write('\n')
            process.stdin.setRawMode(false)
            process.stdin.removeListener('readable', onReadable)
            resolve(result)
          } else if (chunk === '\u0003') {
            process.stdout.write('\n')
            process.stdin.setRawMode(false)
            process.stdin.removeListener('readable', onReadable)
            reject(new Error('Input interrupted'))
          } else {
            result += chunk
            if (password) {
              process.stdout.write('*')
            } else {
              process.stdout.write(chunk)
            }
          }
        }
      }
      process.stdin.on('readable', onReadable)
    })
  }

  var result = {}

  try {
    result.username = await question('username : ')
    result.password = await question('password : ', true)
  } catch (error) {
    process.stdin.emit('end')
    throw error
  }

  process.stdin.emit('end')

  return result
}

var createHash = async (password) => {
  return new Promise((resolve, reject) => {
    hash({ password }, (err, pass, salt, hash) => {
      if (err) throw reject(err)
      resolve({ salt, hash })
    })
  })
}

var main = async () => {
  if (!require('fs').existsSync(path.resolve(path.join(__dirname, '..', config.redis.pidfile)))) {
    await RedisStore.startSrever(config.redis)
    await timeout(500)
  } else {
    console.log('server already started')
  }

  var store = new RedisStore(config.redis)

  try {
    const { username, password } = await readInput()

    const userobj = {
      name: username,
      ...await createHash(password)
    }

    await store.setMapVal('users', username, userobj)

    console.log('OK!', userobj)
  } catch (error) {
    console.error(error.message)
  }

  RedisStore.stopServer()
}

main()
