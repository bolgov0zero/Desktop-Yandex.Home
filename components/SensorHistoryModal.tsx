import React, { useEffect, useState, useRef } from 'react';
import { YandexDevice } from '../types';
import { X } from 'lucide-react';

const yandexApi = window.api;

interface HistoryEntry {
  ts: number;
  temperature?: number;
  humidity?: number;
}

interface SensorHistoryModalProps {
  device: YandexDevice | null;
  isOpen: boolean;
  onClose: () => void;
  singleProperty?: 'temperature' | 'humidity';
}

// Average values into N time buckets to reduce noise
function bucketAverage(
  entries: { ts: number; value: number }[],
  maxBuckets = 30
): { ts: number; value: number }[] {
  if (entries.length === 0) return [];
  if (entries.length <= maxBuckets) return entries;
  const minTs = entries[0].ts;
  const maxTs = entries[entries.length - 1].ts;
  const size = (maxTs - minTs) / maxBuckets;
  if (size === 0) return entries;
  const result: { ts: number; value: number }[] = [];
  for (let i = 0; i < maxBuckets; i++) {
    const from = minTs + i * size;
    const to = i === maxBuckets - 1 ? maxTs + 1 : from + size;
    const bucket = entries.filter(e => e.ts >= from && e.ts < to);
    if (bucket.length === 0) continue;
    result.push({
      ts: bucket.reduce((s, e) => s + e.ts, 0) / bucket.length,
      value: bucket.reduce((s, e) => s + e.value, 0) / bucket.length,
    });
  }
  return result;
}

// Catmull-Rom spline through points
function smoothPath(points: [number, number][], tension = 0.4): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
  }
  const d: string[] = [`M ${points[0][0]} ${points[0][1]}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) * tension;
    const cp1y = p1[1] + (p2[1] - p0[1]) * tension;
    const cp2x = p2[0] - (p3[0] - p1[0]) * tension;
    const cp2y = p2[1] - (p3[1] - p1[1]) * tension;
    d.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2[0]} ${p2[1]}`);
  }
  return d.join(' ');
}

const GAP_THRESHOLD = 60 * 60 * 1000; // 1 hour

function splitByGaps(
  points: [number, number][],
  timestamps: number[]
): [number, number][][] {
  if (points.length === 0) return [];
  const segments: [number, number][][] = [];
  let current: [number, number][] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (timestamps[i] - timestamps[i - 1] > GAP_THRESHOLD) {
      if (current.length >= 2) segments.push(current);
      current = [points[i]];
    } else {
      current.push(points[i]);
    }
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}

function formatHHMM(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const PADDING = { top: 28, right: 28, bottom: 36, left: 44 };

export const SensorHistoryModal: React.FC<SensorHistoryModalProps> = ({
  device, isOpen, onClose, singleProperty,
}) => {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(520);

  useEffect(() => {
    if (!isOpen || !device) return;
    setLoading(true);
    yandexApi.getSensorHistory().then(all => {
      const h = (all[device.id] ?? []).slice().sort((a, b) => a.ts - b.ts);
      setHistory(h);
      setLoading(false);
    }).catch(() => { setHistory([]); setLoading(false); });
  }, [isOpen, device]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  if (!isOpen || !device) return null;

  const rawTemp = singleProperty === 'humidity' ? [] :
    history.filter(e => e.temperature !== undefined).map(e => ({ ts: e.ts, value: e.temperature! }));
  const rawHum = singleProperty === 'temperature' ? [] :
    history.filter(e => e.humidity !== undefined).map(e => ({ ts: e.ts, value: e.humidity! }));

  const tempData = bucketAverage(rawTemp, 30);
  const humData = bucketAverage(rawHum, 30);

  const hasTemp = tempData.length >= 2;
  const hasHum = humData.length >= 2;
  const hasData = hasTemp || hasHum;

  const chartWidth = width - PADDING.left - PADDING.right;
  const chartHeight = 200;
  const totalHeight = PADDING.top + chartHeight + PADDING.bottom;
  const bottomY = PADDING.top + chartHeight;

  const allTs = history.map(e => e.ts);
  const minTs = allTs.length > 0 ? Math.min(...allTs) : 0;
  const maxTs = allTs.length > 0 ? Math.max(...allTs) : 1;
  const tsRange = maxTs - minTs || 1;
  const toX = (ts: number) => PADDING.left + ((ts - minTs) / tsRange) * chartWidth;

  const makeYScale = (vals: number[], padFactor = 0.15, minPad = 0.5) => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * padFactor || minPad;
    const lo2 = lo - pad, hi2 = hi + pad;
    return { lo, hi, toY: (v: number) => PADDING.top + (1 - (v - lo2) / (hi2 - lo2)) * chartHeight };
  };

  const tempScale = hasTemp ? makeYScale(tempData.map(e => e.value)) : null;
  const humScale = hasHum ? makeYScale(humData.map(e => e.value), 0.15, 2) : null;

  // X-axis labels (5 evenly spaced)
  const xLabels: { ts: number; x: number }[] = [];
  if (allTs.length > 0) {
    const n = Math.min(5, allTs.length);
    for (let i = 0; i < n; i++) {
      const idx = Math.round((i / (n - 1 || 1)) * (allTs.length - 1));
      xLabels.push({ ts: allTs[idx], x: toX(allTs[idx]) });
    }
  }

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => PADDING.top + f * chartHeight);

  const renderSeries = (
    data: { ts: number; value: number }[],
    toY: (v: number) => number,
    color: string,
    gradientId: string
  ) => {
    const pts: [number, number][] = data.map(b => [toX(b.ts), toY(b.value)]);
    const segments = splitByGaps(pts, data.map(b => b.ts));

    return (
      <>
        {segments.map((seg, i) => {
          const linePath = smoothPath(seg);
          if (!linePath) return null;
          const areaPath = `${linePath} L ${seg[seg.length - 1][0]} ${bottomY} L ${seg[0][0]} ${bottomY} Z`;
          return (
            <g key={i}>
              <path d={areaPath} fill={`url(#${gradientId})`} strokeWidth={0} />
              <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        })}
        {/* Dots */}
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2.5} fill={color} />
        ))}
      </>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-surface border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-white/5">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{device.name}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">История показаний (7 дней)</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors text-slate-500 dark:text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4" ref={containerRef}>
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !hasData ? (
            <p className="text-center text-slate-500 dark:text-slate-400 py-12 text-sm">
              Нет данных. Данные появятся после следующего обновления.
            </p>
          ) : (
            <>
              <svg width={width} height={totalHeight} className="overflow-visible">
                <defs>
                  <linearGradient id="grad-temp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#f97316" stopOpacity="0.03" />
                  </linearGradient>
                  <linearGradient id="grad-hum" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.03" />
                  </linearGradient>
                </defs>

                {/* Grid lines */}
                {gridLines.map((y, i) => (
                  <line
                    key={i}
                    x1={PADDING.left} y1={y}
                    x2={PADDING.left + chartWidth} y2={y}
                    stroke="currentColor" strokeOpacity={0.07} strokeWidth={1}
                    className="text-slate-600 dark:text-slate-300"
                  />
                ))}

                {/* Series */}
                {hasTemp && tempScale && renderSeries(tempData, tempScale.toY, '#f97316', 'grad-temp')}
                {hasHum && humScale && renderSeries(humData, humScale.toY, '#60a5fa', 'grad-hum')}

                {/* X axis labels */}
                {xLabels.map(({ ts, x }, i) => (
                  <text
                    key={i} x={x} y={PADDING.top + chartHeight + 20}
                    textAnchor="middle" fontSize={10}
                    fill="currentColor" className="text-slate-500 dark:text-slate-400" opacity={0.55}
                  >
                    {formatHHMM(ts)}
                  </text>
                ))}

                {/* Y axis - temp left */}
                {hasTemp && tempScale && (
                  <>
                    <text x={PADDING.left - 6} y={PADDING.top + 4} textAnchor="end" fontSize={9} fill="#f97316" opacity={0.9}>
                      {tempScale.hi.toFixed(1)}°
                    </text>
                    <text x={PADDING.left - 6} y={bottomY} textAnchor="end" fontSize={9} fill="#f97316" opacity={0.9}>
                      {tempScale.lo.toFixed(1)}°
                    </text>
                  </>
                )}

                {/* Y axis - humidity right */}
                {hasHum && humScale && (
                  <>
                    <text x={PADDING.left + chartWidth + 6} y={PADDING.top + 4} textAnchor="start" fontSize={9} fill="#60a5fa" opacity={0.9}>
                      {humScale.hi.toFixed(0)}%
                    </text>
                    <text x={PADDING.left + chartWidth + 6} y={bottomY} textAnchor="start" fontSize={9} fill="#60a5fa" opacity={0.9}>
                      {humScale.lo.toFixed(0)}%
                    </text>
                  </>
                )}
              </svg>

              {/* Legend */}
              <div className="flex items-center gap-4 mt-1 justify-center">
                {hasTemp && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-0.5 bg-orange-500 rounded" />
                    <span className="text-xs text-slate-600 dark:text-slate-400">Температура</span>
                  </div>
                )}
                {hasHum && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-0.5 bg-blue-400 rounded" />
                    <span className="text-xs text-slate-600 dark:text-slate-400">Влажность</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
