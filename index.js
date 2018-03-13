const App = require('./src/App')
async function main () {
  const app = new App(__dirname)
  const ok = await app.init()
  if (ok) app.start()
}

main()
