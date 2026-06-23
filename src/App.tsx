import { useEffect, useMemo, useRef, useState } from 'react'
import { useMapEvents, MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { openDB } from 'idb'
import { Icon } from '@mdi/react'
import {
  mdiMapMarker,
  mdiNavigationVariant,
  mdiPlay,
  mdiStop,
  mdiDownload,
  mdiFlag,
  mdiCrosshairsGps,
  mdiMap,
  mdiLoading,
  mdiHistory,
  mdiDelete,
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

type SavedRoute = {
  id?: number
  name: string
  points: Point[]
  distance: number
  duration: number
  createdAt: number
}

const dbPromise = openDB('mountain-tracker-db', 2, {
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
  },
})

const currentIcon = new L.Icon({
  iconUrl: `${import.meta.env.BASE_URL}marker-icon.png`,
  shadowUrl: `${import.meta.env.BASE_URL}marker-shadow.png`,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
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
  const [showLocateButton, setShowLocateButton] = useState(false)

  const currentPoint = points.at(-1) ?? null
  const startPoint = points[0] ?? null

  useEffect(() => {
    loadSaved()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  async function loadSaved() {
    const db = await dbPromise
    const savedPoints = await db.getAll('points')
    const savedElapsed = await db.get('session', 'elapsedMs')
    const savedRoutes = await db.getAll('routes')

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

    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Mountain Tracker">
  <trk>
    <name>Mountain Route</name>
    <trkseg>
${points
  .map(
    point => `      <trkpt lat="${point.lat}" lon="${point.lng}">
        ${point.altitude !== null ? `<ele>${point.altitude}</ele>` : ''}
        <time>${new Date(point.timestamp).toISOString()}</time>
      </trkpt>`,
  )
  .join('\n')}
    </trkseg>
  </trk>
</gpx>`

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
      distance: totalDistance,
      duration,
      createdAt: Date.now(),
    }

    await db.add('routes', route)
    await db.clear('points')
    await db.clear('session')

    setPoints([])
    setElapsedMs(0)
    setActiveStartedAt(null)

    const savedRoutes = await db.getAll('routes')
    setRoutes(savedRoutes.reverse())

    setFinishModalOpen(false)
    setRouteName('')

    alert('Поход сохранён в историю')
  }

  function openRoute(route: SavedRoute) {
    setPoints(route.points)
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
              <Marker
                position={[currentPoint.lat, currentPoint.lng]}
                icon={currentIcon}
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
        </MapContainer>

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
            Моё место
          </button>
        )}

        <div
          className={`absolute bottom-0 left-0 right-0 z-[999]
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
            </div>
          </div>
        </div>
      </main>

      <footer className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-5">
        {!tracking ? (
          <button
            onClick={startTracking}
            className="flex items-center justify-center gap-2 rounded-2xl bg-green-500 px-4 py-4 font-black text-black"
          >
            <Icon path={mdiPlay} size={1} />
            Старт
          </button>
        ) : (
          <button
            onClick={stopTracking}
            className="flex items-center justify-center gap-2 rounded-2xl bg-red-500 px-4 py-4 font-black"
          >
            <Icon path={mdiStop} size={1} />
            Стоп
          </button>
        )}

        <button
          onClick={exportGpx}
          disabled={points.length < 2}
          className="flex items-center justify-center gap-2 rounded-2xl bg-blue-500 px-4 py-4 font-black disabled:opacity-40"
        >
          <Icon path={mdiDownload} size={1} />
          GPX
        </button>

        <button
          onClick={() => {
            if (!startPoint || !currentPoint) return
            alert(`До старта: ${formatDistance(distanceToStart)}`)
          }}
          disabled={!startPoint || !currentPoint}
          className="flex items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-4 font-black text-black disabled:opacity-40"
        >
          <Icon path={mdiNavigationVariant} size={1} />
          К старту
        </button>

        <button
          onClick={openFinishModal}
          disabled={points.length < 2}
          className="flex items-center justify-center gap-2 rounded-2xl bg-slate-700 px-4 py-4 font-black disabled:opacity-40"
        >
          <Icon path={mdiFlag} size={1} />
          Завершить
        </button>

        <button
          onClick={() =>
            currentPoint &&
            alert(`${currentPoint.lat.toFixed(6)}, ${currentPoint.lng.toFixed(6)}`)
          }
          disabled={!currentPoint}
          className="flex items-center justify-center gap-2 rounded-2xl bg-slate-800 px-4 py-4 font-black disabled:opacity-40"
        >
          <Icon path={mdiMapMarker} size={1} />
          Координаты
        </button>

        <button
          onClick={downloadOfflineMap}
          disabled={!currentPoint || downloadingMap}
          className="flex items-center justify-center gap-2 rounded-2xl bg-purple-500 px-4 py-4 font-black disabled:opacity-40"
        >
          {downloadingMap ? (
            <>
              <Icon path={mdiLoading} size={1} />
              <span>Загрузка...</span>
            </>
          ) : (
            <>
              <Icon path={mdiMap} size={1} />
              <span>Скачать карту</span>
            </>
          )}
        </button>
        <button
          onClick={() => setHistoryOpen(true)}
          className="flex items-center justify-center gap-2 rounded-2xl bg-slate-800 px-4 py-4 font-black"
        >
          <Icon path={mdiHistory} size={1} />
          История
        </button>
      </footer>

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
                        <span>{route.points.length} точек</span>
                      </div>
                    </button>

                    <button
                      onClick={() => deleteRoute(route.id)}
                      className="flex items-center gap-2 mt-3 w-full rounded-xl bg-red-500/20 px-4 py-2 text-sm font-black text-red-200"
                    >
                      <Icon path={mdiDelete} size={1} className="mr-2" />
                      Удалить
                    </button>
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
    </div>
  )
}