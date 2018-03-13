const uuid = require('uuid')
const crypto = require('crypto')
const base32Encode = require('base32-encode')
const moment = require('moment')
var $db, $config

function generateLinkHash (linkData) {
  let hash = crypto.createHmac('sha224', $config['links.secret'])
    .update(linkData.id)
    .update(linkData.email + '') // if null...
    .update(linkData.orderId + '')
    .update(linkData.downloadsLimit.toString())
    .update(linkData.files.join(';'))
    .update(linkData.created_at)
    .digest()
  hash = base32Encode(hash, 'Crockford').toLowerCase()
  return hash
}

class Link {
  constructor (arg) {
    if (typeof arg === 'object') {
      this._data = arg
    } else if (typeof arg === 'string') {
      this._data = $db.get('links').find({ id: arg }).value()
    } else throw new Error('invalid argument')
  }

  get data () { return this._data }
  get isValid () { return !!this.data }
  get isActive () { return this.downloadsCount < this.downloadsLimit }
  get id () { return this.data.id }
  get hash () { return this.data.hash }
  get link () { return this.data.link }
  get email () { return this.data.email }
  get orderId () { return this.data.orderId }
  get downloadsLimit () { return this.data.downloadsLimit }
  get downloadsCount () { return this.data.downloadsCount }
  get downloadsRemain () { return this.downloadsLimit - this.downloadsCount }
  get createdBy () { return this.data.created_by }
  get createdAt () { return this.data.created_at }
  get updatedAt () { return this.data.updated_at }
  get files () { return this.data.files }
  get accessLog () { return this.data.access_log }

  set downloadsCount (downloadsCount) { this._data.downloadsCount = downloadsCount }
  addLog (log) { this._data.access_log.push(log) }

  async save () {
    await $db.get('links').find({ id: this.data.id }).assign(this._data).write()
  }
}

Link.create = async (linkData) => {
  linkData.downloadsLimit = +linkData.downloadsLimit // Force save as Number, not String
  linkData = {
    id: uuid(),
    ...linkData,
    downloadsCount: 0,
    created_at: moment().toISOString(),
    updated_at: moment().toISOString(),
    access_log: []
  }
  linkData.hash = generateLinkHash(linkData)
  linkData.link = `/get/${linkData.hash}/archive.zip`
  await $db.get('links').push(linkData).write()
  return new Link(linkData)
}

class Links {
  async init () {
    await $db.defaults({ links: [] }).write()
  }

  findById (id) { return new Link(id) }
  findByHash (hash) {
    return new Link($db.get('links').find({ hash }).value().id)
  }
  gatAll () { return $db.get('links').value() }

  async add (...args) {
    const linkObj = await Link.create(...args)
    return linkObj
  }
  async remove (id) { await $db.get('links').remove({ id }).write() }
}

module.exports = async ($app) => {
  $db     = $app.$db
  $config = $app.$config
  const $links = new Links()
  await $links.init()
  return $links
}
