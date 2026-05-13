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
}

function catmullRomToBezier(points: [number, number][]): string {
  const d: string[] = [];
  if (points.length < 2) return '';
  d.push(`M ${points[0][0]} ${points[0][1]}`);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2[0]} ${p2[1]}`);
  }
  return d.join(' ');
}

const GAP_THRESHOLD = 30 * 60 * 1000; // 30 minutes

function splitByGaps(points: [number, number][], timestamps: number[]): { segments: [number, number][][] } {
  if (points.length === 0) return { segments: [] };
  const segments: [number, number][][] = [];
  let current: [number, number][] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (timestamps[i] - timestamps[i - 1] > GAP_THRESHOLD) {
      segments.push(current);
      current = [points[i]];
    } else {
      current.push(points[i]);
    }
  }
  segments.push(current);
  return { segments };
}

function formatHHMM(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const PADDING = { top: 20, right: 20, bottom: 40, left: 40 };

export const SensorHistoryModal: React.FC<SensorHistoryModalProps> = ({ device, isOpen, onClose }) => {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(500);

  useEffect(() => {
    if (!isOpen || !device) return;
    setLoading(true);
    yandexApi.getSensorHistory().then(all => {
      const deviceHistory = all[device.id] ?? [];
      // Sort by ts ascending
      deviceHistory.sort((a, b) => a.ts - b.ts);
      setHistory(deviceHistory);
      setLoading(false);
    }).catch(() => {
      setHistory([]);
      setLoading(false);
    });
  }, [isOpen, device]);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  if (!isOpen || !device) return null;

  const tempEntries = history.filter(e => e.temperature !== undefined);
  const humEntries = history.filter(e => e.humidity !== undefined);

  const hasTemp = tempEntries.length >= 2;
  const hasHum = humEntries.length >= 2;
  const hasData = hasTemp || hasHum;

  const chartWidth = width - PADDING.left - PADDING.right;
  const chartHeight = 180;

  // Combine all timestamps for x-axis
  const allTs = history.map(e => e.ts);
  const minTs = allTs.length > 0 ? Math.min(...allTs) : 0;
  const maxTs = allTs.length > 0 ? Math.max(...allTs) : 1;
  const tsRange = maxTs - minTs || 1;

  const toX = (ts: number) => PADDING.left + ((ts - minTs) / tsRange) * chartWidth;

  // Temperature scale
  const tempVals = tempEntries.map(e => e.temperature as number);
  const minTemp = tempVals.length > 0 ? Math.min(...tempVals) : 0;
  const maxTemp = tempVals.length > 0 ? Math.max(...tempVals) : 1;
  const tempRange = maxTemp - minTemp || 1;
  const toTempY = (v: number) => PADDING.top + (1 - (v - minTemp) / tempRange) * chartHeight;

  // Humidity scale
  const humVals = humEntries.map(e => e.humidity as number);
  const minHum = humVals.length > 0 ? Math.min(...humVals) : 0;
  const maxHum = humVals.length > 0 ? Math.max(...humVals) : 1;
  const humRange = maxHum - minHum || 1;
  const toHumY = (v: number) => PADDING.top + (1 - (v - minHum) / humRange) * chartHeight;

  // X labels - ~5 evenly spaced
  const xLabels: { ts: number; x: number }[] = [];
  if (allTs.length > 0) {
    const count = Math.min(5, allTs.length);
    for (let i = 0; i < count; i++) {
      const idx = Math.round((i / (count - 1 || 1)) * (allTs.length - 1));
      xLabels.push({ ts: allTs[idx], x: toX(allTs[idx]) });
    }
  }

  // Grid lines Y (4 lines)
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => PADDING.top + f * chartHeight);

  const totalHeight = PADDING.top + chartHeight + PADDING.bottom;

  const renderLine = (
    entries: HistoryEntry[],
    getValue: (e: HistoryEntry) => number,
    toY: (v: number) => number,
    color: string
  ) => {
    const pts: [number, number][] = entries.map(e => [toX(e.ts), toY(getValue(e))]);
    const timestamps = entries.map(e => e.ts);
    const { segments } = splitByGaps(pts, timestamps);

    return (
      <>
        {segments.map((seg, i) => (
          <path
            key={`seg-${i}`}
            d={catmullRomToBezier(seg)}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </>
    );
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-surface border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-white/5">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{device.name}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">История показаний (7 дней)</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors text-slate-500 dark:text-slate-400">
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
                {/* Grid */}
                {gridLines.map((y, i) => (
                  <line key={i} x1={PADDING.left} y1={y} x2={PADDING.left + chartWidth} y2={y} stroke="currentColor" strokeOpacity={0.1} strokeWidth={1} className="text-slate-600 dark:text-slate-300" />
                ))}

                {/* Temperature line */}
                {hasTemp && renderLine(tempEntries, e => e.temperature!, toTempY, '#f97316')}

                {/* Humidity line */}
                {hasHum && renderLine(humEntries, e => e.humidity!, toHumY, '#3b82f6')}

                {/* X axis labels */}
                {xLabels.map(({ ts, x }, i) => (
                  <text key={i} x={x} y={PADDING.top + chartHeight + 16} textAnchor="middle" fontSize={10} fill="currentColor" className="text-slate-500 dark:text-slate-400" opacity={0.7}>
                    {formatHHMM(ts)}
                  </text>
                ))}

                {/* Y axis - temp left */}
                {hasTemp && (
                  <>
                    <text x={PADDING.left - 4} y={PADDING.top} textAnchor="end" fontSize={9} fill="#f97316" opacity={0.9}>
                      {maxTemp.toFixed(1)}°
                    </text>
                    <text x={PADDING.left - 4} y={PADDING.top + chartHeight} textAnchor="end" fontSize={9} fill="#f97316" opacity={0.9}>
                      {minTemp.toFixed(1)}°
                    </text>
                  </>
                )}

                {/* Y axis - humidity right */}
                {hasHum && (
                  <>
                    <text x={PADDING.left + chartWidth + 4} y={PADDING.top} textAnchor="start" fontSize={9} fill="#3b82f6" opacity={0.9}>
                      {maxHum.toFixed(0)}%
                    </text>
                    <text x={PADDING.left + chartWidth + 4} y={PADDING.top + chartHeight} textAnchor="start" fontSize={9} fill="#3b82f6" opacity={0.9}>
                      {minHum.toFixed(0)}%
                    </text>
                  </>
                )}
              </svg>

              {/* Legend */}
              <div className="flex items-center gap-4 mt-2 justify-center">
                {hasTemp && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-0.5 bg-orange-500 rounded" />
                    <span className="text-xs text-slate-600 dark:text-slate-400">Температура</span>
                  </div>
                )}
                {hasHum && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-0.5 bg-blue-500 rounded" />
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
