// クライアント側でMapを描画するためにAPIキーを返す。
// このキーはGoogle Cloud側でHTTPリファラー制限をかけた上で使う前提。
export default async function handler(req, res) {
  res.status(200).json({ key: process.env.GOOGLE_MAPS_API_KEY || null });
}
