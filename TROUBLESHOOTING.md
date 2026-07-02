# Troubleshooting

## "Activating extension 'google.chrome-devtools-mcp' failed"

If you see this error when launching the extension:
`Cannot find module 'c:\Users\Abuzar\AppData\Local\Programs\Antigravity\resources\app\extensions\chrome-devtools-mcp\out\extension.js'`

**Cause:**
This is an issue with the **Antigravity Editor installation**, not your Angel project code. The editor attempts to load a built-in extension (`chrome-devtools-mcp`) but the file `extension.js` is missing in the installation directory.

**Solution:**
1. This error is harmless for your `Angel` development unless you specifically need Chrome DevTools integration features within the IDE.
2. To fix it, you may need to **reinstall or update** the Antigravity application.
3. You can verify the missing file by checking the path in the error message.
