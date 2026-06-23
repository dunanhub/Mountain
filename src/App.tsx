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
  mdiStop,
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
  mdiFileExport
} from '@mdi/js'

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
  const [showLocateButton, setShowLocateButton] = useState(false)
  const [markers, setMarkers] = useState<CustomMarker[]>([])
  const [markerModalOpen, setMarkerModalOpen] = useState(false)
  const [markersOpen, setMarkersOpen] = useState(false)
  const [heading, setHeading] = useState<number | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [returnTrack, setReturnTrack] = useState<Point[]>([])

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

  async function loadSaved() {
    const db = await dbPromise
    const savedPoints = await db.getAll('points')
    const savedElapsed = await db.get('session', 'elapsedMs')
    const savedRoutes = await db.getAll('routes')
    const savedMarkers = await db.getAll('markers')
    
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
      if (distance < 3) return
    }

    await db.add('points', point)
    setPoints(prev => [...prev, point])
  }

  async function startTracking() {
    setError('')

    if (!navigator.geolocation) {
      setError('GPS не поддерживается этим браузером')
      return
    }

    setActiveStartedAt(Date.now())

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
      err => {
        setError(err.message)
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      },
    )

    setTracking(true)
  }

  async function stopTracking() {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }

    if (activeStartedAt) {
      const newElapsed = elapsedMs + (Date.now() - activeStartedAt)

      setElapsedMs(newElapsed)
      setActiveStartedAt(null)

      const db = await dbPromise
      await db.put('session', { key: 'elapsedMs', value: newElapsed })
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

  async function downloadOfflineMap() {
    setDownloadingMap(true)
    setDownloadProgress('Подготовка карты Алматы и гор...')

    try {
      const cache = await caches.open('osm-map-tiles')

      const places = [
        { name: 'Алматы', lat: 43.238949, lng: 76.889709 },
        { name: 'Медеу', lat: 43.1578, lng: 77.0588 },
        { name: 'Шымбулак', lat: 43.128, lng: 77.079 },
        { name: 'БАО', lat: 43.05, lng: 76.985 },
      ]

      const zoomConfigs = [
        { zoom: 11, radius: 3 },
        { zoom: 12, radius: 5 },
        { zoom: 13, radius: 7 },
        { zoom: 14, radius: 9 },
      ]

      const urls = new Set<string>()

      for (const place of places) {
        for (const config of zoomConfigs) {
          const centerX = lonToTileX(place.lng, config.zoom)
          const centerY = latToTileY(place.lat, config.zoom)

          for (let x = centerX - config.radius; x <= centerX + config.radius; x++) {
            for (let y = centerY - config.radius; y <= centerY + config.radius; y++) {
              const subdomain = ['a', 'b', 'c'][Math.abs(x + y) % 3]
              urls.add(
                `https://${subdomain}.tile.openstreetmap.org/${config.zoom}/${x}/${y}.png`
              )
            }
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
          // пропускаем один тайл
        }

        done++
        setDownloadProgress(`Скачано ${done}/${urlList.length}`)
      }

      setDownloadProgress('Алматы и горные зоны сохранены офлайн')
      alert('Карта Алматы, Медеу, Шымбулак и БАО сохранена офлайн.')
    } catch {
      alert('Не удалось сохранить карту')
    } finally {
      setDownloadingMap(false)
    }
  }

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
          />

          {startPoint && (
            <Marker position={[startPoint.lat, startPoint.lng]} icon={startIcon} />
          )}

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
                  setShowLocateButton(true)
                }}
              />
            </>
          )}

          {!returnMode && points.length > 1 && (
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

          {targetPoint && currentPoint && (
            <Polyline
              positions={[
                [currentPoint.lat, currentPoint.lng],
                [targetPoint.lat, targetPoint.lng],
              ]}
              weight={4}
              dashArray="10"
              pathOptions={{
                color: '#22c55e',
              }}
            />
          )}

          {markers.map(marker => (
            <Marker
              key={marker.id}
              position={[marker.lat, marker.lng]}
            />
          ))}

          {points.length > 1 && (
            <Polyline
              positions={points.map(point => [point.lat, point.lng])}
              weight={5}
            />
          )}

          {startPoint && currentPoint && points.length > 1 && (
            <Polyline
              positions={[
                [currentPoint.lat, currentPoint.lng],
                [startPoint.lat, startPoint.lng],
              ]}
              weight={3}
              dashArray="8"
            />
          )}

          {markers.map(marker => (
            <Marker
              key={marker.id}
              position={[marker.lat, marker.lng]}
            />
          ))}

          {targetPoint && currentPoint && (
            <Polyline
              positions={[
                [currentPoint.lat, currentPoint.lng],
                [targetPoint.lat, targetPoint.lng],
              ]}
              weight={6}
              dashArray="10"
            />
          )}
        </MapContainer>

        {returnMode && targetPoint && currentPoint && (
          <div className="absolute left-3 right-3 top-3 z-[999] rounded-3xl bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold text-orange-300">Назад по маршруту</p>
                <p className="text-3xl font-black">
                  {formatDistance(distanceMeters(currentPoint, targetPoint))}
                </p>
                <p className="text-xs text-slate-400">До следующей точки</p>
              </div>

              <div
                className="flex h-20 w-20 items-center justify-center rounded-full bg-orange-500 text-5xl font-black text-black shadow-xl transition-transform duration-300"
                style={{
                  transform: `rotate(${arrowRotation ?? 0}deg)`,
                }}
              >
                ↑
              </div>
            </div>
          </div>
        )}

        {showLocateButton && (
          <button
            onClick={() => {
              setFollowMe(true)
              setShowLocateButton(false)
            }}
            className="
              absolute
              right-4
              top-4
              z-[999]

              flex
              items-center
              gap-2

              rounded-2xl
              bg-slate-950/90

              px-4
              py-3

              text-sm
              font-black
              text-white

              shadow-2xl
              backdrop-blur

              transition-all
              duration-300

              hover:scale-105
            "
          >
            <Icon path={mdiCrosshairsGps} size={1} />
          </button>
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

      <div className="fixed bottom-24 right-3 z-[1500] flex flex-col items-end gap-2">
        {actionsOpen && (
          <div className="flex flex-col gap-2">
            {!tracking ? (
              <button
                onClick={startTracking}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-black shadow-2xl"
              >
                <Icon path={mdiPlay} size={1.1} />
              </button>
            ) : (
              <button
                onClick={stopTracking}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white shadow-2xl"
              >
                <Icon path={mdiStop} size={1.1} />
              </button>
            )}

            <button
              onClick={() => setMarkerModalOpen(true)}
              disabled={!currentPoint}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-yellow-500 text-black shadow-2xl disabled:opacity-40"
            >
              <Icon path={mdiMapMarker} size={1.1} />
            </button>

            <button
              onClick={() => setHistoryOpen(true)}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-2xl"
            >
              <Icon path={mdiHistory} size={1.1} />
            </button>

            <button
              onClick={downloadOfflineMap}
              disabled={downloadingMap}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-500 text-white shadow-2xl disabled:opacity-40"
            >
              <Icon path={downloadingMap ? mdiLoading : mdiMap} size={1.1} />
            </button>

            <button
              onClick={exportGpx}
              disabled={points.length < 2}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-500 text-white shadow-2xl disabled:opacity-40"
            >
              <Icon path={mdiFileExport} size={1.1} />
              GPX
            </button>

            <button
              onClick={sendSOS}
              disabled={!currentPoint}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-2xl disabled:opacity-40"
            >
              SOS
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
              className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-500 text-black shadow-2xl disabled:opacity-40"
            >
              <Icon path={mdiNavigationVariant} size={1.1} />
            </button>

            <button
              onClick={openFinishModal}
              disabled={points.length < 2}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-700 text-white shadow-2xl disabled:opacity-40"
            >
              <Icon path={mdiFlag} size={1.1} />
            </button>
          </div>
        )}

        <button
          onClick={() => setActionsOpen(prev => !prev)}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-950 text-white shadow-2xl ring-4 ring-white/10"
        >
          <span className="text-3xl font-black">
            {actionsOpen ? '×' : '+'}
          </span>
        </button>
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
    </div>
  )
}