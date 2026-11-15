const { test } = require('node:test');
const assert = require('node:assert/strict');

test('CommonJS build loads', () => {
  const sdk = require('../dist/cjs/index.js');
  const hr = new sdk.HelpRange({ apiKey: 'hr_test_x', fetch: async () => new Response('{}') });
  assert.equal(hr.testMode, true);
  assert.equal(typeof sdk.verifyWebhook, 'function');
  assert.equal(sdk.default, sdk.HelpRange);
});
