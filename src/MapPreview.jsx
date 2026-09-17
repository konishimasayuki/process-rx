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

export default function MapPreview({ days }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const overlaysRef = useRef([]); // markers + polylines
  const [status, setStatus] = useState("loading"); // loading | ready | no_key | no_points | error | auth_error
  const [selectedDate, setSelectedDate] = useState(null); // null = 全日程まとめて表示
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Google Maps側で認証エラー(キー制限・請求設定など)が起きた際に呼ばれるグローバルコールバック
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
            center: { lat: 33.589, lng: 130.401 }, // 福岡付近をデフォルト中心に
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

  // 選択日が消えた(表示範囲から外れた)場合は全日程表示に戻す
  useEffect(() => {
    if (selectedDate && !days.some((d) => d.date === selectedDate)) {
      setSelectedDate(null);
    }
  }, [days, selectedDate]);

  useEffect(() => {
    if (status !== "ready" || !mapInstance.current) return;

    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];

    const bounds = new window.google.maps.LatLngBounds();
    let count = 0;

    const targetDays = selectedDate
      ? days.filter((d) => d.date === selectedDate)
      : days;

    targetDays.forEach((day) => {
      day.drivers?.forEach((d, driverIdx) => {
        const color = DRIVER_COLORS[driverIdx % DRIVER_COLORS.length];
        const path = [];

        d.stops.forEach((stop, stopIdx) => {
          if (stop.lat == null || stop.lng == null) return;
          const position = { lat: stop.lat, lng: stop.lng };
          path.push(position);

          const marker = new window.google.maps.Marker({
            position,
            map: mapInstance.current,
            title: selectedDate
              ? `${d.driver} ${stopIdx + 1}: ${stop.name}様`
              : `${day.date} ${stop.name}様 (${d.driver})`,
            label: {
              text: String(stopIdx + 1),
              color: "#fff",
              fontSize: "10px",
            },
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

        // 日付を選んでいる時だけ、ドライバーごとの巡回順に線を引く
        if (selectedDate && path.length > 1) {
          const polyline = new window.google.maps.Polyline({
            path,
            map: mapInstance.current,
            strokeColor: color,
            strokeOpacity: 0.8,
            strokeWeight: 3,
          });
          overlaysRef.current.push(polyline);
        }
      });
    });

    if (count === 0) {
      setStatus("no_points");
    } else {
      mapInstance.current.fitBounds(bounds);
    }
  }, [days, status, selectedDate]);

  useEffect(() => {
    if (!mapInstance.current || !window.google?.maps) return;
    // 拡大/縮小でコンテナサイズが変わるので、地図に再計算させる
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
    <div
      style={expanded ? styles.wrapperExpanded : styles.wrapper}
    >
      <div style={styles.controlsRow}>
        <div style={styles.legend}>
          <button
            style={
              selectedDate === null
                ? styles.dayButtonActive
                : styles.dayButton
            }
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

      <div
        ref={mapRef}
        style={expanded ? styles.mapExpanded : styles.map}
      />
      {status === "no_points" && (
        <p style={styles.notice}>
          位置情報が取得できた配達先がまだありません
        </p>
      )}
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
  legend: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.4rem",
  },
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
  mapExpanded: {
    width: "100%",
    flex: 1,
    borderRadius: "10px",
    overflow: "hidden",
  },
  notice: { color: "#888", fontSize: "0.85rem" },
};
