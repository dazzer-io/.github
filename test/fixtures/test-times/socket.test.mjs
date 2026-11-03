// A fixture for test/test-times-record.test.mjs: it opens a loopback socket, so its file's
// kinds say "local-service" and the record holds no address or port. It lies outside
// test/*.test.mjs, so this repository's own check never runs it.
import { test } from 'node:test';
import net from 'node:net';

test('talks to a local server', async () => {
  const server = net.createServer((s) => s.end('hi'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const text = await new Promise((resolve, reject) => {
    const c = net.connect(port, '127.0.0.1');
    let got = '';
    c.on('data', (b) => { got += b; });
    c.on('end', () => resolve(got));
    c.on('error', reject);
  });
  await new Promise((resolve) => server.close(resolve));
  if (text !== 'hi') throw new Error(`the local server answered ${text}`);
});
