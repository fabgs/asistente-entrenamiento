import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { LatLon } from '@/domain/gps';
import { colors, isDark, mapBrightness } from '@/theme';

export type MapMode = '2d' | '3d';
export type MapLayer = 'map' | 'satellite';
export type MapStatus = 'loading' | 'ready' | 'offline';

/**
 * MapLibre GL JS in a WebView: zoom, pan, rotate and tilt, 3D relief and a satellite layer, with no
 * API keys. Map, relief and library come from the internet (the WebView caches them); without a
 * connection it says so and the static map of the walk detail still works.
 * Sources: OpenStreetMap tiles, Spain's PNOA orthophotos (IGN) and Mapzen's terrain tiles on AWS.
 */
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.24.0/dist';
// Subresource integrity: the WebView refuses the library if what arrives is not exactly this version.
const MAPLIBRE_JS_SRI = 'sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp';
const MAPLIBRE_CSS_SRI = 'sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK';
const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const PNOA =
  'https://www.ign.es/wmts/pnoa-ma?request=GetTile&service=WMTS&VERSION=1.0.0&Layer=OI.OrthoimageCoverage' +
  '&Style=default&Format=image/jpeg&TileMatrixSet=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}';
const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

type Coords = [number, number][][];
const toCoords = (segments: LatLon[][]): Coords => segments.map((s) => s.map((p) => [p.lon, p.lat]));

/** A path of the heat map (PLAN.md §6.8, 1.4.10): its colour, its width in dp, how much of its outline shows and what goes on top. */
export interface HeatPath {
  points: LatLon[];
  color: string;
  width: number;
  casing: number;
  sort: number;
}

const toHeat = (paths: HeatPath[]) => ({
  type: 'FeatureCollection',
  features: paths.map(({ points, ...properties }) => ({
    type: 'Feature',
    properties,
    geometry: { type: 'LineString', coordinates: points.map((p) => [p.lon, p.lat]) },
  })),
});

type Frame = [[number, number], [number, number]];
const toFrame = (frame: { min: LatLon; max: LatLon } | null): Frame | null =>
  frame ? [[frame.min.lon, frame.min.lat], [frame.max.lon, frame.max.lat]] : null;

function buildHtml(initial: {
  route: Coords;
  guide: Coords;
  mode: MapMode;
  layer: MapLayer;
  padding: object;
  /** The heat map: grey tiles (only its paths have colour) and taps on its paths. */
  heat: boolean;
  frame: Frame | null;
}): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="${MAPLIBRE}/maplibre-gl.css" integrity="${MAPLIBRE_CSS_SRI}" crossorigin="anonymous">
<style>
html,body,#map{margin:0;padding:0;width:100%;height:100%;background:${colors.bg};overflow:hidden}
.maplibregl-ctrl-attrib{background:${colors.overlay}!important;color:${colors.muted};font:10px sans-serif}
.maplibregl-ctrl-attrib a{color:${colors.muted}}
.maplibregl-ctrl-attrib-button{filter:invert(${isDark ? 1 : 0})}
.km{box-sizing:border-box;width:20px;height:20px;border-radius:10px;border:2px solid ${colors.text};background:${colors.bg};
 color:${colors.text};font:700 11px sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.6)}
</style></head><body><div id="map"></div>
<script>
function post(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m))}
window.onerror=function(m){post({type:'error',message:String(m)})};
</script>
<script src="${MAPLIBRE}/maplibre-gl.js" integrity="${MAPLIBRE_JS_SRI}" crossorigin="anonymous" onerror="post({type:'offline'})"></script>
<script>
(function(){
if(!window.maplibregl)return;
var init=${JSON.stringify(initial)};
var state={route:init.route,guide:init.guide,mode:init.mode,padding:init.padding,follow:false,kms:[],frame:init.frame};
var empty={type:'FeatureCollection',features:[]};
var map=new maplibregl.Map({container:'map',attributionControl:false,maxPitch:75,fadeDuration:0,
 style:{version:8,
  sources:{
   osm:{type:'raster',tiles:['${OSM}'],tileSize:128,maxzoom:19,attribution:'© OpenStreetMap'},
   pnoa:{type:'raster',tiles:['${PNOA}'],tileSize:128,maxzoom:19,attribution:'PNOA © IGN'},
   terrain:{type:'raster-dem',tiles:['${TERRAIN}'],encoding:'terrarium',tileSize:256,maxzoom:15,attribution:'Relieve © Mapzen'},
   shade:{type:'raster-dem',tiles:['${TERRAIN}'],encoding:'terrarium',tileSize:256,maxzoom:15},
   heat:{type:'geojson',data:empty},
   guide:{type:'geojson',data:empty},
   route:{type:'geojson',data:empty},
   ends:{type:'geojson',data:empty},
   cursor:{type:'geojson',data:empty}},
  layers:[
   {id:'bg',type:'background',paint:{'background-color':'${colors.bg}'}},
   {id:'osm',type:'raster',source:'osm',paint:{'raster-brightness-max':${mapBrightness},'raster-saturation':${initial.heat ? -0.8 : isDark ? -0.25 : 0}}},
   {id:'pnoa',type:'raster',source:'pnoa',layout:{visibility:'none'},paint:{'raster-brightness-max':0.9}},
   {id:'shade',type:'hillshade',source:'shade',layout:{visibility:'none'},paint:{'hillshade-exaggeration':0.35,'hillshade-shadow-color':'#000000'}},
   {id:'heat-casing',type:'line',source:'heat',layout:{'line-join':'round','line-cap':'round','line-sort-key':['get','sort']},paint:{'line-color':'${colors.trailCasing}','line-width':['+',['get','width'],3],'line-opacity':['get','casing']}},
   {id:'heat',type:'line',source:'heat',layout:{'line-join':'round','line-cap':'round','line-sort-key':['get','sort']},paint:{'line-color':['get','color'],'line-width':['get','width']}},
   {id:'guide-casing',type:'line',source:'guide',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'${colors.overlay}','line-width':14}},
   {id:'guide',type:'line',source:'guide',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'${colors.guide}','line-width':10}},
   {id:'route-casing',type:'line',source:'route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'${colors.mapCasing}','line-width':10}},
   {id:'route',type:'line',source:'route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'${colors.primary}','line-width':6}},
   {id:'ends',type:'circle',source:'ends',paint:{'circle-radius':['match',['get','kind'],'start',6,7],'circle-color':['match',['get','kind'],'start','${colors.bg}','${colors.primary}'],'circle-stroke-color':['match',['get','kind'],'start','${colors.primary}','${colors.bg}'],'circle-stroke-width':['match',['get','kind'],'start',3,2]}},
   {id:'cursor-shadow',type:'circle',source:'cursor',paint:{'circle-radius':11,'circle-color':'#000000','circle-opacity':0.35,'circle-blur':0.6}},
   {id:'cursor',type:'circle',source:'cursor',paint:{'circle-radius':7,'circle-color':'${colors.text}','circle-stroke-color':'${colors.bg}','circle-stroke-width':3}}]}});
map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-left');
function bounds(){var b=new maplibregl.LngLatBounds();state.route.concat(state.guide).forEach(function(s){s.forEach(function(c){b.extend(c)})});
 if(state.frame){b.extend(state.frame[0]);b.extend(state.frame[1])}return b}
function count(){return state.route.concat(state.guide).reduce(function(n,s){return n+s.length},state.frame?2:0)}
function setHeat(data){map.getSource('heat').setData(data)}
// The place of a path closest to a tap, among those within 24 px: a tap next to a line still reads it.
function nearestOnHeat(point){
 var box=[[point.x-24,point.y-24],[point.x+24,point.y+24]],best=null,least=Infinity;
 map.queryRenderedFeatures(box,{layers:['heat']}).forEach(function(f){
  var g=f.geometry,lines=g.type==='MultiLineString'?g.coordinates:[g.coordinates];
  lines.forEach(function(l){for(var i=0;i<l.length-1;i++){
   var a=map.project(l[i]),b=map.project(l[i+1]),dx=b.x-a.x,dy=b.y-a.y,n=dx*dx+dy*dy;
   var t=n?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/n)):0,x=a.x+t*dx,y=a.y+t*dy;
   var d=(x-point.x)*(x-point.x)+(y-point.y)*(y-point.y);
   if(d<least){least=d;best=[x,y]}}})});
 return best?map.unproject(best):null}
function setGuide(guide){state.guide=guide;map.getSource('guide').setData({type:'Feature',geometry:{type:'MultiLineString',coordinates:guide}})}
function last(){var s=state.route[state.route.length-1];return s&&s[s.length-1]}
function recenter(animate){if(!count())return;map.fitBounds(bounds(),{padding:state.padding,maxZoom:17,bearing:map.getBearing(),pitch:map.getPitch(),duration:animate?600:0})}
function setRoute(route,fit){
 state.route=route;
 map.getSource('route').setData({type:'Feature',geometry:{type:'MultiLineString',coordinates:route}});
 var all=[].concat.apply([],route),f=[];
 if(all.length){f.push({type:'Feature',properties:{kind:'start'},geometry:{type:'Point',coordinates:all[0]}});
  f.push({type:'Feature',properties:{kind:'end'},geometry:{type:'Point',coordinates:all[all.length-1]}})}
 map.getSource('ends').setData({type:'FeatureCollection',features:f});
 if(fit)recenter(false);
 else if(state.follow&&last())map.easeTo({center:last(),duration:500})}
function setKms(kms){
 state.kms.forEach(function(m){m.remove()});
 state.kms=kms.map(function(k){var el=document.createElement('div');el.className='km';el.textContent=k.km;
  return new maplibregl.Marker({element:el}).setLngLat([k.lon,k.lat]).addTo(map)})}
// The camera only moves when the marker leaves the middle 80 % of the view.
function setCursor(c){
 map.getSource('cursor').setData(c?{type:'Feature',geometry:{type:'Point',coordinates:c}}:empty);
 if(!c)return;var p=map.project(c),w=map.getCanvas().clientWidth,h=map.getCanvas().clientHeight;
 if(p.x<w*0.1||p.x>w*0.9||p.y<h*0.1||p.y>h*0.9)map.easeTo({center:c,duration:300})}
function setLayer(layer){map.setLayoutProperty('osm','visibility',layer==='map'?'visible':'none');map.setLayoutProperty('pnoa','visibility',layer==='satellite'?'visible':'none')}
function setMode(mode,animate){
 state.mode=mode;var three=mode==='3d';
 map.setLayoutProperty('shade','visibility',three?'visible':'none');
 map.setTerrain(three?{source:'terrain',exaggeration:1.5}:null);
 map.easeTo({pitch:three?60:0,bearing:three?(map.getBearing()||-25):0,duration:animate?900:0})}
map.on('load',function(){
 map.setSky({'sky-color':'${colors.bg}','horizon-color':'${colors.cardAlt}','fog-color':'${colors.bg}','sky-horizon-blend':0.6,'horizon-fog-blend':0.6,'fog-ground-blend':0.7});
 setLayer(init.layer);setGuide(init.guide);setRoute(init.route,true);
 if(init.mode==='3d')setMode('3d',true);
 post({type:'ready'})});
map.on('moveend',function(){post({type:'camera',bearing:map.getBearing(),pitch:map.getPitch()})});
map.on('dragstart',function(){if(state.follow)post({type:'moved'})});
map.on('click',function(e){
 if(init.heat){var at=nearestOnHeat(e.point);post(at?{type:'tap',lon:at.lng,lat:at.lat}:{type:'tapout'});return}
 var box=[[e.point.x-24,e.point.y-24],[e.point.x+24,e.point.y+24]];
 if(map.queryRenderedFeatures(box,{layers:['route','route-casing']}).length)post({type:'tap',lon:e.lngLat.lng,lat:e.lngLat.lat})});
window.app={setHeat:setHeat,setFrame:function(frame){state.frame=frame},setRoute:setRoute,setGuide:setGuide,setCursor:setCursor,setMode:setMode,setLayer:setLayer,recenter:recenter,setKms:setKms,
 north:function(){map.easeTo({bearing:0,pitch:state.mode==='3d'?60:0,duration:500})},
 follow:function(on){state.follow=on;if(on&&last())map.easeTo({center:last(),zoom:Math.max(map.getZoom(),16),duration:500})}};
})();
</script></body></html>`;
}

export function InteractiveMap({
  segments,
  guide = [],
  cursor,
  kms = [],
  mode,
  layer,
  bottomInset = 0,
  topInset = 0,
  recenterKey = 0,
  northKey = 0,
  follow = false,
  onCamera,
  onStatus,
  onTap,
  onTapOut,
  onUserMove,
  heat,
  frame = null,
}: {
  segments: LatLon[][];
  /** What is left of a route being followed (1.4.9), in grey under the walk; «ver todo» fits both. */
  guide?: LatLon[][];
  cursor: LatLon | null;
  /** Marks at each km: only in the full map. */
  kms?: (LatLon & { km: number })[];
  mode: MapMode;
  layer: MapLayer;
  /** Space covered by controls at the bottom and top, kept free when fitting the route. */
  bottomInset?: number;
  topInset?: number;
  /** Changing it fits the route in view again. */
  recenterKey?: number;
  /** Changing it turns the map back to the north. */
  northKey?: number;
  /** While recording: keep the latest position in view. */
  follow?: boolean;
  onCamera?: (camera: { bearing: number; pitch: number }) => void;
  onStatus?: (status: MapStatus) => void;
  /** A tap on (or next to) the route. */
  onTap?: (p: LatLon) => void;
  /** The user dragged the map while it was following. */
  onUserMove?: () => void;
  /**
   * The heat map (1.4.10) instead of a walk: the paths to draw. The tiles go grey, so only the paths
   * have colour, and `onTap` gets the place of the path closest to the tap (`onTapOut`, a tap on none).
   */
  heat?: HeatPath[];
  onTapOut?: () => void;
  /** What «ver todo» and the first view fit besides the route. */
  frame?: { min: LatLon; max: LatLon } | null;
}) {
  const web = useRef<WebView<object>>(null);
  const [status, setStatus] = useState<MapStatus>('loading');
  const [html] = useState(() =>
    buildHtml({
      route: toCoords(segments),
      guide: toCoords(guide),
      mode,
      layer,
      padding: { top: 48 + topInset, right: 48, bottom: 48 + bottomInset, left: 48 },
      heat: heat !== undefined,
      frame: toFrame(frame),
    }),
  );
  const ready = status === 'ready';
  const run = (code: string) => web.current?.injectJavaScript(`window.app&&${code};true;`);

  // Only when the route really changes (a walk being recorded grows every few seconds).
  const routeKey = `${segments.map((s) => s.length).join(',')}:${segments.at(-1)?.at(-1)?.lat}`;
  useEffect(() => {
    if (ready) run(`app.setRoute(${JSON.stringify(toCoords(segments))},false)`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new array arrives on every reload
  }, [ready, routeKey]);
  const guideKey = `${guide.map((s) => s.length).join(',')}:${guide[0]?.[0]?.lat}:${guide[0]?.[0]?.lon}`;
  useEffect(() => {
    if (ready) run(`app.setGuide(${JSON.stringify(toCoords(guide))})`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new array arrives on every reload
  }, [ready, guideKey]);
  useEffect(() => {
    if (ready && heat) run(`app.setHeat(${JSON.stringify(toHeat(heat))})`);
  }, [ready, heat]);
  const frameKey = JSON.stringify(toFrame(frame));
  useEffect(() => {
    if (ready) run(`app.setFrame(${frameKey})`);
  }, [ready, frameKey]);
  const kmKey = kms.map((k) => k.km).join(',');
  useEffect(() => {
    if (ready) run(`app.setKms(${JSON.stringify(kms)})`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new array arrives on every reload
  }, [ready, kmKey]);
  useEffect(() => {
    if (ready) run(`app.setCursor(${cursor ? JSON.stringify([cursor.lon, cursor.lat]) : 'null'})`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new object arrives on every render
  }, [ready, cursor?.lat, cursor?.lon]);
  useEffect(() => {
    if (ready) run(`app.setMode('${mode}',true)`);
  }, [ready, mode]);
  useEffect(() => {
    if (ready) run(`app.setLayer('${layer}')`);
  }, [ready, layer]);
  useEffect(() => {
    if (ready) run(`app.follow(${follow})`);
  }, [ready, follow]);
  useEffect(() => {
    if (ready && recenterKey > 0) run('app.recenter(true)');
  }, [ready, recenterKey]);
  useEffect(() => {
    if (ready && northKey > 0) run('app.north()');
  }, [ready, northKey]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(e.nativeEvent.data) as {
        type: string;
        bearing?: number;
        pitch?: number;
        lat?: number;
        lon?: number;
        message?: string;
      };
      if (message.type === 'ready' || message.type === 'offline') {
        setStatus(message.type);
        onStatus?.(message.type);
      } else if (message.type === 'camera') onCamera?.({ bearing: message.bearing ?? 0, pitch: message.pitch ?? 0 });
      else if (message.type === 'tap') onTap?.({ lat: message.lat ?? 0, lon: message.lon ?? 0 });
      else if (message.type === 'tapout') onTapOut?.();
      else if (message.type === 'moved') onUserMove?.();
      else if (message.type === 'error') console.warn('Map error', message.message);
    } catch {
      // Not one of ours.
    }
  };

  return (
    <View style={styles.box}>
      <WebView<object>
        ref={web}
        source={{ html, baseUrl: 'https://localhost/' }}
        originWhitelist={['*']}
        onMessage={onMessage}
        applicationNameForUserAgent="Entreno/1.3 (app personal de entrenamiento)"
        setSupportMultipleWindows={false}
        overScrollMode="never"
        webviewDebuggingEnabled={__DEV__}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, backgroundColor: colors.bg },
  web: { flex: 1, backgroundColor: colors.bg },
});
