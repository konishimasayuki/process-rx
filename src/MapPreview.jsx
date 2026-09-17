import { useEffect, useRef, useState } from "react";

let mapsScriptPromise = null;

function loadGoogleMapsScript(apiKey) {
  if (window.google?.maps) return Promise.resolve();
  if (mapsScriptPromise) return mapsScriptPromise;

  mapsScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Mapsの読み込みに失敗しました"));
    document.head.appendChild(script);
  });

  return mapsScriptPromise;
}

const DRIVER_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
];

function formatShort(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function MapPreview({ days, depotAddress }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const overlaysRef = useRef([]); // markers + polylines + directions renderers
  const [status, setStatus] = useState("loading"); // loading | ready | no_key | no_points | error | auth_error
  const [selectedDate, setSelectedDate] = useState(null); // null = 全日程まとめて表示
  const [expanded, setExpanded] = useState(false);
  const [dayNotice, setDayNotice] = useState("");

  useEffect(() => {
    let cancelled = false;

    window.gm_authFailure = () => {
      if (!cancelled) setStatus("auth_error");
    };

    const timeoutId = setTimeout(() => {
      setStatus((prev) => (prev === "loading" ? "error" : prev));
    }, 8000);

    async function init() {
      try {
        const res = await fetch("/api/maps-key");
        const data = await res.json();
        if (cancelled) return;

        if (!data.key) {
          setStatus("no_key");
          return;
        }

        await loadGoogleMapsScript(data.key);
        if (cancelled) return;

        if (!window.google?.maps?.Map) {
          throw new Error("google.maps.Mapが利用できません");
        }

        if (!mapInstance.current && mapRef.current) {
          mapInstance.current = new window.google.maps.Map(mapRef.current, {
            center: { lat: 33.589, lng: 130.401 },
            zoom: 10,
          });
        }
        setStatus("ready");
      } catch (err) {
        console.error("MapPreview init error:", err);
        if (!cancelled) setStatus("error");
      }
    }

    init();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedDate && !days.some((d) => d.date === selectedDate)) {
      setSelectedDate(null);
    }
  }, [days, selectedDate]);

  useEffect(() => {
    if (status !== "ready" && status !== "no_points") return;
    if (!mapInstance.current) return;

    let cancelled = false;

    async function render() {
      overlaysRef.current.forEach((o) => o.setMap(null));
      overlaysRef.current = [];
      setDayNotice("");

      const bounds = new window.google.maps.LatLngBounds();
      let count = 0;

      if (!selectedDate) {
        // 全日程まとめて: 従来通りピンのみ表示(ルート線なし)
        days.forEach((day, dayIdx) => {
          const color = DRIVER_COLORS[dayIdx % DRIVER_COLORS.length];
          day.drivers?.forEach((d) => {
            d.stops.forEach((stop) => {
              if (stop.lat == null || stop.lng == null) return;
              const position = { lat: stop.lat, lng: stop.lng };
              const marker = new window.google.maps.Marker({
                position,
                map: mapInstance.current,
                title: `${day.date} ${stop.name}様 (${d.driver})`,
                label: { text: String(dayIdx + 1), color: "#fff", fontSize: "10px" },
                icon: {
                  path: window.google.maps.SymbolPath.CIRCLE,
                  scale: 10,
                  fillColor: color,
                  fillOpacity: 1,
                  strokeColor: "#fff",
                  strokeWeight: 2,
                },
              });
              overlaysRef.current.push(marker);
              bounds.extend(position);
              count++;
            });
          });
        });
      } else {
        const day = days.find((d) => d.date === selectedDate);
        const drivers = (day?.drivers || []).filter((d) =>
          d.stops.some((s) => s.lat != null && s.lng != null)
        );

        if (drivers.length === 0) {
          setDayNotice("この日は位置情報のある配達がまだ登録されていません");
        }

        let depotMarkerPlaced = false;

        for (let driverIdx = 0; driverIdx < drivers.length; driverIdx++) {
          const d = drivers[driverIdx];
          const color = DRIVER_COLORS[driverIdx % DRIVER_COLORS.length];
          const validStops = d.stops.filter(
            (s) => s.lat != null && s.lng != null
          );

          validStops.forEach((stop, idx) => {
            const position = { lat: stop.lat, lng: stop.lng };
            const marker = new window.google.maps.Marker({
              position,
              map: mapInstance.current,
              title: `${d.driver} ${idx + 1}: ${stop.name}様`,
              label: { text: String(idx + 1), color: "#fff", fontSize: "10px" },
              icon: {
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: 10,
                fillColor: color,
                fillOpacity: 1,
                strokeColor: "#fff",
                strokeWeight: 2,
              },
            });
            overlaysRef.current.push(marker);
            bounds.extend(position);
            count++;
          });

          if (!depotAddress || validStops.length === 0) continue;

          const destination = validStops[validStops.length - 1];
          const waypoints = validStops.slice(0, -1).map((s) => ({
            location: { lat: s.lat, lng: s.lng },
            stopover: true,
          }));

          try {
            const directionsService = new window.google.maps.DirectionsService();
            const result = await directionsService.route({
              origin: depotAddress,
              destination: { lat: destination.lat, lng: destination.lng },
              waypoints,
              travelMode: window.google.maps.TravelMode.DRIVING,
            });

            if (cancelled) return;

            const renderer = new window.google.maps.DirectionsRenderer({
              map: mapInstance.current,
              directions: result,
              suppressMarkers: true,
              preserveViewport: true,
              polylineOptions: {
                strokeColor: color,
                strokeWeight: 4,
                strokeOpacity: 0.75,
              },
            });
            overlaysRef.current.push(renderer);

            const routeBounds = result.routes[0]?.bounds;
            if (routeBounds) bounds.union(routeBounds);

            if (!depotMarkerPlaced) {
              const startLoc = result.routes[0]?.legs?.[0]?.start_location;
              if (startLoc) {
                const depotMarker = new window.google.maps.Marker({
                  position: startLoc,
                  map: mapInstance.current,
                  title: "出発地点(薬局)",
                  icon: {
                    path: window.google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
                    scale: 5,
                    fillColor: "#111827",
                    fillOpacity: 1,
                    strokeColor: "#fff",
                    strokeWeight: 2,
                  },
                });
                overlaysRef.current.push(depotMarker);
                depotMarkerPlaced = true;
              }
            }
          } catch (err) {
            console.error("directions error:", err);
            // ルート取得に失敗した場合はマーカーのみ残す(直線は引かない)
          }
        }
      }

      if (cancelled) return;

      if (count === 0) {
        setStatus("no_points");
      } else {
        setStatus("ready");
        mapInstance.current.fitBounds(bounds);
      }
    }

    render();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, status === "ready" || status === "no_points", selectedDate, depotAddress]);

  useEffect(() => {
    if (!mapInstance.current || !window.google?.maps) return;
    const timer = setTimeout(() => {
      window.google.maps.event.trigger(mapInstance.current, "resize");
    }, 50);
    return () => clearTimeout(timer);
  }, [expanded]);

  if (status === "no_key") {
    return (
      <p style={styles.notice}>
        GOOGLE_MAPS_API_KEY未設定のため地図プレビューは表示できません
      </p>
    );
  }

  if (status === "auth_error") {
    return (
      <p style={styles.notice}>
        地図の表示が許可されていません。Google Cloud
        ConsoleでこのAPIキーの「APIの制限」にMaps
        JavaScript APIを追加してください
      </p>
    );
  }

  if (status === "error") {
    return <p style={styles.notice}>地図の読み込みに失敗しました</p>;
  }

  return (
    <div style={expanded ? styles.wrapperExpanded : styles.wrapper}>
      <div style={styles.controlsRow}>
        <div style={styles.legend}>
          <button
            style={selectedDate === null ? styles.dayButtonActive : styles.dayButton}
            onClick={() => setSelectedDate(null)}
          >
            全日程
          </button>
          {days.map((day) => (
            <button
              key={day.date}
              style={
                selectedDate === day.date
                  ? styles.dayButtonActive
                  : styles.dayButton
              }
              onClick={() => setSelectedDate(day.date)}
            >
              {formatShort(day.date)}
            </button>
          ))}
        </div>
        <button
          style={styles.expandButton}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? "縮小" : "拡大"}
        </button>
      </div>

      <div ref={mapRef} style={expanded ? styles.mapExpanded : styles.map} />

      {status === "no_points" && !dayNotice && (
        <p style={styles.notice}>位置情報が取得できた配達先がまだありません</p>
      )}
      {dayNotice && <p style={styles.notice}>{dayNotice}</p>}
    </div>
  );
}

const styles = {
  wrapper: { marginTop: "1rem" },
  wrapperExpanded: {
    position: "fixed",
    inset: 0,
    background: "#fff",
    zIndex: 200,
    padding: "1rem",
    display: "flex",
    flexDirection: "column",
  },
  controlsRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "0.5rem",
    marginBottom: "0.5rem",
  },
  legend: { display: "flex", flexWrap: "wrap", gap: "0.4rem" },
  dayButton: {
    padding: "0.3rem 0.6rem",
    borderRadius: "999px",
    border: "1px solid #ccc",
    background: "#fff",
    color: "#333",
    fontSize: "0.75rem",
    cursor: "pointer",
  },
  dayButtonActive: {
    padding: "0.3rem 0.6rem",
    borderRadius: "999px",
    border: "1px solid #2563eb",
    background: "#2563eb",
    color: "#fff",
    fontSize: "0.75rem",
    cursor: "pointer",
  },
  expandButton: {
    padding: "0.3rem 0.7rem",
    borderRadius: "6px",
    border: "1px solid #ccc",
    background: "#fff",
    color: "#333",
    fontSize: "0.75rem",
    cursor: "pointer",
    flexShrink: 0,
  },
  map: {
    width: "100%",
    height: "320px",
    borderRadius: "10px",
    overflow: "hidden",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
  },
  mapExpanded: { width: "100%", flex: 1, borderRadius: "10px", overflow: "hidden" },
  notice: { color: "#888", fontSize: "0.85rem", marginTop: "0.4rem" },
};
