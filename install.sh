#!/bin/sh
# Dotaz install/update script for macOS and Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/contember/dotaz/main/install.sh | sh
set -e

REPO="contember/dotaz"

# ── Detect platform ─────────────────────────────────────────

OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
	Darwin) PLATFORM="macos" ;;
	Linux)  PLATFORM="linux" ;;
	*)      echo "Error: unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
	x86_64|amd64)   ARCH="x64" ;;
	arm64|aarch64)   ARCH="arm64" ;;
	*)               echo "Error: unsupported architecture: $ARCH"; exit 1 ;;
esac

ARTIFACT="dotaz-${PLATFORM}-${ARCH}"

# ── Resolve version ─────────────────────────────────────────

if [ -z "$DOTAZ_VERSION" ]; then
	DOTAZ_VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
	if [ -z "$DOTAZ_VERSION" ]; then
		echo "Error: could not determine latest version"
		exit 1
	fi
fi

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${DOTAZ_VERSION}/${ARTIFACT}.tar.gz"

echo "Installing Dotaz ${DOTAZ_VERSION} (${PLATFORM}-${ARCH})..."

# ── Download and extract ────────────────────────────────────

TMP_DIR=$(mktemp -d)
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "Downloading ${DOWNLOAD_URL}..."
curl -fsSL "$DOWNLOAD_URL" -o "$TMP_DIR/dotaz.tar.gz"
tar -xzf "$TMP_DIR/dotaz.tar.gz" -C "$TMP_DIR"

# ── Install (platform-specific) ─────────────────────────────

if [ "$PLATFORM" = "macos" ]; then
	# macOS: copy .app bundle to /Applications
	APP_SRC=$(find "$TMP_DIR" -maxdepth 1 -name "*.app" -type d | head -1)
	if [ -z "$APP_SRC" ]; then
		echo "Error: no .app bundle found in archive"
		exit 1
	fi

	APP_NAME=$(basename "$APP_SRC")
	DEST="/Applications/${APP_NAME}"

	echo "Installing to ${DEST}..."
	[ -d "$DEST" ] && rm -rf "$DEST"
	cp -R "$APP_SRC" /Applications/

	echo "Done! Dotaz installed to /Applications/${APP_NAME}"

else
	# Linux: install to ~/.local/share/dotaz, symlink launcher
	INSTALL_DIR="${DOTAZ_INSTALL_DIR:-$HOME/.local/share/dotaz}"
	BIN_DIR="${DOTAZ_BIN_DIR:-$HOME/.local/bin}"

	APP_SRC=$(find "$TMP_DIR" -maxdepth 1 -type d -name "Dotaz*" | head -1)
	if [ -z "$APP_SRC" ]; then
		echo "Error: no Dotaz directory found in archive"
		exit 1
	fi

	echo "Installing to ${INSTALL_DIR}..."
	mkdir -p "$INSTALL_DIR"
	rm -rf "${INSTALL_DIR:?}"/*
	cp -r "$APP_SRC"/* "$INSTALL_DIR/"

	# Create launcher symlink
	mkdir -p "$BIN_DIR"
	ln -sf "$INSTALL_DIR/bin/launcher" "$BIN_DIR/dotaz"

	# Install .desktop entry
	DESKTOP_DIR="$HOME/.local/share/applications"
	mkdir -p "$DESKTOP_DIR"
	cat > "$DESKTOP_DIR/dotaz.desktop" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Dotaz
Comment=Desktop database client
Exec=${INSTALL_DIR}/bin/launcher
Icon=${INSTALL_DIR}/Resources/appIcon.png
Terminal=false
StartupWMClass=Dotaz
Categories=Development;Database;
EOF

	echo "Done! Dotaz installed to ${INSTALL_DIR}"

	if ! echo "$PATH" | grep -q "$BIN_DIR"; then
		echo ""
		echo "  Add ~/.local/bin to your PATH to run 'dotaz' from terminal:"
		echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
	fi
fi
