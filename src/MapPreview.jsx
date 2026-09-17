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

const DAY_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
];

export default function MapPreview({ days }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);
  const [status, setStatus] = useState("loading"); // loading | ready | no_key | no_points | error | auth_error

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

  useEffect(() => {
    if (status !== "ready" || !mapInstance.current) return;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const bounds = new window.google.maps.LatLngBounds();
    let count = 0;

    days.forEach((day, dayIdx) => {
      const color = DAY_COLORS[dayIdx % DAY_COLORS.length];
      day.drivers?.forEach((d) => {
        d.stops.forEach((stop) => {
          if (stop.lat == null || stop.lng == null) return;
          const position = { lat: stop.lat, lng: stop.lng };
          const marker = new window.google.maps.Marker({
            position,
            map: mapInstance.current,
            title: `${day.date} ${stop.name}様 (${d.driver})`,
            label: {
              text: String(dayIdx + 1),
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
          markersRef.current.push(marker);
          bounds.extend(position);
          count++;
        });
      });
    });

    if (count === 0) {
      setStatus("no_points");
    } else {
      mapInstance.current.fitBounds(bounds);
    }
  }, [days, status]);

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
    <div style={styles.wrapper}>
      <div style={styles.legend}>
        {days.map((day, idx) => (
          <span key={day.date} style={styles.legendItem}>
            <span
              style={{
                ...styles.legendDot,
                background: DAY_COLORS[idx % DAY_COLORS.length],
              }}
            />
            {formatShort(day.date)}
          </span>
        ))}
      </div>
      <div ref={mapRef} style={styles.map} />
      {status === "no_points" && (
        <p style={styles.notice}>
          位置情報が取得できた配達先がまだありません
        </p>
      )}
    </div>
  );
}

function formatShort(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const styles = {
  wrapper: { marginTop: "1rem" },
  legend: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.6rem",
    marginBottom: "0.5rem",
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.3rem",
    fontSize: "0.75rem",
    color: "#555",
  },
  legendDot: {
    width: "0.6rem",
    height: "0.6rem",
    borderRadius: "50%",
    display: "inline-block",
  },
  map: {
    width: "100%",
    height: "320px",
    borderRadius: "10px",
    overflow: "hidden",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
  },
  notice: { color: "#888", fontSize: "0.85rem" },
};
