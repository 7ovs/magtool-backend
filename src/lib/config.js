const ENV = process.env.NODE_ENV || 'development'
const $config = {
  ...require(`../config/config.json`),
  ...require(`../config/${ENV}.config.json`)
}
module.exports = $config
