/**
 * Google Calendar API client — Calendar v3 REST.
 *
 * Auth: exchanges OAuth2 refresh_token → short-lived access_token on each
 * call (cached until expiry). The HAP gateway injects client_id, client_secret
 * and refresh_token as env vars after the user completes the OAuth flow in
 * the UI; the vault is the source of truth.
 *
 * Env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_CALENDAR_REFRESH_TOKEN
 */

const API_BASE = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface TokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let tokenCache: TokenCache | null = null;
// Refresh 60s before actual expiry so a request that starts just under the wire
// doesn't land on an expired token server-side.
const TOKEN_SKEW_MS = 60_000;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - TOKEN_SKEW_MS > now) {
    return tokenCache.accessToken;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    const missing: string[] = [];
    if (!clientId) missing.push('GOOGLE_CLIENT_ID');
    if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
    if (!refreshToken) missing.push('GOOGLE_CALENDAR_REFRESH_TOKEN');
    throw new Error(`Missing OAuth env vars: ${missing.join(', ')}`);
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OAuth refresh failed (${res.status}): ${body}`);
  }
  const data = await res.json() as { access_token: string; expires_in: number; error?: string };
  if (data.error || !data.access_token) {
    throw new Error(`OAuth refresh error: ${data.error ?? 'no access_token in response'}`);
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + (data.expires_in * 1000),
  };
  return tokenCache.accessToken;
}

async function authHeader(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getAccessToken()}` };
}

async function handle<T>(res: Response, op: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${op} failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: string;
  timeZone?: string;
  backgroundColor?: string;
}

export interface EventDateTime {
  dateTime?: string; // RFC3339 for timed events
  date?: string;     // YYYY-MM-DD for all-day events
  timeZone?: string;
}

export interface CalendarEvent {
  id: string;
  status: string;
  summary?: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  attendees?: Array<{ email: string; responseStatus?: string }>;
  htmlLink?: string;
  created?: string;
  updated?: string;
  recurrence?: string[];
}

// ─── Calendars ───────────────────────────────────────────────────────────────

export async function listCalendars(): Promise<CalendarListEntry[]> {
  const res = await fetch(`${API_BASE}/users/me/calendarList`, { headers: await authHeader() });
  const data = await handle<{ items: CalendarListEntry[] }>(res, 'list_calendars');
  return data.items ?? [];
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface ListEventsParams {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  q?: string;
  maxResults?: number;
  singleEvents?: boolean;
  orderBy?: 'startTime' | 'updated';
}

export async function listEvents(params: ListEventsParams = {}): Promise<CalendarEvent[]> {
  const cal = encodeURIComponent(params.calendarId ?? 'primary');
  const qs = new URLSearchParams();
  if (params.timeMin) qs.set('timeMin', params.timeMin);
  if (params.timeMax) qs.set('timeMax', params.timeMax);
  if (params.q) qs.set('q', params.q);
  if (params.maxResults) qs.set('maxResults', String(params.maxResults));
  if (params.singleEvents !== undefined) qs.set('singleEvents', String(params.singleEvents));
  if (params.orderBy) qs.set('orderBy', params.orderBy);

  const url = `${API_BASE}/calendars/${cal}/events${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url, { headers: await authHeader() });
  const data = await handle<{ items: CalendarEvent[] }>(res, 'list_events');
  return data.items ?? [];
}

export async function getEvent(calendarId: string, eventId: string): Promise<CalendarEvent> {
  const cal = encodeURIComponent(calendarId);
  const evt = encodeURIComponent(eventId);
  const res = await fetch(`${API_BASE}/calendars/${cal}/events/${evt}`, { headers: await authHeader() });
  return handle<CalendarEvent>(res, 'get_event');
}

export interface CreateEventParams {
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  attendees?: Array<{ email: string }>;
  sendUpdates?: 'all' | 'externalOnly' | 'none';
}

export async function createEvent(params: CreateEventParams): Promise<CalendarEvent> {
  const cal = encodeURIComponent(params.calendarId ?? 'primary');
  const qs = params.sendUpdates ? `?sendUpdates=${params.sendUpdates}` : '';
  const { calendarId: _cid, sendUpdates: _s, ...body } = params;
  const res = await fetch(`${API_BASE}/calendars/${cal}/events${qs}`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handle<CalendarEvent>(res, 'create_event');
}

export interface UpdateEventParams {
  calendarId?: string;
  eventId: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: EventDateTime;
  end?: EventDateTime;
  attendees?: Array<{ email: string }>;
  sendUpdates?: 'all' | 'externalOnly' | 'none';
}

export async function updateEvent(params: UpdateEventParams): Promise<CalendarEvent> {
  const cal = encodeURIComponent(params.calendarId ?? 'primary');
  const evt = encodeURIComponent(params.eventId);
  const qs = params.sendUpdates ? `?sendUpdates=${params.sendUpdates}` : '';
  const { calendarId: _cid, eventId: _eid, sendUpdates: _s, ...body } = params;
  const res = await fetch(`${API_BASE}/calendars/${cal}/events/${evt}${qs}`, {
    method: 'PATCH',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handle<CalendarEvent>(res, 'update_event');
}

export async function deleteEvent(
  calendarId: string,
  eventId: string,
  sendUpdates?: 'all' | 'externalOnly' | 'none',
): Promise<void> {
  const cal = encodeURIComponent(calendarId);
  const evt = encodeURIComponent(eventId);
  const qs = sendUpdates ? `?sendUpdates=${sendUpdates}` : '';
  const res = await fetch(`${API_BASE}/calendars/${cal}/events/${evt}${qs}`, {
    method: 'DELETE',
    headers: await authHeader(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`delete_event failed (${res.status}): ${body}`);
  }
}

// ─── Free/busy ───────────────────────────────────────────────────────────────

export interface FreeBusyQuery {
  timeMin: string;
  timeMax: string;
  calendarIds?: string[];
}

export interface FreeBusyResponse {
  calendars: Record<string, { busy: Array<{ start: string; end: string }> }>;
}

export async function freeBusy(query: FreeBusyQuery): Promise<FreeBusyResponse> {
  const body = {
    timeMin: query.timeMin,
    timeMax: query.timeMax,
    items: (query.calendarIds ?? ['primary']).map(id => ({ id })),
  };
  const res = await fetch(`${API_BASE}/freeBusy`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handle<FreeBusyResponse>(res, 'free_busy');
}
