# Persisted artifact privacy

The shared filter reduces recognized credential/PII exposure in newly written structured diagnostics and managed logs. It is a heuristic redactor, not an anonymizer or a guarantee that all artifacts are safe to share.

**Native Playwright HTML reports/ZIP data, traces, screenshots, videos, file attachment contents and `error-context.md` remain potentially sensitive.** The filter does not rewrite their binary/package formats or arbitrary external files. Filesystem artifact references are retained exactly so links keep working; filenames and paths can therefore contain identifying information. Historical artifacts are not rewritten. Protect the complete report directory and inspect raw artifacts before sharing it.

## Filtered boundaries

- `run-metadata.json` checkpoints, including errors, scenario URL annotations and serialized configuration. Browser execution still uses the original configuration and URL.
- The metadata reporter's aggregate JSON outputs: Web Vitals, spelling, script inventory, commerce consistency and buyer journeys.
- `CONTROL_EVENTS_FILE` JSONL before persistence.
- Scheduler-captured stdout/stderr before display and `.log` persistence. Each stream buffers complete lines across chunks with UTF-8 decoding. An over-64-KiB line is replaced and discarded until its newline; a final unterminated line is filtered on stream end. This can delay partial-line progress output. Direct CLI/list reporter console output outside the managed scheduler is not covered.
- Initial/final `run-sites.js` metadata writes.
- Derived `report-model` summaries, including summaries created from legacy raw inputs, without modifying the source report or its outcome/counts. This protects those summary fields reused by the generated overview; it does not sanitize independently loaded report families or the native Playwright HTML package.
- Notification state, delivery/script-change JSON and outgoing notification JSON payloads, including events inherited from prior state. The webhook configuration/endpoint and actual store requests are not changed.
- The standard runner's published `results.json`: the built-in JSON reporter first writes to an OS temporary directory with mode `0700`, outside the served reports tree. An exit reporter parses and filters that JSON and atomically publishes the complete final file with mode `0600`. At run start a previous final JSON for that output is removed, so a failed publication cannot leave stale results looking current. Metadata checkpoints remain available when the final JSON is absent. Malformed, cyclic, excessively nested or oversized input fails closed instead of publishing raw data.

The offline reporting config uses the same staging/publication path. Other custom Playwright configs that directly select the built-in JSON reporter do not automatically gain this filter.

## Redaction and retained identity

The filter clones output values; it does not mutate test configuration, execute requests, change status/counts or edit approved security baselines. Exact SHA-256 fingerprints, signature/history hashes, stable scope identifiers, counters and already clean origin strings remain unchanged. URL-like frame/script keys are preserved; they are not interpreted as credential fields.

Recognized credential/PII field names include authorization/cookie headers, password/passphrase, token/API key/client secret/session/CSRF variants, email and card-number/security-code fields. Free-form text masks common header/assignment/Bearer/JWT/API-key and ASCII-email patterns, including quoted JSON-like log assignments. This is a bounded rule set: arbitrary names, addresses, phone numbers, unknown secret formats, malicious obfuscation and all encoded representations cannot be reliably inferred.

For absolute HTTP(S)/WS(S) URLs, credentials are removed. Every query value and URL fragment becomes a deterministic `redacted-<SHA-256>` label, rather than trusting a parameter-name denylist. Distinct values remain distinguishable for diagnosis. These labels are pseudonymous and dictionary-guessable for low-entropy inputs; they are not encryption or strong anonymization. Clean URLs requiring no redaction retain their exact original spelling. Query keys remain except for recognized text patterns; unknown sensitive data in a key is outside the guarantee. Normal path segments are retained, recognized decoded text patterns are masked where parsing succeeds, and undecodable paths are not claimed safe. Relative URLs are only subject to the free-form pattern filter, so unknown query values in relative paths require care.

Base64 text/JSON bodies embedded by the built-in JSON reporter and UTF-8 stdout buffers are decoded, filtered and re-encoded. Explicit binary bodies remain unchanged. External attachment files referenced by path remain under their own retention/sharing policy. Structural-limit failures inside encoded JSON propagate instead of falling back to raw text.

## Limits and staging lifetime

Structured serialization rejects cycles, depth over 100 and over two million visited values. Final raw JSON publication accepts at most 100 MiB. These are processing limits, not a hard bound on Playwright's browser/response buffering.

Parent/worker configuration imports reuse one private staging directory per output through inherited process environment. Normal reporter exit removes it, including publication failure. Forced termination or configuration-only imports may leave a private temporary directory; apply the installation's temporary-file retention policy after confirming the run is no longer active. This is separate from customer-facing report retention and does not make raw staging globally readable.

## Local verification

`node --test scripts/artifact-privacy.test.js` checks non-mutating redaction, exact security signature/origin/path preservation, query identity labels, idempotence, malformed/encoded textual diagnostics, UTF-8/chunk boundaries, overflow handling, structural limits and private atomic publication.

`pnpm test:reporting` exercises the real metadata/control/built-in JSON/exit reporters with local browser fixtures: the requested URL remains original, public final JSON stays absent until publication, stale results are removed, known secrets are removed from checkpoints/events/errors/stdout and embedded JSON attachment bodies, and hashes/outcomes/flaky diagnostics remain intact. Native raw failure artifacts remain explicitly outside this filter.
