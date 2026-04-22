# @humanagencyp/google-calendar-mcp

Google Calendar MCP server for the [Human Agency Protocol](https://humanagencyprotocol.com).

Exposes Google Calendar v3 operations as MCP tools. Designed for use inside the [HAP gateway](https://github.com/humanagencyprotocol/hap-gateway), which gates each tool against an active `calendar@0.4` attestation and injects the OAuth access token from its encrypted vault.

## Tools

| Tool | Category | Description |
|---|---|---|
| `list_calendars` | read | List the user's calendars |
| `list_events` | read | List events (with time window + search) |
| `get_event` | read | Fetch a single event |
| `free_busy` | read | Query free/busy across calendars |
| `create_event` | write | Create a new event |
| `update_event` | write | Patch an existing event |
| `delete_event` | destructive | Delete an event (cannot be undone) |

## Authentication

Reads the OAuth2 access token from `GOOGLE_CALENDAR_ACCESS_TOKEN`. Inside HAP, the gateway supplies this from the vault after the user completes the OAuth flow in the UI — same pattern as [`hap-linkedin-mcp`](https://github.com/humanagencyprotocol/hap-linkedin-mcp).

## Standalone use (outside HAP)

```bash
GOOGLE_CALENDAR_ACCESS_TOKEN="ya29...." npx @humanagencyp/google-calendar-mcp
```

Obtain a token via any Google OAuth2 flow with the scope `https://www.googleapis.com/auth/calendar` (or the narrower `calendar.events` + `calendar.readonly` pair).

## License

MIT — see [LICENSE](LICENSE).
