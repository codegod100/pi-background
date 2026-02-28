/**
 * Background Task Tracker Extension
 *
 * Shows when pi is running tasks in the background or when the agent is actively working.
 * Displays status in the footer and provides commands to manage background sessions.
 *
 * Features:
 *   - Shows "● working" when the agent is processing
 *   - Tracks running bash commands (shows command preview while executing)
 *   - Tracks interactive_shell background sessions
 *   - Widget below editor shows running commands and sessions with elapsed time
 *
 * Commands:
 *   /bg         - List active background sessions and running commands
 *   /bg-attach  - Attach to a background session
 *   /bg-dismiss - Dismiss all background sessions
 *
 * Usage:
 *   Place in ~/.pi/agent/extensions/ for auto-discovery
 *   Or run: pi -e ~/.pi/agent/extensions/background-tracker.ts
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

interface BackgroundSession {
	id: string;
	command: string;
	startTime: number;
	mode: "hands-free" | "dispatch";
}

interface RunningCommand {
	command: string;
	startTime: number;
}

export default function (pi: ExtensionAPI) {
	const backgroundSessions = new Map<string, BackgroundSession>();
	const runningCommands = new Map<string, RunningCommand>();
	let agentWorking = false;
	let agentStartTime = 0;
	let widgetInterval: ReturnType<typeof setInterval> | null = null;

	function updateDisplay(ctx: ExtensionContext) {
		const theme = ctx.ui.theme;
		const parts: string[] = [];

		// Show running bash commands
		if (runningCommands.size > 0) {
			for (const [cmd] of runningCommands) {
				const cmdPreview = cmd.length > 30 ? cmd.slice(0, 30) + "..." : cmd;
				parts.push(theme.fg("info", `▶ ${cmdPreview}`));
			}
		}

		// Show agent working status
		if (agentWorking) {
			const elapsed = Math.floor((Date.now() - agentStartTime) / 1000);
			const time = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m${elapsed % 60}s`;
			parts.push(theme.fg("warning", `● working ${time}`));
		}

		// Show background sessions count
		const bgCount = backgroundSessions.size;
		if (bgCount > 0) {
			parts.push(theme.fg("accent", `⚙ ${bgCount} bg`));
		}

		if (parts.length === 0) {
			ctx.ui.setStatus("background-tracker", undefined);
		} else {
			ctx.ui.setStatus("background-tracker", parts.join("  "));
		}
	}

	function updateWidget(ctx: ExtensionContext) {
		const cmdCount = runningCommands.size;
		const bgCount = backgroundSessions.size;

		if (cmdCount === 0 && bgCount === 0 && !agentWorking) {
			ctx.ui.setWidget("background-tracker", undefined);
			return;
		}

		ctx.ui.setWidget("background-tracker", (tui, theme) => {
			const lines: string[] = [];

			// Show agent status
			if (agentWorking) {
				const elapsed = Math.floor((Date.now() - agentStartTime) / 1000);
				const mins = Math.floor(elapsed / 60);
				const secs = elapsed % 60;
				const time = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
				lines.push(theme.fg("warning", `● Agent working for ${time}`));
			}

			// Show running bash commands
			if (cmdCount > 0) {
				lines.push(theme.fg("info", theme.bold(`\nRunning Commands (${cmdCount})`)));
				for (const [cmd] of runningCommands) {
					const elapsed = Math.floor((Date.now() - runningCommands.get(cmd)!.startTime) / 1000);
					const mins = Math.floor(elapsed / 60);
					const secs = elapsed % 60;
					const time = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
					const cmdPreview = cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd;
					lines.push(theme.fg("dim", `  ▶ ${cmdPreview} (${time})`));
				}
			}

			// Show background sessions
			if (bgCount > 0) {
				lines.push(theme.fg("accent", theme.bold(`\nBackground Sessions (${bgCount})`)));
				let i = 1;
				for (const [id, session] of backgroundSessions) {
					const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
					const mins = Math.floor(elapsed / 60);
					const secs = elapsed % 60;
					const time = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
					const icon = session.mode === "dispatch" ? "⚡" : "🔄";
					const cmdPreview = session.command.length > 40
						? session.command.slice(0, 40) + "..."
						: session.command;
					lines.push(theme.fg("dim", `  ${i}. ${icon} ${cmdPreview} (${time})`));
					i++;
				}
			}

			return new Text(lines.join("\n"), 0, 0);
		}, { placement: "belowEditor" });
	}

	function startUpdates(ctx: ExtensionContext) {
		if (widgetInterval) return;
		widgetInterval = setInterval(() => {
			updateDisplay(ctx);
			updateWidget(ctx);
		}, 1000);
	}

	function stopUpdates() {
		if (widgetInterval) {
			clearInterval(widgetInterval);
			widgetInterval = null;
		}
	}

	// Track agent working state
	pi.on("agent_start", async (_event, ctx) => {
		agentWorking = true;
		agentStartTime = Date.now();
		updateDisplay(ctx);
		startUpdates(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		agentWorking = false;
		updateDisplay(ctx);
		if (backgroundSessions.size === 0 && runningCommands.size === 0) {
			stopUpdates();
			ctx.ui.setWidget("background-tracker", undefined);
		} else {
			updateWidget(ctx);
		}
	});

	// Track interactive_shell background sessions
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "interactive_shell") return;

		const input = event.input as {
			command?: string;
			mode?: string;
			background?: boolean;
			sessionId?: string;
			listBackground?: boolean;
			dismissBackground?: boolean | string;
			attach?: string;
		};

		// Track dismiss operations
		if (input.dismissBackground) {
			if (input.dismissBackground === true) {
				backgroundSessions.clear();
			} else if (typeof input.dismissBackground === "string") {
				backgroundSessions.delete(input.dismissBackground);
			}
			updateDisplay(ctx);
			return;
		}

		// Track attach operations (session comes to foreground)
		if (input.attach) {
			backgroundSessions.delete(input.attach);
			updateDisplay(ctx);
			return;
		}

		// New background session
		const isBackground = input.background === true;
		const isHandsFree = input.mode === "hands-free";
		const isDispatch = input.mode === "dispatch";

		if (isBackground || isHandsFree || isDispatch) {
			const command = input.command || "unknown";
			const mode = isDispatch ? "dispatch" : "hands-free";
			// Store for result handler
			(event as any)._pendingBackground = { command, mode };
		}
	});

	// Extract session ID from result
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "interactive_shell") return;

		const pending = (event as any)._pendingBackground;
		if (!pending) return;

		const content = event.content;
		if (!Array.isArray(content)) return;

		for (const part of content) {
			if (part.type !== "text" || !part.text) continue;

			// Match sessionId in various formats
			// The interactive_shell tool returns: "sessionId": "calm-reef" or similar
			const match = part.text.match(/sessionId["\s:]+["']?([a-z0-9-]+)/i);
			if (match) {
				const sessionId = match[1];
				backgroundSessions.set(sessionId, {
					id: sessionId,
					command: pending.command,
					startTime: Date.now(),
					mode: pending.mode,
				});
				updateDisplay(ctx);
				startUpdates(ctx);
				break;
			}
		}
	});

	// Track bash commands
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;

		const input = event.input as { command?: string };
		const command = input.command || "unknown";
		runningCommands.set(command, {
			command,
			startTime: Date.now(),
		});
		updateDisplay(ctx);
		startUpdates(ctx);
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "bash") return;

		const input = (event as any).input as { command?: string } | undefined;
		const command = input?.command || "unknown";
		runningCommands.delete(command);
		updateDisplay(ctx);
		if (runningCommands.size === 0 && backgroundSessions.size === 0 && !agentWorking) {
			stopUpdates();
			ctx.ui.setWidget("background-tracker", undefined);
		} else {
			updateWidget(ctx);
		}
	});

	// Command: List background sessions and running commands
	pi.registerCommand("bg", {
		description: "List active background sessions and running commands",
		handler: async (_args, ctx) => {
			const status = agentWorking ? "Agent is working" : "Agent is idle";
			const cmdCount = runningCommands.size;
			const bgCount = backgroundSessions.size;

			if (cmdCount === 0 && bgCount === 0) {
				ctx.ui.notify(`${status}\nNo running commands or background sessions`, "info");
				return;
			}

			const lines = [status];

			if (cmdCount > 0) {
				lines.push(`Running commands (${cmdCount}):`);
				for (const [cmd] of runningCommands) {
					const elapsed = Math.floor((Date.now() - runningCommands.get(cmd)!.startTime) / 1000);
					const time = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m`;
					lines.push(`  ▶ ${cmd.slice(0, 50)} (${time})`);
				}
			}

			if (bgCount > 0) {
				lines.push(`Background sessions (${bgCount}):`);
				for (const [id, session] of backgroundSessions) {
					const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
					const time = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m`;
					const icon = session.mode === "dispatch" ? "⚡" : "🔄";
					lines.push(`  ${icon} ${session.command.slice(0, 50)} (${time}) [${id}]`);
				}
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// Command: Attach to background session
	pi.registerCommand("bg-attach", {
		description: "Attach to a background session by ID",
		getArgumentCompletions: (prefix: string) => {
			const items = [...backgroundSessions.keys()].map(id => ({
				value: id,
				label: `${id} - ${backgroundSessions.get(id)?.command.slice(0, 30)}`
			}));
			return items.filter(i => i.value.startsWith(prefix));
		},
		handler: async (args, ctx) => {
			if (backgroundSessions.size === 0) {
				ctx.ui.notify("No active background sessions", "warning");
				return;
			}

			// No args - show selection dialog
			if (!args) {
				if (!ctx.hasUI) {
					ctx.ui.notify("Specify session ID. Use /bg to list sessions.", "warning");
					return;
				}

				const items = [...backgroundSessions.entries()].map(([id, s]) => ({
					value: id,
					label: `${s.mode === "dispatch" ? "⚡" : "🔄"} ${s.command.slice(0, 40)} (${id.slice(0, 8)})`
				}));

				const choice = await ctx.ui.select("Select session:", items.map(i => i.label));
				if (choice !== undefined) {
					const sessionId = items[choice].value;
					pi.sendUserMessage(`/attach ${sessionId}`);
					backgroundSessions.delete(sessionId);
					if (backgroundSessions.size === 0 && !agentWorking) {
						stopUpdates();
						ctx.ui.setWidget("background-tracker", undefined);
					}
					updateDisplay(ctx);
				}
				return;
			}

			// Match by partial ID
			const partialId = args.trim();
			for (const [id] of backgroundSessions) {
				if (id.startsWith(partialId)) {
					pi.sendUserMessage(`/attach ${id}`);
					backgroundSessions.delete(id);
					if (backgroundSessions.size === 0 && !agentWorking) {
						stopUpdates();
						ctx.ui.setWidget("background-tracker", undefined);
					}
					updateDisplay(ctx);
					return;
				}
			}

			ctx.ui.notify(`No session found starting with "${partialId}"`, "error");
		},
	});

	// Command: Dismiss all background sessions
	pi.registerCommand("bg-dismiss", {
		description: "Dismiss all background sessions",
		handler: async (_args, ctx) => {
			if (backgroundSessions.size === 0) {
				ctx.ui.notify("No active background sessions", "info");
				return;
			}

			const count = backgroundSessions.size;

			if (ctx.hasUI) {
				const ok = await ctx.ui.confirm(
					"Dismiss all background sessions?",
					`${count} session(s) will be killed`
				);
				if (!ok) {
					ctx.ui.notify("Cancelled", "info");
					return;
				}
			}

			// Note: This just clears our tracking. To actually kill sessions,
			// the LLM would need to call interactive_shell with dismissBackground: true
			backgroundSessions.clear();
			if (!agentWorking) {
				stopUpdates();
				ctx.ui.setWidget("background-tracker", undefined);
			}
			updateDisplay(ctx);
			ctx.ui.notify(`Dismissed ${count} background session(s)`, "success");
		},
	});

	// Cleanup on shutdown
	pi.on("session_shutdown", async (_event, ctx) => {
		backgroundSessions.clear();
		runningCommands.clear();
		agentWorking = false;
		stopUpdates();
		ctx.ui.setStatus("background-tracker", undefined);
		ctx.ui.setWidget("background-tracker", undefined);
	});

	// Reset on session start
	pi.on("session_start", async (_event, ctx) => {
		backgroundSessions.clear();
		runningCommands.clear();
		agentWorking = false;
		ctx.ui.setStatus("background-tracker", undefined);
		ctx.ui.setWidget("background-tracker", undefined);
	});
}