'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const REDACTED = '[redacted]';
const digest = value => createHash('sha256').update(value).digest('hex');
const label = value =>
  /^redacted-[a-f0-9]{64}$/.test(value) ? value : 'redacted-' + digest(value);
const secretKey = key =>
  /^(?:authorization|proxyauthorization|cookie|cookies|setcookie|password|passwd|passphrase|token|accesstoken|refreshtoken|idtoken|apikey|clientsecret|secret|sessionid|csrftoken|creditcard|cardnumber|cvv|cvc|email|emailaddress)$/i.test(
    key.replace(/[-_\s]/g, ''),
  );
function plainText(value) {
  return value
    .replace(
      /\b(?:Cookie|Set-Cookie|Authorization|Proxy-Authorization)\s*:\s*[^\r\n]*/gi,
      match => match.slice(0, match.indexOf(':') + 1) + ' ' + REDACTED,
    )
    .replace(/\bBearer\s+[A-Za-z\d._~+/-]+=*/gi, 'Bearer ' + REDACTED)
    .replace(
      /(["']?)\b(password|passwd|passphrase|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|session[_-]?id|csrf[_-]?token|authorization|proxy[_-]?authorization|cookie|cookies|set[_-]?cookie|email|email[_-]?address|token|secret)\b\1(\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,
      (_match, quote, key, separator) => quote + key + quote + separator + quote + REDACTED + quote,
    )
    .replace(/\beyJ[A-Za-z\d_-]+\.[A-Za-z\d_-]+\.[A-Za-z\d_-]+\b/g, REDACTED)
    .replace(
      /\b(?:sk_(?:live|test)_[A-Za-z\d]{12,}|ghp_[A-Za-z\d]{20,}|github_pat_[A-Za-z\d_]{20,}|AKIA[A-Z\d]{16}|AIza[A-Za-z\d_-]{30,})\b/g,
      REDACTED,
    )
    .replace(/\b[A-Z\d._%+-]+@[A-Z\d.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]');
}
function redactUrl(value) {
  let suffix = '';
  while (/[),.;\]]$/.test(value)) {
    suffix = value.slice(-1) + suffix;
    value = value.slice(0, -1);
  }
  try {
    const url = new URL(value);
    const pairs = [...url.searchParams];
    const queryChanged = pairs.some(
      ([key, value]) => plainText(key) !== key || label(value) !== value,
    );
    const fragmentChanged = Boolean(url.hash && label(url.hash.slice(1)) !== url.hash.slice(1));
    let cleanPath = url.pathname,
      pathChanged = false;
    try {
      const decoded = decodeURIComponent(url.pathname);
      cleanPath = plainText(decoded);
      pathChanged = cleanPath !== decoded;
    } catch {
      /* Undecodable paths remain outside the heuristic's guarantees. */
    }
    if (!url.username && !url.password && !queryChanged && !fragmentChanged && !pathChanged)
      return value + suffix;
    url.username = '';
    url.password = '';
    // Every query value, not just a key-name denylist. Labels retain distinct diagnostic identities.
    if (queryChanged) {
      url.search = '';
      for (const [key, value] of pairs) url.searchParams.append(plainText(key), label(value));
    }
    if (fragmentChanged) url.hash = label(url.hash.slice(1));
    if (pathChanged) url.pathname = cleanPath;
    return url.href + suffix;
  } catch {
    // Script inventory keys can contain URL-like non-URL fragments; do not rewrite their hashes.
    return plainText(value.replace(/^((?:https?|wss?):\/\/)[^/@\s]+@/i, '$1')) + suffix;
  }
}
function redactText(value) {
  const parts = String(value).split(/((?:https?|wss?):\/\/[^\s<>"'`]+)/gi);
  return parts.map((part, index) => (index % 2 ? redactUrl(part) : plainText(part))).join('');
}
function sanitizeArtifact(value) {
  let nodes = 0;
  const active = new WeakSet();
  function visit(value, depth) {
    if (++nodes > 2000000 || depth > 100)
      throw new Error('Artifact privacy serialization exceeds limits');
    if (typeof value === 'string') return redactText(value);
    if (value === null || typeof value !== 'object') return value;
    if (active.has(value)) throw new Error('Artifact privacy serialization cannot contain cycles');
    if (value instanceof Date) return value.toJSON();
    active.add(value);
    let result;
    if (Array.isArray(value)) result = value.map(item => visit(item, depth + 1));
    else {
      result = Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          secretKey(key) && entry != null ? REDACTED : visit(entry, depth + 1),
        ]),
      );
      // Artifact filesystem references must continue to point to the original file. They are not scrubbed filenames.
      if (
        typeof value.path === 'string' &&
        typeof value.contentType === 'string' &&
        !/^(?:https?|wss?):\/\//i.test(value.path)
      )
        result.path = value.path;
      // Built-in JSON reporter embeds in-memory text attachments and binary stdout as base64.
      const encodedKey =
        typeof value.contentType === 'string' &&
        /^(?:text\/|application\/(?:[\w.+-]*json|javascript)(?:;|$))/i.test(value.contentType)
          ? 'body'
          : Object.hasOwn(value, 'buffer')
            ? 'buffer'
            : null;
      if (
        encodedKey &&
        typeof value[encodedKey] === 'string' &&
        /^[A-Za-z\d+/]*={0,2}$/.test(value[encodedKey])
      ) {
        const decoded = Buffer.from(value[encodedKey], 'base64').toString('utf8');
        if (!decoded.includes('\ufffd')) {
          let parsed,
            isJson = true;
          try {
            parsed = JSON.parse(decoded);
          } catch {
            isJson = false;
          }
          // Budget/cycle failures must propagate, never fall back to publishing raw JSON text.
          const sanitized = isJson ? JSON.stringify(visit(parsed, depth + 1)) : redactText(decoded);
          result[encodedKey] = Buffer.from(sanitized).toString('base64');
        }
      }
    }
    active.delete(value);
    return result;
  }
  return visit(value, 0);
}
function stringifyArtifact(value, replacer = null, space) {
  return JSON.stringify(sanitizeArtifact(value), replacer, space);
}
function createLogRedactor(write, maximumLineBytes = 65536) {
  const decoder = new StringDecoder('utf8');
  let pending = '',
    dropping = false;
  function consume(value, final = false) {
    pending += value;
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline + 1);
      pending = pending.slice(newline + 1);
      if (!dropping)
        write(
          Buffer.byteLength(line) > maximumLineBytes
            ? '[redacted oversized log line]\n'
            : redactText(line),
        );
      dropping = false;
    }
    if (Buffer.byteLength(pending) > maximumLineBytes) {
      if (!dropping) write('[redacted oversized log line]\n');
      pending = '';
      dropping = true;
    }
    if (final && pending && !dropping) write(redactText(pending));
    if (final) pending = '';
  }
  return {
    write(chunk) {
      consume(decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    },
    end() {
      consume(decoder.end(), true);
    },
  };
}
function privateResultsFile(outputFile) {
  const cacheKey = outputFile
    ? 'ARTIFACT_PRIVATE_RESULTS_' + digest(path.resolve(outputFile))
    : null;
  const prior = cacheKey && process.env[cacheKey];
  if (prior) {
    try {
      const directory = path.dirname(prior);
      if (
        path.dirname(directory) === os.tmpdir() &&
        path.basename(directory).startsWith('e-commerce-private-results-') &&
        !fs.lstatSync(directory).isSymbolicLink() &&
        fs.statSync(directory).isDirectory() &&
        (process.platform === 'win32' || (fs.statSync(directory).mode & 0o777) === 0o700)
      )
        return prior;
    } catch {
      /* A previous completed run may already have removed its staging directory. */
    }
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e-commerce-private-results-'));
  fs.chmodSync(directory, 0o700);
  const file = path.join(directory, 'results.json');
  if (cacheKey) process.env[cacheKey] = file;
  return file;
}
function publishResults(inputFile, outputFile) {
  const input = path.resolve(inputFile),
    output = path.resolve(outputFile);
  if (input === output) throw new Error('Raw results must be staged outside the published output');
  if (fs.statSync(input).size > 100 * 1024 * 1024)
    throw new Error('Raw results exceed privacy publication limit');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(input, 'utf8'));
  } catch {
    throw new Error('Raw results unavailable or invalid; filtered publication refused');
  }
  const sanitized = stringifyArtifact(parsed, null, 2);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = output + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, sanitized, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, output);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
module.exports = {
  sanitizeArtifact,
  stringifyArtifact,
  redactText,
  createLogRedactor,
  privateResultsFile,
  publishResults,
};
