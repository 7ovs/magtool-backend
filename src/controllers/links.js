const assert   = require('assert')
const moment   = require('moment')
const FilesTree = require('../lib/files-tree')
const { resolveJoin, delayAsync } = require('../lib/helpers')
const ZipStream = require('../lib/zipstream')
const { unlinkSync, createReadStream, createWriteStream } = require('fs')
const jwt = require('jsonwebtoken')
const { execAsync } = require('../lib/helpers')
// const { dirname } = require('path')
const { Transform } = require('stream')

module.exports = async ($app) => {
  const { $log, $rootdir, $config, $links, $users } = $app

  await execAsync(`rm -rf ${$config['cache_dir']}/*.tmp`)
  await execAsync(`rm -rf ${$config['cache_dir']}/*.zip`)

  const commands = {
    async GET_FILES_LIST () {
      const rootpath = $config['target_dir'][0] === '/'
        ? $config['target_dir']
        : resolveJoin($rootdir, $config['target_dir'])
      const tree = await FilesTree.buildTree({
        root: rootpath,
        fileFilter: ['!.*']
      })
      assert(tree)
      $log.info('LINKS: GET_FILES_LIST - OK!')
      // $log.trace(tree)
      return tree
    },
    async CREATE_LINK (linkData) {
      const linkObj = await $links.add(linkData)
      assert(linkObj.isValid)
      $log.info('LINKS: CREATE_LINK - OK!')
      // $log.trace(linkObj.data)
      return linkObj.data
    },
    async GET_LINKS (linkData) {
      const linksData = $links.gatAll()
      assert(linksData)
      $log.info('LINKS: GET_LINKS - OK!')
      // $log.trace(linksData)
      return linksData
    },
    async DELETE_LINK (id) {
      await $links.remove(id)
      const linksData = $links.gatAll()
      assert(linksData)
      $log.info('LINKS: DELETE_LINK - OK!')
      // $log.trace(linksData)
      return linksData
    },
    async RESET_COUNTER ({id, count}) {
      let linkObj = $links.findById(id)
      linkObj.downloadsCount = parseInt(count, 10) || 0
      await linkObj.save()
      assert(linkObj.isValid)
      $log.info('LINKS: RESET_COUNTER - OK!')
      // $log.trace(linkObj.data)
      return linkObj.data
    }
  }
  async function linksRoute (req, res) {
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

  const cacheTable = {}

  async function cachestream (cacheFile, res) {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(cacheFile)
      // stream.on('data', (data) => { console.log('!!!!!!!!!! cachestream data', data.length) })
      stream.on('end', () => resolve())
      stream.pipe(res)
    })
  }

  // class StreamCounter extends Transform {
  //   constructor (options) {
  //     super(options)
  //     this.counter = 0
  //   }
  //   _transform (chunk, encoding, callback) {
  //     this.counter += chunk.length
  //     console.log('CacheStream read', chunk.length, this.counter)
  //     callback(null, chunk)
  //   }
  // }

  class CacheWriter extends Transform {
    constructor (options) {
      super(options)
      this.cache = createWriteStream(options.cacheFile)
    }
    _transform (chunk, encoding, callback) {
      this.cache.write(chunk)
      callback(null, chunk)
    }
  }

  // async function cachestream2 (cacheFile, res) {
  //   return new Promise((resolve, reject) => {
  //     const sc = new StreamCounter()
  //     const stream = createReadStream(cacheFile).pipe(sc).pipe(res)
  //     stream.on('end', () => resolve())
  //   })
  // }

  setInterval(() => {
    // $log.info(`clean cache start...`, Date.now(), cacheTable)
    for (let hash in cacheTable) {
      const cacheItem = cacheTable[hash]
      if (cacheItem.active === 0 && cacheItem.expiresIn < Date.now()) {
        $log.info(`clean cache for`, hash, cacheTable[hash])
        unlinkSync(cacheTable[hash].cacheFile)
        delete cacheTable[hash]
      }
    }
  }, 60000)

  async function zipstream (hash, res, files) {
    const cacheDir  = $config['cache_dir'][0] === '/'  ? $config['cache_dir']  : resolveJoin($rootdir, $config['cache_dir'])
    const targetDir = $config['target_dir'][0] === '/' ? $config['target_dir'] : resolveJoin($rootdir, $config['target_dir'])

    if (cacheTable[hash]) {
      cacheTable[hash].active++
      while (!cacheTable[hash].size) await delayAsync(250)
      cacheTable[hash].downloads++
      $log.info('cachestream', hash)
      $log.debug(cacheTable[hash])
      await cachestream(cacheTable[hash].cacheFile, res)
      cacheTable[hash].expiresIn = Date.now() + parseInt($config['cache.expires_in'], 10)
      cacheTable[hash].active--
    } else {
      const cacheFile = `${cacheDir}/${hash}.zip`
      cacheTable[hash] = {
        cacheFile,
        downloads: 1,
        active: 1,
        createdAt: Date.now(),
        expiresIn: Date.now() + parseInt($config['cache.expires_in'], 10)
      }
      $log.info('zipstream', hash, cacheTable[hash])
      $log.debug(cacheTable[hash])
      let zs = new ZipStream({ level: 1 })
      const cw = new CacheWriter({ cacheFile })
      zs.pipe(cw).pipe(res)
      for (const file of files) {
        const fullpath = resolveJoin(targetDir, file)
        await zs.addFile(createReadStream(fullpath), { name: file })
      }
      cacheTable[hash].size = await zs.finalize()
      cacheTable[hash].active--
    }
  }

  async function downloadRoute (req, res) {
    try {
      const hash = req.params.hash
      assert(hash, 'invalid arguments')
      const linkObj = $links.findByHash(hash)
      assert(linkObj.isValid, 'not found')

      $log.debug('download', req.headers)

      const session = req.query.token
        ? jwt.verify(req.query.token, $config['session.secret'])
        : undefined

      if (session && $users.hasUser(session.username)) {
        zipstream(hash, res, linkObj.files)
        $log.info(`safe download ${hash} by ${session.username}`)
      } else {
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
        const ts = moment().toISOString()

        // let isReload = false
        // if (req.cookies.dlid) {
        //   try {
        //     const payload = jwt.verify(req.cookies.dlid, $config['links.secret'])
        //     $log.debug('cookie found', req.cookies.dlid, payload)
        //     isReload = payload.hash === hash
        //   } catch (error) {
        //     $log.warn('invlid cookie, skipped')
        //   }
        // }
        // const dlid = jwt.sign({ hash: hash }, $config['links.secret'], { expiresIn: $config['reload_timeout'] })
        // res.cookie('dlid', dlid, { maxAge: $config['reload_timeout'], httpOnly: true, path: dirname(linkObj.link) })
        // $log.debug('cookie set for ', hash, { maxAge: $config['reload_timeout'], httpOnly: true, path: dirname(linkObj.link) })

        if (!cacheTable[hash]) {
          assert(linkObj.isActive, 'download limit exceeded')
          linkObj.downloadsCount++
          linkObj.addLog({ ts, ip })
          await linkObj.save()
          $log.info(`download ${hash} by ${ip} remain ${linkObj.downloadsRemain}`)
        } else {
          linkObj.addLog({ ts, ip })
          await linkObj.save()
          $log.info(`RELOAD(!) download ${hash} by ${ip} remain ${linkObj.downloadsRemain}`)
        }
        zipstream(hash, res, linkObj.files)

        // if (isReload) {
        //   await zipstream(hash, res, linkObj.files)
        //   $log.info(`reload(!) download ${hash} by ${ip} remain ${linkObj.downloadsRemain}`)
        // } else {
        //   assert(linkObj.isActive, 'download limit exceeded')
        //   const dlid = jwt.sign({ hash: hash }, $config['links.secret'], { expiresIn: $config['reload_timeout'] })
        //   res.cookie('dlid', dlid, { maxAge: $config['reload_timeout'], httpOnly: true, path: dirname(linkObj.link) })
        //   $log.debug('cookie set for ', hash, { maxAge: $config['reload_timeout'], httpOnly: true, path: dirname(linkObj.link) })
        //   await zipstream(hash, res, linkObj.files)
        //   linkObj.downloadsCount++
        //   linkObj.addLog({ ts, ip })
        //   await linkObj.save()
        //   $log.info(`download ${hash} by ${ip} remain ${linkObj.downloadsRemain}`)
        // }
      }
    } catch (error) {
      const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
      $log.warn(`download for ip ${ip} fail with error: ${error.message}`)
      res.send(error.message)
    }
  }

  return {
    linksRoute,
    downloadRoute
  }
}
