#!/usr/bin/env node
/**
 * Google Calendar MCP Server for the Human Agency Protocol.
 *
 * Exposes Calendar v3 operations as MCP tools. The HAP gateway gates each
 * tool against an active calendar-profile attestation and injects the OAuth
 * access token from the vault as GOOGLE_CALENDAR_ACCESS_TOKEN.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as api from './google-calendar-api.js';

const server = new McpServer({
  name: 'google-calendar-mcp',
  version: '0.1.0',
});

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}
function err(e: unknown) {
  return { content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }], isError: true };
}

// ─── Read tools ──────────────────────────────────────────────────────────────

server.tool(
  'list_calendars',
  'List the calendars the authenticated user has access to.',
  {},
  async () => {
    try {
      const cals = await api.listCalendars();
      return ok(JSON.stringify(cals, null, 2));
    } catch (e) { return err(e); }
  },
);

server.tool(
  'list_events',
  'List events in a calendar within an optional time window.',
  {
    calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
    timeMin: z.string().optional().describe('Lower bound (RFC3339, e.g. 2026-04-22T00:00:00Z)'),
    timeMax: z.string().optional().describe('Upper bound (RFC3339)'),
    q: z.string().optional().describe('Free-text search'),
    maxResults: z.number().int().min(1).max(250).optional().describe('Max events to return (default: 25)'),
    singleEvents: z.boolean().optional().describe('Expand recurring events into instances (default: true)'),
    orderBy: z.enum(['startTime', 'updated']).optional(),
  },
  async (args) => {
    try {
      const events = await api.listEvents({
        calendarId: args.calendarId,
        timeMin: args.timeMin,
        timeMax: args.timeMax,
        q: args.q,
        maxResults: args.maxResults ?? 25,
        singleEvents: args.singleEvents ?? true,
        orderBy: args.orderBy,
      });
      return ok(JSON.stringify(events, null, 2));
    } catch (e) { return err(e); }
  },
);

server.tool(
  'get_event',
  'Fetch a single event by ID.',
  {
    calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
    eventId: z.string().describe('Event ID'),
  },
  async ({ calendarId, eventId }) => {
    try {
      const event = await api.getEvent(calendarId ?? 'primary', eventId);
      return ok(JSON.stringify(event, null, 2));
    } catch (e) { return err(e); }
  },
);

server.tool(
  'free_busy',
  'Query free/busy information across one or more calendars.',
  {
    timeMin: z.string().describe('Lower bound (RFC3339)'),
    timeMax: z.string().describe('Upper bound (RFC3339)'),
    calendarIds: z.array(z.string()).optional().describe('Calendar IDs to query (default: ["primary"])'),
  },
  async (args) => {
    try {
      const result = await api.freeBusy(args);
      return ok(JSON.stringify(result, null, 2));
    } catch (e) { return err(e); }
  },
);

// ─── Write tools ─────────────────────────────────────────────────────────────

server.tool(
  'create_event',
  'Create a new calendar event.',
  {
    calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
    summary: z.string().describe('Event title'),
    description: z.string().optional(),
    location: z.string().optional(),
    start: z.object({
      dateTime: z.string().optional().describe('RFC3339 timestamp for timed events'),
      date: z.string().optional().describe('YYYY-MM-DD for all-day events'),
      timeZone: z.string().optional(),
    }).describe('Event start (exactly one of dateTime or date)'),
    end: z.object({
      dateTime: z.string().optional(),
      date: z.string().optional(),
      timeZone: z.string().optional(),
    }).describe('Event end (exactly one of dateTime or date)'),
    attendees: z.array(z.object({ email: z.string().email() })).optional(),
    sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().describe('Who to notify (default: none)'),
  },
  async (args) => {
    try {
      const event = await api.createEvent(args);
      return ok(`Event created. ID: ${event.id}\nLink: ${event.htmlLink ?? '(none)'}`);
    } catch (e) { return err(e); }
  },
);

server.tool(
  'update_event',
  'Patch an existing event. Only provided fields are updated.',
  {
    calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
    eventId: z.string().describe('Event ID to update'),
    summary: z.string().optional(),
    description: z.string().optional(),
    location: z.string().optional(),
    start: z.object({
      dateTime: z.string().optional(),
      date: z.string().optional(),
      timeZone: z.string().optional(),
    }).optional(),
    end: z.object({
      dateTime: z.string().optional(),
      date: z.string().optional(),
      timeZone: z.string().optional(),
    }).optional(),
    attendees: z.array(z.object({ email: z.string().email() })).optional(),
    sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional(),
  },
  async (args) => {
    try {
      const event = await api.updateEvent(args);
      return ok(`Event updated. ID: ${event.id}`);
    } catch (e) { return err(e); }
  },
);

server.tool(
  'delete_event',
  'Delete an event. Destructive — cannot be undone.',
  {
    calendarId: z.string().optional().describe('Calendar ID (default: "primary")'),
    eventId: z.string().describe('Event ID to delete'),
    sendUpdates: z.enum(['all', 'externalOnly', 'none']).optional().describe('Who to notify (default: none)'),
  },
  async ({ calendarId, eventId, sendUpdates }) => {
    try {
      await api.deleteEvent(calendarId ?? 'primary', eventId, sendUpdates);
      return ok(`Event deleted: ${eventId}`);
    } catch (e) { return err(e); }
  },
);

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[google-calendar-mcp] server started');
}

main().catch((e) => {
  console.error('[google-calendar-mcp] Fatal:', e);
  process.exit(1);
});
