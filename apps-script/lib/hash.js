/**
 * 비밀번호 해싱과 토큰 생성.
 * Apps Script에는 bcrypt류 라이브러리가 없어 PBKDF2-HMAC-SHA256을 직접 구현한다.
 */

/**
 * 반복 횟수. 실제 환경에서 benchmarkHash()로 측정한 뒤 조정한다.
 * 로그인 응답이 1초를 넘지 않는 선에서 가장 큰 값을 쓴다.
 */
var HASH_ITERATIONS = 10000;

function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function hexToBytes_(hex) {
  var out = [];
  for (var i = 0; i + 1 < hex.length; i += 2) {
    var b = parseInt(hex.substr(i, 2), 16);
    out.push(b > 127 ? b - 256 : b);
  }
  return out;
}

function strToBytes_(value) {
  return Utilities.newBlob(String(value)).getBytes();
}

function randomBytes_(length) {
  var hex = '';
  while (hex.length < length * 2) {
    hex += Utilities.getUuid().replace(/-/g, '');
  }
  return hexToBytes_(hex.substring(0, length * 2));
}

/**
 * PBKDF2-HMAC-SHA256. 출력 길이는 32바이트 고정이므로 블록은 하나뿐이다.
 * T = U1 xor U2 xor ... xor Uc,  U1 = HMAC(pw, salt || 0x00000001)
 */
function pbkdf2Sha256_(passwordBytes, saltBytes, iterations) {
  var block = saltBytes.concat([0, 0, 0, 1]);
  var u = Utilities.computeHmacSha256Signature(block, passwordBytes);
  var result = u.slice();
  for (var i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, passwordBytes);
    for (var j = 0; j < result.length; j++) {
      result[j] = result[j] ^ u[j];
    }
  }
  return result;
}

function hashPassword(password, iterations, saltBytes) {
  var iter = iterations || HASH_ITERATIONS;
  var salt = saltBytes || randomBytes_(16);
  var derived = pbkdf2Sha256_(strToBytes_(password), salt, iter);
  return 'pbkdf2$' + iter + '$' + bytesToHex_(salt) + '$' + bytesToHex_(derived);
}

function constantTimeEquals_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function verifyPassword(password, stored) {
  var parts = String(stored).split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  var iter = parseInt(parts[1], 10);
  if (!iter || iter < 1) return false;
  if (parts[2].length !== 32 || parts[3].length !== 64) return false;
  if (!/^[0-9a-f]+$/.test(parts[2]) || !/^[0-9a-f]+$/.test(parts[3])) return false;
  var derived = pbkdf2Sha256_(strToBytes_(password), hexToBytes_(parts[2]), iter);
  return constantTimeEquals_(bytesToHex_(derived), parts[3]);
}

/** UUID 두 개를 이어 붙여 256비트 토큰을 만든다. getUuid는 보안 난수를 쓴다. */
function generateToken() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function sha256Hex(value) {
  return bytesToHex_(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value))
  );
}

/** Apps Script 편집기에서 직접 실행해 반복 횟수를 정하는 데 쓴다. */
function benchmarkHash() {
  var started = new Date().getTime();
  hashPassword('benchmark-password-1234', HASH_ITERATIONS);
  var elapsed = new Date().getTime() - started;
  Logger.log(HASH_ITERATIONS + '회 해싱: ' + elapsed + 'ms');
  return elapsed;
}

if (typeof module !== 'undefined') {
  module.exports = {
    HASH_ITERATIONS: HASH_ITERATIONS,
    hashPassword: hashPassword,
    verifyPassword: verifyPassword,
    generateToken: generateToken,
    sha256Hex: sha256Hex,
    bytesToHex_: bytesToHex_,
    hexToBytes_: hexToBytes_,
    strToBytes_: strToBytes_,
    pbkdf2Sha256_: pbkdf2Sha256_,
  };
}
