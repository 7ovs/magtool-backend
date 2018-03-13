const readdirp = require('readdirp')

class FilesTree {
  constructor () {
    this._tree = {}
  }

  _add (tree, pa) {
    if (pa.length === 1) {
      tree[pa[0]] = {
        name: pa[0]
      }
      return tree
    } else {
      if (!tree[pa[0]]) {
        tree[pa[0]] = {
          name: pa[0],
          children: {}
        }
      }
      tree[pa[0]].children = this._add(tree[pa[0]].children, pa.slice(1))
      return tree
    }
  }

  add (entry) {
    let pa = entry.path.split('/')
    this._tree = this._add(this._tree, pa)
  }

  get tree () {
    return this._tree
  }
}

FilesTree.buildTree = (options) => {
  return new Promise((resolve) => {
    const tree = new FilesTree()
    readdirp(options)
      .on('data', entry => tree.add(entry))
      .on('end', () => { resolve(tree.tree)  })
  })
}

module.exports = FilesTree
