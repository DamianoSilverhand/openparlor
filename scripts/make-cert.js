#!/usr/bin/env node
// Makes a certificate so the server can run on https (npm run cert). The server picks it up from data/certs/.
//
// Best: mkcert (https://github.com/FiloSottile/mkcert). It makes a certificate your own devices can trust once their
// phones install its root certificate. If mkcert is not installed this falls back to openssl, which makes a
// self-signed certificate: it works, but every browser shows a warning that you must click through once.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('../server/config'); // for DATA_DIR
const { config } = require('../server/config');

const dir = path.join(config.dataDir, 'certs');
const cert = path.join(dir, 'cert.pem');
const key = path.join(dir, 'key.pem');
const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4').map((i) => i.address);
const names = ['localhost', '127.0.0.1', ...ips.filter((ip) => ip !== '127.0.0.1'), os.hostname()];

fs.mkdirSync(dir, { recursive: true });
const has = (cmd) => spawnSync(cmd, ['-help'], { stdio: 'ignore' }).error === undefined;

if (spawnSync('mkcert', ['-version'], { stdio: 'ignore' }).status === 0) {
  const r = spawnSync('mkcert', ['-cert-file', cert, '-key-file', key, ...names], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
  console.log('\nmkcert made the certificate. If you have not yet, run "mkcert -install" on this computer, and install the');
  console.log('root certificate on your phones (run "mkcert -CAROOT" to find rootCA.pem). See docs/PWA.md.');
} else if (has('openssl')) {
  const san = names.map((n, i) => (/^[\d.]+$/.test(n) ? `IP.${i + 1} = ${n}` : `DNS.${i + 1} = ${n}`)).join('\n');
  const conf = path.join(dir, 'openssl.cnf');
  fs.writeFileSync(conf, `[req]\ndistinguished_name = dn\nx509_extensions = v3\nprompt = no\n[dn]\nCN = localhost\n[v3]\nsubjectAltName = @alt\n[alt]\n${san}\n`);
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-keyout', key, '-out', cert, '-config', conf], { stdio: 'inherit' });
  fs.rmSync(conf, { force: true });
  if (r.status !== 0) process.exit(r.status || 1);
  console.log('\nmkcert is not installed, so this is a self-signed certificate: browsers will warn on first visit.');
  console.log('Install mkcert (https://github.com/FiloSottile/mkcert) and run this again for a smoother setup.');
} else {
  console.error('Neither mkcert nor openssl was found. Install one of them, or supply your own certificate with HTTPS_CERT and HTTPS_KEY.');
  process.exit(1);
}
console.log(`\nCertificate: ${cert}\nKey: ${key}\nRestart the server and it will use https. Valid for: ${names.join(', ')}`);
