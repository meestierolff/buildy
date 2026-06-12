import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

interface RouteStep {
  id: string;
  latitude: number | null;
  longitude: number | null;
  location_name: string;
  step_date: string;
}

interface Props {
  steps: RouteStep[];
  activeStepId?: string | null;
  onMarkerClick?: (stepId: string) => void;
  className?: string;
}

const FitBounds = ({ positions }: { positions: L.LatLngTuple[] }) => {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 0) return;
    // Ensure correct sizing before fitting (sticky/grid containers can mis-measure on mount)
    const t = setTimeout(() => {
      map.invalidateSize();
      if (positions.length === 1) {
        map.setView(positions[0], 14, { animate: true });
        return;
      }
      const bounds = L.latLngBounds(positions);
      map.fitBounds(bounds.pad(0.15), { padding: [60, 60], maxZoom: 14, animate: true });
    }, 50);
    return () => clearTimeout(t);
  }, [positions, map]);
  return null;
};

const pinIcon = (color: string, label: string) =>
  L.divIcon({
    className: "trip-route-pin",
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);">
      <div style="background:${color};color:#fff;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;padding:2px 6px;border-radius:9999px;box-shadow:0 1px 3px rgba(0,0,0,0.3);white-space:nowrap;">${label}</div>
      <div style="width:14px;height:14px;background:${color};border:2px solid #fff;border-radius:9999px;box-shadow:0 1px 3px rgba(0,0,0,0.4);margin-top:2px;"></div>
    </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });

const dotIcon = (active: boolean) =>
  L.divIcon({
    className: "trip-route-dot",
    html: `<div style="width:${active ? 14 : 10}px;height:${active ? 14 : 10}px;background:${active ? "hsl(38,85%,55%)" : "hsl(160,30%,30%)"};border:2px solid #fff;border-radius:9999px;box-shadow:0 1px 3px rgba(0,0,0,0.4);transform:translate(-50%,-50%);"></div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });

const TripRouteMap = ({ steps, activeStepId, onMarkerClick, className }: Props) => {
  // Chronological order (oldest -> newest) for route
  const valid = [...steps]
    .filter((s) => typeof s.latitude === "number" && typeof s.longitude === "number")
    .sort((a, b) => new Date(a.step_date).getTime() - new Date(b.step_date).getTime());

  const positions = valid.map((s) => [s.latitude!, s.longitude!] as L.LatLngTuple);

  if (positions.length === 0) {
    return (
      <div className={`flex h-full w-full items-center justify-center rounded-md border border-border bg-muted/30 text-center text-xs text-muted-foreground p-4 ${className ?? ""}`}>
        Voeg locaties toe aan je updates om de route op de kaart te zien.
      </div>
    );
  }

  return (
    <div className={`relative h-full w-full overflow-hidden rounded-md border border-border ${className ?? ""}`}>
      <MapContainer
        center={positions[0]}
        zoom={13}
        scrollWheelZoom={false}
        className="h-full w-full"
        style={{ background: "hsl(160 30% 8%)" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <FitBounds positions={positions} />
        {positions.length > 1 && (
          <Polyline positions={positions} pathOptions={{ color: "hsl(38, 85%, 55%)", weight: 3, opacity: 0.85, dashArray: "6 6" }} />
        )}
        {valid.map((step, idx) => {
          const isStart = idx === 0;
          const isEnd = idx === valid.length - 1 && valid.length > 1;
          let icon: L.DivIcon;
          if (isStart) icon = pinIcon("hsl(160, 50%, 30%)", "Start");
          else if (isEnd) icon = pinIcon("hsl(38, 85%, 45%)", "Eind");
          else icon = dotIcon(step.id === activeStepId);
          return (
            <Marker
              key={step.id}
              position={[step.latitude!, step.longitude!]}
              icon={icon}
              eventHandlers={{ click: () => onMarkerClick?.(step.id) }}
            />
          );
        })}
      </MapContainer>
    </div>
  );
};

export default TripRouteMap;
