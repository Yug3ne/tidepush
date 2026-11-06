#!/usr/bin/env bash
# Build Tidepush Panel and install it for the current user (binary, icon, launcher entry).
set -euo pipefail
cd "$(dirname "$0")"
cargo build --release --manifest-path src-tauri/Cargo.toml
install -Dm755 src-tauri/target/release/tidepanel "$HOME/.local/bin/tidepanel"
install -Dm644 src-tauri/icons/icon.png "$HOME/.local/share/icons/hicolor/256x256/apps/tidepanel.png"
install -Dm644 /dev/stdin "$HOME/.local/share/applications/tidepanel.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Tidepush Panel
GenericName=OTA Update Panel
Comment=Publish, promote, roll out and roll back Expo OTA updates
Exec=$HOME/.local/bin/tidepanel %f
Icon=tidepanel
Terminal=false
Categories=Development;
Keywords=ota;expo;tidepush;publish;update;
StartupWMClass=tidepanel
DESKTOP
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
echo "Installed: $HOME/.local/bin/tidepanel"
