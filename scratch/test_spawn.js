const { spawn } = require('child_process');

class MockPTY {
    constructor(shell, args, cwd) {
        this.process = spawn(shell, args, { cwd, shell: false });
        this.process.stdout.on('data', (d) => this.onDataCb && this.onDataCb(d.toString()));
        this.process.stderr.on('data', (d) => this.onDataCb && this.onDataCb(d.toString()));
        this.process.on('exit', (code) => this.onExitCb && this.onExitCb(code));
    }
    
    onData(cb) { this.onDataCb = cb; }
    onExit(cb) { this.onExitCb = cb; }
    write(data) { this.process.stdin.write(data); }
    kill() { this.process.kill(); }
}

const pty = new MockPTY('cmd.exe', [], 'd:\\Angel');
pty.onData((data) => process.stdout.write(data));
pty.onExit((code) => console.log('Exited with', code));

setTimeout(() => {
    pty.write('echo hello\r\n');
}, 1000);

setTimeout(() => {
    pty.write('exit\r\n');
}, 2000);
