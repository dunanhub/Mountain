import { useEffect, useRef, useState } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { openDB } from 'idb'

type Point = {
  id?: number
  lat: number
  lng: number
  accuracy: number
  timestamp: number
}

const dbPromise = openDB('gps-tracker-db', 1, {
  upgrade(db) {
    db.createObjectStore('points', {
      keyPath: 'id',
      autoIncrement: true,
    })
  },
})

const currentIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

function MapFollow({ point }: { point: Point | null }) {
  const map = useMap()

  useEffect(() => {
    if (point) {
      map.setView([point.lat, point.lng], 17)
    }
  }, [point, map])

  return null
}

export default function App() {
  const watchId = useRef<number | null>(null)
  const [points, setPoints] = useState<Point[]>([])
  const [tracking, setTracking] = useState(false)
  const [error, setError] = useState('')
  const currentPoint = points.at(-1) ?? null

  useEffect(() => {
    loadPoints()
  }, [])

  async function loadPoints() {
    const db = await dbPromise
    const savedPoints = await db.getAll('points')
    setPoints(savedPoints)
  }

  async function savePoint(point: Point) {
    const db = await dbPromise
    await db.add('points', point)
    setPoints(prev => [...prev, point])
  }

  function startTracking() {
    setError('')

    if (!navigator.geolocation) {
      setError('GPS не поддерживается этим браузером')
      return
    }

    watchId.current = navigator.geolocation.watchPosition(
      async position => {
        const point: Point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        }

        await savePoint(point)
      },
      err => {
        setError(err.message)
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      }
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
    setPoints([])
  }

  function exportGeoJson() {
    const geoJson = {
      type: 'Feature',
      properties: {
        name: 'GPS Route',
        createdAt: new Date().toISOString(),
      },
      geometry: {
        type: 'LineString',
        coordinates: points.map(p => [p.lng, p.lat]),
      },
    }

    const blob = new Blob([JSON.stringify(geoJson, null, 2)], {
      type: 'application/geo+json',
    })

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'route.geojson'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full flex-col bg-slate-950 text-white">
      <header className="p-4">
        <h1 className="text-xl font-bold">GPS Tracker</h1>
        <p className="text-sm text-slate-300">
          Точек маршрута: {points.length}
        </p>
        {currentPoint && (
          <p className="text-xs text-slate-400">
            Точность: ±{Math.round(currentPoint.accuracy)} м
          </p>
        )}
        {error && (
          <p className="mt-2 rounded-xl bg-red-500/20 p-2 text-sm text-red-200">
            {error}
          </p>
        )}
      </header>

      <main className="relative flex-1">
        <MapContainer
          center={currentPoint ? [currentPoint.lat, currentPoint.lng] : [43.238949, 76.889709]}
          zoom={13}
          className="h-full w-full"
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {currentPoint && (
            <>
              <Marker position={[currentPoint.lat, currentPoint.lng]} icon={currentIcon} />
              <MapFollow point={currentPoint} />
            </>
          )}

          {points.length > 1 && (
            <Polyline positions={points.map(p => [p.lat, p.lng])} />
          )}
        </MapContainer>
      </main>

      <footer className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
        {!tracking ? (
          <button
            onClick={startTracking}
            className="rounded-2xl bg-green-500 px-4 py-3 font-semibold text-black"
          >
            Старт
          </button>
        ) : (
          <button
            onClick={stopTracking}
            className="rounded-2xl bg-red-500 px-4 py-3 font-semibold text-white"
          >
            Стоп
          </button>
        )}

        <button
          onClick={exportGeoJson}
          disabled={points.length < 2}
          className="rounded-2xl bg-blue-500 px-4 py-3 font-semibold disabled:opacity-40"
        >
          Экспорт
        </button>

        <button
          onClick={clearRoute}
          className="rounded-2xl bg-slate-700 px-4 py-3 font-semibold"
        >
          Очистить
        </button>

        <button
          onClick={() => currentPoint && alert(`${currentPoint.lat}, ${currentPoint.lng}`)}
          className="rounded-2xl bg-slate-800 px-4 py-3 font-semibold"
        >
          Координаты
        </button>
      </footer>
    </div>
  )
}