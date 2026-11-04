// Planted on purpose: proves the organisation's code-scanning rule refuses a change that
// brings in a new high alert. This change is never merged; it is closed once the rule is read.
const http = require('http');
const { exec } = require('child_process');

http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').searchParams.get('name');
  exec('ls ' + name, (err, out) => res.end(out));
}).listen(8080);
