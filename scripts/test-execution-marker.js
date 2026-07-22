import fs from 'node:fs';
import path from 'node:path';

const manifestPath = process.env.BLACKSPIRE_TEST_MANIFEST_PATH;
const testFile = process.argv.find((argument) => argument.endsWith('.test.js'));

if (manifestPath && process.env.NODE_TEST_CONTEXT && testFile) {
  fs.appendFileSync(manifestPath, `${path.resolve(testFile)}\n`);
}
