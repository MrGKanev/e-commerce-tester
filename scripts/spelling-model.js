'use strict';
const { createHash } = require('node:crypto');
function fingerprint(finding) {
  return createHash('sha256').update([finding.language, finding.component, finding.text.normalize('NFC').replace(/\s+/g, ' ').trim(), finding.word.toLocaleLowerCase()].join('\0')).digest('hex');
}
function mergeFindings(existing, incoming) {
  const map = new Map();
  for (const finding of [...existing, ...incoming]) {
    const id = finding.id || fingerprint(finding);
    const previous = map.get(id);
    if (!previous) map.set(id, { ...finding, id, sources: [...new Set(finding.sources || [finding.source])], urls: [...new Set(finding.urls)], locations: [...(finding.locations || [])] });
    else {
      previous.sources = [...new Set([...previous.sources, ...(finding.sources || [finding.source])])];
      previous.urls = [...new Set([...previous.urls, ...finding.urls])];
      const locations = new Map([...previous.locations, ...(finding.locations || [])].map(location => [JSON.stringify(location), location]));
      previous.locations = [...locations.values()];
    }
  }
  return [...map.values()];
}
module.exports = { fingerprint, mergeFindings };
