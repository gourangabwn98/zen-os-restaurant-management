// One delivery: pickup → customer → OTP hand-over (+ cash for COD). The phone
// number is used only to dial; on screen it is masked. Every step is checked
// by the server (order ready? right OTP? exact cash?).
import React, { useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import { ApiError } from '../api';
import { useStore } from '../store';
import { Zen } from '../native';
import { fmtKm, fmtTime, isPoint, meters, rupees } from '../geo';
import DeliveryMap from '../components/DeliveryMap';
import { radius, space, useTheme } from '../theme';
import { Banner, Button, Card, Divider, Empty, Icon, IconBubble, JOB_LABEL, Pill, Screen, Section, T, styles } from '../ui';
import { nextActionText } from './Home';

const mask = (p: string) => (p && p.length > 4 ? `•••• ${p.slice(-4)}` : p);

export default function JobDetail({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const t = useTheme();
  const { snapshot, step, myLocation, refresh } = useStore();
  const job = snapshot?.activeJobs.find((j) => j.jobId === jobId);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [otp, setOtp] = useState('');
  const [cashOk, setCashOk] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const run = async (name: string, body?: any) => {
    setErr(''); setBusy(name);
    try {
      const r = await step(jobId, name, body);
      if (r.status === 'DELIVERED' || r.status === 'FAILED') {setDone(r.status);}
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong');
      if (e instanceof ApiError && e.code === 'OTP_WRONG') {setOtp('');}
    } finally { setBusy(''); }
  };

  const header = (
    <Pressable onPress={onBack} hitSlop={12} style={[styles.row, { marginBottom: space(3) }]} accessibilityRole="button" accessibilityLabel="Back">
      <Icon name="back" size={26} color={t.brand} /><T v="body" color={t.brand} style={{ marginLeft: 4 }}>Deliveries</T>
    </Pressable>
  );

  if (done) {
    return (
      <Screen>
        {header}
        <Card><Empty icon={done === 'DELIVERED' ? 'check' : 'warn'} title={done === 'DELIVERED' ? 'Delivered!' : 'Marked as not delivered'}
          sub={done === 'DELIVERED' ? 'Great job. Cash you collected is listed under Profile → Cash in hand until you hand it in.' : 'The restaurant has been told and will contact you.'}
          action={<Button title="Back to deliveries" onPress={onBack} />} /></Card>
      </Screen>
    );
  }
  if (!job) {
    return <Screen>{header}<Card><Empty icon="info" title="This delivery is no longer active" sub="It may have been completed, cancelled or reassigned." action={<Button kind="secondary" title="Refresh" onPress={refresh} />} /></Card></Screen>;
  }

  const s = JOB_LABEL[job.status];
  const pickup = isPoint(job.pickup) ? job.pickup : null;
  const drop = isPoint(job.drop) ? job.drop : null;
  const cash = job.payment?.collectCash ? job.payment.amount : 0;
  const atDoor = ['PICKED_UP', 'AT_CUSTOMER'].includes(job.status);

  return (
    <Screen onRefresh={refresh}>
      {header}
      <View style={styles.rowB}>
        <T v="h1">#{job.orderNo}</T>
        <Pill label={s?.label || job.status} tone={s?.tone || 'muted'} dot />
      </View>
      <T v="small" color={t.text3} style={{ marginTop: 4 }}>Accepted {fmtTime(job.assignedAt)} · {nextActionText(job)}</T>
      {err ? <View style={{ marginTop: space(3) }}><Banner tone="bad" icon="warn" title={err} /></View> : null}

      <View style={{ marginTop: space(3) }}>
        <DeliveryMap me={myLocation} height={220} stops={[
          ...(pickup && !atDoor ? [{ id: 'r', point: pickup, title: job.pickup.name || 'Restaurant', kind: 'restaurant' as const }] : []),
          ...(drop ? [{ id: 'd', point: drop, title: job.drop.contactName || 'Customer', kind: 'drop' as const }] : []),
        ]} />
      </View>

      {/* ── pickup ── */}
      {!atDoor && (
        <Card>
          <View style={styles.row}><IconBubble name="store" tone="brand" /><View style={{ marginLeft: 12, flex: 1 }}>
            <T v="tiny" color={t.text3}>PICKUP</T><T v="h3">{job.pickup?.name || 'Restaurant'}</T>
            {job.pickup?.address ? <T v="small" color={t.text2}>{job.pickup.address}</T> : null}
          </View></View>
          <View style={{ marginTop: space(3) }}>
            {job.canPickUp ? <Banner tone="go" icon="check" title="Order is ready for pickup" /> : <Banner tone="wait" icon="clock" title="Kitchen is still preparing" body={`Order status: ${job.orderStatus || '—'}. You can pick up once it's marked ready.`} />}
          </View>
          {pickup && <Button kind="secondary" title="Navigate to restaurant" icon="nav" onPress={() => Zen.openNavigation(pickup.latitude, pickup.longitude, job.pickup.name || 'Restaurant')} />}
        </Card>
      )}

      {/* ── items ── */}
      <Card>
        <T v="tiny" color={t.text3}>ITEMS — CHECK BEFORE YOU LEAVE</T>
        {job.items.map((it, i) => <View key={i} style={[styles.rowB, { marginTop: 8 }]}><T v="body" style={{ flex: 1 }}>{it.name}</T><T v="h3">× {it.qty}</T></View>)}
        {job.notes ? <T v="small" color={t.wait} style={{ marginTop: 8 }}>Note: {job.notes}</T> : null}
      </Card>

      {/* ── customer ── */}
      <Card>
        <View style={styles.row}><IconBubble name="pin" tone="info" /><View style={{ marginLeft: 12, flex: 1 }}>
          <T v="tiny" color={t.text3}>DELIVER TO</T>
          <T v="h3">{job.drop?.contactName || 'Customer'}</T>
          <T v="small" color={t.text2}>{job.drop?.address}</T>
          {job.drop?.landmark ? <T v="small" color={t.text3}>Landmark: {job.drop.landmark}</T> : null}
          <T v="small" color={t.text3} style={{ marginTop: 4 }}>
            {myLocation && drop ? `${fmtKm(meters(myLocation, drop))} from you (straight line)` : `${fmtKm(job.distanceMeters)} from the restaurant`}
          </T>
        </View></View>
        <View style={[styles.row, { gap: space(2.5), marginTop: space(3) }]}>
          {drop && <Button kind="secondary" title="Navigate" icon="nav" style={{ flex: 1 }} onPress={() => Zen.openNavigation(drop.latitude, drop.longitude, job.drop.address || 'Customer')} />}
          {job.drop?.contactPhone ? <Button kind="ghost" title={`Call ${mask(job.drop.contactPhone)}`} icon="phone" style={{ flex: 1 }} onPress={() => Zen.dial(job.drop.contactPhone)} /> : null}
        </View>
      </Card>

      {cash > 0 && (
        <Card style={{ backgroundColor: t.waitSoft, borderColor: t.wait }}>
          <View style={styles.row}><IconBubble name="cash" tone="wait" /><View style={{ marginLeft: 12 }}>
            <T v="tiny" color={t.wait}>CASH ON DELIVERY</T><T v="num" color={t.wait}>{rupees(cash)}</T>
            <T v="small" color={t.text2}>Collect this exact amount at the door.</T>
          </View></View>
        </Card>
      )}

      {/* ── actions ── */}
      <Section title="Next step" />
      {job.status === 'ASSIGNED' && (
        <>
          <Button big title="I've arrived at the restaurant" icon="store" onPress={() => run('arrived-restaurant')} loading={busy === 'arrived-restaurant'} />
          {job.canPickUp && <Button big kind="go" title="Picked up the order" icon="check" style={{ marginTop: space(3) }} onPress={() => run('picked-up')} loading={busy === 'picked-up'} />}
        </>
      )}
      {job.status === 'AT_RESTAURANT' && (
        <Button big kind="go" title={job.canPickUp ? 'Picked up the order' : 'Waiting for the kitchen…'} icon="check" disabled={!job.canPickUp}
          onPress={() => run('picked-up')} loading={busy === 'picked-up'} />
      )}
      {job.status === 'PICKED_UP' && (
        <Button big title="I've arrived at the customer" icon="pin" onPress={() => run('arrived-customer')} loading={busy === 'arrived-customer'} />
      )}
      {atDoor && (
        <Card style={{ marginTop: space(3) }}>
          <T v="h3">Hand over</T>
          <T v="small" color={t.text3} style={{ marginTop: 4 }}>Ask the customer for the 4-digit code shown in their order.</T>
          <TextInput value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4}
            placeholder="• • • •" placeholderTextColor={t.text3} accessibilityLabel="Customer's delivery code"
            style={{ marginTop: space(3), borderWidth: 1, borderColor: t.line, borderRadius: radius.md, height: 60, fontSize: 28, fontWeight: '800', letterSpacing: 18, textAlign: 'center', color: t.text, backgroundColor: t.surface2 }} />
          {job.otpAttempts > 0 && <T v="small" color={t.bad} style={{ marginTop: 6 }}>{job.otpAttempts} wrong attempt{job.otpAttempts > 1 ? 's' : ''} so far</T>}
          {cash > 0 && (
            <Pressable onPress={() => setCashOk((v) => !v)} style={[styles.row, { marginTop: space(3), padding: space(3), borderRadius: radius.md, backgroundColor: cashOk ? t.goSoft : t.surface2 }]}
              accessibilityRole="checkbox" accessibilityState={{ checked: cashOk }}>
              <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: cashOk ? t.go : t.text3, backgroundColor: cashOk ? t.go : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {cashOk && <Icon name="check" size={14} color="#fff" />}
              </View>
              <T v="body" style={{ marginLeft: 12, flex: 1 }}>I collected {rupees(cash)} in cash</T>
            </Pressable>
          )}
          <Button big kind="go" title="Complete delivery" icon="check" style={{ marginTop: space(3) }}
            disabled={otp.length !== 4 || (cash > 0 && !cashOk)} loading={busy === 'deliver'}
            onPress={() => run('deliver', { otp, ...(cash > 0 ? { cashCollected: true, cashAmount: cash } : {}) })} />
          <Divider />
          {!failOpen ? (
            <Button kind="ghost" title="Can't deliver this order" onPress={() => setFailOpen(true)} />
          ) : (
            <View>
              <T v="small" color={t.text2}>What happened? (the restaurant sees this)</T>
              <TextInput value={reason} onChangeText={setReason} placeholder="e.g. customer not reachable for 10 minutes" placeholderTextColor={t.text3} maxLength={200}
                style={{ marginTop: 8, borderWidth: 1, borderColor: t.line, borderRadius: radius.md, padding: space(3), color: t.text, minHeight: 60 }} multiline />
              <View style={[styles.row, { gap: space(2.5), marginTop: space(3) }]}>
                <Button kind="ghost" title="Back" style={{ flex: 1 }} onPress={() => setFailOpen(false)} />
                <Button kind="danger" title="Report failed" style={{ flex: 1.4 }} disabled={reason.trim().length < 3} loading={busy === 'fail'}
                  onPress={() => Alert.alert('Report failed delivery?', 'The order stays with the restaurant to resolve.', [{ text: 'Cancel' }, { text: 'Report', style: 'destructive', onPress: () => run('fail', { reason: reason.trim() }) }])} />
              </View>
            </View>
          )}
        </Card>
      )}
    </Screen>
  );
}
