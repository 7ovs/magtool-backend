const assert = require('assert')
const { hasherAsync } = require('../lib/helpers')
var $db

class User {
  constructor (name) {
    this._data = $db.get('users').find({ name }).value()
  }

  get data () { return this._data }
  get isValid () { return !!this.data }
  get name () { return this.data.name }
  get hash () { return this.data.hash }
  set hash (hash) { this._data.hash = hash }
  get salt () { return this.data.salt }

  async save () {
    await $db.get('links')
      .find({ name: this.data.name })
      .assign(this._data)
      .write()
  }

  async changePassword (password, newPassword) {
    const current = await hasherAsync({ password, salt: this.salt })
    assert(current.hash === this.hash, 'invalid user or password')
    const updated = await hasherAsync({ password: newPassword, salt: this.salt })
    this.hash = updated.hash
    await this.save()
  }
}

class Users {
  async init () { await $db.defaults({ users: [] }).write() }
  async refrash () { await $db.read() }
  getUser (name) {
    return new User(name)
  }
  hasUser (name) { return !!$db.get('users').find({ name }) }
}

module.exports = async ($app) => {
  $db = $app.$db
  const $users = new Users()
  await $users.init()
  return $users
}
