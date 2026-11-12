import { DEPOT_ADDRESS, geocodeAddress } from "./_delivery-utils.js";

export const DEFAULT_RADIUS_M = 100;

// 打刻の基準になる会社の場所(未設定なら配達の出発地点=薬局の住所)
export async function getCompany(redis) {
  const raw = await redis.get("settings:company");
  const saved = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
  const company = {
    address: saved.address || DEPOT_ADDRESS,
    radius_m: saved.radius_m || DEFAULT_RADIUS_M,
    lat: saved.lat ?? null,
    lng: saved.lng ?? null,
  };
  if (company.lat == null || company.lng == null) {
    const geo = await geocodeAddress(company.address);
    if (geo) {
      company.lat = geo.lat;
      company.lng = geo.lng;
      await redis.set("settings:company", JSON.stringify(company));
    }
  }
  return company;
}
