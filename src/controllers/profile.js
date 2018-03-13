const assert = require('assert')
const jwt = require('jsonwebtoken')

module.exports = async ($app) => {
  const { $log, $users, $config } = $app

  const commands = {
    async CHANGE_PASSWORD (data, session) {
      const user = $users.getUser(session.username)
      assert(user, 'user not found')
      await user.changePassword(data.password, data.new_password)
      $log.info('PROFILE: CHANGE_PASSWORD - OK!')
      return null
    }
  }

  return async function (req, res) {
    try {
      assert(req.body)
      const { command, data } = req.body
      assert(commands[command])
      const token = req.headers['x-access-token']
      if (!token) throw (new Error('token is required'))
      const session = jwt.verify(token, $config['session.secret'])
      const result = await commands[command](data, session)
      res.success(result)
    } catch (error) {
      res.error(error.message)
    }
  }
}
