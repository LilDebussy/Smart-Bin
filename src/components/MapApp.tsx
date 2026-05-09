import { useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Tooltip } from 'react-leaflet';
import "leaflet/dist/leaflet.css";
import L from 'leaflet';
import { Trash, AlertTriangle, Wine, FileText, Milk, Leaf, Trash2, Bird, Rat, PawPrint } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import poisData from '@/data/pois.json';

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

const pois = poisData as POI[];

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
  predictedFullStr,
  nextPickupStr
}: {
  label: string;
  percentage: number;
  predictedFullStr?: string;
  nextPickupStr: string;
}) => {
  const status = percentage >= 100 ? 'red' : percentage >= 50 ? 'yellow' : 'green';
  const barColor = status === 'red' ? 'bg-red-500' : status === 'yellow' ? 'bg-yellow-400' : 'bg-green-500';

  let alertNode = null;
  if (predictedFullStr) {
    const timeStr = new Date(predictedFullStr).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const predictedTime = new Date(predictedFullStr);
    const pickupTime = new Date(nextPickupStr);

    if (predictedTime < pickupTime) {
      const diffMs = pickupTime.getTime() - predictedTime.getTime();
      const diffHrs = Math.max(1, Math.round(diffMs / (1000 * 60 * 60)));

      const puTimeStr = pickupTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

      // if (percentage >= 100) { // Considered Full
      //   alertNode = (
      //     <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-red-600 leading-tight">
      //       <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
      //       <span>Se llenó a las {timeStr}. ({diffHrs}h antes de su recogida)</span>
      //     </div>
      //   );
      // } else { // Not full yet <= 99
      //   alertNode = (
      //     <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-red-600/90 leading-tight">
      //       <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
      //       <span>Se llenará a las {timeStr} ({diffHrs}h antes de su recogida).</span>
      //     </div>
      //   );
      // }
    }
  }

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
      {alertNode}
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
  const badgeColors = color === 'red' ? 'bg-red-50/50 border-red-100 dark:bg-red-950/20 dark:border-red-900/30' : color === 'yellow' ? 'bg-yellow-50/50 border-yellow-100 dark:bg-yellow-950/20 dark:border-yellow-900/30' : 'bg-secondary/20 border-border/40';

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

export function MapApp() {
  const [selectedPoi, setSelectedPoi] = useState<POI | null>(null);

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
                click: () => setSelectedPoi(poi),
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
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-4 opacity-80 uppercase tracking-wider text-[11px]">Estado de depósitos</h3>
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
                </div>

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
