# Lazyest Presence

Read and follow [AGENTS.md](AGENTS.md) and README.md.

For installation including closed-lid operation:

```sh
./bootstrap.sh install --with-lid
./bootstrap.sh status
./bootstrap.sh lid-status
```

For API scheduling only, omit `--with-lid`; add the built-in power module later
with `./bootstrap.sh lid-setup`. Do not install a separate sleep-prevention app.
Dependencies are prepared automatically, including the Swift build. The user
completes any Apple Command Line Tools installation, Microsoft login/MFA and
macOS administrator approval. Reuse their existing Microsoft login when possible.
Do not require new Entra registration or tenant-wide approval before an actual error.

Keep daily 08:00–21:00, battery, thermal and lease-expiry safeguards intact.
Do not collect passwords or tokens, disable screen security or expose personal paths.
Report API, power-setting and physical closed-lid verification separately.
Use en dashes in Markdown ranges and run the checks listed in AGENTS.md before publishing.
