# @nandithebull/pi-background

Background task tracker extension for [pi](https://github.com/mariozechner/pi-coding-agent).

Shows when pi is running tasks in the background or when the agent is actively working. Displays status in the footer and provides commands to manage background sessions.

## Features

- Shows "● working" when the agent is processing
- Tracks running bash commands (shows command preview while executing)
- Tracks interactive_shell background sessions
- Widget below editor shows running commands and sessions with elapsed time

## Installation

```bash
npm install @nandithebull/pi-background
```

Or run directly with pi:

```bash
pi -e @nandithebull/pi-background
```

## Commands

| Command | Description |
|---------|-------------|
| `/bg` | List active background sessions and running commands |
| `/bg-attach` | Attach to a background session |
| `/bg-dismiss` | Dismiss all background sessions |

## Usage

The extension automatically tracks:
- Agent working state (shows timer while processing)
- Running bash commands with elapsed time
- Background interactive_shell sessions (hands-free and dispatch modes)

Place in `~/.pi/agent/extensions/` for auto-discovery.

## License

MIT