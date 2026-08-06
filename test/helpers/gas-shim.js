'use strict';

const crypto = require('node:crypto');

function toSigned(buf) {
  const out = new Array(buf.length);
  for (let i = 0; i < buf.length; i += 1) {
    out[i] = buf[i] > 127 ? buf[i] - 256 : buf[i];
  }
  return out;
}

// Apps Script의 바이트 배열은 Java의 signed byte(-128..127)다. NaN이나 범위를 벗어난
// 값을 넘기면 실제 런타임은 변환에 실패한다. Node의 Buffer.from은 그런 값을 조용히
// 0으로 바꿔버리므로, 대역이 실제보다 관대해지지 않도록 여기서 막는다.
function toBuffer(value) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return Buffer.from(
    value.map((b) => {
      if (!Number.isInteger(b) || b < -128 || b > 127) {
        throw new Error('바이트 배열에 올바르지 않은 값이 있습니다: ' + b);
      }
      return b < 0 ? b + 256 : b;
    })
  );
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

const ContentService = {
  MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
  createTextOutput(content) {
    let mimeType = 'text/plain';
    const output = {
      getContent: () => content,
      getMimeType: () => mimeType,
      setMimeType(type) {
        mimeType = type;
        return output;
      },
    };
    return output;
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
  global.ContentService = ContentService;
}

function resetShim() {
  cacheStore.clear();
  propertyStore.clear();
}

module.exports = {
  Utilities,
  CacheService,
  PropertiesService,
  ContentService,
  toSigned,
  toBuffer,
  installGlobals,
  resetShim,
};
