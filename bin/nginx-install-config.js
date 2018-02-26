const fs = require('fs')
const { resolve, join } = require('path')
const cfg = {
  ...require(`../etc/config.json`),
  ...require(`../etc/config.production.json`)
}

const nginxConfig =
`upstream nodeapi {
  server ${cfg.api_host}:${cfg.api_port};
}

upstream nodedownload {
  server ${cfg.download_host}:${cfg.download_port};
}

server {
  listen 80;
  server_name ${cfg.api_domain};
  if ($scheme != "https") {
    return 301 https://$host$request_uri;
  }
}

server {
  listen 443 ssl;
  server_name ${cfg.api_domain};

  ssl on;
  ssl_certificate     /etc/letsencrypt/live/api.obitel-minsk.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.obitel-minsk.com/privkey.pem;

  ssl_session_cache   shared:SSL:20m;
  ssl_session_timeout 10m;

  ssl_prefer_server_ciphers on;
  ssl_protocols             TLSv1 TLSv1.1 TLSv1.2;
  ssl_ciphers               ECDH+AESGCM:DH+AESGCM:ECDH+AES256:DH+AES256:ECDH+AES128:DH+AES:ECDH+3DES:DH+3DES:RSA+AESGCM:RSA+AES:RSA+3DES:!aNULL:!MD5:!DSS;

  add_header Strict-Transport-Security "max-age=31536000";

  # include /etc/nginx/snippets/letsencrypt-webroot.conf;

  location / {
    proxy_pass http://nodeapi;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

server {
  listen 80;
  server_name ${cfg.download_domain};

  location / {
    proxy_pass http://nodedownload;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}`

const configFilePath = resolve(join(__dirname, '..', 'var/magtool.nginx.conf'))
const sitesAvailable = resolve(join('/etc/nginx', 'sites-available/magtool'))
const sitesEnabled = resolve(join('/etc/nginx', 'sites-enabled/magtool'))
fs.writeFileSync(configFilePath, nginxConfig, 'utf-8')
if (fs.existsSync(sitesAvailable)) fs.unlinkSync(sitesAvailable)
if (fs.existsSync(sitesEnabled)) fs.unlinkSync(sitesEnabled)
fs.linkSync(configFilePath, sitesAvailable)
fs.linkSync(configFilePath, sitesEnabled)
