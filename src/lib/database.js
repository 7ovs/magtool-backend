const low = require('lowdb')
const FileAsync = require('lowdb/adapters/FileAsync')

module.exports = async ($app) => {
  const adapter = new FileAsync($app.$config['db.path'])
  const db = await low(adapter)
  return db
}
