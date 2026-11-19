// REST client for the Zen OS backend (/api). The server is authoritative for
// everything — this only sends the rider's intent and shows the server's answer.
export class ApiError extends Error {
  status: number;
  code?: string;
  details?: any;
  offline: boolean;
  constructor(message: string, status = 0, code?: string, details?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.offline = status === 0;
  }
}
//hello
let base = '';
let token: string | null = null;
let onAuthLost: (() => void) | null = null;
let onReachability: ((ok: boolean) => void) | null = null;

export const configureApi = (opts: { base?: string; token?: string | null; onAuthLost?: () => void; onReachability?: (ok: boolean) => void }) => {
  if (opts.base !== undefined) {base = opts.base.replace(/\/+$/, '');}
  if (opts.token !== undefined) {token = opts.token;}
  if (opts.onAuthLost) {onAuthLost = opts.onAuthLost;}
  if (opts.onReachability) {onReachability = opts.onReachability;}
};
export const apiBase = () => base;
export const serverRoot = () => base.replace(/\/api$/i, '');

const FRIENDLY: Record<string, string> = {
  ALREADY_ASSIGNED: 'Another partner accepted this order first.',
  OFFER_GONE: 'This request has expired.',
  CAPACITY_FULL: "You're at your delivery limit — finish a delivery first.",
  ORDER_NOT_READY: "The kitchen hasn't marked this order ready yet.",
  HAS_ACTIVE_DELIVERIES: 'Finish your active deliveries before going offline.',
  SUSPENDED: 'Your account is suspended — please contact the restaurant.',
  OTP_LOCKED: 'Too many wrong codes. Ask the restaurant to reset the delivery code.',
};

export async function api<T = any>(method: string, path: string, body?: any, timeoutMs = 15000): Promise<T> {
  if (!base) {throw new ApiError('Server address is not set — open Settings.', 0, 'NO_SERVER');}
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    onReachability?.(false);
    throw new ApiError(e?.name === 'AbortError' ? 'The server is taking too long. Check your connection.' : 'No connection to the server.', 0, 'OFFLINE');
  } finally {
    clearTimeout(timer);
  }
  onReachability?.(true);
  const data: any = await res.json().catch(() => ({}));
  if (res.ok) {return data as T;}
  if ((res.status === 401 && data?.code === 'SESSION_EXPIRED') || data?.code === 'ACCOUNT_INACTIVE') {onAuthLost?.();}
  throw new ApiError(FRIENDLY[data?.code] || data?.message || `Request failed (${res.status})`, res.status, data?.code, data?.details);
}
