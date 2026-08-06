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
let clockOffsetMs = 0;

function nowMs() {
  return Date.now() + clockOffsetMs;
}

// Apps Script의 CacheService는 만료 시간을 최대 6시간(21600초)까지만 받는다.
const CACHE_MAX_TTL_SECONDS = 21600;
const CACHE_DEFAULT_TTL_SECONDS = 600;

const CacheService = {
  getScriptCache() {
    return {
      get(key) {
        const entry = cacheStore.get(key);
        if (!entry) return null;
        if (nowMs() >= entry.expiresAt) {
          cacheStore.delete(key);
          return null;
        }
        return entry.value;
      },
      put(key, value, seconds) {
        let ttl = seconds === undefined || seconds === null
          ? CACHE_DEFAULT_TTL_SECONDS
          : Number(seconds);
        if (!(ttl > 0)) ttl = CACHE_DEFAULT_TTL_SECONDS;
        if (ttl > CACHE_MAX_TTL_SECONDS) ttl = CACHE_MAX_TTL_SECONDS;
        cacheStore.set(key, { value: String(value), expiresAt: nowMs() + ttl * 1000 });
      },
      remove(key) {
        cacheStore.delete(key);
      },
    };
  },
};

/** 테스트에서 시간이 흐른 상황을 만든다. */
function advanceClock(ms) {
  clockOffsetMs += ms;
}

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

const lockCalls = { waits: 0, releases: 0 };

const LockService = {
  getScriptLock() {
    return {
      waitLock(timeoutMs) {
        lockCalls.waits += 1;
        return true;
      },
      releaseLock() {
        lockCalls.releases += 1;
      },
    };
  },
};

function lockStats() {
  return { waits: lockCalls.waits, releases: lockCalls.releases };
}

function installGlobals() {
  global.Utilities = Utilities;
  global.CacheService = CacheService;
  global.PropertiesService = PropertiesService;
  global.ContentService = ContentService;
  global.LockService = LockService;
}

function resetShim() {
  cacheStore.clear();
  propertyStore.clear();
  clockOffsetMs = 0;
  lockCalls.waits = 0;
  lockCalls.releases = 0;
}

module.exports = {
  Utilities,
  CacheService,
  PropertiesService,
  ContentService,
  LockService,
  toSigned,
  toBuffer,
  installGlobals,
  resetShim,
  advanceClock,
  lockStats,
};
