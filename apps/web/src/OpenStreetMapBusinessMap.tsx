import { divIcon, latLngBounds, type Map as LeafletMap } from 'leaflet';
import { Component, useEffect, useRef, type ReactNode } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import { ExternalLink, MapPin, Minus, Phone, Plus, Star, Store, Target } from 'lucide-react';
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

const shopSvg = `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 10v9h16v-9M3 6h18l-2 5H5L3 6Zm5 13v-5h4v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const markerIcon = (business: Business, selected: boolean) => {
  const tone = business.opportunityScore >= 85 ? 'high' : business.opportunityScore >= 70 ? 'medium' : 'low';
  return divIcon({
    className: 'openstreet-map-marker-shell',
    iconSize: [68, 62],
    iconAnchor: [28, 58],
    popupAnchor: [6, -56],
    html: `<span class="shop-map-marker is-${tone}${selected ? ' is-selected' : ''}"><i>${shopSvg}</i><b>${business.opportunityScore}</b></span>`,
  });
};

function FitResults({ businesses }: Pick<OpenStreetMapBusinessMapProps, 'businesses'>) {
  const map = useMap();
  useEffect(() => {
    const located = businesses.filter(hasValidMapCoordinates);
    if (!located.length) return void map.setView(chennaiCentre, defaultZoom);
    map.fitBounds(latLngBounds(located.map((business) => [business.latitude, business.longitude] as [number, number])).pad(0.16), { maxZoom: maximumAutomaticZoom });
  }, [businesses, map]);
  return null;
}

function FocusSelection({ businesses, selectedBusinessId }: Pick<OpenStreetMapBusinessMapProps, 'businesses' | 'selectedBusinessId'>) {
  const map = useMap();
  const lastSelection = useRef<string | null>(null);
  useEffect(() => {
    if (lastSelection.current === null) return void (lastSelection.current = selectedBusinessId);
    const selected = businesses.find((business) => business.id === selectedBusinessId);
    if (!selected || !hasValidMapCoordinates(selected) || lastSelection.current === selectedBusinessId) return;
    lastSelection.current = selectedBusinessId;
    map.stop();
    map.flyTo([selected.latitude, selected.longitude], Math.min(18, Math.max(map.getZoom(), 15)), { duration: .55 });
  }, [businesses, map, selectedBusinessId]);
  return null;
}

class MapErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="openstreet-map-fallback" role="status">Map unavailable. Business details remain available in the list.</div> : this.props.children; }
}

function BusinessPopup({ business }: { business: Business }) {
  return <article className="place-popup">
    <div className="place-popup__media">
      {business.photoUrl
        ? <img src={business.photoUrl} alt={`${business.name} business`} loading="lazy" />
        : <div className="place-popup__fallback"><Store size={28} /></div>}
      <span>{business.opportunityScore} opportunity</span>
    </div>
    <div className="place-popup__body">
      <p className="place-popup__category">{business.category} · {business.area}</p>
      <h3>{business.name}</h3>
      <p className="place-popup__rating"><Star size={13} fill="currentColor" /> {business.rating} <span>({business.reviews} reviews)</span></p>
      <p><MapPin size={14} /> <span>{business.address || `${business.area}, ${business.city}`}</span></p>
      <div className="place-popup__contact">
        <span>Contact</span>
        <strong>{business.contact || 'Owner / Manager'}</strong>
        {business.phoneNumber
          ? <a href={`tel:${business.phoneNumber}`}><Phone size={14} /> {business.phoneNumber}</a>
          : <small><Phone size={13} /> Phone available after live Google search</small>}
      </div>
      {business.googleMapsUrl && <a className="place-popup__maps" href={business.googleMapsUrl} target="_blank" rel="noreferrer">Open in Google Maps <ExternalLink size={13} /></a>}
      {business.photoAttribution && <small>Photo: {business.photoAttribution.uri ? <a href={business.photoAttribution.uri} target="_blank" rel="noreferrer">{business.photoAttribution.displayName}</a> : business.photoAttribution.displayName}</small>}
    </div>
  </article>;
}

export function OpenStreetMapBusinessMap({ businesses, selectedBusinessId, onSelect }: OpenStreetMapBusinessMapProps) {
  const mapRef = useRef<LeafletMap | null>(null);
  const fitResults = () => {
    const map = mapRef.current;
    if (!map) return;
    const located = businesses.filter(hasValidMapCoordinates);
    if (!located.length) return void map.setView(chennaiCentre, defaultZoom);
    map.fitBounds(latLngBounds(located.map((business) => [business.latitude, business.longitude] as [number, number])).pad(0.16), { maxZoom: maximumAutomaticZoom });
  };
  const changeZoom = (delta: number) => mapRef.current?.setZoom(Math.min(19, Math.max(3, mapRef.current.getZoom() + delta)));

  return <>
    <MapErrorBoundary>
      <MapContainer ref={mapRef} className="openstreet-map-surface" center={chennaiCentre} zoom={defaultZoom} minZoom={3} maxZoom={19} zoomControl={false} attributionControl aria-label="Map of discovered businesses">
        <TileLayer attribution={tileAttribution} url={tileUrl} />
        <FitResults businesses={businesses} />
        <FocusSelection businesses={businesses} selectedBusinessId={selectedBusinessId} />
        {businesses.filter(hasValidMapCoordinates).map((business) => <Marker
          key={business.id}
          position={[business.latitude, business.longitude]}
          icon={markerIcon(business, business.id === selectedBusinessId)}
          eventHandlers={{ click: () => onSelect(business) }}
          title={`${business.name}, opportunity ${business.opportunityScore}`}
        ><Popup minWidth={285} maxWidth={320} closeButton><BusinessPopup business={business} /></Popup></Marker>)}
      </MapContainer>
    </MapErrorBoundary>
    <div className="map-controls" aria-label="Map controls">
      <button className="icon-button" type="button" aria-label="Zoom map in" onClick={() => changeZoom(1)}><Plus size={17} /></button>
      <button className="icon-button" type="button" aria-label="Zoom map out" onClick={() => changeZoom(-1)}><Minus size={17} /></button>
      <button className="icon-button" type="button" aria-label="Fit all map results" onClick={fitResults}><Target size={16} /></button>
    </div>
  </>;
}
