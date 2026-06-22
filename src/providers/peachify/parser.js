const { webcrypto } = require('crypto');
const logger = require('../../logger');

/**
 * Decode base64 URL safe string to Uint8Array
 */
function dC(e) {
  let t = e.replace(/-/g, "+").replace(/_/g, "/"),
      i = t.length % 4 == 0 ? "" : "=".repeat(4 - t.length % 4),
      r = Buffer.from(t + i, 'base64').toString('binary'),
      s = new Uint8Array(r.length);
  for (let e = 0; e < r.length; e++) {
    s[e] = r.charCodeAt(e);
  }
  return s;
}

/**
 * Import raw hexadecimal key as AES-GCM CryptoKey
 */
async function dP(e) {
  let t = new Uint8Array(e.match(/.{1,2}/g).map(e => parseInt(e, 16)));
  return await webcrypto.subtle.importKey("raw", t, {name: "AES-GCM"}, false, ["decrypt"]);
}

/**
 * Decrypt AES-GCM cipher data (e.g. Peachify tokens)
 */
async function dD(e, t) {
  try {
    let [i, r, s] = e.split(".");
    let n = dC(i),
        a = dC(r),
        l = dC(s);
    let o = new Uint8Array(a.length + l.length);
    o.set(a, 0);
    o.set(l, a.length);
    let u = await dP(t);
    let d = await webcrypto.subtle.decrypt({name: "AES-GCM", iv: n}, u, o);
    let h = new TextDecoder().decode(d);
    return JSON.parse(h);
  } catch (err) {
    logger.warn(`Decryption failed: ${err.message}`);
    return null;
  }
}

module.exports = {
  dC,
  dP,
  dD
};
