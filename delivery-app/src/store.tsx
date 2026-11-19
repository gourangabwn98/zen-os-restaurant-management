// App state: session, the server snapshot (GET /delivery/me), live Socket.IO
// events, offers, the GPS service, connectivity and an in-app event log.
// Every decision (who wins an order, capacity, pickup readiness, OTP, COD)
// is made by the server; this keeps the screens in step with it.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, Vibration } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { api, ApiError, configureApi, serverRoot } from './api';
import { BUILD, Zen, zenEvents, TrackingEvent } from './native';
import type { LatLng } from './geo';

export type Offer = { jobId: string; orderNo: string; expiresAt: string; pickup: any; drop: LatLng; distanceMeters: number | null; cod: boolean };
export type Job = {
  jobId: string; orderId: string; orderNo: string; status: string; pickup: any; drop: any; distanceMeters: number | null;
  orderStatus: string | null; canPickUp: boolean; items: { name: string; qty: number }[]; notes: string; otpAttempts: number;
  payment: { method: string; paid: boolean; collectCash: boolean; amount: number } | null;
  assignedAt: string; pickedUpAt?: string; deliveredAt?: string; failReason?: string;
};
export type Snapshot = {
  partner: { id: string; name: string; phone: string };
  restaurant: { name: string; phone: string; latitude: number | null; longitude: number | null; address: string };
  state: { online: boolean; suspended: boolean; suspendedReason: string; activeCount: number; capacity: number; lastSeenAt: string | null };
  activeJobs: Job[]; offers: Offer[];
  today: { assigned: number; delivered: number; failed: number; active: number; avgDeliveryMinutes: number | null; avgRideMinutes: number | null };
};
export type LogEntry = { id: string; at: number; title: string; body: string; tone: 'info' | 'good' | 'warn' | 'bad' };
type Session = { token: string; name: string; phone: string };

type Ctx = {
  ready: boolean; session: Session | null; snapshot: Snapshot | null; loading: boolean;
  serverOk: boolean; socketOk: boolean; myLocation: LatLng | null; tracking: { running: boolean; queued: number; note: string };
  offers: Offer[]; log: LogEntry[]; unread: number; apiUrl: string; themeMode: 'system' | 'light' | 'dark';
  login(phone: string, otp: string): Promise<void>; logout(): Promise<void>; refresh(): Promise<void>;
  setOnline(on: boolean): Promise<void>; accept(jobId: string): Promise<Job>; reject(jobId: string): Promise<void>;
  step(jobId: string, step: string, body?: any): Promise<Job>; markLogRead(): void;
  setApiUrl(url: string): Promise<void>; setThemeMode(m: 'system' | 'light' | 'dark'): Promise<void>;
  focusJobId: string | null; setFocusJobId(id: string | null): void; dismissedOffers: Set<string>; dismissOffer(id: string): void;
};

const StoreCtx = createContext<Ctx | null>(null);
export const useStore = () => {
  const c = useContext(StoreCtx);
  if (!c) {throw new Error('useStore outside provider');}
  return c;
};

const uid = () => Math.random().toString(36).slice(2);

async function ensureLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {return false;}
  const fine = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, {
    title: 'Share location during deliveries',
    message: 'Zen OS Delivery shares your location only while you have an active delivery, so customers and the restaurant can see you coming.',
    buttonPositive: 'Allow',
  });
  if (BUILD.sdkInt >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => null);
  }
  return fine === PermissionsAndroid.RESULTS.GRANTED;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [serverOk, setServerOk] = useState(true);
  const [socketOk, setSocketOk] = useState(false);
  const [myLocation, setMyLocation] = useState<LatLng | null>(null);
  const [tracking, setTracking] = useState({ running: false, queued: 0, note: '' });
  const [liveOffers, setLiveOffers] = useState<Record<string, Offer>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [readAt, setReadAt] = useState(0);
  const [apiUrl, setApiUrlState] = useState(BUILD.apiBase);
  const [themeMode, setThemeModeState] = useState<'system' | 'light' | 'dark'>('system');
  const [focusJobId, setFocusJobId] = useState<string | null>(null);
  const [dismissedOffers, setDismissed] = useState<Set<string>>(new Set());
  const socketRef = useRef<Socket | null>(null);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  const addLog = useCallback((title: string, body: string, tone: LogEntry['tone'] = 'info') => {
    setLog((l) => [{ id: uid(), at: Date.now(), title, body, tone }, ...l].slice(0, 100));
  }, []);

  // ── boot: saved server address, theme, session ─────────────────────────────
  useEffect(() => {
    (async () => {
      const [savedUrl, savedTheme, saved] = await Promise.all([
        Zen.secureGet('apiUrl').catch(() => null), Zen.secureGet('theme').catch(() => null), Zen.secureGet('session').catch(() => null),
      ]);
      const url = savedUrl || BUILD.apiBase;
      setApiUrlState(url);
      if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {setThemeModeState(savedTheme);}
      configureApi({ base: url, onReachability: setServerOk });
      if (saved) {
        try {
          const s = JSON.parse(saved) as Session;
          configureApi({ token: s.token });
          setSession(s);
        } catch { /* corrupt → login again */ }
      }
      setReady(true);
    })();
  }, []);

  const logout = useCallback(async () => {
    await Zen.stopTracking().catch(() => null);
    socketRef.current?.close();
    socketRef.current = null;
    await Zen.secureRemove('session').catch(() => null);
    configureApi({ token: null });
    setSession(null);
    setSnapshot(null);
    setLiveOffers({});
  }, []);

  useEffect(() => { configureApi({ onAuthLost: () => { logout(); } }); }, [logout]);

  const refresh = useCallback(async () => {
    if (!sessionRef.current) {return;}
    setLoading(true);
    try {
      const s = await api<Snapshot>('GET', '/delivery/me');
      setSnapshot(s);
      // Server's open offers are the truth; drop any live card it no longer lists.
      setLiveOffers(Object.fromEntries(s.offers.map((o) => [o.jobId, o])));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {await logout();}
    } finally {
      setLoading(false);
    }
  }, [logout]);

  const login = useCallback(async (phone: string, otp: string) => {
    const r = await api<any>('POST', '/auth/employee/verify-otp', { phone, otp });
    if (r.role !== 'delivery') {throw new ApiError('This app is for delivery partners. Use the Zen OS staff apps for other roles.', 403);}
    const s: Session = { token: r.token, name: r.name || '', phone: r.phone || phone };
    await Zen.secureSet('session', JSON.stringify(s));
    configureApi({ token: s.token });
    setSession(s);
    addLog('Signed in', `Welcome, ${s.name || 'partner'}`, 'good');
  }, [addLog]);

  // ── socket: own room only (server-side), reconnects with backoff ───────────
  useEffect(() => {
    if (!session) {return undefined;}
    refresh();
    const s = io(serverRoot(), { auth: { token: session.token }, transports: ['websocket'], reconnectionDelayMax: 10000 });
    socketRef.current = s;
    s.on('connect', () => { setSocketOk(true); refresh(); });
    s.on('disconnect', () => setSocketOk(false));
    s.on('connect_error', () => setSocketOk(false));
    s.on('delivery:request_received', ({ offer }: { offer: Offer }) => {
      setLiveOffers((m) => ({ ...m, [offer.jobId]: offer }));
      Vibration.vibrate([0, 350, 150, 350]);
      addLog('New delivery request', `Order #${offer.orderNo}${offer.cod ? ' · Cash on delivery' : ''}`, 'info');
    });
    const dropOffer = (title: string) => ({ jobId }: { jobId: string }) => {
      setLiveOffers((m) => { const n = { ...m }; delete n[jobId]; return n; });
      addLog(title, '', 'warn');
    };
    s.on('delivery:request_expired', dropOffer('A request expired'));
    s.on('delivery:already_assigned', dropOffer('Order taken by another partner'));
    const jobChanged = (title: string, tone: LogEntry['tone']) => (p: any) => { if (p?.job?.orderNo) {addLog(title, `#${p.job.orderNo}`, tone);} refresh(); };
    s.on('delivery:accepted', jobChanged('Order assigned to you', 'good'));
    s.on('delivery:job_updated', (p: any) => { if (p?.job?.canPickUp && p.job.status !== 'PICKED_UP') {addLog('Ready for pickup', `#${p.job.orderNo}`, 'good');} refresh(); });
    s.on('delivery:completed', jobChanged('Delivered', 'good'));
    s.on('delivery:job_removed', (p: any) => { addLog(p?.reason === 'CANCELLED' ? 'Delivery cancelled' : 'Delivery reassigned by the restaurant', '', 'bad'); refresh(); });
    s.on('delivery:capacity_updated', () => refresh());
    s.on('delivery:presence', (p: any) => { addLog('You are offline', p?.reason === 'SUSPENDED' ? 'Account suspended' : p?.reason === 'INACTIVE' ? 'No signal for a while' : 'Set by the restaurant', 'warn'); refresh(); });
    s.on('delivery:cash_updated', () => addLog('Cash hand-in verified', '', 'good'));
    return () => { s.close(); socketRef.current = null; setSocketOk(false); };
  }, [session, refresh, addLog]);

  // Refresh when the app returns to the foreground, and every 30 s while visible.
  useEffect(() => {
    if (!session) {return undefined;}
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') {refresh();} });
    const t = setInterval(() => { if (AppState.currentState === 'active') {refresh();} }, 30000);
    return () => { sub.remove(); clearInterval(t); };
  }, [session, refresh]);

  // Presence heartbeat while online and visible.
  const online = !!snapshot?.state.online;
  useEffect(() => {
    if (!session || !online) {return undefined;}
    const beat = () => { if (AppState.currentState === 'active') {api('POST', '/delivery/me/heartbeat').catch(() => null);} };
    beat();
    const t = setInterval(beat, 60000);
    return () => clearInterval(t);
  }, [session, online]);

  // Push token → server (only exists when the build has Firebase configured).
  useEffect(() => {
    if (!session) {return;}
    Zen.getPushToken().then((tok) => { if (tok) {api('POST', '/delivery/me/push-token', { token: tok }).catch(() => null);} }).catch(() => null);
    Zen.consumeTappedOffer().then((id) => { if (id) {refresh();} }).catch(() => null);
    const sub = zenEvents.addListener('ZenOfferTapped', () => refresh());
    return () => sub.remove();
  }, [session, refresh]);

  // ── GPS service: on exactly while there are active deliveries ──────────────
  const activeCount = snapshot?.activeJobs.length ?? 0;
  useEffect(() => {
    if (!session) {return;}
    (async () => {
      if (activeCount > 0) {
        const ok = await ensureLocationPermission();
        if (!ok) { setTracking((t) => ({ ...t, running: false, note: 'Location permission is off — customers can’t see you.' })); return; }
        try {
          await Zen.startTracking(apiUrl, session.token, `${activeCount} active ${activeCount === 1 ? 'delivery' : 'deliveries'} · sharing location`);
          const st = await Zen.trackingStatus();
          setTracking({ running: st.running || true, queued: st.queued, note: '' });
        } catch (e: any) {
          setTracking((t) => ({ ...t, running: false, note: e?.message || 'Could not start location sharing' }));
        }
      } else {
        await Zen.stopTracking().catch(() => null);
        setTracking({ running: false, queued: 0, note: '' });
      }
    })();
  }, [session, activeCount, apiUrl]);

  useEffect(() => {
    const sub = zenEvents.addListener('ZenTracking', (e: TrackingEvent) => {
      if (e.type === 'location') {setMyLocation({ latitude: e.latitude, longitude: e.longitude });}
      if (e.type === 'uploaded') {setTracking((t) => ({ ...t, running: true, queued: e.queued, note: '' }));}
      if (e.type === 'error') {setTracking((t) => ({ ...t, queued: e.queued ?? t.queued, note: e.message === 'NETWORK' ? 'No network — locations are saved and will be sent.' : e.message === 'FOREGROUND_NOT_ALLOWED' ? 'Open the app to resume location sharing.' : `Location upload problem (${e.message})` }));}
      if (e.type === 'stopped') {
        setTracking({ running: false, queued: 0, note: '' });
        if (e.reason === 'AUTH') {logout();}
        if (e.reason === 'PERMISSION_REVOKED') {addLog('Location permission removed', 'Customers can no longer see you', 'bad');}
      }
    });
    return () => sub.remove();
  }, [logout, addLog]);

  // ── actions ────────────────────────────────────────────────────────────────
  const setOnline = useCallback(async (on: boolean) => {
    await api('POST', '/delivery/me/online', { online: on });
    addLog(on ? 'You are online' : 'You are offline', on ? 'New requests will reach you' : '', on ? 'good' : 'info');
    await refresh();
  }, [refresh, addLog]);

  const accept = useCallback(async (jobId: string) => {
    try {
      const r = await api<{ job: Job }>('POST', `/delivery/offers/${jobId}/accept`);
      setLiveOffers((m) => { const n = { ...m }; delete n[jobId]; return n; });
      await refresh();
      return r.job;
    } catch (e) {
      if (e instanceof ApiError && ['ALREADY_ASSIGNED', 'OFFER_GONE'].includes(e.code || '')) {
        setLiveOffers((m) => { const n = { ...m }; delete n[jobId]; return n; });
      }
      throw e;
    }
  }, [refresh]);

  const reject = useCallback(async (jobId: string) => {
    setLiveOffers((m) => { const n = { ...m }; delete n[jobId]; return n; });
    await api('POST', `/delivery/offers/${jobId}/reject`).catch(() => null);
  }, []);

  const step = useCallback(async (jobId: string, s: string, body?: any) => {
    const r = await api<{ job: Job }>('POST', `/delivery/jobs/${jobId}/${s}`, body || {});
    await refresh();
    return r.job;
  }, [refresh]);

  const setApiUrl = useCallback(async (url: string) => {
    const clean = url.trim().replace(/\/+$/, '');
    await Zen.secureSet('apiUrl', clean);
    configureApi({ base: clean });
    setApiUrlState(clean);
  }, []);
  const setThemeMode = useCallback(async (m: 'system' | 'light' | 'dark') => { setThemeModeState(m); await Zen.secureSet('theme', m).catch(() => null); }, []);
  const dismissOffer = useCallback((id: string) => setDismissed((s) => new Set(s).add(id)), []);

  // Offers still open (by the clock) and not dismissed on this phone.
  const [now, setNow] = useState(Date.now());
  const hasLiveOffers = Object.keys(liveOffers).length > 0;
  useEffect(() => {
    if (!hasLiveOffers) {return undefined;} // the 1 s clock runs only while a request is on screen
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasLiveOffers]);
  const offers = useMemo(() => Object.values(liveOffers).filter((o) => new Date(o.expiresAt).getTime() > now)
    .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime()), [liveOffers, now]);

  const value: Ctx = {
    ready, session, snapshot, loading, serverOk, socketOk, myLocation, tracking, offers, log,
    unread: log.filter((l) => l.at > readAt).length, apiUrl, themeMode,
    login, logout, refresh, setOnline, accept, reject, step, markLogRead: () => setReadAt(Date.now()),
    setApiUrl, setThemeMode, focusJobId, setFocusJobId, dismissedOffers, dismissOffer,
  };
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
