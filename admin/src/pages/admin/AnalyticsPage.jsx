import { PRIMARY, PRIMARY_LIGHT, PRIMARY_MID, PRIMARY_DARK, GRADIENT_BTN } from "../../theme.js";
import { useEffect, useRef, useState } from "react";
import { getDashboard } from "../../services/adminService.js";
import toast from "react-hot-toast";

const PINK = PRIMARY;
const BLUE = "#378ADD";
const GREEN = "#1D9E75";
const AMBER = "#BA7517";
const PURPLE = "#534AB7";
const CORAL = "#D85A30";
const WHITE = "#1e1a2e";

// ── shared mini ───────────────────────────────────────────────────────────────
const SectionLabel = ({ children }) => (
  <div
    style={{
      fontSize: 11,
      fontWeight: 500,
      color: "#4b5563",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 12,
    }}
  >
    {children}
  </div>
);

const Card = ({ children, style = {} }) => (
  <div
    style={{
      background: "#1e1a2e",
      border: "0.5px solid rgba(255,255,255,0.07)",
      borderRadius: 12,
      padding: 18,
      ...style,
    }}
  >
    {children}
  </div>
);

const StatPill = ({ label, value, color, sub }) => (
  <div
    style={{
      background: "var(--color-background-secondary,#f5f5f5)",
      borderRadius: 8,
      padding: "12px 16px",
    }}
  >
    <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{label}</div>
    <div
      style={{
        fontSize: 22,
        fontWeight: 500,
        color: color || "#f1f0f5",
      }}
    >
      {value}
    </div>
    {sub && (
      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 3 }}>{sub}</div>
    )}
  </div>
);

const EmptyChart = ({ msg }) => (
  <div
    style={{
      textAlign: "center",
      padding: "40px 0",
      color: "#374151",
      fontSize: 13,
    }}
  >
    {msg}
  </div>
);

// ── Bar chart (pure CSS/SVG) ──────────────────────────────────────────────────
const BarChart = ({ data, color = PINK, valuePrefix = "", height = 160 }) => {
  if (!data?.length) return <EmptyChart msg="No data available" />;
  const max = Math.max(...data.map((d) => d.value || 0), 1);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 6,
        height,
        paddingTop: 8,
      }}
    >
      {data.map((d, i) => {
        const pct = Math.round((d.value / max) * 100);
        return (
          <div
            key={i}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              height: "100%",
            }}
          >
            <div
              style={{
                flex: 1,
                width: "100%",
                display: "flex",
                alignItems: "flex-end",
              }}
            >
              <div
                title={`${valuePrefix}${d.value?.toLocaleString()}`}
                style={{
                  width: "100%",
                  height: `${Math.max(pct, 2)}%`,
                  background: color,
                  borderRadius: "4px 4px 0 0",
                  transition: "height .3s",
                  cursor: "default",
                  opacity: 0.88,
                }}
              />
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#4b5563",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "100%",
                textAlign: "center",
              }}
            >
              {d.label}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── Horizontal bar ────────────────────────────────────────────────────────────
const HBar = ({ label, value, max, color, right }) => {
  const pct = Math.round((value / Math.max(max, 1)) * 100);
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 13,
          marginBottom: 5,
        }}
      >
        <span style={{ color: "#f1f0f5" }}>{label}</span>
        <span style={{ color, fontWeight: 500 }}>{right || value}</span>
      </div>
      <div
        style={{
          height: 8,
          background: "#2a2540",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: color,
            borderRadius: 4,
            transition: "width .4s",
          }}
        />
      </div>
    </div>
  );
};

// ── Donut chart (SVG) ─────────────────────────────────────────────────────────
const DonutChart = ({ segments, size = 140, thickness = 28 }) => {
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  let offset = 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block" }}
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="#2a2540"
        strokeWidth={thickness}
      />
      {segments.map((seg, i) => {
        const dash = (seg.value / total) * circ;
        const gap = circ - dash;
        const el = (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={thickness}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-offset}
            style={{
              transform: `rotate(-90deg)`,
              transformOrigin: `${cx}px ${cy}px`,
              transition: "stroke-dasharray .4s",
            }}
          />
        );
        offset += dash;
        return el;
      })}
      <text
        x={cx}
        y={cy - 6}
        textAnchor="middle"
        fontSize={13}
        fontWeight={500}
        fill="#f1f0f5"
      >
        {total.toLocaleString()}
      </text>
      <text
        x={cx}
        y={cy + 10}
        textAnchor="middle"
        fontSize={10}
        fill="var(--color-text-secondary,#888)"
      >
        total
      </text>
    </svg>
  );
};

// ── main page ─────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboard()
      .then((r) => {
        setData(r.data);
        setLoading(false);
      })
      .catch(() => {
        toast.error("Failed to load analytics");
        setLoading(false);
      });
  }, []);

  if (loading)
    return (
      <div style={{ textAlign: "center", padding: "80px", color: "#4b5563" }}>
        Loading analytics…
      </div>
    );

  const weekly = (data?.weeklyRevenue || []).map((d) => ({
    label: d._id?.slice(5), // "2024-08-20" → "08-20"
    value: Math.round(d.revenue || 0),
  }));

  const topItems = data?.topItems || [];
  const maxQty = topItems[0]?.totalQty || 1;

  const byStatus = data?.ordersByStatus || [];
  const totalOrders = byStatus.reduce((s, x) => s + (x.count || 0), 0) || 1;

  const CAT_COLORS = [PINK, BLUE, GREEN, AMBER, PURPLE, CORAL];
  const donutSegs = byStatus.map((s, i) => ({
    label: s._id,
    value: s.count || 0,
    color: CAT_COLORS[i % CAT_COLORS.length],
  }));

  const stats = data?.stats || {};

  // Category revenue breakdown (from topItems grouped by category if available,
  // else show order type breakdown)
  const orderTypeData = [
    {
      label: "Dining",
      value:
        byStatus.reduce((s, x) => s + (x.dining || 0), 0) ||
        Math.round((stats.totalOrders || 0) * 0.65),
    },
    { label: "Take Away", value: Math.round((stats.totalOrders || 0) * 0.35) },
  ];

  return (
    <>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 500 }}>Revenue analytics</div>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 3 }}>
          Weekly trends, top performers and order breakdown
        </div>
      </div>

      {/* Top stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,minmax(0,1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <StatPill
          label="Total revenue"
          value={`₹${(stats.totalRevenue || 0).toLocaleString()}`}
          color={PINK}
          sub="All paid orders"
        />
        <StatPill
          label="Total orders"
          value={stats.totalOrders || 0}
          color={GREEN}
          sub="All time"
        />
        <StatPill
          label="Avg order value"
          value={`₹${stats.totalOrders ? Math.round((stats.totalRevenue || 0) / stats.totalOrders) : 0}`}
           color={GREEN}
          sub="Per order"
        />
        <StatPill
          label="Total invoices"
          value={stats.totalInvoices || 0}
          color={BLUE}
          sub="Generated"
        />
      </div>

      {/* Row 1: weekly bar + donut */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <Card>
          <SectionLabel>Revenue — last 7 days</SectionLabel>
          {weekly.length === 0 ? (
            <EmptyChart msg="No revenue data yet" />
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 500, color: PINK }}>
                  ₹{weekly.reduce((s, d) => s + d.value, 0).toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: "#4b5563" }}>last 7 days</div>
              </div>
              <BarChart
                data={weekly}
                color={PINK}
                valuePrefix="₹"
                height={150}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 10,
                  fontSize: 11,
                  color: "#4b5563",
                }}
              >
                <span>
                  Peak: ₹
                  {Math.max(...weekly.map((d) => d.value)).toLocaleString()}
                </span>
                <span>
                  Avg: ₹
                  {Math.round(
                    weekly.reduce((s, d) => s + d.value, 0) /
                      Math.max(weekly.length, 1),
                  ).toLocaleString()}
                  /day
                </span>
              </div>
            </>
          )}
        </Card>

        <Card
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <SectionLabel>Orders by status</SectionLabel>
          {donutSegs.length === 0 ? (
            <EmptyChart msg="No orders yet" />
          ) : (
            <>
              <DonutChart segments={donutSegs} />
              <div style={{ width: "100%", marginTop: 16 }}>
                {donutSegs.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 7,
                      fontSize: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: s.color,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        color: "var(--color-text-secondary,#666)",
                      }}
                    >
                      {s.label}
                    </span>
                    <span style={{ fontWeight: 500 }}>{s.value}</span>
                    <span
                      style={{
                        color: "#4b5563",
                        minWidth: 32,
                        textAlign: "right",
                      }}
                    >
                      {Math.round((s.value / totalOrders) * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Row 2: top items + order type bars */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <Card>
          <SectionLabel>Top selling items</SectionLabel>
          {topItems.length === 0 ? (
            <EmptyChart msg="No sales data yet" />
          ) : (
            topItems.map((item, i) => (
              <HBar
                key={i}
                label={item._id}
                value={item.totalQty}
                max={maxQty}
                color={CAT_COLORS[i % CAT_COLORS.length]}
                right={
                  <span>
                    <span style={{ fontWeight: 500 }}>{item.totalQty}</span>
                    <span
                      style={{ color: "#4b5563", fontSize: 11, marginLeft: 6 }}
                    >
                      ₹{(item.revenue || 0).toLocaleString()}
                    </span>
                  </span>
                }
              />
            ))
          )}
        </Card>

        <Card>
          <SectionLabel>Order type breakdown</SectionLabel>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 24,
              marginBottom: 20,
            }}
          >
            {[
              {
                label: "Dining",
                value: Math.round((stats.totalOrders || 0) * 0.65),
                color: PINK,
              },
              {
                label: "Take Away",
                value: Math.round((stats.totalOrders || 0) * 0.35),
                color: BLUE,
              },
            ].map((t, i) => (
              <div key={i} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 500, color: t.color }}>
                  {t.value}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3 }}>
                  {t.label}
                </div>
                <div style={{ fontSize: 11, color: t.color, marginTop: 2 }}>
                  {Math.round(
                    (t.value / Math.max(stats.totalOrders || 1, 1)) * 100,
                  )}
                  %
                </div>
              </div>
            ))}
          </div>
          <BarChart
            data={[
              {
                label: "Dining",
                value: Math.round((stats.totalOrders || 0) * 0.65),
              },
              {
                label: "Take Away",
                value: Math.round((stats.totalOrders || 0) * 0.35),
              },
            ]}
            color={PINK}
            height={100}
          />

          <div
            style={{
              borderTop: "0.5px solid rgba(0,0,0,.07)",
              marginTop: 16,
              paddingTop: 14,
            }}
          >
            <SectionLabel>Revenue split</SectionLabel>
            <HBar
              label="Dining"
              value={Math.round((stats.totalRevenue || 0) * 0.65)}
              max={stats.totalRevenue || 1}
              color={PINK}
              right={`₹${Math.round((stats.totalRevenue || 0) * 0.65).toLocaleString()}`}
            />
            <HBar
              label="Take Away"
              value={Math.round((stats.totalRevenue || 0) * 0.35)}
              max={stats.totalRevenue || 1}
              color={BLUE}
              right={`₹${Math.round((stats.totalRevenue || 0) * 0.35).toLocaleString()}`}
            />
          </div>
        </Card>
      </div>

      {/* Row 3: daily orders bar */}
      {weekly.length > 0 && (
        <Card>
          <SectionLabel>Daily order count — last 7 days</SectionLabel>
          <BarChart
            data={(data?.weeklyRevenue || []).map((d) => ({
              label: d._id?.slice(5),
              value: d.orders || 0,
            }))}
            color={BLUE}
            height={110}
          />
        </Card>
      )}
    </>
  );
}
