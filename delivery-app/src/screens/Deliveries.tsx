// Multi-order management: all active deliveries, the stop plan and the map.
// Plan source, in order: the server's Google route (real ETA) → a local
// suggestion (pickup first, then nearest drop; older orders first for
// freshness) with straight-line distance and NO ETA. Always a suggestion —
// the rider chooses; each order keeps its own lifecycle.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { api } from '../api';
import { useStore } from '../store';
import { Zen } from '../native';
import { decodePolyline, fmtKm, fmtMin, isPoint, LatLng, Stop, suggestStops } from '../geo';
import DeliveryMap, { MapStop } from '../components/DeliveryMap';
import { space, useTheme } from '../theme';
import { Button, Card, Empty, IconBubble, Pill, Screen, Section, SkeletonCard, T, styles } from '../ui';
import { JobRow } from './Home';

type Plan = { source: 'google' | 'local'; stops: Stop[]; totalDurationSec?: number | null; polyline?: LatLng[] | null; reason?: string };

export default function Deliveries({ openJob }: { openJob: (id: string) => void }) {
  const t = useTheme();
  const { snapshot, myLocation, refresh, loading } = useStore();
  const jobs = useMemo(() => snapshot?.activeJobs || [], [snapshot]);
  const restaurant = snapshot && isPoint(snapshot.restaurant) ? { latitude: snapshot.restaurant.latitude!, longitude: snapshot.restaurant.longitude! } : null;
  const [server, setServer] = useState<Plan | null>(null);
  const lastAsk = useRef(0);
  const key = jobs.map((j) => `${j.jobId}:${j.status}`).join('|');

  const askServer = useCallback(async (force = false) => {
    if (!jobs.length) { setServer(null); return; }
    if (!force && Date.now() - lastAsk.current < 60000) {return;} // the route API is paid — keep it rare
    lastAsk.current = Date.now();
    try {
      const r: any = await api('POST', '/delivery/me/route', myLocation ? { origin: myLocation } : {});
      if (r.available && r.stops?.length) {
        setServer({ source: 'google', stops: r.stops.map((s: any) => ({ ...s, point: s.point })), totalDurationSec: r.totalDurationSec, polyline: r.polyline ? decodePolyline(r.polyline) : null });
      } else {setServer({ source: 'local', stops: [], reason: r.reason });}
    } catch { setServer(null); }
  }, [jobs.length, myLocation]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { askServer(true); }, [key]);

  const plan: Plan = server?.source === 'google' ? server : { source: 'local', stops: suggestStops(jobs, myLocation, restaurant), reason: server?.reason };
  const next = plan.stops[0];
  const mapStops: MapStop[] = [
    ...(restaurant && plan.stops.some((s) => s.kind === 'PICKUP') ? [{ id: 'r', point: restaurant, title: snapshot?.restaurant.name || 'Restaurant', kind: 'restaurant' as const }] : []),
    ...plan.stops.filter((s) => s.kind === 'DROP').map((s, i) => ({ id: s.jobIds[0], point: s.point, title: s.label, kind: 'drop' as const, n: i + 1 })),
  ];

  if (!snapshot) {return <Screen><SkeletonCard /><SkeletonCard /></Screen>;}
  if (!jobs.length) {
    return <Screen onRefresh={refresh} refreshing={loading}><Card><Empty icon="bike" title="No active deliveries" sub="Accept a request from Home. Your stops, route and customers appear here." /></Card></Screen>;
  }

  return (
    <Screen onRefresh={() => { refresh(); askServer(true); }} refreshing={loading}>
      <View style={styles.rowB}>
        <T v="h1">Deliveries</T>
        <Pill label={`${jobs.length} / ${snapshot.state.capacity} active`} tone="brand" />
      </View>

      <Section title="Route overview" right={<Pill label={plan.source === 'google' ? `Google route${plan.totalDurationSec ? ` · ${fmtMin(plan.totalDurationSec)}` : ''}` : 'Suggested order'} tone={plan.source === 'google' ? 'go' : 'muted'} />} />
      <DeliveryMap stops={mapStops} me={myLocation} route={plan.polyline} />
      <Card>
        {plan.stops.map((s, i) => (
          <View key={`${s.kind}-${s.jobIds.join(',')}`} style={[styles.row, { paddingVertical: 8 }]}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: i === 0 ? t.brand : t.surface2, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
              <T v="small" color={i === 0 ? '#fff' : t.text2}>{i + 1}</T>
            </View>
            <View style={{ flex: 1 }}>
              <T v="body">{s.kind === 'PICKUP' ? `Pick up at ${s.label}` : `Deliver ${s.label}`}</T>
              <T v="small" color={t.text3}>
                {s.kind === 'PICKUP' ? `${s.jobIds.length} order${s.jobIds.length > 1 ? 's' : ''}` : ''}
                {s.legDurationSec ? `${s.kind === 'PICKUP' ? ' · ' : ''}${fmtMin(s.legDurationSec)} · ${fmtKm(s.legDistanceM)}` : s.legDistanceM != null ? `${s.kind === 'PICKUP' ? ' · ' : ''}${fmtKm(s.legDistanceM)} straight line` : ''}
              </T>
            </View>
          </View>
        ))}
        {plan.source === 'local' && (
          <T v="small" color={t.text3} style={{ marginTop: 6 }}>
            Suggested from distance only — no live ETA{plan.reason === 'ROUTES_NOT_CONFIGURED' ? ' (route service not set up)' : ''}. Choose the order that works for you.
          </T>
        )}
        {next && (
          <Button title={next.kind === 'PICKUP' ? 'Navigate to restaurant' : `Navigate to ${next.label}`} icon="nav" style={{ marginTop: space(3) }}
            onPress={() => Zen.openNavigation(next.point.latitude, next.point.longitude, next.label)} />
        )}
      </Card>

      <Section title="Orders" />
      {jobs.map((j) => <JobRow key={j.jobId} job={j} onPress={() => openJob(j.jobId)} />)}
      <View style={[styles.row, { marginTop: space(2) }]}>
        <IconBubble name="info" tone="muted" size={26} />
        <T v="small" color={t.text3} style={{ marginLeft: 8, flex: 1 }}>Each order is picked up, delivered and verified on its own — finishing one never completes another.</T>
      </View>
    </Screen>
  );
}
