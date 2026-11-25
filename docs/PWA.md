# Installing as an app, staying awake, and offline use

OpenParlor can be added to a phone's home screen and opened full screen, like an app. How much it can do depends on whether the page is served over **https** or plain **http**.

## Plain http (the default)

`http://192.168.1.20:3100` is not a "secure context", so browsers switch some features off. Everything else works.

| Feature | Plain http | https (or localhost) |
|---|---|---|
| Add to home screen, app icon, full-screen window | Yes (as a shortcut) | Yes (as an installable app, with an Install prompt) |
| Live rooms: TV, phones, QR code | Yes | Yes |
| Reconnect after a locked phone or a Wi-Fi blip, with a banner | Yes | Yes |
| Screen stays awake | Best effort (see below) | Yes, with the browser's wake lock |
| Solo Practice without a connection | No | Yes |
| Starts instantly with no connection | No | Yes |

### Add to home screen

- **iPhone or iPad (Safari):** tap Share, then **Add to Home Screen**.
- **Android (Chrome):** open the menu, then **Install app** or **Add to Home screen**.

The icon and name follow the `brand` in your config.

### Keeping the screen on

The big screen should not go to sleep in the middle of a game, and neither should phones.

- Over https the browser's **Screen Wake Lock** is used.
- Over plain http that API is not available, so a tiny silent looping video is played from the first tap instead (the same trick as the NoSleep library; the video is made in the browser, nothing is downloaded). Click or tap once on the page after it loads.
- Some TV browsers ignore the video. **The dependable fix is to turn off the screen timeout on the TV or laptop**: set the display to "never sleep" and turn off the screensaver, at least while you play. On a laptop, plug it in.

### If the connection drops

A phone that locks, switches networks or loses Wi-Fi reconnects on its own and rejoins its seat. A banner at the top of the screen says "Reconnecting..." if it takes more than a moment. A heartbeat every 15 seconds notices a connection that died silently (for example after the phone was asleep) and reconnects.

## Turning on https

Over https you get the service worker, offline Solo Practice, the install prompt and the real wake lock. It is optional, because phones must trust the certificate.

1. Make a certificate for this computer:

        npm run cert

   It uses [mkcert](https://github.com/FiloSottile/mkcert) if it is installed, and otherwise `openssl` to make a self-signed certificate. The files go in `data/certs/`.
2. Restart the server. When `data/certs/cert.pem` and `key.pem` exist, it serves https on the same port, and prints `https://` addresses. The QR code on the TV uses them too.
3. Make the phones trust it. With a self-signed certificate every browser shows a warning that you click through once, and some features may stay blocked. With mkcert the warning goes away if you install mkcert's root certificate on each phone:
   - Run `mkcert -CAROOT` to find `rootCA.pem`, and send it to the phone.
   - **iPhone:** open the file, install the profile in Settings, then turn it on under Settings > General > About > Certificate Trust Settings.
   - **Android:** Settings > Security > Encryption and credentials > Install a certificate > CA certificate.

To use your own certificate (for example from a reverse proxy or a real domain) set `HTTPS_CERT` and `HTTPS_KEY` to the file paths, or `https.cert` and `https.key` in `config/local.json`. If you set them and the files cannot be read, the server stops with a message instead of quietly falling back to http. You can also put OpenParlor behind a reverse proxy such as Caddy that handles https for you.

Guests who are not on your own devices will see a certificate warning. For a party with visitors, plain http is usually the easier choice.

## Offline Solo Practice (https only)

When the page is secure, a service worker stores the home page, Solo Practice, the scores page, the mini-games and their word lists the first time you open the site. After that:

- Opening the site with no connection shows the stored copy.
- Solo Practice works with the profiles saved on that device.
- A finished game is applied to your saved profile at once, so "New personal best!" and your streak work offline, and the result is put in a queue on the device.
- The queue is sent when the connection is back, in order. Each result has its own id, so a result that was sent but whose answer was lost is never counted twice. Results keep the day they were played, so streaks are right. A result for a profile that was deleted meanwhile is dropped.
- The screen says "Saved on this device" until it has been sent.

What does not work offline: live rooms (they need the server), and adding a new person (the server makes the profile).

Online, every file is fetched fresh from the server, and the stored copy is only used when the network fails, so after you update the server nobody is left running old screens.

## For developers

- `public/sw.js` is the service worker, `public/shared/pwa.js` registers it (only on secure pages), and `GET /api/precache` lists what it stores, with a version that changes whenever any of those files change.
- `public/shared/offline.js` holds the local copy of profiles and the queue.
- `public/shared/net.js` is the reconnecting socket, and `public/shared/wake.js` keeps the screen awake.
- `npm run icons` redraws the icons in `public/icons/` (no image tools needed).
- Browsers will not register a service worker for a plain `http://192.168.x.x` address, so test the service worker on `http://localhost` or over https. The tests exercise the worker's logic in a simulated environment, because the test run has no browser.
