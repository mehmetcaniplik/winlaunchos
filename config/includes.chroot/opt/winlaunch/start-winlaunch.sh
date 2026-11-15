#!/bin/sh
# WinLaunchOS session launcher
export WINLAUNCH_OS=1
# Minimal live environment needs the sandbox flags; Electron would otherwise refuse to start.
exec /opt/winlaunch/WinLaunch --no-sandbox --disable-gpu-sandbox --disable-dev-shm-usage "$@"
