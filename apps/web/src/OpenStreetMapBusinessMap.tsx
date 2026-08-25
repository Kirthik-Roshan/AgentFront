import { divIcon, latLngBounds, type Map as LeafletMap } from 'leaflet';
import { useEffect, useRef } from 'react';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import { Minus, Plus, Target } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { hasValidMapCoordinates } from './map-coordinates';
import type { Business } from './types';

interface OpenStreetMapBusinessMapProps {
  businesses: readonly Business[];
  selectedBusinessId: string;
  onSelect: (business: Business) => void;
}

const chennaiCentre: [number, number] = [12.9716, 80.2231];
const defaultZoom = 12;
const maximumAutomaticZoom = 16;
const defaultTileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const defaultAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const tileUrl = import.meta.env.VITE_MAP_TILE_URL?.trim() || defaultTileUrl;
const tileAttribution = import.meta.env.VITE_MAP_TILE_ATTRIBUTION?.trim() || defaultAttribution;

const markerIcon = (business: Business, selected: boolean) => divIcon({
  className: 'openstreet-map-marker-shell',
  iconSize: selected ? [38, 38] : [31, 31],
  iconAnchor: selected ? [19, 38] : [15.5, 31],
  html: `<span class="openstreet-map-marker${business.opportunityScore >= 85 ? ' is-hot' : ''}${selected ? ' is-selected' : ''}"><b>${business.opportunityScore}</b></span>`,
});

function FitResults({ businesses }: Pick<OpenStreetMapBusinessMapProps, 'businesses'>) {
  const map = useMap();

  useEffect(() => {
    const located = businesses.filter(hasValidMapCoordinates);
    if (!located.length) {
      map.setView(chennaiCentre, defaultZoom);
      return;
    }
    const bounds = latLngBounds(located.map((business) => [business.latitude, business.longitude] as [number, number]));
    map.fitBounds(bounds.pad(0.16), { maxZoom: maximumAutomaticZoom });
  }, [businesses, map]);

  return null;
}

function FocusSelection({ businesses, selectedBusinessId }: Pick<OpenStreetMapBusinessMapProps, 'businesses' | 'selectedBusinessId'>) {
  const map = useMap();
  const lastSelection = useRef<string | null>(null);

  useEffect(() => {
    const selected = businesses.find((business) => business.id === selectedBusinessId);
    if (!selected || !hasValidMapCoordinates(selected) || lastSelection.current === selectedBusinessId) return;
    lastSelection.current = selectedBusinessId;
    map.flyTo([selected.latitude, selected.longitude], Math.max(map.getZoom(), 15), { duration: 0.35 });
  }, [businesses, map, selectedBusinessId]);

  return null;
}

export function OpenStreetMapBusinessMap({ businesses, selectedBusinessId, onSelect }: OpenStreetMapBusinessMapProps) {
  const mapRef = useRef<LeafletMap | null>(null);
  const fitResults = () => {
    const map = mapRef.current;
    if (!map) return;
    const located = businesses.filter(hasValidMapCoordinates);
    if (!located.length) {
      map.setView(chennaiCentre, defaultZoom);
      return;
    }
    map.fitBounds(latLngBounds(located.map((business) => [business.latitude, business.longitude] as [number, number])).pad(0.16), {
      maxZoom: maximumAutomaticZoom,
    });
  };
  const changeZoom = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.setZoom(Math.min(19, Math.max(3, map.getZoom() + delta)));
  };

  return (
    <>
      <MapContainer
        ref={mapRef}
        className="openstreet-map-surface"
        center={chennaiCentre}
        zoom={defaultZoom}
        minZoom={3}
        maxZoom={19}
        zoomControl={false}
        attributionControl
        aria-label="OpenStreetMap of discovered businesses"
      >
        <TileLayer
          attribution={tileAttribution}
          url={tileUrl}
        />
        <FitResults businesses={businesses} />
        <FocusSelection businesses={businesses} selectedBusinessId={selectedBusinessId} />
        {businesses.filter(hasValidMapCoordinates).map((business) => (
          <Marker
            key={business.id}
            position={[business.latitude, business.longitude]}
            icon={markerIcon(business, business.id === selectedBusinessId)}
            eventHandlers={{ click: () => onSelect(business) }}
            title={`${business.name}, opportunity ${business.opportunityScore}`}
          />
        ))}
      </MapContainer>
      <div className="map-controls" aria-label="Map controls">
        <button className="icon-button" type="button" aria-label="Zoom map in" onClick={() => changeZoom(1)}><Plus size={17} /></button>
        <button className="icon-button" type="button" aria-label="Zoom map out" onClick={() => changeZoom(-1)}><Minus size={17} /></button>
        <button className="icon-button" type="button" aria-label="Fit all map results" onClick={fitResults}><Target size={16} /></button>
      </div>
    </>
  );
}
