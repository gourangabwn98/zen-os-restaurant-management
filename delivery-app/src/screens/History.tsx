// Delivery history (server: GET /delivery/me/history, restaurant calendar days).
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api } from '../api';
import { fmtKm, fmtTime } from '../geo';
import { space, useTheme } from '../theme';
import { Banner, Card, Empty, JOB_LABEL, Pill, Screen, Section, SkeletonCard, T, styles } from '../ui';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const RANGES = [
  { key: 'today', label: 'Today', from: () => ymd(new Date()) },
  { key: 'week', label: '7 days', from: () => ymd(new Date(Date.now() - 6 * 86400000)) },
  { key: 'month', label: '30 days', from: () => ymd(new Date(Date.now() - 29 * 86400000)) },
];

export default function History() {
  const t = useTheme();
  const [range, setRange] = useState('today');
  const [rows, setRows] = useState<any[] | null>(null);
  const [sum, setSum] = useState<any>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const r = RANGES.find((x) => x.key === range)!;
    const q = `?from=${r.from()}&to=${ymd(new Date())}`;
    setLoading(true); setErr('');
    try {
      const [h, s] = await Promise.all([api<any>('GET', `/delivery/me/history${q}&limit=100`), api<any>('GET', `/delivery/me/summary${q}`)]);
      setRows(h.jobs); setSum(s);
    } catch (e: any) { setErr(e?.message || 'Could not load history'); }
    finally { setLoading(false); }
  }, [range]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen onRefresh={load} refreshing={loading && rows !== null}>
      <T v="h1">History</T>
      <View style={[styles.row, { marginTop: space(3), gap: space(2) }]}>
        {RANGES.map((r) => (
          <Pressable key={r.key} onPress={() => { if (range !== r.key) { setRows(null); setRange(r.key); } }} hitSlop={8}
            accessibilityRole="radio" accessibilityState={{ selected: range === r.key }}>
            <Pill label={r.label} tone={range === r.key ? 'brand' : 'muted'} />
          </Pressable>
        ))}
      </View>
      {err ? <View style={{ marginTop: space(3) }}><Banner tone="bad" icon="warn" title={err} /></View> : null}
      {sum && (
        <Card style={{ marginTop: space(4) }}>
          <View style={styles.rowB}>
            {[['Delivered', sum.delivered, t.go], ['Failed', sum.failed, sum.failed ? t.bad : t.text3], ['Avg time', sum.avgDeliveryMinutes != null ? `${sum.avgDeliveryMinutes}m` : '—', t.info]].map(([k, v, c]) => (
              <View key={k as string} style={{ alignItems: 'center', flex: 1 }}>
                <T v="num" color={c as string}>{v as any}</T><T v="tiny" color={t.text3}>{String(k).toUpperCase()}</T>
              </View>
            ))}
          </View>
          <T v="small" color={t.text3} style={{ marginTop: space(3), textAlign: 'center' }}>Earnings aren't shown — your restaurant pays you directly.</T>
        </Card>
      )}
      <Section title="Deliveries" />
      {rows === null ? <><SkeletonCard /><SkeletonCard /></> : rows.length === 0 ? <Card><Empty icon="history" title="Nothing yet" sub="Completed deliveries show here." /></Card> : rows.map((j) => {
        const s = JOB_LABEL[j.status] || { label: j.status, tone: 'muted' as const };
        return (
          <Card key={j.jobId}>
            <View style={styles.rowB}><T v="h3">#{j.orderNo}</T><Pill label={s.label} tone={s.tone} /></View>
            <T v="small" color={t.text2} numberOfLines={1} style={{ marginTop: 4 }}>{j.dropAddress}</T>
            <T v="small" color={t.text3} style={{ marginTop: 4 }}>
              {fmtTime(j.assignedAt)} → {fmtTime(j.deliveredAt || j.failedAt)}{j.minutes != null ? ` · ${Math.round(j.minutes)} min` : ''} · {fmtKm(j.distanceMeters)}
            </T>
            {j.failReason ? <T v="small" color={t.bad} style={{ marginTop: 4 }}>{j.failReason}</T> : null}
          </Card>
        );
      })}
    </Screen>
  );
}
