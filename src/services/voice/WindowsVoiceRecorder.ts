/**
 * NativeVoiceRecorder — cross-platform audio capture via system CLIs.
 *
 * Platform routing:
 *  - Windows: PowerShell + mciSendString (original implementation)
 *  - macOS:   sox (brew install sox) → fallback error with helpful message
 *  - Linux:   arecord (ALSA)
 *
 * NOTE: The primary voice path on macOS is the VAD webview (browser mic).
 * This class only handles the legacy "native recording" button path.
 */

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class WindowsVoiceRecorder {
    private recordingProcess: cp.ChildProcess | null = null;
    private tempFilePath: string;
    private platform: NodeJS.Platform;

    constructor() {
        this.platform = process.platform;
        this.tempFilePath = path.join(
            os.tmpdir(),
            `angel_recording_${Date.now()}_${Math.floor(Math.random() * 1000)}.wav`
        );
    }

    public async start(): Promise<void> {
        if (this.platform === 'win32') {
            return this.startWindows();
        } else if (this.platform === 'darwin') {
            return this.startMacOS();
        } else {
            return this.startLinux();
        }
    }

    // ─── Windows (PowerShell + MCI) ──────────────────────────────────────────

    private startWindows(): Promise<void> {
        return new Promise((resolve, reject) => {
            const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Audio {
    [DllImport("winmm.dll", EntryPoint = "mciSendStringA", CharSet = CharSet.Ansi)]
    public static extern int mciSendString(string lpszCommand, string lpszReturnString, int cchReturn, int hwndCallback);
}
"@
$ret = [Audio]::mciSendString("open new type waveaudio alias recsound", $null, 0, 0)
if ($ret -ne 0) { Write-Error "MCI Open Failed: $ret" }
$ret = [Audio]::mciSendString("record recsound", $null, 0, 0)
if ($ret -ne 0) { Write-Error "MCI Record Failed: $ret" }

`;
            try {
                this.recordingProcess = cp.spawn('powershell', ['-NoProfile', '-Command', '-'], {
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                if (this.recordingProcess.stdin) {
                    this.recordingProcess.stdin.write(script);
                    console.log('[NativeRecorder] Windows: MCI recording started');
                }

                if (this.recordingProcess.stderr) {
                    this.recordingProcess.stderr.on('data', (data) => {
                        console.error(`[NativeRecorder] Windows stderr: ${data}`);
                    });
                }

                // Give MCI time to initialize
                setTimeout(() => resolve(), 500);
            } catch (error) {
                reject(new Error(`[NativeRecorder] Failed to start PowerShell recorder: ${(error as Error).message}`));
            }
        });
    }

    // ─── macOS (sox) ──────────────────────────────────────────────────────────

    private startMacOS(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Verify sox is available
            cp.exec('which sox', (err) => {
                if (err) {
                    // sox not found — guide the user and reject gracefully
                    reject(new Error(
                        'Native recording requires "sox" on macOS.\n' +
                        'Install it with: brew install sox\n\n' +
                        'Alternatively, use the microphone (🎙) button in the sidebar — ' +
                        'it uses your browser mic directly and works without sox.'
                    ));
                    return;
                }

                try {
                    // sox: record 16-bit 16kHz mono WAV, keep process alive until stop()
                    this.recordingProcess = cp.spawn('sox', [
                        '-d',                       // default input device
                        '-r', '16000',              // 16 kHz
                        '-c', '1',                  // mono
                        '-b', '16',                 // 16-bit
                        '-e', 'signed-integer',
                        this.tempFilePath           // output file
                    ], { stdio: ['pipe', 'pipe', 'pipe'] });

                    if (this.recordingProcess.stderr) {
                        this.recordingProcess.stderr.on('data', (data) => {
                            const msg = data.toString();
                            // sox writes progress to stderr — only log actual errors
                            if (!msg.includes('In:') && !msg.includes('%')) {
                                console.error(`[NativeRecorder] macOS sox stderr: ${msg}`);
                            }
                        });
                    }

                    this.recordingProcess.on('error', (err) => {
                        console.error('[NativeRecorder] macOS sox error:', err);
                    });

                    // sox starts immediately — give it 200ms to settle
                    setTimeout(() => {
                        console.log(`[NativeRecorder] macOS: sox recording started → ${this.tempFilePath}`);
                        resolve();
                    }, 200);

                } catch (error) {
                    reject(new Error(`[NativeRecorder] Failed to start sox: ${(error as Error).message}`));
                }
            });
        });
    }

    // ─── Linux (arecord / ALSA) ───────────────────────────────────────────────

    private startLinux(): Promise<void> {
        return new Promise((resolve, reject) => {
            cp.exec('which arecord', (err) => {
                if (err) {
                    reject(new Error(
                        'Native recording requires "arecord" on Linux.\n' +
                        'Install ALSA utils: sudo apt install alsa-utils'
                    ));
                    return;
                }

                try {
                    this.recordingProcess = cp.spawn('arecord', [
                        '-f', 'S16_LE',
                        '-r', '16000',
                        '-c', '1',
                        this.tempFilePath
                    ], { stdio: ['pipe', 'pipe', 'pipe'] });

                    if (this.recordingProcess.stderr) {
                        this.recordingProcess.stderr.on('data', (data) => {
                            const msg = data.toString();
                            if (!msg.includes('Recording')) {
                                console.error(`[NativeRecorder] Linux arecord stderr: ${msg}`);
                            }
                        });
                    }

                    setTimeout(() => {
                        console.log(`[NativeRecorder] Linux: arecord recording started → ${this.tempFilePath}`);
                        resolve();
                    }, 200);
                } catch (error) {
                    reject(new Error(`[NativeRecorder] Failed to start arecord: ${(error as Error).message}`));
                }
            });
        });
    }

    // ─── Stop ─────────────────────────────────────────────────────────────────

    public async stop(): Promise<string> {
        if (this.platform === 'win32') {
            return this.stopWindows();
        } else {
            return this.stopUnix();
        }
    }

    private stopWindows(): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.recordingProcess || !this.recordingProcess.stdin) {
                return reject(new Error('No recording process active'));
            }

            const validPath = this.tempFilePath.replace(/\\/g, '\\\\');
            const saveScript = `
[Audio]::mciSendString("save recsound ${validPath}", $null, 0, 0)
[Audio]::mciSendString("close recsound", $null, 0, 0)
exit
`;
            try {
                this.recordingProcess.stdin.write(saveScript);
                this.recordingProcess.stdin.end();
            } catch (e) {
                console.error('[NativeRecorder] Windows: error writing stop script:', e);
            }

            this.waitForProcessExit(resolve, reject, 3000);
        });
    }

    private stopUnix(): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.recordingProcess) {
                return reject(new Error('No recording process active'));
            }

            // Send SIGINT to stop sox/arecord cleanly (they flush the WAV header on exit)
            try {
                this.recordingProcess.kill('SIGINT');
                console.log('[NativeRecorder] Unix: sent SIGINT to stop recording');
            } catch (e) {
                console.error('[NativeRecorder] Unix: failed to send SIGINT:', e);
            }

            this.waitForProcessExit(resolve, reject, 3000);
        });
    }

    private waitForProcessExit(
        resolve: (value: string) => void,
        reject: (reason: Error) => void,
        timeoutMs: number
    ): void {
        let settled = false;

        const settle = (fn: () => void) => {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            fn();
        };

        const timer = setTimeout(() => {
            settle(() => {
                console.warn('[NativeRecorder] Process did not exit in time — force killing');
                try { this.recordingProcess?.kill('SIGKILL'); } catch (_) { /* ignore */ }
                this.recordingProcess = null;

                if (fs.existsSync(this.tempFilePath) && fs.statSync(this.tempFilePath).size > 0) {
                    resolve(this.tempFilePath);
                } else {
                    reject(new Error('Recording timed out and no audio file was saved.'));
                }
            });
        }, timeoutMs);

        this.recordingProcess!.on('close', (code) => {
            settle(() => {
                console.log(`[NativeRecorder] Process exited (code=${code})`);
                this.recordingProcess = null;

                if (fs.existsSync(this.tempFilePath)) {
                    const { size } = fs.statSync(this.tempFilePath);
                    if (size > 0) {
                        resolve(this.tempFilePath);
                    } else {
                        reject(new Error('Recording file created but is empty'));
                    }
                } else {
                    reject(new Error('Recording file was not saved'));
                }
            });
        });

        this.recordingProcess!.on('error', (err) => {
            settle(() => {
                this.recordingProcess = null;
                reject(err);
            });
        });
    }

    // ─── Utilities ────────────────────────────────────────────────────────────

    public getFilePath(): string {
        return this.tempFilePath;
    }

    public dispose(): void {
        if (this.recordingProcess) {
            try { this.recordingProcess.kill(); } catch (_) { /* ignore */ }
        }
        if (fs.existsSync(this.tempFilePath)) {
            try { fs.unlinkSync(this.tempFilePath); } catch (_) { /* ignore */ }
        }
    }
}
