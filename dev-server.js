import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

try {
  execSync('pkill -9 -f "next-server" || true', { stdio: 'ignore' });
} catch (e) {
  // ignore
}

const rawArgs = process.argv.slice(2);

let port = '3000';
let hostname = '0.0.0.0';
const otherArgs = [];

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg === '--host' || arg === '-H' || arg === '--hostname') {
    if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
      hostname = rawArgs[i + 1];
      i++;
    }
  } else if (arg.startsWith('--host=')) {
    hostname = arg.split('=')[1];
  } else if (arg.startsWith('--hostname=')) {
    hostname = arg.split('=')[1];
  } else if (arg === '--port' || arg === '-p') {
    if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
      port = rawArgs[i + 1];
      i++;
    }
  } else if (arg.startsWith('--port=')) {
    port = arg.split('=')[1];
  } else {
    otherArgs.push(arg);
  }
}

const nextArgs = ['dev', '-p', port, '-H', hostname, ...otherArgs];

const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  stdio: 'inherit',
  env: process.env,
});

function cleanup(signal) {
  if (child && !child.killed) {
    child.kill(signal);
  }
}

process.on('SIGTERM', () => {
  cleanup('SIGTERM');
  process.exit(0);
});

process.on('SIGINT', () => {
  cleanup('SIGINT');
  process.exit(0);
});

process.on('SIGHUP', () => {
  cleanup('SIGHUP');
  process.exit(0);
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
