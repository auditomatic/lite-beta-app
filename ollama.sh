#!/bin/sh
# This script installs Ollama on macOS and configures it for Auditomatic Lite
# Based on the official Ollama install script but adds OLLAMA_ORIGINS configuration

set -eu

red="$( (/usr/bin/tput bold || :; /usr/bin/tput setaf 1 || :) 2>&-)"
green="$( (/usr/bin/tput bold || :; /usr/bin/tput setaf 2 || :) 2>&-)"
plain="$( (/usr/bin/tput sgr0 || :) 2>&-)"

status() { echo ">>> $*" >&2; }
success() { echo "${green}SUCCESS:${plain} $*"; }
error() { echo "${red}ERROR:${plain} $*"; exit 1; }
warning() { echo "${red}WARNING:${plain} $*"; }

# Check if running on macOS
[ "$(uname -s)" = "Darwin" ] || error 'This script is intended to run on macOS only.'

# Check if Ollama is already installed
if command -v ollama >/dev/null 2>&1; then
    status "Ollama is already installed at $(which ollama)"
    EXISTING_VERSION=$(ollama --version 2>/dev/null || echo "unknown")
    status "Current version: $EXISTING_VERSION"
else
    status "Ollama not found. Installing..."
    
    # Download and install Ollama for macOS
    status "Downloading Ollama for macOS..."
    
    # Create temporary directory
    TEMP_DIR=$(mktemp -d)
    trap "rm -rf $TEMP_DIR" EXIT
    
    # Download the Ollama macOS app
    curl -L -o "$TEMP_DIR/Ollama.zip" "https://ollama.com/download/Ollama-darwin.zip"
    
    status "Extracting Ollama..."
    cd "$TEMP_DIR"
    unzip -q Ollama.zip
    
    status "Installing Ollama to /Applications..."
    # Remove old version if exists
    [ -d "/Applications/Ollama.app" ] && rm -rf "/Applications/Ollama.app"
    
    # Move to Applications
    mv Ollama.app /Applications/
    
    # Create symlink for CLI
    status "Creating command line tool..."
    ln -sf /Applications/Ollama.app/Contents/MacOS/ollama /usr/local/bin/ollama 2>/dev/null || \
        sudo ln -sf /Applications/Ollama.app/Contents/MacOS/ollama /usr/local/bin/ollama
    
    success "Ollama installed successfully!"
fi

# Configure OLLAMA_ORIGINS for Auditomatic
status "Configuring Ollama for Auditomatic Lite..."

# Check if Ollama is running
if pgrep -x "ollama" > /dev/null; then
    status "Ollama is currently running. It will need to be restarted for changes to take effect."
    OLLAMA_RUNNING=true
else
    OLLAMA_RUNNING=false
fi

# Set OLLAMA_ORIGINS environment variable
AUDITOMATIC_ORIGINS="https://*.auditomatic.org,http://localhost:3000,http://localhost:5173,http://localhost:5174"

# For immediate use (until restart)
status "Setting OLLAMA_ORIGINS for current session..."
launchctl setenv OLLAMA_ORIGINS "$AUDITOMATIC_ORIGINS"

# Create launch agent for persistence
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
LAUNCH_AGENT_FILE="$LAUNCH_AGENT_DIR/com.auditomatic.ollama.environment.plist"

status "Creating persistent configuration..."
mkdir -p "$LAUNCH_AGENT_DIR"

cat > "$LAUNCH_AGENT_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.auditomatic.ollama.environment</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/launchctl</string>
        <string>setenv</string>
        <string>OLLAMA_ORIGINS</string>
        <string>$AUDITOMATIC_ORIGINS</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
EOF

# Load the launch agent
launchctl load "$LAUNCH_AGENT_FILE" 2>/dev/null || launchctl unload "$LAUNCH_AGENT_FILE" && launchctl load "$LAUNCH_AGENT_FILE"

# Restart Ollama if it was running
if [ "$OLLAMA_RUNNING" = true ]; then
    status "Restarting Ollama..."
    killall ollama 2>/dev/null || true
    sleep 2
    open -a Ollama
fi

# Test the installation
status "Testing Ollama installation..."
if ollama list >/dev/null 2>&1; then
    success "Ollama is working correctly!"
else
    warning "Ollama command is available but the service might not be running."
    status "Starting Ollama..."
    open -a Ollama
    sleep 3
fi

echo ""
success "Installation complete!"
echo ""
status "Ollama has been configured to accept connections from:"
echo "  - https://*.auditomatic.org (all subdomains)"
echo "  - http://localhost:3000 (development)"
echo "  - http://localhost:5173 (Vite dev server)"
echo "  - http://localhost:5174 (Vite dev server alternate)"
echo ""
status "To verify the configuration, run:"
echo "  launchctl getenv OLLAMA_ORIGINS"
echo ""
status "To start using Ollama with Auditomatic Lite:"
echo "  1. Make sure Ollama is running (check menu bar)"
echo "  2. Pull a model: ollama pull llama3.2"
echo "  3. Visit https://lite.auditomatic.org and enable Ollama in settings"
echo ""