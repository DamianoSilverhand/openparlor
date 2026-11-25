// Optional HTTPS. Pages served over https (or from localhost) are "secure contexts", which unlocks the service worker
// (offline Solo Practice and a fast start), the install prompt and the real Screen Wake Lock. Plain http://192.168.x.x
// pages are not secure contexts, so these features are off there. See docs/PWA.md.
//
// A certificate and key are used when:
//   HTTPS_CERT and HTTPS_KEY (or https.cert and https.key in the config) point at files, or
//   data/certs/cert.pem and data/certs/key.pem exist (made by `npm run cert`).
// If they were set explicitly and cannot be read, the server refuses to start rather than silently falling back to http.
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

function loadTls() {
  const explicitCert = process.env.HTTPS_CERT || config.https.cert;
  const explicitKey = process.env.HTTPS_KEY || config.https.key;
  const dir = path.join(config.dataDir, 'certs');
  const certFile = explicitCert || path.join(dir, 'cert.pem');
  const keyFile = explicitKey || path.join(dir, 'key.pem');
  const explicit = !!(explicitCert || explicitKey);
  if (!explicit && !(fs.existsSync(certFile) && fs.existsSync(keyFile))) return null;
  try {
    if (!explicitCert || !explicitKey) {
      if (explicit) throw new Error('both a certificate and a key are needed (HTTPS_CERT and HTTPS_KEY)');
    }
    return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile), certFile };
  } catch (err) {
    if (explicit) {
      console.error(`\nCould not load the HTTPS certificate: ${err.message}\nFix HTTPS_CERT and HTTPS_KEY, or unset them to run on plain http.\n`);
      process.exit(1);
    }
    console.error(`[https] ignoring ${certFile}: ${err.message}`);
    return null;
  }
}

module.exports = { loadTls };
