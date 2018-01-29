var timeout = async (timeoutValue) => {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutValue)
  })
}

module.exports = {
  timeout
}
