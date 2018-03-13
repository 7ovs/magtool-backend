const { resolve, join } = require('path')
const hasher = require('pbkdf2-password')()
const { exec } = require('child_process')

module.exports = {
  resolveJoin: (...args) => resolve(join(...args)),
  hasherAsync: (options) => {
    return new Promise((resolve, reject) => {
      hasher(options, (err, pass, salt, hash) => {
        if (err) reject(new Error(err))
        resolve({ pass, salt, hash })
      })
    })
  },
  execAsync: (...args) => {
    return new Promise((resolve, reject) => {
      exec(...args, (error, stdout, stderr) => {
        if (error) reject(new Error(error))
        return resolve(stdout)
      })
    })
  },
  delayAsync: (timeout) => {
    return new Promise((resolve) => {
      setTimeout(() => { resolve() }, timeout)
    })
  }
}
