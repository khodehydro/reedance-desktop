# Reedance Content Studio — release artifacts

This folder holds the published binaries of the studio.

## `reedance-studio-1.0.6-linux-x64-build.zip` (current)

The **build bundle** for v1.0.6: the compiled app (`dist/`), `package.json`,
`electron-builder.yml` and the contracts. It is the source of the installer
build, not a runnable app by itself — running it needs the Electron runtime.

## Producing the real installers

The development sandbox used to build this app cannot download the Electron
runtime or the electron-builder toolset (the GitHub release CDN is blocked
there), so a true installer is built on a machine with normal internet:

```bash
scripts/build-installer.sh win       # Windows NSIS installer (.exe)
scripts/build-installer.sh linux     # Linux .deb installer
scripts/build-installer.sh appimage  # Linux AppImage (single file)
```

The installer lands in this folder (`release/`). Once a real installer is
built, drop it here and update this README — the download link for end users
points at this folder.

## Pack format note

Released `.rdpack` files are encrypted with the fixed `enc-main` key embedded
in the Reedance Android app; only that app (and the studio as the authorized
producer) can read them. See `docs/CRYPTO.md`.
