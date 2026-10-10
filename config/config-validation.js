'use strict';
const Ajv = require('ajv');
const settingsSchema = require('./schemas/site-settings.schema.json');
const sitesSchema = require('./schemas/sites.schema.json');
// No coercion, injected defaults, removal of fields or remote schema loading.
const ajv = new Ajv({ strict: true, allErrors: true, ownProperties: true });
ajv.addSchema(settingsSchema);
const validators = {
  settings: ajv.getSchema(settingsSchema.$id),
  commerce: ajv.compile(require('./schemas/commerce.schema.json')),
  sites: ajv.compile(sitesSchema),
};
function validateConfigShape(kind, input) {
  const validate = validators[kind];
  if (!validate) throw new Error('Unknown configuration schema');
  if (validate(input)) return;
  const issues = validate.errors.map(error => {
    const field = error.params.additionalProperty || error.params.missingProperty;
    return `${error.instancePath || '/'}${field ? ` (${field})` : ''}: ${error.message}`;
  });
  // Report paths/rules, without copying supplied values or credentials into errors.
  throw new Error(`Invalid ${kind} configuration: ${issues.join('; ')}`);
}
module.exports = { validateConfigShape };
