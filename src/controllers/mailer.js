const assert = require('assert')
const nodemailer = require('nodemailer')

/* eslint-disable handle-callback-err */

function createTestAccountAsync () {
  return new Promise((resolve, reject) => {
    nodemailer.createTestAccount((err, account) => {
      if (err) reject(err)
      resolve(account)
    })
  })
}

function sendMailAsync (mailerOptions, mailOptions) {
  return new Promise((resolve, reject) => {
    let transporter = nodemailer.createTransport(mailerOptions)
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) reject(error)
      resolve(info)
    })
  })
}

module.exports = async ($app) => {
  const { $log, $rootdir, $config } = $app

  const commands = {
    async SEND_MAIL ({ email, title, body }) {
      assert(email, 'email is required')
      assert(title, 'email title is required')
      assert(body, 'email body is required')

      const account = await createTestAccountAsync()
      const info = await sendMailAsync({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,        // true for 465, false for other ports
        auth: {
          user: account.user, // generated ethereal user
          pass: account.pass  // generated ethereal password
        }
      }, {
        from:    'st.elisabeth.shop@gmail.com', // sender address
        to:      email,  // list of receivers
        subject: title,  // Subject line
        text:    body    // plain text body
      })
      console.log('mailer result', info)
      console.log(nodemailer.getTestMessageUrl(info))
      return info
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
