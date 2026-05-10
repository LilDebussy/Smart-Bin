import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Tooltip } from 'react-leaflet';
import "leaflet/dist/leaflet.css";
import L from 'leaflet';
import { Trash, Wine, FileText, Milk, Leaf, Trash2, Bird, Rat, PawPrint, BarChart2, List, Eye, EyeOff } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

export type POI = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  description: string;
  lastPickup: string;
  nextPickup: string;
  wasteLevels: {
    cristal: number;
    papel: number;
    plastico: number;
    organico: number;
    resto: number;
    [key: string]: number;
  };
  predictedFull: Record<string, string>;
  animals: {
    palomas: string;
    ratas: string;
    cerdos: string;
    [key: string]: string;
  };
};

const createIcon = (colorKey: 'red' | 'yellow' | 'green') => {
  const colorMap = {
    red: { bg: 'bg-red-100', text: 'text-red-600', border: 'border-red-500' },
    yellow: { bg: 'bg-yellow-100', text: 'text-yellow-600', border: 'border-yellow-500' },
    green: { bg: 'bg-green-100', text: 'text-green-600', border: 'border-green-500' }
  };
  const colors = colorMap[colorKey];

  const html = renderToStaticMarkup(
    <div className={`flex items-center justify-center ${colors.bg} ${colors.text} rounded-full w-8 h-8 shadow-md border-2 ${colors.border} cursor-pointer`}>
      <Trash size={16} />
    </div>
  );

  return new L.DivIcon({
    html,
    className: 'custom-poi-icon bg-transparent border-none',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16]
  });
};

function getOverallWasteStatus(wasteLevels: Record<string, number>): 'red' | 'yellow' | 'green' {
  const values = Object.values(wasteLevels);
  const maxPerc = Math.max(...values, 0);
  if (maxPerc >= 100) return 'red';
  if (maxPerc >= 50) return 'yellow';
  return 'green';
}

const WasteIcon = ({ type }: { type: string }) => {
  const iconProps = { size: 14, className: "text-muted-foreground mr-1.5 flex-shrink-0" };
  switch (type.toLowerCase()) {
    case 'cristal': return <Wine {...iconProps} />;
    case 'papel': return <FileText {...iconProps} />;
    case 'plastico': return <Milk {...iconProps} />;
    case 'organico': return <Leaf {...iconProps} />;
    case 'resto':
    default: return <Trash2 {...iconProps} />;
  }
}

const WasteProgressNode = ({
  label,
  percentage,
}: {
  label: string;
  percentage: number;
  predictedFullStr?: string;
  nextPickupStr: string;
}) => {
  const status = percentage >= 100 ? 'red' : percentage >= 50 ? 'yellow' : 'green';
  const barColor = status === 'red' ? 'bg-red-500' : status === 'yellow' ? 'bg-yellow-400' : 'bg-green-500';

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1.5">
        <div className="flex items-center">
          <WasteIcon type={label} />
          <span className="text-[13px] font-medium text-foreground capitalize tracking-wide">{label}</span>
        </div>
        <span className="text-[13px] font-semibold text-foreground">{percentage}%</span>
      </div>
      <div className="w-full bg-secondary/50 rounded-full h-1.5 overflow-hidden">
        <div className={`${barColor} h-full rounded-full transition-all duration-500 ease-out`} style={{ width: `${percentage}%` }}></div>
      </div>
    </div>
  )
}

const AnimalIcon = ({ type }: { type: string }) => {
  const props = { size: 14, className: "text-muted-foreground/80" };
  switch (type.toLowerCase()) {
    case 'palomas': return <Bird {...props} />;
    case 'ratas': return <Rat {...props} />;
    case 'cerdos': return <PawPrint {...props} />;
    default: return <PawPrint {...props} />;
  }
}

const AnimalBadge = ({ name, level }: { name: string, level: string }) => {
  const color = level === 'alta' ? 'red' : level === 'media' ? 'yellow' : 'green';
  const dotColor = color === 'red' ? 'bg-red-500' : color === 'yellow' ? 'bg-yellow-400' : 'bg-green-500';

  return (
    <div className={`flex items-center justify-between rounded-lg transition-colors`}>
      <div className="flex items-center gap-2">
        <AnimalIcon type={name} />
        <span className="capitalize font-medium text-[13px] text-foreground/80">{name}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">{level}</span>
        <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`}></div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Monitoring chart (canvas) – Avanzado view
// ─────────────────────────────────────────────

// Characteristic colour for each waste type (real + faded prediction)
const WASTE_COLORS: Record<string, { real: string; pred: string }> = {
  cristal: { real: '#22c55e', pred: '#86efac' },   // green
  papel: { real: '#3b82f6', pred: '#93c5fd' },   // blue
  plastico: { real: '#f59e0b', pred: '#fcd34d' },   // amber
  organico: { real: '#84cc16', pred: '#bef264' },   // lime
  resto: { real: '#6b7280', pred: '#d1d5db' },   // gray
};

/** Generate a deterministic "today" dataset for one waste type.
 *  - Grows steadily from 0 to ~95-100 % between 00:00 and ~10:00
 *  - Drops sharply at ~10:30 (pickup)
 *  - Then grows again from 0 until current time
 */
function generateTodayData(
  typeKey: string,
  totalPoints = 145          // one point every ~10 min for 24 h
): { actual: number[]; predicted: number[] } {
  const seed = typeKey.charCodeAt(0) + typeKey.length;
  const rng = (i: number) => Math.sin(seed * 9301 + i * 49297) * 0.5 + 0.5;

  const actual: number[] = [];
  const predicted: number[] = [];

  // pickup happens at point index ~62 (around 10:20 in a 0-144 scale for 24h)
  const pickupIdx = 60 + Math.floor(rng(seed) * 8);
  // peak just before pickup
  const peakValue = 90 + rng(seed + 1) * 10;
  // final value (how full at current time ~8:23 = ~50 out of 144 pts after pickup)
  const nowIdx = Math.round((8 * 60 + 23) / (24 * 60) * totalPoints); // ~50

  for (let i = 0; i < totalPoints; i++) {
    let a: number;
    let p: number;
    const noise = (rng(i + seed * 7) - 0.5) * 3;

    if (i < pickupIdx) {
      // Growing phase – before pickup
      const t = i / pickupIdx;
      a = Math.min(100, t * peakValue + noise);
      p = Math.min(100, t * peakValue);   // smooth prediction
    } else if (i === pickupIdx) {
      // Pickup event – sharp drop
      a = 4 + rng(i) * 6;
      p = 5;
    } else {
      // Post-pickup growth
      const t = (i - pickupIdx) / (totalPoints - pickupIdx);
      const postPeak = 30 + rng(seed + 3) * 20; // how full by end of day
      if (i <= nowIdx) {
        a = Math.min(100, t * postPeak + noise);
      } else {
        a = -1; // no actual data yet (future)
      }
      p = Math.min(100, t * postPeak);
    }

    actual.push(Math.max(0, Math.round(a * 10) / 10));
    predicted.push(Math.max(0, Math.round(p * 10) / 10));
  }

  return { actual, predicted };
}

const MonitoringChart = ({
  poi,
  enabledTypes,
}: {
  poi: POI;
  enabledTypes: Set<string>;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const totalPoints = 145;

  const datasets = useMemo(() => {
    const result: Record<string, { actual: number[]; predicted: number[] }> = {};
    for (const key of Object.keys(poi.wasteLevels)) {
      result[key] = generateTodayData(key, totalPoints);
    }
    return result;
  }, [poi.id]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    const padLeft = 32;
    const padRight = 12;
    const padTop = 12;
    const padBottom = 28;
    const chartW = W - padLeft - padRight;
    const chartH = H - padTop - padBottom;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, W, H);

    // Grid lines & y labels
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'right';
    const yTicks = [0, 25, 50, 75, 100];
    for (const tick of yTicks) {
      const y = padTop + chartH - (tick / 100) * chartH;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + chartW, y);
      ctx.stroke();
      ctx.fillText(`${tick}%`, padLeft - 4, y + 3);
    }

    // X labels (hours)
    ctx.textAlign = 'center';
    const xHours = [0, 3, 6, 9, 12, 15, 18, 21, 24];
    for (const h of xHours) {
      const x = padLeft + (h / 24) * chartW;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(`${h}:00`, x, H - 6);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + chartH);
      ctx.stroke();
    }

    // "Now" vertical line
    const nowH = 8 + 23 / 60;
    const nowX = padLeft + (nowH / 24) * chartW;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(nowX, padTop);
    ctx.lineTo(nowX, padTop + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('ahora', nowX, padTop + 9);

    // Draw series
    const xOf = (i: number) => padLeft + (i / (totalPoints - 1)) * chartW;
    const yOf = (v: number) => padTop + chartH - (v / 100) * chartH;

    for (const [key, { actual, predicted }] of Object.entries(datasets)) {
      if (!enabledTypes.has(key)) continue;
      const colors = WASTE_COLORS[key] ?? { real: '#ffffff', pred: '#888888' };

      // Predicted (dashed, faded)
      ctx.strokeStyle = colors.pred;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (let i = 0; i < totalPoints; i++) {
        const x = xOf(i);
        const y = yOf(predicted[i]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Actual (solid, vivid) – only up to nowIdx
      ctx.strokeStyle = colors.real;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < totalPoints; i++) {
        if (actual[i] < 0) continue;
        const x = xOf(i);
        const y = yOf(actual[i]);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, [datasets, enabledTypes]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx_scale(canvas);
      draw();
    });
    obs.observe(canvas);
    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    ctx_scale(canvas);
    draw();
    return () => obs.disconnect();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '180px', borderRadius: '8px', display: 'block' }}
    />
  );
};

function ctx_scale(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.scale(dpr, dpr);
}

// ─────────────────────────────────────────────
//  Avanzado Panel
// ─────────────────────────────────────────────
const AvanzadoPanel = ({ poi }: { poi: POI }) => {
  const wasteKeys = Object.keys(poi.wasteLevels);
  const [enabled, setEnabled] = useState<Set<string>>(new Set(wasteKeys));

  const toggle = (key: string) => {
    setEnabled(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const today = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <div className="flex flex-col gap-3">
      {/* Quick access + date range (facade) */}
      <div className="flex flex-col gap-2">
        {/* Quick buttons */}
        <div className="flex gap-1.5 flex-wrap">
          {['Hoy', 'Ayer', '7 días', '30 días'].map((label, i) => (
            <button
              key={label}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md border transition-colors ${i === 0
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-transparent text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground'
                }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Date/time range (facade) */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1 bg-secondary/30 border border-border rounded px-2 py-1">
            <span className="opacity-50"></span>
            <span>{today} 00:00</span>
          </div>
          <span className="opacity-40">→</span>
          <div className="flex items-center gap-1 bg-secondary/30 border border-border rounded px-2 py-1">
            <span className="opacity-50"></span>
            <span>{today} 23:59</span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-lg overflow-hidden border border-white/10">
        <MonitoringChart poi={poi} enabledTypes={enabled} />
      </div>

      {/* Legend — toggle per-bin visibility */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Depósitos</span>
        <div className="grid grid-cols-2 gap-1.5">
          {wasteKeys.map(key => {
            const colors = WASTE_COLORS[key] ?? { real: '#aaa', pred: '#aaa' };
            const isOn = enabled.has(key);
            return (
              <button
                key={key}
                onClick={() => toggle(key)}
                className={`flex items-center gap-1.5 px-2 py-1. 5 rounded-md border text-[11px] font-medium capitalize transition-all ${isOn
                    ? 'border-white/20 bg-white/5 text-foreground'
                    : 'border-border/30 bg-transparent text-muted-foreground/40 line-through'
                  }`}
                style={{ paddingTop: '5px', paddingBottom: '5px' }}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: isOn ? colors.real : '#444' }}
                />
                {isOn ? <Eye size={10} className="flex-shrink-0 opacity-50" /> : <EyeOff size={10} className="flex-shrink-0 opacity-30" />}
                {key}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend for lines */}
      <div className="flex gap-3 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="currentColor" strokeWidth="2" /></svg>
          Real
        </div>
        <div className="flex items-center gap-1">
          <svg width="20" height="6">
            <line x1="0" y1="3" x2="20" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
          </svg>
          Predicción
        </div>
        <div className="flex items-center gap-1 ml-auto opacity-60">
          <span className="inline-block w-px h-3 bg-white/30 mx-0.5" />
          Ahora
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
//  Main MapApp
// ─────────────────────────────────────────────
export function MapApp() {
  const [selectedPoi, setSelectedPoi] = useState<POI | null>(null);
  const [pois, setPois] = useState<POI[]>([]);
  const [sheetTab, setSheetTab] = useState<'simple' | 'avanzado'>('simple');

  useEffect(() => {
    const fetchPois = () => {
      fetch('https://backend-production-1353.up.railway.app/api/bins')
        .then(res => res.json())
        .then(data => {
          setPois(data);
          setSelectedPoi(prev => {
            if (!prev) return null;
            const updated = data.find((p: POI) => p.id === prev.id);
            return updated || prev;
          });
        })
        .catch(err => console.error("Failed to fetch pois", err));
    };

    fetchPois();
    const interval = setInterval(fetchPois, 1000);

    return () => clearInterval(interval);
  }, []);

  const position: [number, number] = [41.3874, 2.1686];

  const icons = useMemo(() => ({
    red: createIcon('red'),
    yellow: createIcon('yellow'),
    green: createIcon('green'),
  }), []);

  return (
    <div className="w-full h-screen relative">
      <MapContainer center={position} zoom={13} style={{ width: '100%', height: '100%', zIndex: 0 }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pois.map((poi) => {
          const status = getOverallWasteStatus(poi.wasteLevels);
          return (
            <Marker
              key={poi.id}
              position={[poi.lat, poi.lng]}
              icon={icons[status]}
              eventHandlers={{
                click: () => { setSelectedPoi(poi); setSheetTab('simple'); },
              }}
            >
              <Tooltip direction="top" offset={[0, -10]}>{poi.name}</Tooltip>
            </Marker>
          );
        })}
      </MapContainer>

      <Sheet open={!!selectedPoi} onOpenChange={(open) => {
        if (!open) setSelectedPoi(null);
      }}>
        <SheetContent className="z-[9999] sm:max-w-sm w-full overflow-y-auto p-0 border-l">
          {selectedPoi && (
            <div className="flex flex-col text-left">
              <div className="py-2 border-b bg-card">
                <SheetHeader className="text-left space-y-1 relative">
                  <SheetTitle className="text-xl font-semibold tracking-tight text-foreground pr-4">
                    {selectedPoi.name}
                  </SheetTitle>
                  <SheetDescription className="text-xs text-muted-foreground">
                    Última recogida: {new Date(selectedPoi.lastPickup)
                      .toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
                      .replace(',', ' a las')}
                  </SheetDescription>
                </SheetHeader>
              </div>

              <div className="flex flex-col p-6 gap-8">

                {/* ── Tabs ── */}
                <div>
                  {/* Tab switcher */}
                  <div className="flex items-center gap-0 mb-4 rounded-lg bg-secondary/30 p-0.5 border border-border/40 w-fit">
                    <button
                      onClick={() => setSheetTab('simple')}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-semibold transition-all ${sheetTab === 'simple'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                      <List size={12} />
                      Simple
                    </button>
                    <button
                      onClick={() => setSheetTab('avanzado')}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-semibold transition-all ${sheetTab === 'avanzado'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                      <BarChart2 size={12} />
                      Avanzado
                    </button>
                  </div>

                  {/* Estado de depósitos */}
                  <h3 className="text-sm font-medium text-foreground mb-4 opacity-80 uppercase tracking-wider text-[11px]">Estado de depósitos</h3>

                  {sheetTab === 'simple' ? (
                    <div className="flex flex-col gap-4">
                      {Object.entries(selectedPoi.wasteLevels).map(([type, perc]) => (
                        <WasteProgressNode
                          key={type}
                          label={type}
                          percentage={perc as number}
                          predictedFullStr={selectedPoi.predictedFull[type]}
                          nextPickupStr={selectedPoi.nextPickup}
                        />
                      ))}
                    </div>
                  ) : (
                    <AvanzadoPanel poi={selectedPoi} />
                  )}
                </div>

                {/* Fauna */}
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-3 opacity-80 uppercase tracking-wider text-[11px]">Incidencias de fauna</h3>
                  <div className="flex flex-col gap-2">
                    {Object.entries(selectedPoi.animals).map(([animal, level]) => (
                      <AnimalBadge key={animal} name={animal} level={level as string} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
