// スマホの通知(プッシュ通知)の登録など

export const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

export function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
}

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

// この端末の通知の状態と設定
export async function loadPushState() {
  const sub = await currentSubscription();
  const qs = sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : "";
  const res = await fetch(`/api/push${qs}`);
  const data = await res.json();
  return { endpoint: sub?.endpoint || null, subscribed: !!sub && data.subscribed, prefs: data.prefs, publicKey: data.publicKey };
}

// 通知を有効にする(許可を求めて登録)
export async function enablePush(prefs) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("denied");
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await (await fetch("/api/push")).json();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  }
  const res = await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON(), prefs }),
  });
  if (!res.ok) throw new Error("register");
  return sub.endpoint;
}

export async function pushAction(action, endpoint, extra = {}) {
  const res = await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, endpoint, ...extra }),
  });
  return res.json().catch(() => ({}));
}

export async function disablePush(endpoint) {
  await pushAction("unsubscribe", endpoint);
  const sub = await currentSubscription();
  if (sub) await sub.unsubscribe().catch(() => {});
}

// 受信一覧を見た → アイコンの件数を消す
export function markFaxSeen() {
  try {
    navigator.clearAppBadge?.();
  } catch {
    // 対応していない端末
  }
  fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "seen" }),
  }).catch(() => {});
}
