'use strict';

let originalFetch;
let recorded = [];

/** handler(url, options) -> { status?, text } 또는 Error를 던져 네트워크 오류를 흉내낸다. */
function installFetch(handler) {
  originalFetch = global.fetch;
  recorded = [];
  global.fetch = async function (url, options) {
    recorded.push({ url, options });
    const result = await handler(url, options, recorded.length);
    return {
      status: result.status === undefined ? 200 : result.status,
      text: async () => result.text,
    };
  };
}

function restoreFetch() {
  global.fetch = originalFetch;
}

function requests() {
  return recorded;
}

function lastRequest() {
  return recorded[recorded.length - 1];
}

const store = new Map();

function installLocalStorage() {
  global.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
}

function resetLocalStorage() {
  store.clear();
}

module.exports = {
  installFetch,
  restoreFetch,
  requests,
  lastRequest,
  installLocalStorage,
  resetLocalStorage,
};
