const assert = require('assert')
const { resolveJoin, execAsync } = require('../lib/helpers')

module.exports = async ($app) => {
  const { $log, $rootdir, $config } = $app

  const commands = {
    PING () {
      return 'PONG'
    },
    async RESET_APACHE () {
      const stdout = await execAsync('sudo /usr/sbin/service apache2 restart')
      $log.info('CONTROL: RESET_APACHE - OK!')
      $log.trace(stdout)
      return null
    },
    async RESET_VARNISH () {
      const stdout = await execAsync('sudo /usr/sbin/service varnish restart')
      $log.info('CONTROL: RESET_VARNISH - OK!')
      $log.trace(stdout)
      return null
    },
    async CLEAN_CACHE () {
      let stdout = await execAsync('sudo /var/www/magento21/bin/magento cache:flush',
        { cwd: '/var/www/magento21' })
      $log.trace(stdout)
      stdout = execAsync('sudo /usr/sbin/service varnish restart')
      $log.info('CONTROL: CLEAN_CACHE - OK!')
      $log.trace(stdout)
      return null
    },
    async GET_LOG (count) {
      if (!count) count = 100
      const logPath = resolveJoin($rootdir, $config['log_file'])
      const stdout = await execAsync(`tail -n ${count} ${logPath}`)
      if (stdout.trim() === '') return []
      return stdout.trim().split('\n').map(it => JSON.parse(it.trim()))
    }
  }

  return async function (req, res) {
    try {
      assert(req.body)
      const { command, data } = req.body
      assert(commands[command])
      const result = await commands[command](data)
      res.success(result)
    } catch (error) {
      res.error(error.message)
    }
  }
}
