
const pty = require('node-pty');
const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';

console.log('Spawning pty...');
const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: process.cwd(),
  env: process.env
});

ptyProcess.onData((data) => {
  console.log('Data received: ' + JSON.stringify(data));
});

setTimeout(() => {
  console.log('Sending command...');
  ptyProcess.write('echo hello\r\n');
}, 1000);

setTimeout(() => {
  console.log('Done.');
  process.exit(0);
}, 5000);
