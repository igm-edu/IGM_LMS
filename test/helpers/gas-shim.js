'use strict';

const crypto = require('node:crypto');

function toSigned(buf) {
  const out = new Array(buf.length);
  for (let i = 0; i < buf.length; i += 1) {
    out[i] = buf[i] > 127 ? buf[i] - 256 : buf[i];
  }
  return out;
}

function toBuffer(value) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return Buffer.from(value.map((b) => (b < 0 ? b + 256 : b)));
}

const Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  computeHmacSha256Signature(value, key) {
    return toSigned(
      crypto.createHmac('sha256', toBuffer(key)).update(toBuffer(value)).digest()
    );
  },
  computeDigest(_algorithm, value) {
    return toSigned(crypto.createHash('sha256').update(toBuffer(value)).digest());
  },
  getUuid() {
    return crypto.randomUUID();
  },
  newBlob(value) {
    const buf = Buffer.from(String(value), 'utf8');
    return { getBytes: () => toSigned(buf) };
  },
};

const cacheStore = new Map();
const CacheService = {
  getScriptCache() {
    return {
      get: (key) => (cacheStore.has(key) ? cacheStore.get(key) : null),
      put: (key, value) => { cacheStore.set(key, String(value)); },
      remove: (key) => { cacheStore.delete(key); },
    };
  },
};

const propertyStore = new Map();
const PropertiesService = {
  getScriptProperties() {
    return {
      getProperty: (key) => (propertyStore.has(key) ? propertyStore.get(key) : null),
      setProperty: (key, value) => { propertyStore.set(key, String(value)); },
      deleteProperty: (key) => { propertyStore.delete(key); },
    };
  },
};

function installGlobals() {
  global.Utilities = Utilities;
  global.CacheService = CacheService;
  global.PropertiesService = PropertiesService;
}

function resetShim() {
  cacheStore.clear();
  propertyStore.clear();
}

module.exports = {
  Utilities,
  CacheService,
  PropertiesService,
  toSigned,
  toBuffer,
  installGlobals,
  resetShim,
};
