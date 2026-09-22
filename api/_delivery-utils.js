// 配達ボード機能の共通ロジック(ジオコーディング / ルート並び替え / Googleマップリンク生成)

export const DEPOT_ADDRESS =
  process.env.DELIVERY_DEPOT_ADDRESS || "〒813-0034 福岡県福岡市東区多の津5丁目27-13";

// 住所 -> 緯度経度。GOOGLE_MAPS_API_KEY未設定の場合はnullを返す(呼び出し側で並び替え不可として扱う)。
export async function geocodeAddress(address) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || !address) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address
    )}&key=${apiKey}&language=ja&region=jp`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== "OK" || !data.results?.[0]) {
      console.error("geocode failed:", address, data.status);
      return null;
    }

    const { lat, lng } = data.results[0].geometry.location;
    return { lat, lng };
  } catch (err) {
    console.error("geocode error:", err);
    return null;
  }
}

// 2点間の距離(km) - 緯度経度からの直線距離(Haversine)
function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 出発地点(depot: {lat,lng})から、最近傍法で配達先を並び替える。
// lat/lngを持たない(ジオコーディング未実施/失敗)配達先は末尾にまとめて追加する。
export function orderStopsByNearestNeighbor(depot, stops) {
  const geocoded = stops.filter((s) => s.lat != null && s.lng != null);
  const ungeocoded = stops.filter((s) => s.lat == null || s.lng == null);

  if (!depot || geocoded.length === 0) {
    return { ordered: [...geocoded, ...ungeocoded], routable: false };
  }

  const remaining = [...geocoded];
  const ordered = [];
  let current = depot;

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineKm(current, remaining[i]);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    const next = remaining.splice(nearestIdx, 1)[0];
    ordered.push(next);
    current = next;
  }

  return { ordered: [...ordered, ...ungeocoded], routable: true };
}

// 並び替え済みの配達先リストからGoogleマップの経路リンクを生成する。
// 住所ベースで生成するため、Google Maps API Keyが無くても使える。
export function buildGoogleMapsRouteUrl(orderedStops) {
  if (orderedStops.length === 0) return null;

  const origin = encodeURIComponent(DEPOT_ADDRESS);
  const destination = encodeURIComponent(
    orderedStops[orderedStops.length - 1].address
  );
  const waypointStops = orderedStops.slice(0, -1);
  const waypoints = waypointStops
    .map((s) => encodeURIComponent(s.address))
    .join("|");

  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving&avoid=highways`;
  if (waypoints) {
    url += `&waypoints=${waypoints}`;
  }
  return url;
}

export function parseCookiesForBoard(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((pair) => {
    const [key, ...rest] = pair.trim().split("=");
    cookies[key] = rest.join("=");
  });
  return cookies;
}
