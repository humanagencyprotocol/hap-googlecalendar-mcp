/**
 * Google Calendar API client — Calendar v3 REST.
 *
 * Auth: reads OAuth2 access token from GOOGLE_CALENDAR_ACCESS_TOKEN env var.
 * The HAP gateway injects the token at spawn time after the user completes
 * the OAuth flow in the UI; the vault is the source of truth.
 */

const API_BASE = 'https://www.googleapis.com/calendar/v3';

function getAccessToken(): string {
  const token = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
  if (!token) throw new Error('GOOGLE_CALENDAR_ACCESS_TOKEN not set');
  return token;
}

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${getAccessToken()}` };
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
  const res = await fetch(`${API_BASE}/users/me/calendarList`, { headers: authHeader() });
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
  const res = await fetch(url, { headers: authHeader() });
  const data = await handle<{ items: CalendarEvent[] }>(res, 'list_events');
  return data.items ?? [];
}

export async function getEvent(calendarId: string, eventId: string): Promise<CalendarEvent> {
  const cal = encodeURIComponent(calendarId);
  const evt = encodeURIComponent(eventId);
  const res = await fetch(`${API_BASE}/calendars/${cal}/events/${evt}`, { headers: authHeader() });
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
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
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
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
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
    headers: authHeader(),
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
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handle<FreeBusyResponse>(res, 'free_busy');
}
