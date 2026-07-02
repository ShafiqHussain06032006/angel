
const pty = require('node-pty');
const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';

console.log('Spawning pty with exact code parameters...');
const env = {
  ...process.env,
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
  CI: 'true',
  NPM_CONFIG_YES: 'true',
  PIP_NO_INPUT: '1',
};

const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-256color',
  cols: 220,
  rows: 50,
  cwd: 'd:\\Angel',
  env: env
});

ptyProcess.onData((data) => {
  console.log('Data received (' + data.length + ' chars)');
});

setTimeout(() => {
  console.log('Done.');
  process.exit(0);
}, 3000);
