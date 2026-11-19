// Home dashboard: online toggle, capacity, today's numbers, incoming requests
// (with live countdown, accept / reject) and the active deliveries with their
// next action.
import React, { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { ApiError } from '../api';
import { useStore, Offer, Job } from '../store';
import { fmtKm, rupees } from '../geo';
import { space, useTheme } from '../theme';
import { Banner, Button, Card, Empty, Icon, IconBubble, JOB_LABEL, Pill, Screen, Section, SkeletonCard, Stat, T, styles } from '../ui';

export const nextActionText = (j: Job) =>
  j.status === 'ASSIGNED' ? (j.canPickUp ? 'Ready — go to the restaurant' : 'Head to the restaurant')
  : j.status === 'AT_RESTAURANT' ? (j.canPickUp ? 'Order ready — pick it up' : 'Waiting for the kitchen')
  : j.status === 'PICKED_UP' ? 'Deliver to the customer'
  : j.status === 'AT_CUSTOMER' ? 'Hand over & enter the code' : '';

export function Countdown({ until, total = 45 }: { until: string; total?: number }) {
  const t = useTheme();
  const left = Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000));
  const pct = Math.min(1, left / total);
  const c = left <= 10 ? t.bad : left <= 20 ? t.wait : t.go;
  return (
    <View accessibilityLabel={`${left} seconds left`}>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: t.surface2, overflow: 'hidden' }}>
        <View style={{ width: `${pct * 100}%`, height: 6, backgroundColor: c }} />
      </View>
      <T v="tiny" color={c} style={{ marginTop: 4 }}>{left}s left</T>
    </View>
  );
}

export function OfferCard({ offer, onOpen }: { offer: Offer; onOpen?: () => void }) {
  const t = useTheme();
  const { accept, reject, snapshot } = useStore();
  const [busy, setBusy] = useState<'' | 'a' | 'r'>('');
  const [err, setErr] = useState('');
  const full = !!snapshot && snapshot.state.activeCount >= snapshot.state.capacity;
  return (
    <Card onPress={onOpen} style={{ borderColor: t.brand, borderWidth: 1.5 }}>
      <View style={styles.rowB}>
        <View style={styles.row}><IconBubble name="bike" tone="brand" size={36} /><T v="h3" style={{ marginLeft: 10 }}>Order #{offer.orderNo}</T></View>
        {offer.cod ? <Pill label="CASH" tone="wait" /> : <Pill label="PREPAID" tone="go" />}
      </View>
      <View style={[styles.row, { marginTop: space(3), gap: space(4) }]}>
        <View style={{ flex: 1 }}><T v="tiny" color={t.text3}>PICKUP</T><T v="small" numberOfLines={1}>{offer.pickup?.name || 'Restaurant'}</T></View>
        <View style={{ flex: 1 }}><T v="tiny" color={t.text3}>DROP DISTANCE</T><T v="small">{fmtKm(offer.distanceMeters)} from restaurant</T></View>
      </View>
      <View style={{ marginTop: space(3) }}><Countdown until={offer.expiresAt} /></View>
      {err ? <T v="small" color={t.bad} style={{ marginTop: 8 }}>{err}</T> : null}
      <View style={[styles.row, { marginTop: space(3), gap: space(2.5) }]}>
        <Button kind="ghost" title="Reject" style={{ flex: 1 }} loading={busy === 'r'} disabled={!!busy}
          onPress={async () => { setBusy('r'); await reject(offer.jobId); setBusy(''); }} />
        <Button kind="go" title={full ? 'At limit' : 'Accept'} icon="check" style={{ flex: 1.6 }} loading={busy === 'a'} disabled={!!busy || full}
          onPress={async () => { setErr(''); setBusy('a'); try { await accept(offer.jobId); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not accept'); } finally { setBusy(''); } }} />
      </View>
    </Card>
  );
}

export function JobRow({ job, onPress }: { job: Job; onPress: () => void }) {
  const t = useTheme();
  const s = JOB_LABEL[job.status] || { label: job.status, tone: 'muted' as const };
  return (
    <Card onPress={onPress}>
      <View style={styles.rowB}>
        <T v="h3">#{job.orderNo}</T>
        <Pill label={s.label} tone={s.tone} dot />
      </View>
      <T v="small" color={t.text2} style={{ marginTop: 6 }} numberOfLines={1}>{job.drop?.address}</T>
      <View style={[styles.rowB, { marginTop: space(2.5) }]}>
        <T v="small" color={job.canPickUp || ['PICKED_UP', 'AT_CUSTOMER'].includes(job.status) ? t.go : t.wait}>{nextActionText(job)}</T>
        {job.payment?.collectCash ? <Pill label={`Collect ${rupees(job.payment.amount)}`} tone="wait" /> : null}
      </View>
    </Card>
  );
}

export default function Home({ openJob, openNotifications }: { openJob: (id: string) => void; openNotifications: () => void }) {
  const t = useTheme();
  const st = useStore();
  const { snapshot, offers, loading, refresh, serverOk, socketOk, tracking, unread } = st;
  const [toggling, setToggling] = useState(false);
  const [err, setErr] = useState('');

  const toggle = async (on: boolean) => {
    setErr(''); setToggling(true);
    try { await st.setOnline(on); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not change status'); }
    finally { setToggling(false); }
  };

  const s = snapshot?.state;
  return (
    <Screen refreshing={loading && !!snapshot} onRefresh={refresh}>
      <View style={[styles.rowB, { marginBottom: space(4) }]}>
        <View>
          <T v="small" color={t.text3}>Hello,</T>
          <T v="h1">{snapshot?.partner.name || st.session?.name || 'Partner'}</T>
        </View>
        <Pressable onPress={openNotifications} accessibilityLabel={`Notifications, ${unread} new`} hitSlop={10}>
          <IconBubble name="bell" tone="muted" size={44} />
          {unread > 0 && <View style={{ position: 'absolute', right: 0, top: 0, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: t.bad, alignItems: 'center', justifyContent: 'center' }}><T v="tiny" color="#fff">{unread > 9 ? '9+' : unread}</T></View>}
        </Pressable>
      </View>

      {!serverOk && <Banner tone="bad" icon="warn" title="No connection to the server" body="Showing your last data. It updates as soon as you're back online." />}
      {serverOk && !socketOk && snapshot && <Banner tone="wait" icon="refresh" title="Reconnecting live updates…" body="Pull down to refresh meanwhile." />}
      {s?.suspended && <Banner tone="bad" icon="warn" title="Account suspended" body={s.suspendedReason || 'Contact the restaurant.'} />}
      {tracking.note ? <Banner tone="wait" icon="pin" title={tracking.note} /> : null}
      {err ? <Banner tone="bad" icon="warn" title={err} /> : null}

      {!snapshot ? <><SkeletonCard /><SkeletonCard /></> : (
        <>
          {/* ── online toggle ── */}
          <Card style={{ backgroundColor: s!.online ? t.go : t.surface, borderColor: s!.online ? t.go : t.line }}>
            <View style={styles.rowB}>
              <View style={{ flex: 1 }}>
                <T v="h2" color={s!.online ? '#fff' : t.text}>{s!.online ? "You're online" : "You're offline"}</T>
                <T v="small" color={s!.online ? 'rgba(255,255,255,0.9)' : t.text3} style={{ marginTop: 4 }}>
                  {s!.online ? 'New delivery requests will reach you' : 'Go online to receive delivery requests'}
                </T>
              </View>
              <Switch value={s!.online} onValueChange={toggle} disabled={toggling || (s!.suspended && !s!.online)}
                trackColor={{ true: 'rgba(255,255,255,0.45)', false: t.line }} thumbColor={s!.online ? '#fff' : t.text3}
                accessibilityLabel={s!.online ? 'Go offline' : 'Go online'} style={{ transform: [{ scale: 1.25 }] }} />
            </View>
          </Card>

          {/* ── capacity + today ── */}
          <Card>
            <View style={styles.rowB}>
              <T v="tiny" color={t.text3}>ACTIVE DELIVERIES</T>
              <T v="h3">{s!.activeCount} / {s!.capacity}</T>
            </View>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: space(3) }}>
              {Array.from({ length: s!.capacity }, (_, i) => (
                <View key={i} style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: i < s!.activeCount ? t.brand : t.surface2 }} />
              ))}
            </View>
            <T v="small" color={t.text3} style={{ marginTop: 8 }}>
              {s!.activeCount >= s!.capacity ? "You're at your limit — finish a delivery to take more." : `You can take ${s!.capacity - s!.activeCount} more.`}
            </T>
          </Card>
          <View style={{ flexDirection: 'row', gap: space(3), marginBottom: space(3) }}>
            <Stat label="Delivered today" value={snapshot.today.delivered} tone="go" icon="check" />
            <Stat label="Avg time" value={snapshot.today.avgDeliveryMinutes != null ? `${snapshot.today.avgDeliveryMinutes}m` : '—'} tone="info" icon="clock" />
            <Stat label="Failed" value={snapshot.today.failed} tone={snapshot.today.failed ? 'bad' : 'muted'} icon="warn" />
          </View>

          {/* ── requests ── */}
          <Section title={`Incoming requests${offers.length ? ` · ${offers.length}` : ''}`} />
          {offers.length === 0
            ? <Card><Empty icon="bike" title={s!.online ? 'Waiting for orders' : 'You are offline'} sub={s!.online ? 'Keep the app open. New requests appear here and ring your phone.' : 'Switch on above to start receiving requests.'} /></Card>
            : offers.map((o) => <OfferCard key={o.jobId} offer={o} />)}

          {/* ── active ── */}
          <Section title={`My deliveries · ${snapshot.activeJobs.length}`} />
          {snapshot.activeJobs.length === 0
            ? <Card><Empty icon="list" title="No active deliveries" sub="Orders you accept show here with the next step." /></Card>
            : snapshot.activeJobs.map((j) => <JobRow key={j.jobId} job={j} onPress={() => openJob(j.jobId)} />)}
          {snapshot.activeJobs.length > 0 && (
            <View style={[styles.row, { marginTop: 4 }]}>
              <Icon name="pin" size={13} color={tracking.running ? t.go : t.text3} />
              <T v="small" color={t.text3} style={{ marginLeft: 6 }}>{tracking.running ? `Sharing your location${tracking.queued ? ` · ${tracking.queued} waiting to send` : ''}` : 'Location sharing is off'}</T>
            </View>
          )}
          {!st.snapshot?.state.online && !offers.length && !snapshot.activeJobs.length && (
            <Button big title="Go online" kind="go" icon="power" style={{ marginTop: space(4) }} onPress={() => toggle(true)} loading={toggling} disabled={s!.suspended} />
          )}
        </>
      )}
    </Screen>
  );
}
