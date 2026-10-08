'use strict';
const { createHash } = require('node:crypto');
function fingerprint(finding) {
  return createHash('sha256').update([finding.language, finding.component, finding.source, finding.text.normalize('NFC').replace(/\s+/g, ' ').trim(), finding.word.toLocaleLowerCase()].join('\0')).digest('hex');
}
function mergeFindings(existing, incoming) {
  const map = new Map();
  for (const finding of [...existing, ...incoming]) {
    const id = finding.id || fingerprint(finding);
    const previous = map.get(id);
    if (!previous) map.set(id, { ...finding, id, urls: [...new Set(finding.urls)], locations: [...(finding.locations || [])] });
    else {
      previous.urls = [...new Set([...previous.urls, ...finding.urls])];
      const locations = new Map([...previous.locations, ...(finding.locations || [])].map(location => [JSON.stringify(location), location]));
      previous.locations = [...locations.values()];
    }
  }
  return [...map.values()];
}
module.exports = { fingerprint, mergeFindings };
