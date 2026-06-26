import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useMapEvents,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
  Circle,
  CircleMarker,
} from 'react-leaflet'
import L from 'leaflet'
import { openDB } from 'idb'
import { Icon } from '@mdi/react'
import {
  mdiMapMarker,
  mdiNavigationVariant,
  mdiPlay,
  mdiPause,
  mdiFlag,
  mdiCrosshairsGps,
  mdiMap,
  mdiLoading,
  mdiHistory,
  mdiDelete,
  mdiPencil,
  mdiWater,
  mdiCampfire,
  mdiAlert,
  mdiNote,
  mdiFileExport,
  mdiMenu,
} from '@mdi/js'

import { Capacitor, registerPlugin } from '@capacitor/core'
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation'

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>(
  'BackgroundGeolocation',
)

type TrackingWidgetPlugin = {
  start: () => Promise<void>
  stop: () => Promise<void>
  saveLastLocation: (data: {
    lat: number
    lng: number
    accuracy: number
    altitude: number
  }) => Promise<void>
  readMarkers: () => Promise<{ markers: CustomMarker[] }>
  clearMarkers: () => Promise<void>
  readStopRequested: () => Promise<{ stopRequested: boolean }>
  clearStopRequested: () => Promise<void>
}

const TrackingWidget = registerPlugin<TrackingWidgetPlugin>('TrackingWidget')

type Point = {
  id?: number
  lat: number
  lng: number
  accuracy: number
  speed: number | null
  altitude: number | null
  timestamp: number
}

type CustomMarker = {
  id?: number
  type: 'water' | 'camp' | 'danger' | 'note'
  title: string
  lat: number
  lng: number
  createdAt: number
}

type SavedRoute = {
  id?: number
  name: string
  points: Point[]
  markers: CustomMarker[]
  distance: number
  duration: number
  createdAt: number
}

type OfflineMapZone = {
  id: string
  name: string
  lat: number
  lng: number
  zooms: { zoom: number; radius: number }[]
}

const dbPromise = openDB('mountain-tracker-db', 3, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('points')) {
      db.createObjectStore('points', { keyPath: 'id', autoIncrement: true })
    }

    if (!db.objectStoreNames.contains('session')) {
      db.createObjectStore('session', { keyPath: 'key' })
    }

    if (!db.objectStoreNames.contains('routes')) {
      db.createObjectStore('routes', { keyPath: 'id', autoIncrement: true })
    }

    if (!db.objectStoreNames.contains('markers')) {
      db.createObjectStore('markers', { keyPath: 'id', autoIncrement: true })
    }
  },
})

const startIcon = new L.Icon({
  iconUrl: `${import.meta.env.BASE_URL}marker-icon.png`,
  shadowUrl: `${import.meta.env.BASE_URL}marker-shadow.png`,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

function getMarkerIcon(type: CustomMarker['type']) {
  const config = {
    water: {
      icon: mdiWater,
      color: '#3b82f6',
    },
    camp: {
      icon: mdiCampfire,
      color: '#22c55e',
    },
    danger: {
      icon: mdiAlert,
      color: '#ef4444',
    },
    note: {
      icon: mdiNote,
      color: '#64748b',
    },
  }[type]

  return L.divIcon({
    className: '',
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    html: `
      <div style="
        width: 42px;
        height: 42px;
        border-radius: 9999px;
        background: ${config.color};
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 10px 25px rgba(0,0,0,.35);
        border: 3px solid white;
      ">
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path fill="white" d="${config.icon}" />
        </svg>
      </div>
    `,
  })
}

function MapController({
  point,
  follow,
  onMove,
}: {
  point: Point | null
  follow: boolean
  onMove: () => void
}) {
  const map = useMap()

  useMapEvents({
    dragstart() {
      onMove()
    },

    zoomstart() {
      onMove()
    },
  })

  useEffect(() => {
    if (point && follow) {
      map.setView([point.lat, point.lng], 17)
    }
  }, [point, follow, map])

  return null
}

function distanceMeters(a: Point, b: Point) {
  const R = 6371000
  const toRad = (value: number) => (value * Math.PI) / 180

  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)

  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} м`
  return `${(meters / 1000).toFixed(2)} км`
}

function formatTime(ms: number) {
  const total = Math.floor(ms / 1000)

  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  if (hours > 0) return `${hours} ч ${minutes} мин`
  return `${minutes} мин ${seconds} сек`
}

export default function App() {
  const watchId = useRef<number | null>(null)
  const backgroundWatchId = useRef<string | null>(null)
  const gpxInputRef = useRef<HTMLInputElement | null>(null)

  const [points, setPoints] = useState<Point[]>([])
  const [tracking, setTracking] = useState(false)
  const [activeStartedAt, setActiveStartedAt] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const [downloadingMap, setDownloadingMap] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState('')
  const [routes, setRoutes] = useState<SavedRoute[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [finishModalOpen, setFinishModalOpen] = useState(false)
  const [routeName, setRouteName] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [followMe, setFollowMe] = useState(true)
  const [returnMode, setReturnMode] = useState(false)
  const [returnIndex, setReturnIndex] = useState<number | null>(null)
  const [markers, setMarkers] = useState<CustomMarker[]>([])
  const [markerModalOpen, setMarkerModalOpen] = useState(false)
  const [markersOpen, setMarkersOpen] = useState(false)
  const [heading, setHeading] = useState<number | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [returnTrack, setReturnTrack] = useState<Point[]>([])
  const [offlineMapsOpen, setOfflineMapsOpen] = useState(false)
  const [downloadedZones, setDownloadedZones] = useState<string[]>([])

  const [selectedMarker, setSelectedMarker] = useState<CustomMarker | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<Point | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<CustomMarker | Point | null>(null)
  const [traceTarget, setTraceTarget] = useState<CustomMarker | Point | null>(null)
  const [traceTargetIndex, setTraceTargetIndex] = useState<number | null>(null)

  const currentPoint = points.at(-1) ?? null
  const startPoint = points[0] ?? null
  const activeReturnTrack = returnTrack.length > 0 ? returnTrack : points

  const targetPoint =
    returnMode &&
    returnIndex !== null &&
    returnIndex > 0
      ? activeReturnTrack[returnIndex - 1]
      : null

  const targetBearing =
    currentPoint && targetPoint
      ? calculateBearing(currentPoint, targetPoint)
      : null

  const arrowRotation =
    targetBearing !== null && heading !== null
      ? targetBearing - heading
      : targetBearing

  const currentTrackIndex = currentPoint ? findNearestPointIndex(currentPoint) : null

  const traceNextIndex =
    traceTargetIndex !== null &&
    currentTrackIndex !== null
      ? currentTrackIndex > traceTargetIndex
        ? currentTrackIndex - 1
        : currentTrackIndex < traceTargetIndex
          ? currentTrackIndex + 1
          : traceTargetIndex
      : null

  const traceNextPoint =
    traceNextIndex !== null
      ? points[traceNextIndex]
      : null

  const activeNavTarget = traceTarget ? traceNextPoint : targetPoint

  const activeNavBearing =
    currentPoint && activeNavTarget
      ? calculateBearing(currentPoint, activeNavTarget as Point)
      : null

  const activeNavRotation =
    activeNavBearing !== null && heading !== null
      ? activeNavBearing - heading
      : activeNavBearing

  const tracePath =
    traceTargetIndex !== null &&
    currentTrackIndex !== null
      ? currentTrackIndex > traceTargetIndex
        ? points.slice(traceTargetIndex, currentTrackIndex + 1)
        : points.slice(currentTrackIndex, traceTargetIndex + 1)
      : []

  const returnRemainingPath =
    returnMode && returnIndex !== null
      ? activeReturnTrack.slice(0, returnIndex + 1)
      : []

  const returnPassedPath =
    returnMode && returnIndex !== null
      ? activeReturnTrack.slice(returnIndex)
      : []

  useEffect(() => {
    loadSaved()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (
      !returnMode ||
      !currentPoint ||
      returnIndex === null ||
      returnIndex <= 0
    ) {
      return
    }

    const target = points[returnIndex - 1]

    const distance = distanceMeters(
      currentPoint,
      target,
    )

    if (distance < 10) {
      setReturnIndex(prev =>
        prev !== null && prev > 0
          ? prev - 1
          : prev,
      )
    }
  }, [
    currentPoint,
    returnMode,
    returnIndex,
    points,
  ])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const timer = setInterval(async () => {
      const stopResult = await TrackingWidget.readStopRequested()

      if (stopResult.stopRequested) {
        await TrackingWidget.clearStopRequested()
        await stopTracking()
      }

      const result = await TrackingWidget.readMarkers()

      if (result.markers.length > 0) {
        const db = await dbPromise

        for (const marker of result.markers) {
          await db.add('markers', marker)
        }

        const savedMarkers = await db.getAll('markers')
        setMarkers(savedMarkers)

        await TrackingWidget.clearMarkers()
      }
    }, 3000)

    return () => clearInterval(timer)
  }, [])

  async function loadSaved() {
    const db = await dbPromise
    const savedPoints = await db.getAll('points')
    const savedElapsed = await db.get('session', 'elapsedMs')
    const savedRoutes = await db.getAll('routes')
    const savedMarkers = await db.getAll('markers')
    const savedDownloadedZones = await db.get('session', 'downloadedZones')
    
    if (savedDownloadedZones?.value) {
      setDownloadedZones(savedDownloadedZones.value)
    }
    setMarkers(savedMarkers)
    setPoints(savedPoints)
    setRoutes(savedRoutes.reverse())

    if (savedElapsed?.value) {
      setElapsedMs(savedElapsed.value)
    }
  }

  async function savePoint(point: Point) {
    const db = await dbPromise

    const last = points.at(-1)
    if (last) {
      const distance = distanceMeters(last, point)
      if (distance < 2) return
    }

    await db.add('points', point)
    setPoints(prev => [...prev, point])

    if (Capacitor.isNativePlatform()) {
      await TrackingWidget.saveLastLocation({
        lat: point.lat,
        lng: point.lng,
        accuracy: point.accuracy,
        altitude: point.altitude ?? 0,
      })
    }
  }

  async function startTracking() {
    setError('')

    if (!Capacitor.isNativePlatform()) {
      if (!navigator.geolocation) {
        setError('GPS не поддерживается этим браузером')
        return
      }

      watchId.current = navigator.geolocation.watchPosition(
        async position => {
          await savePoint({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed,
            altitude: position.coords.altitude,
            timestamp: position.timestamp,
          })
        },
        err => setError(err.message),
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 15000,
        },
      )

      setActiveStartedAt(Date.now())
      setTracking(true)
 
      return
    }

    backgroundWatchId.current = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: 'Mountain Tracker записывает маршрут',
        backgroundTitle: 'GPS-трекинг запущен',
        requestPermissions: true,
        stale: false,
        distanceFilter: 5,
      },
      async (location: any, error: any) => {
        if (error) {
          setError(error.message)
          return
        }

        if (!location) return

        await savePoint({
          lat: location.latitude,
          lng: location.longitude,
          accuracy: location.accuracy ?? 0,
          speed: location.speed ?? null,
          altitude: location.altitude ?? null,
          timestamp: location.time ?? Date.now(),
        })
      },
    )

    setActiveStartedAt(Date.now())
    setTracking(true)

    if (Capacitor.isNativePlatform()) {
      await TrackingWidget.start()
    }
  }

  async function stopTracking() {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }

    if (backgroundWatchId.current !== null) {
      await BackgroundGeolocation.removeWatcher({
        id: backgroundWatchId.current,
      })
      backgroundWatchId.current = null
    }

    if (activeStartedAt) {
      const newElapsed = elapsedMs + (Date.now() - activeStartedAt)

      setElapsedMs(newElapsed)
      setActiveStartedAt(null)

      const db = await dbPromise
      await db.put('session', { key: 'elapsedMs', value: newElapsed })
    }
    
    if (Capacitor.isNativePlatform()) {
      await TrackingWidget.stop()
    }
    
    setTracking(false)
  }

  const totalDistance = useMemo(() => {
    return points.reduce((sum, point, index) => {
      if (index === 0) return sum
      return sum + distanceMeters(points[index - 1], point)
    }, 0)
  }, [points])

  const distanceToStart = useMemo(() => {
    if (!startPoint || !currentPoint) return 0
    return distanceMeters(startPoint, currentPoint)
  }, [startPoint, currentPoint])

  const duration =
    tracking && activeStartedAt
      ? elapsedMs + (now - activeStartedAt)
      : elapsedMs

  const avgSpeed =
    duration > 0 ? totalDistance / 1000 / (duration / 1000 / 3600) : 0

  const currentSpeed =
    currentPoint?.speed !== null && currentPoint?.speed !== undefined
      ? currentPoint.speed * 3.6
      : 0

  function exportGpx() {
    if (points.length < 2) return

    const waypoints = markers
      .map(
        marker => `  <wpt lat="${marker.lat}" lon="${marker.lng}">
      <name>${marker.title}</name>
      <time>${new Date(marker.createdAt).toISOString()}</time>
      <desc>${marker.type}</desc>
    </wpt>`,
      )
      .join('\n')

    const trackPoints = points
      .map(
        point => `      <trkpt lat="${point.lat}" lon="${point.lng}">
          ${
            point.altitude !== null && point.altitude !== undefined
              ? `<ele>${point.altitude}</ele>`
              : ''
          }
          <time>${new Date(point.timestamp).toISOString()}</time>
        </trkpt>`,
      )
      .join('\n')

    const gpx =
      `
        <?xml version="1.0" encoding="UTF-8"?>
          <gpx version="1.1" creator="Mountain Tracker">
            ${waypoints}
            <trk>
              <name>Mountain Route</name>
              <trkseg>
                ${trackPoints}
              </trkseg>
            </trk>
          </gpx>
      `

    const blob = new Blob([gpx], { type: 'application/gpx+xml' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = `mountain-route-${Date.now()}.gpx`
    a.click()

    URL.revokeObjectURL(url)
  }

  function lonToTileX(lon: number, zoom: number) {
    return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom))
  }

  function latToTileY(lat: number, zoom: number) {
    const latRad = (lat * Math.PI) / 180
    return Math.floor(
      ((1 -
        Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
        2) *
        Math.pow(2, zoom),
    )
  }

  const OFFLINE_ZONES: OfflineMapZone[] = [
    {
      id: 'almaty',
      name: 'Алматы',
      lat: 43.238949,
      lng: 76.889709,
      zooms: [
        { zoom: 11, radius: 4 },
        { zoom: 12, radius: 6 },
        { zoom: 13, radius: 8 },
        { zoom: 14, radius: 10 },
        { zoom: 15, radius: 5 },
        { zoom: 16, radius: 3 },
      ],
    },
    {
      id: 'medeu',
      name: 'Медеу',
      lat: 43.1578,
      lng: 77.0588,
      zooms: [
        { zoom: 13, radius: 6 },
        { zoom: 14, radius: 8 },
        { zoom: 15, radius: 6 },
        { zoom: 16, radius: 4 },
      ],
    },
    {
      id: 'shymbulak',
      name: 'Шымбулак',
      lat: 43.1283,
      lng: 77.0814,
      zooms: [
        { zoom: 13, radius: 6 },
        { zoom: 14, radius: 8 },
        { zoom: 15, radius: 6 },
        { zoom: 16, radius: 4 },
      ],
    },
    {
      id: 'bao',
      name: 'БАО',
      lat: 43.0505,
      lng: 76.9855,
      zooms: [
        { zoom: 13, radius: 6 },
        { zoom: 14, radius: 8 },
        { zoom: 15, radius: 6 },
        { zoom: 16, radius: 4 },
      ],
    },
  ]

  const KNOWN_LOCATIONS = [
    {
      name: 'БАО',
      lat: 43.0505,
      lng: 76.9855,
    },
    {
      name: 'Медеу',
      lat: 43.1578,
      lng: 77.0588,
    },
    {
      name: 'Шымбулак',
      lat: 43.1283,
      lng: 77.0814,
    },
    {
      name: 'Кок-Тобе',
      lat: 43.2336,
      lng: 76.9752,
    },
  ]

  function getNearestLocation(point: Point) {
    let nearest = null
    let nearestDistance = Infinity

    for (const location of KNOWN_LOCATIONS) {
      const distance = distanceMeters(point, {
        lat: location.lat,
        lng: location.lng,
        accuracy: 0,
        speed: null,
        altitude: null,
        timestamp: 0,
      })

      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = location
      }
    }

    if (nearestDistance < 3000) {
      return nearest?.name
    }

    return null
  }

  function openFinishModal() {
    if (points.length < 2) {
      alert('Маршрут слишком короткий')
      return
    }

    const routeStartPoint = points[0]

    const suggestedName =
      getNearestLocation(routeStartPoint) ??
      `Поход ${new Date().toLocaleDateString('ru-RU')}`

    setRouteName(suggestedName)
    setFinishModalOpen(true)
  }

  async function finishRoute() {
    if (!routeName.trim()) {
      alert('Введите название похода')
      return
    }

    stopTracking()

    const db = await dbPromise

    const route: SavedRoute = {
      name: routeName.trim(),
      points,
      markers,
      distance: totalDistance,
      duration,
      createdAt: Date.now(),
    }

    await db.add('routes', route)
    await db.clear('points')
    await db.clear('session')
    await db.clear('markers')

    setPoints([])
    setElapsedMs(0)
    setActiveStartedAt(null)

    const savedRoutes = await db.getAll('routes')
    setRoutes(savedRoutes.reverse())

    setFinishModalOpen(false)
    setRouteName('')

    setMarkers([])

    alert('Поход сохранён в историю')
  }

  function openRoute(route: SavedRoute) {
    setPoints(route.points)
    setMarkers(route.markers ?? [])
    setElapsedMs(route.duration)
    setActiveStartedAt(null)
    setTracking(false)
    setHistoryOpen(false)
  }

  async function deleteRoute(routeId?: number) {
    if (!routeId) return

    const confirmed = confirm('Удалить этот поход из истории?')
    if (!confirmed) return

    const db = await dbPromise
    await db.delete('routes', routeId)

    const savedRoutes = await db.getAll('routes')
    setRoutes(savedRoutes.reverse())
  }

  async function renameRoute(route: SavedRoute) {
    if (!route.id) return

    const newName = prompt('Новое название похода:', route.name)

    if (!newName || !newName.trim()) return

    const db = await dbPromise

    await db.put('routes', {
      ...route,
      name: newName.trim(),
    })

    const savedRoutes = await db.getAll('routes')
    setRoutes(savedRoutes.reverse())
  }

  async function addMarker(type: CustomMarker['type']) {
    if (!currentPoint) {
      alert('Сначала получите GPS-позицию')
      return
    }

    const titles = {
      water: 'Вода',
      camp: 'Лагерь',
      danger: 'Опасность',
      note: 'Заметка',
    }

    const marker: CustomMarker = {
      type,
      title: titles[type],
      lat: currentPoint.lat,
      lng: currentPoint.lng,
      createdAt: Date.now(),
    }

    const db = await dbPromise
    await db.add('markers', marker)

    const savedMarkers = await db.getAll('markers')
    setMarkers(savedMarkers)

    setMarkerModalOpen(false)
  }

  async function deleteMarker(markerId?: number) {
    if (!markerId) return

    const confirmed = confirm('Удалить эту метку?')
    if (!confirmed) return

    const db = await dbPromise
    await db.delete('markers', markerId)

    const savedMarkers = await db.getAll('markers')
    setMarkers(savedMarkers)
  }

  function startReturnMode() {
    if (points.length < 2) return

    const snapshot = [...points]
    setReturnTrack(snapshot)

    let nearestIndex = 0
    let nearestDistance = Infinity

    snapshot.forEach((point, index) => {
      if (!currentPoint) return

      const distance = distanceMeters(currentPoint, point)

      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    })

    setReturnIndex(nearestIndex)
    startCompass()
    setReturnMode(true)
    setMenuOpen(false)
    setToolsOpen(false)
  }

  function calculateBearing(from: Point, to: Point) {
    const toRad = (value: number) => (value * Math.PI) / 180
    const toDeg = (value: number) => (value * 180) / Math.PI

    const lat1 = toRad(from.lat)
    const lat2 = toRad(to.lat)
    const dLng = toRad(to.lng - from.lng)

    const y = Math.sin(dLng) * Math.cos(lat2)
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)

    return (toDeg(Math.atan2(y, x)) + 360) % 360
  }

  function startCompass() {
    window.addEventListener('deviceorientationabsolute', handleOrientation as EventListener)
    window.addEventListener('deviceorientation', handleOrientation as EventListener)
  }

  function handleOrientation(event: DeviceOrientationEvent) {
    const webkitHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number })
      .webkitCompassHeading

    if (typeof webkitHeading === 'number') {
      setHeading(webkitHeading)
      return
    }

    if (typeof event.alpha === 'number') {
      setHeading(360 - event.alpha)
    }
  }

  async function sendSOS() {
    if (!currentPoint) {
      alert('GPS ещё не определён')
      return
    }

    const message = `
      🚨 SOS

      Широта: ${currentPoint.lat}
      Долгота: ${currentPoint.lng}

      Высота: ${
          currentPoint.altitude !== null &&
          currentPoint.altitude !== undefined
            ? Math.round(currentPoint.altitude) + ' м'
            : 'неизвестно'
        }

      Точность GPS: ±${Math.round(
          currentPoint.accuracy,
        )} м

      Время: ${new Date().toLocaleString('ru-RU')}

      Google Maps:
      https://maps.google.com/?q=${currentPoint.lat},${currentPoint.lng}
    `

    try {
      await navigator.clipboard.writeText(message)

      alert(
        'SOS сообщение скопировано в буфер обмена',
      )
    } catch {
      alert(message)
    }
  }

  async function downloadOfflineZone(zone: OfflineMapZone) {
    setDownloadingMap(true)
    setDownloadProgress(`Подготовка: ${zone.name}`)

    try {
      const db = await dbPromise
      const cache = await caches.open('osm-map-tiles')
      const urls = new Set<string>()

      for (const config of zone.zooms) {
        const centerX = lonToTileX(zone.lng, config.zoom)
        const centerY = latToTileY(zone.lat, config.zoom)

        for (let x = centerX - config.radius; x <= centerX + config.radius; x++) {
          for (let y = centerY - config.radius; y <= centerY + config.radius; y++) {
            const subdomain = ['a', 'b', 'c'][Math.abs(x + y) % 3]
            urls.add(`https://${subdomain}.tile.openstreetmap.org/${config.zoom}/${x}/${y}.png`)
          }
        }
      }

      const urlList = Array.from(urls)

      let done = 0

      for (const url of urlList) {
        try {
          const cached = await cache.match(url)

          if (!cached) {
            const response = await fetch(url, { mode: 'no-cors' })
            await cache.put(url, response)
          }
        } catch {
          // пропускаем тайл
        }

        done++
        setDownloadProgress(`${zone.name}: ${done}/${urlList.length}`)
      }

      const updatedZones = Array.from(new Set([...downloadedZones, zone.id]))

      await db.put('session', {
        key: 'downloadedZones',
        value: updatedZones,
      })

      setDownloadedZones(updatedZones)

      setDownloadProgress(`${zone.name} сохранён офлайн`)
      alert(`${zone.name} сохранён офлайн`)
    } finally {
      setDownloadingMap(false)
    }
  }

  function findNearestPointIndex(target: Point | CustomMarker) {
    if (points.length === 0) return null

    let nearestIndex = 0
    let nearestDistance = Infinity

    points.forEach((point, index) => {
      const distance = distanceMeters(point, target as Point)

      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    })

    return nearestIndex
  }

  function startTraceToTarget(target: Point | CustomMarker) {
    const targetIndex = findNearestPointIndex(target)

    if (targetIndex === null) return

    setTraceTarget(target)
    setTraceTargetIndex(targetIndex)

    startCompass()

    setSelectedMarker(null)
    setSelectedPoint(null)
  }

  async function importGpxFile(file: File) {
    const text = await file.text()
    const parser = new DOMParser()
    const xml = parser.parseFromString(text, 'application/xml')

    const trkpts = Array.from(xml.querySelectorAll('trkpt'))

    if (trkpts.length < 2) {
      alert('В GPX файле не найден маршрут')
      return
    }

    const importedPoints: Point[] = trkpts.map((trkpt, index) => {
      const lat = Number(trkpt.getAttribute('lat'))
      const lng = Number(trkpt.getAttribute('lon'))

      const eleText = trkpt.querySelector('ele')?.textContent
      const timeText = trkpt.querySelector('time')?.textContent

      return {
        lat,
        lng,
        accuracy: 0,
        speed: null,
        altitude: eleText ? Number(eleText) : null,
        timestamp: timeText ? new Date(timeText).getTime() : Date.now() + index,
      }
    })

    const routeName =
      file.name.replace('.gpx', '') || `GPX маршрут ${new Date().toLocaleDateString('ru-RU')}`

    const distance = importedPoints.reduce((sum, point, index) => {
      if (index === 0) return sum
      return sum + distanceMeters(importedPoints[index - 1], point)
    }, 0)

    const route: SavedRoute = {
      name: routeName,
      points: importedPoints,
      markers: [],
      distance,
      duration: 0,
      createdAt: Date.now(),
    }

    const db = await dbPromise
    await db.add('routes', route)

    const savedRoutes = await db.getAll('routes')
    setRoutes(savedRoutes.reverse())

    alert('GPX маршрут добавлен в историю')
  }

  return (
    <div className="flex h-full flex-col bg-slate-950 text-white">
      <header className="z-10 p-4">
        <div className="rounded-3xl bg-slate-900/90 p-4 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-black">Mountain Tracker</h1>
              <p className="text-xs text-slate-400">
                Офлайн GPS-трекер маршрутов
              </p>
            </div>

            <div
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                tracking ? 'bg-green-500 text-black' : 'bg-slate-700'
              }`}
            >
              {tracking ? 'ЗАПИСЬ' : 'СТОП'}
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-2xl bg-red-500/20 p-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {downloadProgress && (
            <div className="mt-3 rounded-2xl bg-purple-500/20 p-3 text-sm text-purple-200">
              {downloadProgress}
            </div>
          )}
        </div>
      </header>

      <main className="relative flex-1 overflow-hidden">
        <MapContainer
          center={
            currentPoint
              ? [currentPoint.lat, currentPoint.lng]
              : [43.238949, 76.889709]
          }
          zoom={13}
          className="h-full w-full"
        >
          <TileLayer
            attribution="&copy; OpenStreetMap"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxNativeZoom={16}
            maxZoom={18}
          />

          {/* 1. Основная линия маршрута */}
          {points.length > 1 && (
            <Polyline
              positions={points.map(point => [point.lat, point.lng])}
              weight={5}
              pathOptions={{
                color: '#2563eb',
              }}
            />
          )}

          {returnMode && returnPassedPath.length > 1 && (
            <Polyline
              positions={returnPassedPath.map(point => [point.lat, point.lng])}
              weight={5}
              pathOptions={{
                color: '#64748b',
              }}
            />
          )}

          {returnMode && returnRemainingPath.length > 1 && (
            <Polyline
              positions={returnRemainingPath.map(point => [point.lat, point.lng])}
              weight={6}
              pathOptions={{
                color: '#f97316',
              }}
            />
          )}

          {/* 2. Линия следования по маршруту */}
          {traceTarget && tracePath.length > 1 && (
            <Polyline
              positions={tracePath.map(point => [point.lat, point.lng])}
              weight={7}
              pathOptions={{
                color: '#22c55e',
              }}
            />
          )}

          {/* 3. Маленькие точки */}
          {points
            .filter((_, index) => index % 10 === 0)
            .map((point, index) => (
              <div key={`track-point-wrap-${index}`}>
                <CircleMarker
                  center={[point.lat, point.lng]}
                  radius={14}
                  pathOptions={{
                    color: 'transparent',
                    fillColor: '#ffffff',
                    fillOpacity: 0.01,
                    weight: 0,
                  }}
                  eventHandlers={{
                    click: () => {
                      setSelectedPoint(point)
                      setSelectedMarker(null)
                      setSelectedTarget(point)
                    },
                  }}
                />

                <CircleMarker
                  center={[point.lat, point.lng]}
                  radius={4}
                  pathOptions={{
                    color: '#ffffff',
                    fillColor: '#0ea5e9',
                    fillOpacity: 1,
                    weight: 1,
                  }}
                  eventHandlers={{
                    click: () => {
                      setSelectedPoint(point)
                      setSelectedMarker(null)
                      setSelectedTarget(point)
                    },
                  }}
                />
              </div>
            ))}

          {/* 4. Метки */}
          {markers.map(marker => (
            <Marker
              key={marker.id}
              position={[marker.lat, marker.lng]}
              icon={getMarkerIcon(marker.type)}
              eventHandlers={{
                click: () => {
                  setSelectedMarker(marker)
                  setSelectedPoint(null)
                  setSelectedTarget(marker)
                },
              }}
            />
          ))}

          {startPoint && (
            <Marker position={[startPoint.lat, startPoint.lng]} icon={startIcon} />
          )}

          {/* 5. Текущая позиция — последняя, значит поверх всех */}
          {currentPoint && (
            <>
              <Circle
                center={[currentPoint.lat, currentPoint.lng]}
                radius={currentPoint.accuracy}
                pathOptions={{
                  color: '#3b82f6',
                  fillColor: '#3b82f6',
                  fillOpacity: 0.12,
                  weight: 1,
                }}
              />

              <CircleMarker
                center={[currentPoint.lat, currentPoint.lng]}
                radius={9}
                pathOptions={{
                  color: '#ffffff',
                  fillColor: '#2563eb',
                  fillOpacity: 1,
                  weight: 3,
                }}
              />

              <MapController
                point={currentPoint}
                follow={followMe}
                onMove={() => {
                  setFollowMe(false)
                }}
              />
            </>
          )}
        </MapContainer>

        {(selectedMarker || selectedPoint) && (
          <div className="absolute bottom-24 left-3 right-3 z-[1700] rounded-3xl bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-slate-400">
                  {selectedMarker ? 'Метка' : 'Точка маршрута'}
                </p>

                <h3 className="text-xl font-black">
                  {selectedMarker?.title ?? 'GPS-точка'}
                </h3>

                <p className="mt-2 text-sm text-slate-300">
                  Широта: {(selectedMarker?.lat ?? selectedPoint?.lat)?.toFixed(6)}
                </p>

                <p className="text-sm text-slate-300">
                  Долгота: {(selectedMarker?.lng ?? selectedPoint?.lng)?.toFixed(6)}
                </p>

                {selectedPoint && (
                  <>
                    <p className="text-sm text-slate-300">
                      Точность: ±{Math.round(selectedPoint.accuracy)} м
                    </p>

                    <p className="text-sm text-slate-300">
                      Время: {new Date(selectedPoint.timestamp).toLocaleString('ru-RU')}
                    </p>
                  </>
                )}

                {selectedMarker && (
                  <p className="text-sm text-slate-300">
                    Время: {new Date(selectedMarker.createdAt).toLocaleString('ru-RU')}
                  </p>
                )}
              </div>

              <button
                onClick={() => {
                  setSelectedMarker(null)
                  setSelectedPoint(null)
                  setSelectedTarget(null)
                  setTraceTarget(null)
                  setTraceTargetIndex(null)

                  if (!returnMode) {
                    setSelectedTarget(null)
                  }
                }}
                className="rounded-full bg-slate-800 px-4 py-2 font-black"
              >
                ✕
              </button>
            </div>

            <button
              onClick={() => {
                if (!selectedTarget) return

                startTraceToTarget(selectedTarget)
              }}
              className="mt-4 w-full rounded-2xl bg-green-500 px-4 py-3 font-black text-black"
            >
              Проследить
            </button>
          </div>
        )}

        {/* Бургер-меню сверху справа: история, GPX, скачать карту */}
        <div className={`absolute top-4 z-[1600] transition-all duration-500
          ${menuOpen ? '-right-30' : 'right-4'}
          ${returnMode ? 'invisible opacity-0' : 'visible opacity-100'}
          `}>
          <div className="relative h-14 w-14">
            {toolsOpen && (
              <>
                <button
                  onClick={() => setHistoryOpen(true)}
                  className="absolute -bottom-15 -right-2 flex h-13 w-13 items-center justify-center rounded-full bg-slate-900 text-white shadow-2xl transition-all duration-500 active:scale-90"
                >
                  <Icon path={mdiHistory} size={1.05} />
                </button>

                <button
                  onClick={exportGpx}
                  disabled={points.length < 2}
                  className="absolute -bottom-12 right-13 flex h-13 w-13 items-center justify-center rounded-full bg-blue-500 text-white shadow-2xl transition-all duration-500 active:scale-90 disabled:opacity-40"
                >
                  <Icon path={mdiFileExport} size={1.05} />
                </button>

                <button
                  onClick={() => setOfflineMapsOpen(true)}
                  disabled={downloadingMap}
                  className="absolute bottom-2 right-17 flex h-13 w-13 items-center justify-center rounded-full bg-purple-500 text-white shadow-2xl transition-all duration-500 active:scale-90 disabled:opacity-40"
                >
                  <Icon path={downloadingMap ? mdiLoading : mdiMap} size={1.05} />
                </button>
              </>
            )}

            <button
              onClick={() => setToolsOpen(prev => !prev)}
              className="absolute bottom-0 right-0 flex h-14 w-14 items-center justify-center rounded-full bg-slate-950 text-white shadow-2xl ring-4 ring-white/10 transition-all duration-500 active:scale-90"
            >
              <Icon path={mdiMenu} size={1.15} />
            </button>
          </div>
        </div>

        {activeNavTarget && currentPoint && (
          <div className="absolute left-3 right-3 top-3 z-[1700] rounded-3xl bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <button
                onClick={() => {
                  setTraceTarget(null)
                  if (!returnMode) {
                    setSelectedTarget(null)
                  }
                }}
                className="absolute right-3 top-3 rounded-full bg-slate-800 px-3 py-1 text-sm font-black"
              >
                ✕
              </button>
              <div>
                <p className="text-xs font-bold text-orange-300">
                  {traceTarget ? 'Следую к точке' : 'Назад по маршруту'}
                </p>

                <p className="text-3xl font-black">
                  {traceTarget && tracePath.length > 1
                    ? formatDistance(
                        tracePath.reduce((sum, point, index) => {
                          if (index === 0) return sum
                          return sum + distanceMeters(tracePath[index - 1], point)
                        }, 0),
                      )
                    : formatDistance(distanceMeters(currentPoint, activeNavTarget as Point))}
                </p>

                <p className="text-xs text-slate-400">
                  {traceTarget ? 'До выбранной точки' : 'До следующей точки'}
                </p>
              </div>

              <div
                className="flex h-20 w-20 items-center justify-center rounded-full bg-orange-500 text-5xl font-black text-black shadow-xl transition-transform duration-300"
                style={{
                  transform: `rotate(${activeNavRotation ?? 0}deg)`,
                }}
              >
                ↑
              </div>
            </div>
          </div>
        )}

        <div
          className={`absolute bottom-0 left-0 right-0 z-[900]
            transition-transform duration-500 ease-out
            ${
              menuOpen
                ? 'translate-y-0'
                : 'translate-y-[calc(100%-0px)]'
            }
          `}
        >
          <div className="relative rounded-t-[32px] bg-slate-950 px-4 pb-4 pt-10 backdrop-blur-xl shadow-2xl">

            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="
                absolute
                -top-8
                left-1/2
                -translate-x-1/2

                h-14
                w-24

                rounded-t-full
                bg-slate-950

                flex
                items-center
                justify-center

                shadow-xl
              "
            >
              <svg
                className={`h-6 w-6 text-white transition-transform duration-300 ${
                  menuOpen ? 'rotate-180' : ''
                }`}
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M6 15L12 9L18 15"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            <div className="mb-3 text-center">
              <p className="text-sm font-black">Статистика маршрута</p>
              <p className="text-xs text-slate-400
              ">
                {menuOpen
                  ? 'Нажмите стрелку чтобы скрыть'
                  : 'Нажмите стрелку чтобы открыть'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-slate-800 p-3">
                <p className="text-xs text-slate-400">Расстояние</p>
                <p className="text-lg font-black">
                  {formatDistance(totalDistance)}
                </p>
              </div>

              <div className="rounded-2xl bg-slate-800 p-3">
                <p className="text-xs text-slate-400">Время</p>
                <p className="text-lg font-black">
                  {formatTime(duration)}
                </p>
              </div>

              <div className="rounded-2xl bg-slate-800 p-3">
                <p className="text-xs text-slate-400">Текущая скорость</p>
                <p className="text-lg font-black">
                  {currentSpeed.toFixed(1)} км/ч
                </p>
              </div>

              <div className="rounded-2xl bg-slate-800 p-3">
                <p className="text-xs text-slate-400">Средняя скорость</p>
                <p className="text-lg font-black">
                  {avgSpeed.toFixed(1)} км/ч
                </p>
              </div>

              <div className="rounded-2xl bg-slate-800 p-3">
                <p className="text-xs text-slate-400">Высота</p>
                <p className="text-lg font-black">
                  {currentPoint?.altitude !== null &&
                  currentPoint?.altitude !== undefined
                    ? `${Math.round(currentPoint.altitude)} м`
                    : '—'}
                </p>
              </div>

              <div className="rounded-2xl bg-slate-800 p-3">
                <p className="text-xs text-slate-400">Точность GPS</p>
                <p className="text-lg font-black">
                  {currentPoint
                    ? `±${Math.round(currentPoint.accuracy)} м`
                    : '—'}
                </p>
              </div>

              <div className="col-span-2 rounded-2xl bg-orange-500 p-3 text-black">
                <p className="text-xs font-bold opacity-80">
                  До точки старта
                </p>
                <p className="text-2xl font-black">
                  {startPoint && currentPoint
                    ? formatDistance(distanceToStart)
                    : '—'}
                </p>
              </div>

              {returnMode && targetPoint && currentPoint && (
                <div className="col-span-2 rounded-2xl bg-green-500 p-4 text-black">
                  <p className="text-xs font-bold opacity-80">Возврат по маршруту</p>

                  <div className="mt-2 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-2xl font-black">
                        {formatDistance(distanceMeters(currentPoint, targetPoint))}
                      </p>
                      <p className="text-sm">До следующей точки маршрута</p>
                    </div>

                    <div
                      className="flex h-16 w-16 items-center justify-center rounded-full bg-black/10 text-4xl transition-transform duration-300"
                      style={{
                        transform: `rotate(${arrowRotation ?? 0}deg)`,
                      }}
                    >
                      ↑
                    </div>
                  </div>

                  {heading === null && (
                    <p className="mt-2 text-xs opacity-80">
                      Компас может попросить разрешение на телефоне
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Моё место — всегда снизу слева */}
      <button
        onClick={() => {
          setFollowMe(true)
        }}
        disabled={!currentPoint}
        className={`fixed bottom-6 z-[1600] flex h-14 w-14 items-center justify-center rounded-full bg-slate-950 text-white shadow-2xl ring-4 ring-white/10 transition-all duration-300 active:scale-90 disabled:opacity-40
          ${menuOpen ? '-left-30 invisible opacity-0' : 'left-4 visible opacity-100'}`}
      >
        <Icon path={mdiCrosshairsGps} size={1.15} />
      </button>

      {/* Правое главное меню: старт/пауза, метка, назад, SOS, завершить */}
      <div
        className={`fixed bottom-6 z-[1600] transition-all duration-500 ease-out ${
          menuOpen ? '-right-50 invisible opacity-0' : 'right-4 visible opacity-100'
        }`}
      >
        <div className="relative h-16 w-16">
          {actionsOpen && (
            <>
              <button
                onClick={tracking ? stopTracking : startTracking}
                className={`absolute bottom-20 right-0 flex h-14 w-14 items-center justify-center rounded-full shadow-2xl transition-all duration-500 active:scale-90 ${
                  tracking ? 'bg-red-500 text-white' : 'bg-green-500 text-black'
                }`}
              >
                <Icon path={tracking ? mdiPause : mdiPlay} size={1.1} />
              </button>

              <button
                onClick={() => setMarkerModalOpen(true)}
                disabled={!currentPoint}
                className="absolute bottom-0 right-20 flex h-14 w-14 items-center justify-center rounded-full bg-yellow-500 text-black shadow-2xl transition-all duration-500 active:scale-90 disabled:opacity-40"
              >
                <Icon path={mdiMapMarker} size={1.1} />
              </button>

              <button
                onClick={() => {
                  if (!returnMode) {
                    startReturnMode()
                  } else {
                    setReturnMode(false)
                    setReturnIndex(null)
                    setReturnTrack([])
                  }
                }}
                disabled={points.length < 2}
                className="absolute bottom-15 right-15 flex h-14 w-14 items-center justify-center rounded-full bg-orange-500 text-black shadow-2xl transition-all duration-500 active:scale-90 disabled:opacity-40"
              >
                <Icon path={mdiNavigationVariant} size={1.1} />
              </button>

              <button
                onClick={sendSOS}
                disabled={!currentPoint}
                className="absolute bottom-12 right-32 flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-sm font-black text-white shadow-2xl transition-all duration-500 active:scale-90 disabled:opacity-40"
              >
                SOS
              </button>

              <button
                onClick={openFinishModal}
                disabled={points.length < 2}
                className="absolute bottom-32 right-12 flex h-14 w-14 items-center justify-center rounded-full bg-slate-700 text-white shadow-2xl transition-all duration-500 active:scale-90 disabled:opacity-40"
              >
                <Icon path={mdiFlag} size={1.1} />
              </button>
            </>
          )}

          <button
            onClick={() => setActionsOpen(prev => !prev)}
            className={`absolute bottom-0 right-0 flex h-16 w-16 items-center justify-center rounded-full bg-slate-950 text-white shadow-2xl ring-4 ring-white/10 transition-all duration-500 active:scale-90 ${
              actionsOpen ? 'rotate-45' : 'rotate-0'
            }`}
          >
            <span className="text-4xl font-light leading-none">+</span>
          </button>
        </div>
      </div>

      {historyOpen && (
        <div className="fixed inset-0 z-[2000] flex items-end bg-black/60 p-3 backdrop-blur-sm">
          <div className="max-h-[80vh] w-full overflow-y-auto rounded-3xl bg-slate-950 p-4 text-white shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-black">История походов</h2>

              <button
                onClick={() => setHistoryOpen(false)}
                className="rounded-full bg-slate-800 px-4 py-2 font-black"
              >
                ✕
              </button>
            </div>

            {routes.length === 0 ? (
              <p className="text-sm text-slate-400">Пока нет сохранённых походов</p>
            ) : (
              <div className="space-y-2">
                {routes.map(route => (
                  <div
                    key={route.id}
                    className="rounded-2xl bg-slate-800 p-4"
                  >
                    <button
                      onClick={() => openRoute(route)}
                      className="w-full text-left"
                    >
                      <p className="font-black">{route.name}</p>
                      <p className="text-sm text-slate-400">
                        {new Date(route.createdAt).toLocaleString('ru-RU')}
                      </p>

                      <div className="mt-2 flex gap-3 text-sm">
                        <span>{formatDistance(route.distance)}</span>
                        <span>{formatTime(route.duration)}</span>
                        <span>{route.markers?.length ?? 0} меток</span>
                      </div>
                    </button>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => renameRoute(route)}
                        className="flex items-center gap-2 rounded-xl bg-blue-500/20 px-4 py-2 text-sm font-black text-blue-200"
                      >
                        <Icon path={mdiPencil} size={1} className="mr-2" />
                        Переименовать
                      </button>

                      <button
                        onClick={() => deleteRoute(route.id)}
                        className="flex items-center gap-2 mt-3 w-full rounded-xl bg-red-500/20 px-4 py-2 text-sm font-black text-red-200"
                      >
                        <Icon path={mdiDelete} size={1} className="mr-2" />
                        Удалить
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {finishModalOpen && (
        <div className="fixed inset-0 z-[2100] flex items-end bg-black/60 p-3 backdrop-blur-sm">
          <div className="w-full rounded-3xl bg-slate-950 p-4 text-white shadow-2xl">
            <h2 className="text-xl font-black">Сохранить поход</h2>

            <p className="mt-1 text-sm text-slate-400">
              Название можно изменить перед сохранением
            </p>

            <input
              value={routeName}
              onChange={e => setRouteName(e.target.value)}
              className="mt-4 w-full rounded-2xl bg-slate-800 px-4 py-4 text-lg font-black outline-none ring-2 ring-transparent focus:ring-green-500"
              placeholder="Название похода"
            />

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-slate-800 p-3">
                <p className="text-xs text-slate-400">Расстояние</p>
                <p className="text-lg font-black">{formatDistance(totalDistance)}</p>
              </div>

              <div className="rounded-2xl bg-slate-800 p-3">
                <p className="text-xs text-slate-400">Время</p>
                <p className="text-lg font-black">{formatTime(duration)}</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setFinishModalOpen(false)}
                className="rounded-2xl bg-slate-800 px-4 py-4 font-black"
              >
                Отмена
              </button>

              <button
                onClick={finishRoute}
                className="rounded-2xl bg-green-500 px-4 py-4 font-black text-black"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {markerModalOpen && (
        <div className="fixed inset-0 z-[2200] flex items-end bg-black/60 p-3 backdrop-blur-sm">
          <div className="w-full rounded-3xl bg-slate-950 p-4 text-white shadow-2xl">
            <h2 className="text-xl font-black">Добавить метку</h2>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => addMarker('water')} className="flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-4 font-black">
                <Icon path={mdiWater} size={1} className="mr-2" />
                Вода
              </button>

              <button onClick={() => addMarker('camp')} className="flex items-center gap-2 rounded-2xl bg-green-500 px-4 py-4 font-black text-black">
                <Icon path={mdiCampfire} size={1} className="mr-2" />
                Лагерь
              </button>

              <button onClick={() => addMarker('danger')} className="flex items-center gap-2 rounded-2xl bg-red-500 px-4 py-4 font-black">
                <Icon path={mdiAlert} size={1} className="mr-2" />
                Опасность
              </button>

              <button onClick={() => addMarker('note')} className="flex items-center gap-2 rounded-2xl bg-slate-800 px-4 py-4 font-black">
                <Icon path={mdiNote} size={1} className="mr-2" />
                Заметка
              </button>
            </div>

            <button
              onClick={() => setMarkerModalOpen(false)}
              className="mt-3 w-full rounded-2xl bg-slate-800 px-4 py-4 font-black"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {markersOpen && (
        <div className="fixed inset-0 z-[2300] flex items-end bg-black/60 p-3 backdrop-blur-sm">
          <div className="max-h-[80vh] w-full overflow-y-auto rounded-3xl bg-slate-950 p-4 text-white shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-black">Метки</h2>

              <button
                onClick={() => setMarkersOpen(false)}
                className="rounded-full bg-slate-800 px-4 py-2 font-black"
              >
                ✕
              </button>
            </div>

            {markers.length === 0 ? (
              <p className="text-sm text-slate-400">Пока нет сохранённых меток</p>
            ) : (
              <div className="space-y-2">
                {markers.map(marker => (
                  <div
                    key={marker.id}
                    className="rounded-2xl bg-slate-800 p-4"
                  >
                    <p className="font-black">{marker.title}</p>

                    <p className="text-sm text-slate-400">
                      {new Date(marker.createdAt).toLocaleString('ru-RU')}
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      {marker.lat.toFixed(6)}, {marker.lng.toFixed(6)}
                    </p>

                    <button
                      onClick={() => deleteMarker(marker.id)}
                      className="mt-3 w-full rounded-xl bg-red-500/20 px-4 py-2 text-sm font-black text-red-200"
                    >
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {offlineMapsOpen && (
        <div className="fixed inset-0 z-[2400] flex items-end bg-black/60 p-3 backdrop-blur-sm">
          <div className="max-h-[80vh] w-full overflow-y-auto rounded-3xl bg-slate-950 p-4 text-white shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-black">Офлайн карты</h2>

              <button
                onClick={() => setOfflineMapsOpen(false)}
                className="rounded-full bg-slate-800 px-4 py-2 font-black"
              >
                ✕
              </button>
            </div>

            <p className="mb-4 text-sm text-slate-400">
              Скачай нужные зоны заранее, пока есть интернет.
            </p>

            <button
              onClick={() => gpxInputRef.current?.click()}
              className="mb-4 w-full rounded-2xl bg-blue-500 px-4 py-4 font-black text-white"
            >
              Загрузить маршрут через GPX
            </button>

            {downloadProgress && (
              <div className="mb-4 rounded-2xl bg-purple-500/20 p-3 text-sm text-purple-200">
                {downloadProgress}
              </div>
            )}

            <div className="space-y-2">
              {OFFLINE_ZONES.map(zone => {
                const isDownloaded = downloadedZones.includes(zone.id)

                return (
                  <button
                    key={zone.id}
                    onClick={() => downloadOfflineZone(zone)}
                    disabled={downloadingMap}
                    className="w-full rounded-2xl bg-slate-800 p-4 text-left disabled:opacity-40"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-black">{zone.name}</p>

                        <p className="text-sm text-slate-400">
                          {isDownloaded
                            ? 'Карта сохранена офлайн'
                            : 'Скачать карту для офлайн-режима'}
                        </p>
                      </div>

                      <span
                        className={
                          isDownloaded
                            ? 'text-green-400'
                            : 'text-slate-400'
                        }
                      >
                        {isDownloaded ? '✅' : '⬇️'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <input
        ref={gpxInputRef}
        type="file"
        accept=".gpx,application/gpx+xml"
        className="hidden"
        onChange={async event => {
          const file = event.target.files?.[0]
          if (!file) return

          await importGpxFile(file)

          event.target.value = ''
        }}
      />
    </div>
  )
}