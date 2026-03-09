// IP 定位兜底方案
async function fallbackIPLocation() {
  try {
    // 方案1: ip-api.com（免费）
    const resp = await fetch('http://ip-api.com/json/?fields=status,message,country,regionName,city,lat,lon&lang=zh-CN');
    if (!resp.ok) throw new Error();
    const data = await resp.json();
    if (data.status === 'success') {
      return {
        lat: data.lat,
        lon: data.lon,
        name: `${data.city},${data.regionName},${data.country}`,
        source: 'ip-api',
        accuracy: 'city'
      };
    }
  } catch(e1) { /* ignore */ }
  
  try {
    // 方案2: ipinfo.io（简单）
    const resp = await fetch('https://ipinfo.io/json?token='); // 没 token，只有基础信息
    if (!resp.ok) throw new Error();
    const data = await resp.json();
    if (data.loc) {
      const [lat, lon] = data.loc.split(',');
      return {
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        name: `${data.city},${data.region},${data.country}`,
        source: 'ipinfo',
        accuracy: 'city'
      };
    }
  } catch(e2) { /* ignore */ }
  
  return null;
}
