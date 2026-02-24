import { useEffect, useRef } from "react";
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

interface Step {
  id: string;
  latitude: number | null;
  longitude: number | null;
  location_name: string;
}

interface TripMapProps {
  steps: Step[];
  activeStepId?: string | null;
  onMarkerClick?: (stepId: string) => void;
}

const FitBounds = ({ steps }: { steps: Step[] }) => {
  const map = useMap();
  useEffect(() => {
    const validSteps = steps.filter((s) => s.latitude && s.longitude);
    if (validSteps.length > 0) {
      const bounds = L.latLngBounds(
        validSteps.map((s) => [s.latitude!, s.longitude!] as L.LatLngTuple)
      );
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [steps, map]);
  return null;
};

const TripMap = ({ steps, activeStepId, onMarkerClick }: TripMapProps) => {
  const validSteps = steps.filter((s) => s.latitude && s.longitude);
  const positions = validSteps.map((s) => [s.latitude!, s.longitude!] as L.LatLngTuple);

  const activeIcon = new L.Icon({
    iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
    iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
    iconSize: [30, 45],
    iconAnchor: [15, 45],
    shadowSize: [41, 41],
  });

  return (
    <MapContainer
      center={positions[0] || [52.37, 4.89]}
      zoom={5}
      className="h-full w-full"
      style={{ background: "hsl(220 25% 12%)" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      <FitBounds steps={validSteps} />
      {positions.length > 1 && (
        <Polyline positions={positions} color="hsl(198, 80%, 50%)" weight={3} opacity={0.7} />
      )}
      {validSteps.map((step) => (
        <Marker
          key={step.id}
          position={[step.latitude!, step.longitude!]}
          icon={step.id === activeStepId ? activeIcon : undefined}
          eventHandlers={{
            click: () => onMarkerClick?.(step.id),
          }}
        />
      ))}
    </MapContainer>
  );
};

export default TripMap;
