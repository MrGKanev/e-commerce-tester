import { test } from '../tests/fixtures';
test('disabled newsletter does not execute or send a request', async () => {
  throw new Error('Disabled capability must skip this scenario');
});
