const assert = require('assert')
const jwt = require('jsonwebtoken')
const {hasherAsync} = require('../lib/helpers')

module.exports = async ($app) => {
  const { $users, $config, $log } = $app

  function getToken (username) {
    assert($users.hasUser(username), 'user not found')
    return jwt.sign({ username: username }, $config['session.secret'],
      { expiresIn: $config['session.expires_in'] })
  }

  async function auth (name, password) {
    await $users.refrash()
    const user = $users.getUser(name)
    assert(user, 'cannot find user')
    const { hash } = await hasherAsync({ password, salt: user.salt })
    assert(hash === user.hash, 'invalid username or password')
    return user
  }

  function checkAuth (req, res, next) {
    try {
      const token = req.headers['x-access-token']
      assert(token, 'login is required')
      const session = jwt.verify(token, $config['session.secret'])
      assert($users.hasUser(session.username), 'user not found')
      next()
    } catch (error) {
      res.error(error.message)
    }
  }

  async function loginRoute (req, res) {
    try {
      const data = req.body
      if (!data) throw new Error('invalid request')
      const user = await auth(data.username, data.password)
      const token = getToken(user.name)
      $log.info('login ', user.name)
      res.json({ status: 'OK', token })
    } catch (error) {
      res.error(error.message)
    }
  }

  function regenRoute (req, res) {
    try {
      const token = req.headers['x-access-token']
      assert(token, 'token not found')
      const session = jwt.verify(token, $config['session.secret'])
      const newToken = getToken(session.username)
      res.json({ status: 'OK', token: newToken })
    } catch (error) {
      res.error(error.message)
    }
  }

  return {
    checkAuth,
    loginRoute,
    regenRoute
  }
}
