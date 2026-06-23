import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { openDB } from 'idb'

type Point = {
  id?: number
  lat: number
  lng: number
  accuracy: number
  speed: number | null
  altitude: number | null
  timestamp: number
}

const dbPromise = openDB('mountain-tracker-db', 1, {
  upgrade(db) {
    db.createObjectStore('points', { keyPath: 'id', autoIncrement: true })
    db.createObjectStore('session', { keyPath: 'key' })
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

function FollowMe({ point }: { point: Point | null }) {
  const map = useMap()

  useEffect(() => {
    if (point) {
      map.setView([point.lat, point.lng], 17)
    }
  }, [point, map])

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
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const [downloadingMap, setDownloadingMap] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

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
    const savedSession = await db.get('session', 'startedAt')

    setPoints(savedPoints)
    if (savedSession?.value) setStartedAt(savedSession.value)
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

    const start = startedAt ?? Date.now()
    setStartedAt(start)

    const db = await dbPromise
    await db.put('session', { key: 'startedAt', value: start })

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

  function stopTracking() {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }

    setTracking(false)
  }

  async function clearRoute() {
    stopTracking()

    const db = await dbPromise
    await db.clear('points')
    await db.clear('session')

    setPoints([])
    setStartedAt(null)
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

  const duration = startedAt ? now - startedAt : 0

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
    if (!currentPoint) {
      alert('Сначала нажми Старт, чтобы получить GPS-позицию')
      return
    }

    setDownloadingMap(true)
    setDownloadProgress('Подготовка карты...')

    try {
      const cache = await caches.open('osm-map-tiles')

      const zooms = [13, 14, 15, 16]
      const radius = 3

      const urls: string[] = []

      for (const zoom of zooms) {
        const centerX = lonToTileX(currentPoint.lng, zoom)
        const centerY = latToTileY(currentPoint.lat, zoom)

        for (let x = centerX - radius; x <= centerX + radius; x++) {
          for (let y = centerY - radius; y <= centerY + radius; y++) {
            const subdomain = ['a', 'b', 'c'][Math.abs(x + y) % 3]
            urls.push(`https://${subdomain}.tile.openstreetmap.org/${zoom}/${x}/${y}.png`)
          }
        }
      }

      let done = 0

      for (const url of urls) {
        try {
          const response = await fetch(url, { mode: 'no-cors' })
          await cache.put(url, response)
        } catch {
          // Пропускаем один тайл, если не скачался
        }

        done++
        setDownloadProgress(`Скачано ${done}/${urls.length}`)
      }

      setDownloadProgress('Карта района сохранена офлайн')
      alert('Карта района сохранена. Теперь можно открыть её без интернета.')
    } catch {
      alert('Не удалось сохранить карту')
    } finally {
      setDownloadingMap(false)
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
              <Marker
                position={[currentPoint.lat, currentPoint.lng]}
                icon={currentIcon}
              />
              <FollowMe point={currentPoint} />
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
          <div className="relative rounded-t-[32px] bg-slate-950 px-4 pb-4 pt-4 backdrop-blur-xl shadow-2xl">

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
            className="rounded-2xl bg-green-500 px-4 py-4 font-black text-black"
          >
            Старт
          </button>
        ) : (
          <button
            onClick={stopTracking}
            className="rounded-2xl bg-red-500 px-4 py-4 font-black"
          >
            Стоп
          </button>
        )}

        <button
          onClick={exportGpx}
          disabled={points.length < 2}
          className="rounded-2xl bg-blue-500 px-4 py-4 font-black disabled:opacity-40"
        >
          GPX
        </button>

        <button
          onClick={() => {
            if (!startPoint || !currentPoint) return
            alert(`До старта: ${formatDistance(distanceToStart)}`)
          }}
          disabled={!startPoint || !currentPoint}
          className="rounded-2xl bg-orange-500 px-4 py-4 font-black text-black disabled:opacity-40"
        >
          К старту
        </button>

        <button
          onClick={clearRoute}
          className="rounded-2xl bg-slate-700 px-4 py-4 font-black"
        >
          Очистить
        </button>

        <button
          onClick={() =>
            currentPoint &&
            alert(`${currentPoint.lat.toFixed(6)}, ${currentPoint.lng.toFixed(6)}`)
          }
          disabled={!currentPoint}
          className="rounded-2xl bg-slate-800 px-4 py-4 font-black disabled:opacity-40"
        >
          Координаты
        </button>

        <button
          onClick={downloadOfflineMap}
          disabled={!currentPoint || downloadingMap}
          className="rounded-2xl bg-purple-500 px-4 py-4 font-black disabled:opacity-40"
        >
          {downloadingMap ? 'Загрузка...' : 'Карта'}
        </button>
      </footer>
    </div>
  )
}