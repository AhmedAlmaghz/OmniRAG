import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = 3000;

// @ts-ignore
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

createServer((req, res) => {
  try {
    const parsedUrl = parse(req.url || '', true);
    handle(req, res, parsedUrl);
  } catch (err) {
    console.error('Error occurred handling', req.url, err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}).once('error', (err) => {
  console.error(err);
  process.exit(1);
}).listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname}:${port}`);
});
