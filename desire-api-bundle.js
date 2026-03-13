/**
 * ██████╗ ███████╗███████╗██╗██████╗ ███████╗     █████╗ ██████╗ ██╗
 * ██╔══██╗██╔════╝██╔════╝██║██╔══██╗██╔════╝    ██╔══██╗██╔══██╗██║
 * ██║  ██║█████╗  ███████╗██║██████╔╝█████╗      ███████║██████╔╝██║
 * ██║  ██║██╔══╝  ╚════██║██║██╔══██╗██╔══╝      ██╔══██║██╔═══╝ ██║
 * ██████╔╝███████╗███████║██║██║  ██║███████╗    ██║  ██║██║     ██║
 * ╚═════╝ ╚══════╝╚══════╝╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝  ╚═╝╚═╝     ╚═╝
 *
 * One key. Everything.
 * Cloudflare Worker — Single File Bundle
 * Paste this entire file into the Cloudflare Workers dashboard editor
 *
 * SETUP: After pasting, go to Settings > Variables > Add variable
 *   Name: MASTER_API_KEY
 *   Value: any secret key you choose (e.g. desire_secret_2024)
 */

// ============================================================
// CORS & RESPONSE HELPERS
// ============================================================

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Content-Type': 'application/json',
  };
}

function success(endpoint, data, ms) {
  return Response.json({ success: true, endpoint, ms, data }, { headers: corsHeaders() });
}

function fail(message, status = 400) {
  return Response.json({ success: false, error: message }, { status, headers: corsHeaders() });
}

function validateKey(request, env) {
  const key = request.headers.get('X-API-Key') || new URL(request.url).searchParams.get('apikey');
  return key && key === env.MASTER_API_KEY;
}

// ============================================================
// WEB & SCRAPING
// ============================================================

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DesireAPI/1.0)' },
    redirect: 'follow',
  });
  return { html: await res.text(), status: res.status, headers: Object.fromEntries(res.headers) };
}

function parseMetaTags(html, baseUrl) {
  const get = (pattern) => { const m = html.match(pattern); return m ? m[1] : null; };
  return {
    title: get(/<title[^>]*>([^<]+)<\/title>/i),
    description: get(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) || get(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i),
    ogTitle: get(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i),
    ogDescription: get(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i),
    ogImage: get(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i),
    favicon: get(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)/i) || new URL('/favicon.ico', baseUrl).href,
    canonical: get(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i),
    author: get(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)/i),
    keywords: get(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)/i),
    themeColor: get(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)/i),
    twitterCard: get(/<meta[^>]+name=["']twitter:card["'][^>]+content=["']([^"']+)/i),
  };
}

function extractLinks(html, baseUrl) {
  const links = []; const regex = /href=["']([^"'#]+)["']/gi; let m;
  while ((m = regex.exec(html)) !== null) { try { links.push(new URL(m[1], baseUrl).href); } catch {} }
  return [...new Set(links)].slice(0, 100);
}

function extractImages(html, baseUrl) {
  const imgs = []; const regex = /src=["']([^"']+\.(jpg|jpeg|png|gif|webp|svg|avif)[^"']*)["']/gi; let m;
  while ((m = regex.exec(html)) !== null) { try { imgs.push(new URL(m[1], baseUrl).href); } catch {} }
  return [...new Set(imgs)].slice(0, 50);
}

function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
}

function detectTech(html, headers) {
  const checks = [
    [/wp-content|wordpress/i,'WordPress'],[/shopify/i,'Shopify'],[/next\.js|__NEXT_DATA__/i,'Next.js'],
    [/react|__react/i,'React'],[/vue\.js|__vue/i,'Vue.js'],[/angular|ng-version/i,'Angular'],
    [/jquery/i,'jQuery'],[/bootstrap/i,'Bootstrap'],[/tailwindcss/i,'Tailwind CSS'],
    [/gtag|google-analytics/i,'Google Analytics'],[/cloudflare/i,'Cloudflare'],
    [/drupal/i,'Drupal'],[/wix\.com/i,'Wix'],[/squarespace/i,'Squarespace'],
    [/webflow/i,'Webflow'],[/stripe/i,'Stripe'],[/laravel/i,'Laravel'],
  ];
  const tech = checks.filter(([p]) => p.test(html) || p.test(JSON.stringify(headers))).map(([,n]) => n);
  const server = headers['server'] || headers['x-powered-by'];
  if (server) tech.push(`Server: ${server}`);
  return tech;
}

async function handleWeb(path, url, request) {
  const targetUrl = url.searchParams.get('url');

  if (path === '/status') {
    if (!targetUrl) throw new Error('url param required');
    const start = Date.now();
    try {
      const res = await fetch(targetUrl, { method: 'HEAD', redirect: 'follow' });
      return { url: targetUrl, up: res.status < 400, status: res.status, responseTime: Date.now() - start, finalUrl: res.url };
    } catch (e) { return { url: targetUrl, up: false, error: e.message, responseTime: Date.now() - start }; }
  }
  if (path === '/headers') {
    if (!targetUrl) throw new Error('url param required');
    const res = await fetch(targetUrl, { method: 'HEAD', redirect: 'follow' });
    return { url: targetUrl, status: res.status, headers: Object.fromEntries(res.headers) };
  }
  if (path === '/redirect') {
    if (!targetUrl) throw new Error('url param required');
    const chain = []; let current = targetUrl;
    for (let i = 0; i < 10; i++) {
      const res = await fetch(current, { method: 'HEAD', redirect: 'manual' });
      chain.push({ url: current, status: res.status });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { current = new URL(res.headers.get('location'), current).href; } else break;
    }
    return { original: targetUrl, final: current, hops: chain.length - 1, chain };
  }
  if (path === '/archive') {
    if (!targetUrl) throw new Error('url param required');
    const res = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(targetUrl)}`);
    const data = await res.json();
    return { url: targetUrl, available: !!data.archived_snapshots?.closest, snapshot: data.archived_snapshots?.closest || null };
  }
  if (path === '/rss') {
    if (!targetUrl) throw new Error('url param required');
    const xml = await fetch(targetUrl).then(r => r.text());
    const items = []; const itemRegex = /<item>([\s\S]*?)<\/item>/gi; let m;
    while ((m = itemRegex.exec(xml)) !== null) {
      const get = (tag) => m[1].match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i'))?.[1]?.trim();
      items.push({ title: get('title'), link: get('link'), description: get('description')?.slice(0, 200), pubDate: get('pubDate') });
    }
    return { feedUrl: targetUrl, count: items.length, items: items.slice(0, 20) };
  }
  if (path === '/sitemap') {
    if (!targetUrl) throw new Error('url param required');
    const sitemapUrl = targetUrl.includes('sitemap') ? targetUrl : new URL('/sitemap.xml', targetUrl).href;
    const xml = await fetch(sitemapUrl).then(r => r.text());
    const urls = []; const regex = /<loc>([^<]+)<\/loc>/gi; let m;
    while ((m = regex.exec(xml)) !== null) urls.push(m[1].trim());
    return { sitemapUrl, count: urls.length, urls: urls.slice(0, 50) };
  }
  if (path === '/robots') {
    if (!targetUrl) throw new Error('url param required');
    const robotsUrl = new URL('/robots.txt', targetUrl).href;
    const text = await fetch(robotsUrl).then(r => r.text());
    const rules = []; let current = null;
    for (const line of text.split('\n')) {
      const l = line.trim();
      if (l.startsWith('User-agent:')) current = { agent: l.split(':')[1].trim(), allow: [], disallow: [] };
      else if (l.startsWith('Disallow:') && current) current.disallow.push(l.split(':')[1].trim());
      else if (l.startsWith('Allow:') && current) current.allow.push(l.split(':')[1].trim());
      else if (l === '' && current) { rules.push(current); current = null; }
    }
    const sitemapM = text.match(/Sitemap:\s*(.+)/i);
    return { robotsUrl, sitemap: sitemapM ? sitemapM[1].trim() : null, rules };
  }
  if (!targetUrl) throw new Error('url param required');
  const { html, status, headers } = await fetchPage(targetUrl);
  if (path === '/fetch') return { url: targetUrl, status, html: html.slice(0, 50000) };
  if (path === '/scrape') return { url: targetUrl, status, text: stripHtml(html) };
  if (path === '/meta') return { url: targetUrl, status, ...parseMetaTags(html, targetUrl) };
  if (path === '/links') return { url: targetUrl, links: extractLinks(html, targetUrl) };
  if (path === '/images') return { url: targetUrl, images: extractImages(html, targetUrl) };
  if (path === '/tech') return { url: targetUrl, technologies: detectTech(html, headers) };
  if (path === '/readability') { const text = stripHtml(html); return { url: targetUrl, wordCount: text.split(/\s+/).length, readTimeMinutes: Math.ceil(text.split(/\s+/).length / 200), content: text }; }
  throw new Error(`Unknown endpoint: ${path}`);
}

// ============================================================
// LOCATION & NETWORK
// ============================================================

async function handleLocation(path, url, request) {
  if (path === '/myip') {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    return { ip, country: request.headers.get('cf-ipcountry'), city: request.cf?.city, region: request.cf?.region, latitude: request.cf?.latitude, longitude: request.cf?.longitude, timezone: request.cf?.timezone };
  }
  if (path === '/ip') {
    const address = url.searchParams.get('address'); if (!address) throw new Error('address param required');
    const data = await fetch(`http://ip-api.com/json/${address}?fields=status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,query`).then(r => r.json());
    if (data.status === 'fail') throw new Error(data.message);
    return { ip: data.query, country: data.country, countryCode: data.countryCode, region: data.regionName, city: data.city, zip: data.zip, latitude: data.lat, longitude: data.lon, timezone: data.timezone, isp: data.isp, org: data.org };
  }
  if (path === '/dns') {
    const domain = url.searchParams.get('domain'); if (!domain) throw new Error('domain param required');
    const types = ['A','AAAA','MX','TXT','NS','CNAME']; const results = {};
    await Promise.all(types.map(async (type) => {
      const data = await fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=${type}`, { headers: { 'Accept': 'application/dns-json' } }).then(r => r.json());
      results[type] = data.Answer?.map(r => ({ ttl: r.TTL, data: r.data })) || [];
    }));
    return { domain, records: results };
  }
  if (path === '/whois') {
    const domain = url.searchParams.get('domain'); if (!domain) throw new Error('domain param required');
    const data = await fetch(`https://rdap.org/domain/${domain}`).then(r => r.json());
    return { domain, name: data.ldhName, status: data.status, nameservers: data.nameservers?.map(n => n.ldhName), events: data.events?.map(e => ({ action: e.eventAction, date: e.eventDate })) };
  }
  if (path === '/geo') {
    const city = url.searchParams.get('city'); if (!city) throw new Error('city param required');
    const data = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=3`, { headers: { 'User-Agent': 'DesireAPI/1.0' } }).then(r => r.json());
    return { query: city, results: data.map(r => ({ name: r.display_name, latitude: parseFloat(r.lat), longitude: parseFloat(r.lon), type: r.type })) };
  }
  if (path === '/country') {
    const code = url.searchParams.get('code') || url.searchParams.get('name'); if (!code) throw new Error('code param required');
    const data = await fetch(`https://restcountries.com/v3.1/search?name=${encodeURIComponent(code)}`).then(r => r.json());
    const c = data[0]; if (!c) throw new Error('Country not found');
    return { name: c.name?.common, official: c.name?.official, capital: c.capital?.[0], region: c.region, population: c.population, area: c.area, languages: Object.values(c.languages || {}), currencies: Object.values(c.currencies || {}).map(x => `${x.name} (${x.symbol})`), flag: c.flag, flagUrl: c.flags?.png, tld: c.tld, borders: c.borders };
  }
  if (path === '/distance') {
    const from = url.searchParams.get('from'), to = url.searchParams.get('to');
    if (!from || !to) throw new Error('from and to params required');
    const [r1, r2] = await Promise.all([
      fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(from)}&format=json&limit=1`, { headers: { 'User-Agent': 'DesireAPI/1.0' } }).then(r => r.json()),
      fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(to)}&format=json&limit=1`, { headers: { 'User-Agent': 'DesireAPI/1.0' } }).then(r => r.json()),
    ]);
    if (!r1[0] || !r2[0]) throw new Error('Location not found');
    const [lat1, lon1, lat2, lon2] = [parseFloat(r1[0].lat), parseFloat(r1[0].lon), parseFloat(r2[0].lat), parseFloat(r2[0].lon)];
    const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    const km = R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return { from, to, distanceKm: Math.round(km), distanceMiles: Math.round(km*0.621371) };
  }
  if (path === '/timezone') {
    const city = url.searchParams.get('city'); if (!city) throw new Error('city param required');
    const geo = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`, { headers: { 'User-Agent': 'DesireAPI/1.0' } }).then(r => r.json());
    if (!geo[0]) throw new Error('City not found');
    const tz = await fetch(`https://timeapi.io/api/TimeZone/coordinate?latitude=${geo[0].lat}&longitude=${geo[0].lon}`).then(r => r.json());
    return { city, timezone: tz.timeZone, currentTime: tz.currentLocalTime, utcOffset: tz.currentUtcOffset?.seconds };
  }
  if (path === '/vpn') {
    const ip = url.searchParams.get('ip'); if (!ip) throw new Error('ip param required');
    const data = await fetch(`http://ip-api.com/json/${ip}?fields=proxy,hosting,query`).then(r => r.json());
    return { ip: data.query, isProxy: data.proxy, isHosting: data.hosting, likelyVPN: data.proxy || data.hosting };
  }
  if (path === '/isp') {
    const ip = url.searchParams.get('ip'); if (!ip) throw new Error('ip param required');
    const data = await fetch(`http://ip-api.com/json/${ip}?fields=isp,org,as,query`).then(r => r.json());
    return { ip: data.query, isp: data.isp, org: data.org, as: data.as };
  }
  throw new Error(`Unknown endpoint: ${path}`);
}

// ============================================================
// FINANCE & CRYPTO
// ============================================================

async function handleFinance(path, url) {
  if (path === '/exchange') {
    const from = (url.searchParams.get('from') || 'USD').toUpperCase(), to = (url.searchParams.get('to') || 'KES').toUpperCase();
    const amount = parseFloat(url.searchParams.get('amount') || '1');
    const data = await fetch(`https://open.er-api.com/v6/latest/${from}`).then(r => r.json());
    if (data.result !== 'success') throw new Error('Exchange rate fetch failed');
    const rate = data.rates[to]; if (!rate) throw new Error(`Currency ${to} not found`);
    return { from, to, rate, amount, converted: parseFloat((amount * rate).toFixed(4)), timestamp: data.time_last_update_utc };
  }
  if (path === '/crypto') {
    const coin = url.searchParams.get('coin') || 'bitcoin', currency = url.searchParams.get('currency') || 'usd';
    const data = await fetch(`https://api.coingecko.com/api/v3/coins/${coin.toLowerCase()}?localization=false&tickers=false&community_data=false&developer_data=false`).then(r => r.json());
    if (data.error) throw new Error('Coin not found. Use ID e.g. bitcoin, ethereum, solana');
    const m = data.market_data;
    return { id: data.id, name: data.name, symbol: data.symbol?.toUpperCase(), price: m?.current_price?.[currency], currency: currency.toUpperCase(), marketCap: m?.market_cap?.[currency], volume24h: m?.total_volume?.[currency], change24h: m?.price_change_percentage_24h, change7d: m?.price_change_percentage_7d, ath: m?.ath?.[currency], rank: data.market_cap_rank, image: data.image?.small };
  }
  if (path === '/crypto/trending') {
    const data = await fetch('https://api.coingecko.com/api/v3/search/trending').then(r => r.json());
    return { trending: data.coins?.map(c => ({ id: c.item.id, name: c.item.name, symbol: c.item.symbol, rank: c.item.market_cap_rank })) };
  }
  if (path === '/stocks') {
    const symbol = url.searchParams.get('symbol'); if (!symbol) throw new Error('symbol param required');
    const data = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`).then(r => r.json());
    const meta = data.chart?.result?.[0]?.meta; if (!meta) throw new Error('Stock not found');
    return { symbol: meta.symbol, currency: meta.currency, exchange: meta.exchangeName, price: meta.regularMarketPrice, previousClose: meta.chartPreviousClose, change: parseFloat((meta.regularMarketPrice - meta.chartPreviousClose).toFixed(2)), changePercent: parseFloat(((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100).toFixed(2)), marketState: meta.marketState };
  }
  if (path === '/gold') {
    const currency = (url.searchParams.get('currency') || 'USD').toUpperCase();
    const data = await fetch(`https://open.er-api.com/v6/latest/XAU`).then(r => r.json());
    const rate = data.rates[currency];
    return { metal: 'Gold', pricePerTroyOunce: rate, pricePerGram: parseFloat((rate/31.1035).toFixed(2)), currency, timestamp: data.time_last_update_utc };
  }
  if (path === '/mpesa' || path === '/mpesa/rates') {
    return { provider: 'M-Pesa Kenya (Safaricom)', note: 'Verify at official Safaricom website', sendMoney: [{min:50,max:100,charge:0},{min:101,max:500,charge:7},{min:501,max:1000,charge:13},{min:1001,max:1500,charge:23},{min:1501,max:2500,charge:33},{min:2501,max:3500,charge:53},{min:3501,max:5000,charge:57},{min:5001,max:7500,charge:78},{min:7501,max:10000,charge:90},{min:10001,max:15000,charge:100},{min:15001,max:20000,charge:105},{min:20001,max:150000,charge:108}], dailyLimit: 300000 };
  }
  throw new Error(`Unknown endpoint: ${path}`);
}

// ============================================================
// WEATHER
// ============================================================

async function getCoords(city) {
  const data = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`, { headers: { 'User-Agent': 'DesireAPI/1.0' } }).then(r => r.json());
  if (!data[0]) throw new Error(`City not found: ${city}`);
  return { lat: data[0].lat, lon: data[0].lon };
}

async function handleWeather(path, url) {
  if (path === '/weather') {
    const city = url.searchParams.get('city'); if (!city) throw new Error('city param required');
    const { lat, lon } = await getCoords(city);
    const data = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,uv_index&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&forecast_days=7&timezone=auto`).then(r => r.json());
    const c = data.current;
    const wc = {0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Foggy',51:'Light drizzle',61:'Slight rain',63:'Moderate rain',65:'Heavy rain',80:'Showers',95:'Thunderstorm'};
    return { city, latitude: parseFloat(lat), longitude: parseFloat(lon), current: { temperature: c.temperature_2m, feelsLike: c.apparent_temperature, humidity: c.relative_humidity_2m, precipitation: c.precipitation, windSpeed: c.wind_speed_10m, uvIndex: c.uv_index, condition: wc[c.weather_code] || `Code ${c.weather_code}`, unit: '°C' }, forecast: data.daily?.time?.map((date, i) => ({ date, max: data.daily.temperature_2m_max[i], min: data.daily.temperature_2m_min[i], precipitation: data.daily.precipitation_sum[i], condition: wc[data.daily.weather_code[i]] || `Code ${data.daily.weather_code[i]}` })) };
  }
  if (path === '/airquality') {
    const city = url.searchParams.get('city'); if (!city) throw new Error('city param required');
    const { lat, lon } = await getCoords(city);
    const data = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,european_aqi`).then(r => r.json());
    const c = data.current;
    const level = c.european_aqi <= 20 ? 'Good' : c.european_aqi <= 40 ? 'Fair' : c.european_aqi <= 60 ? 'Moderate' : c.european_aqi <= 80 ? 'Poor' : 'Very Poor';
    return { city, aqi: c.european_aqi, level, pm2_5: c.pm2_5, pm10: c.pm10, no2: c.nitrogen_dioxide, co: c.carbon_monoxide };
  }
  if (path === '/uv') {
    const city = url.searchParams.get('city'); if (!city) throw new Error('city param required');
    const { lat, lon } = await getCoords(city);
    const data = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=uv_index&timezone=auto`).then(r => r.json());
    const uv = data.current?.uv_index;
    return { city, uvIndex: uv, level: uv <= 2 ? 'Low' : uv <= 5 ? 'Moderate' : uv <= 7 ? 'High' : uv <= 10 ? 'Very High' : 'Extreme', protection: uv <= 2 ? 'No protection needed' : 'Wear sunscreen SPF 30+' };
  }
  if (path === '/sunrise') {
    const city = url.searchParams.get('city'); if (!city) throw new Error('city param required');
    const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
    const { lat, lon } = await getCoords(city);
    const data = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=sunrise,sunset,daylight_duration&start_date=${date}&end_date=${date}&timezone=auto`).then(r => r.json());
    return { city, date, sunrise: data.daily?.sunrise?.[0], sunset: data.daily?.sunset?.[0], daylightHours: data.daily?.daylight_duration?.[0] ? (data.daily.daylight_duration[0]/3600).toFixed(2) : null };
  }
  if (path === '/moon') {
    const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
    const d = new Date(date), knownNew = new Date('2024-01-11'), cycleLength = 29.53059;
    const phase = ((((d - knownNew) / 86400000) % cycleLength) + cycleLength) % cycleLength;
    const phases = [['New Moon','🌑',[0,1.85]],['Waxing Crescent','🌒',[1.85,7.38]],['First Quarter','🌓',[7.38,9.22]],['Waxing Gibbous','🌔',[9.22,14.77]],['Full Moon','🌕',[14.77,16.61]],['Waning Gibbous','🌖',[16.61,22.15]],['Last Quarter','🌗',[22.15,24.0]],['Waning Crescent','🌘',[24.0,29.53]]];
    const current = phases.find(([,,[min,max]]) => phase >= min && phase < max) || phases[0];
    return { date, phase: parseFloat(phase.toFixed(2)), phaseName: current[0], emoji: current[1], illumination: parseFloat((Math.abs(Math.cos(phase/cycleLength*2*Math.PI))*100).toFixed(1)) };
  }
  if (path === '/earthquake') {
    const data = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson').then(r => r.json());
    return { count: data.features?.length, earthquakes: data.features?.slice(0, 10).map(f => ({ magnitude: f.properties.mag, place: f.properties.place, time: new Date(f.properties.time).toISOString(), tsunami: f.properties.tsunami === 1, url: f.properties.url })) };
  }
  if (path === '/wildfires') {
    const data = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&limit=10').then(r => r.json());
    return { count: data.events?.length, wildfires: data.events?.map(e => ({ id: e.id, title: e.title, date: e.geometry?.[0]?.date, coordinates: e.geometry?.[0]?.coordinates })) };
  }
  if (path === '/floods') {
    const data = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?category=floods&status=open&limit=10').then(r => r.json());
    return { count: data.events?.length, floods: data.events?.map(e => ({ id: e.id, title: e.title, date: e.geometry?.[0]?.date })) };
  }
  throw new Error(`Unknown endpoint: ${path}`);
}

// ============================================================
// TEXT & LANGUAGE
// ============================================================

async function handleText(path, url) {
  const text = url.searchParams.get('text') || url.searchParams.get('q');
  if (path === '/translate') {
    if (!text) throw new Error('text param required');
    const to = url.searchParams.get('to') || 'sw', from = url.searchParams.get('from') || 'auto';
    const data = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`).then(r => r.json());
    return { original: text, from, to, translated: data.responseData?.translatedText, confidence: data.responseData?.match };
  }
  if (path === '/detect') {
    if (!text) throw new Error('text param required');
    const data = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0,100))}&langpair=auto|en`).then(r => r.json());
    return { text: text.slice(0,100), detectedLanguage: data.responseData?.detectedLanguage || 'unknown' };
  }
  if (path === '/sentiment') {
    if (!text) throw new Error('text param required');
    const pos = ['good','great','excellent','amazing','wonderful','fantastic','love','best','happy','joy','perfect','awesome','brilliant'];
    const neg = ['bad','terrible','awful','horrible','hate','worst','poor','disappointing','ugly','boring','disgusting','sad','angry'];
    const words = text.toLowerCase().split(/\s+/); let score = 0; const matched = { positive: [], negative: [] };
    for (const w of words) { if (pos.includes(w)) { score++; matched.positive.push(w); } if (neg.includes(w)) { score--; matched.negative.push(w); } }
    return { text: text.slice(0,200), sentiment: score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral', score, matched };
  }
  if (path === '/define') {
    const word = url.searchParams.get('word') || text; if (!word) throw new Error('word param required');
    const data = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`).then(r => r.json());
    if (!data[0]?.word) throw new Error('Word not found');
    return { word: data[0].word, phonetic: data[0].phonetic, meanings: data[0].meanings?.slice(0,3).map(m => ({ partOfSpeech: m.partOfSpeech, definitions: m.definitions?.slice(0,2).map(d => ({ definition: d.definition, example: d.example })), synonyms: m.synonyms?.slice(0,5) })) };
  }
  if (path === '/synonym') {
    const word = url.searchParams.get('word') || text; if (!word) throw new Error('word param required');
    const data = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`).then(r => r.json());
    return { word, synonyms: [...new Set(data[0]?.meanings?.flatMap(m => m.synonyms || []) || [])].slice(0,20) };
  }
  if (path === '/antonym') {
    const word = url.searchParams.get('word') || text; if (!word) throw new Error('word param required');
    const data = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`).then(r => r.json());
    return { word, antonyms: [...new Set(data[0]?.meanings?.flatMap(m => m.antonyms || []) || [])].slice(0,20) };
  }
  if (path === '/rhyme') {
    const word = url.searchParams.get('word') || text; if (!word) throw new Error('word param required');
    const data = await fetch(`https://api.datamuse.com/words?rel_rhy=${word}&max=20`).then(r => r.json());
    return { word, rhymes: data.map(w => w.word) };
  }
  if (path === '/keywords') {
    if (!text) throw new Error('text param required');
    const stop = new Set(['the','a','an','is','it','in','on','at','to','for','of','and','or','but','with','from','by','as','be','was','are','were','have','has','had','do','does','did','will','would','could','should','this','that','these','those','i','you','he','she','we','they','not','no','so','if','then','than','when','where','which','who','what','how','all','each','every','some','such']);
    const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || []; const freq = {};
    for (const w of words) { if (!stop.has(w)) freq[w] = (freq[w] || 0) + 1; }
    return { keywords: Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0,15).map(([word,count]) => ({ word, count })) };
  }
  if (path === '/grammar') {
    if (!text) throw new Error('text param required');
    const data = await fetch('https://api.languagetool.org/v2/check', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `text=${encodeURIComponent(text)}&language=en-US` }).then(r => r.json());
    return { issues: data.matches?.length || 0, corrections: data.matches?.slice(0,10).map(m => ({ message: m.message, suggestions: m.replacements?.slice(0,3).map(r => r.value), offset: m.offset })) };
  }
  if (path === '/translate') {
    if (!text) throw new Error('text param required');
  }
  if (path === '/readinglevel') {
    if (!text) throw new Error('text param required');
    const sentences = text.split(/[.!?]+/).filter(s => s.trim()).length;
    const words = text.split(/\s+/).filter(w => w).length;
    const syllables = text.toLowerCase().split(/\s+/).reduce((sum, w) => sum + Math.max(1, (w.replace(/[^a-z]/g,'').match(/[aeiou]/g) || []).length), 0);
    const flesch = 206.835 - 1.015*(words/sentences) - 84.6*(syllables/words);
    return { words, sentences, fleschScore: parseFloat(flesch.toFixed(1)), readingLevel: flesch >= 70 ? 'Easy' : flesch >= 50 ? 'Standard' : 'Difficult', readTimeMinutes: Math.ceil(words/200) };
  }
  if (path === '/pronounce') {
    const word = url.searchParams.get('word') || text; if (!word) throw new Error('word param required');
    const data = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`).then(r => r.json());
    if (!data[0]?.word) throw new Error('Word not found');
    return { word, ipa: data[0].phonetic, phonetics: data[0].phonetics?.map(p => ({ text: p.text, audio: p.audio })).filter(p => p.text || p.audio) };
  }
  throw new Error(`Unknown endpoint: ${path}`);
}

// ============================================================
// DEVELOPER UTILITIES
// ============================================================

async function handleUtils(path, url, request) {
  if (path === '/qr') {
    const text = url.searchParams.get('text') || url.searchParams.get('url'); if (!text) throw new Error('text param required');
    const size = url.searchParams.get('size') || '200x200';
    return { text, qrImageUrl: `https://api.qrserver.com/v1/create-qr-code/?size=${size}&data=${encodeURIComponent(text)}`, size };
  }
  if (path === '/hash') {
    const text = url.searchParams.get('text'); if (!text) throw new Error('text param required');
    const algo = url.searchParams.get('algo') || 'sha256';
    const algoMap = { 'sha256': 'SHA-256', 'sha512': 'SHA-512', 'sha1': 'SHA-1', 'sha384': 'SHA-384' };
    const selected = algoMap[algo.toLowerCase()] || 'SHA-256';
    const hashBuffer = await crypto.subtle.digest(selected, new TextEncoder().encode(text));
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');
    return { text, algorithm: selected, hash: hashHex };
  }
  if (path === '/encode') {
    const text = url.searchParams.get('text'); if (!text) throw new Error('text param required');
    return { original: text, base64: btoa(unescape(encodeURIComponent(text))), urlEncoded: encodeURIComponent(text) };
  }
  if (path === '/decode') {
    const text = url.searchParams.get('text'); if (!text) throw new Error('text param required');
    try { return { encoded: text, decoded: decodeURIComponent(escape(atob(text))) }; }
    catch { return { encoded: text, decoded: decodeURIComponent(text) }; }
  }
  if (path === '/uuid') {
    const count = parseInt(url.searchParams.get('count') || '1');
    const uuids = Array.from({ length: Math.min(count, 10) }, () => crypto.randomUUID());
    return count === 1 ? { uuid: uuids[0] } : { uuids };
  }
  if (path === '/password') {
    const length = Math.min(parseInt(url.searchParams.get('length') || '16'), 128);
    const strength = url.searchParams.get('strength') || 'strong';
    const charsets = { weak: 'abcdefghijklmnopqrstuvwxyz0123456789', medium: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', strong: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}' };
    const charset = charsets[strength] || charsets.strong;
    const password = Array.from({ length }, () => charset[Math.floor(Math.random() * charset.length)]).join('');
    return { password, length, strength };
  }
  if (path === '/uuid/v5') {
    return { uuid: crypto.randomUUID(), note: 'Cloudflare Workers supports UUID v4. UUID v5 requires custom implementation.' };
  }
  if (path === '/time') {
    const tz = url.searchParams.get('timezone') || url.searchParams.get('tz') || 'UTC';
    try {
      const now = new Date();
      return { timezone: tz, datetime: now.toLocaleString('en-US', { timeZone: tz }), utc: now.toISOString(), unixTimestamp: Math.floor(now.getTime()/1000) };
    } catch { throw new Error(`Invalid timezone: ${tz}. Use IANA format e.g. Africa/Nairobi`); }
  }
  if (path === '/timestamp') {
    const date = url.searchParams.get('date'), unix = url.searchParams.get('unix');
    if (unix) { const d = new Date(parseInt(unix)*1000); return { unix: parseInt(unix), iso: d.toISOString(), human: d.toUTCString() }; }
    const d = date ? new Date(date) : new Date();
    if (isNaN(d.getTime())) throw new Error('Invalid date');
    return { input: date || 'now', unix: Math.floor(d.getTime()/1000), iso: d.toISOString(), human: d.toUTCString() };
  }
  if (path === '/color') {
    const hex = url.searchParams.get('hex')?.replace('#',''); if (!hex) throw new Error('hex param required');
    const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
    const max = Math.max(r,g,b)/255, min = Math.min(r,g,b)/255, l = (max+min)/2;
    const luminance = 0.2126*(r/255)+0.7152*(g/255)+0.0722*(b/255);
    return { hex: `#${hex.toUpperCase()}`, rgb: {r,g,b}, luminance: parseFloat(luminance.toFixed(3)), isDark: luminance < 0.5, contrastColor: luminance < 0.5 ? '#FFFFFF' : '#000000' };
  }
  if (path === '/useragent') {
    const ua = url.searchParams.get('ua') || request.headers.get('user-agent') || '';
    const isMobile = /mobile|android|iphone|ipad/i.test(ua);
    const browsers = [['Chrome',/Chrome\/([0-9.]+)/],['Firefox',/Firefox\/([0-9.]+)/],['Safari',/Version\/([0-9.]+).*Safari/],['Edge',/Edg\/([0-9.]+)/]];
    const oses = [['Windows',/Windows NT ([0-9.]+)/],['macOS',/Mac OS X ([0-9_.]+)/],['Android',/Android ([0-9.]+)/],['iOS',/OS ([0-9_]+) like Mac/],['Linux',/Linux/]];
    const browser = browsers.find(([,r]) => r.test(ua));
    const os = oses.find(([,r]) => r.test(ua));
    return { ua, isMobile, isBot: /bot|crawler|spider/i.test(ua), browser: browser ? { name: browser[0], version: ua.match(browser[1])?.[1] } : null, os: os ? { name: os[0], version: ua.match(os[1])?.[1]?.replace(/_/g,'.') } : null };
  }
  if (path === '/regex') {
    const pattern = url.searchParams.get('pattern'), text = url.searchParams.get('text');
    if (!pattern || !text) throw new Error('pattern and text params required');
    try {
      const matches = [...text.matchAll(new RegExp(pattern, 'g'))];
      return { pattern, text: text.slice(0,200), matched: matches.length > 0, matchCount: matches.length, matches: matches.slice(0,10).map(m => ({ match: m[0], index: m.index })) };
    } catch (e) { throw new Error(`Invalid regex: ${e.message}`); }
  }
  if (path === '/markdown') {
    const text = url.searchParams.get('text'); if (!text) throw new Error('text param required');
    const html = text.replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/`(.+?)`/g,'<code>$1</code>').replace(/\[(.+?)\]\((.+?)\)/g,'<a href="$2">$1</a>');
    return { markdown: text, html };
  }
  if (path === '/cron') {
    const expr = url.searchParams.get('expr'); if (!expr) throw new Error('expr param required');
    const parts = expr.trim().split(/\s+/); if (parts.length !== 5) throw new Error('Cron must have 5 parts');
    const [min, hour, day, month, weekday] = parts;
    return { expression: expr, parts: { minute: min, hour, dayOfMonth: day, month, dayOfWeek: weekday }, explanation: `min:${min} hour:${hour} dom:${day} month:${month} dow:${weekday}` };
  }
  if (path === '/diff') {
    const a = (url.searchParams.get('a') || '').split('\n'), b = (url.searchParams.get('b') || '').split('\n');
    return { added: b.filter(l => !a.includes(l)), removed: a.filter(l => !b.includes(l)), unchanged: a.filter(l => b.includes(l)) };
  }
  throw new Error(`Unknown endpoint: ${path}`);
}

// ============================================================
// SEARCH & KNOWLEDGE
// ============================================================

async function handleSearch(path, url) {
  const q = url.searchParams.get('q') || url.searchParams.get('query');
  if (path === '/wiki' || path === '/wiki/random') {
    if (path === '/wiki/random') {
      const data = await fetch('https://en.wikipedia.org/api/rest_v1/page/random/summary').then(r => r.json());
      return { title: data.title, description: data.description, summary: data.extract, url: data.content_urls?.desktop?.page, thumbnail: data.thumbnail?.source };
    }
    if (!q) throw new Error('q param required');
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`);
    if (!res.ok) { const search = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=5`).then(r => r.json()); return { query: q, found: false, suggestions: search.query?.search?.map(s => s.title) }; }
    const data = await res.json();
    return { title: data.title, description: data.description, summary: data.extract, url: data.content_urls?.desktop?.page, thumbnail: data.thumbnail?.source };
  }
  if (path === '/search') {
    if (!q) throw new Error('q param required');
    const data = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`).then(r => r.json());
    return { query: q, answer: data.Answer || null, abstract: data.Abstract || null, abstractUrl: data.AbstractURL || null, relatedTopics: data.RelatedTopics?.slice(0,5).map(t => ({ text: t.Text, url: t.FirstURL })).filter(t => t.text) };
  }
  if (path === '/npm') {
    const pkg = url.searchParams.get('package') || q; if (!pkg) throw new Error('package param required');
    const data = await fetch(`https://registry.npmjs.org/${pkg}`).then(r => r.json());
    const latest = data['dist-tags']?.latest, v = data.versions?.[latest] || {};
    return { name: data.name, description: data.description, version: latest, license: v.license, homepage: data.homepage, keywords: data.keywords?.slice(0,10), dependencies: Object.keys(v.dependencies || {}).length, publishedAt: data.time?.[latest] };
  }
  if (path === '/pypi') {
    const pkg = url.searchParams.get('package') || q; if (!pkg) throw new Error('package param required');
    const data = await fetch(`https://pypi.org/pypi/${pkg}/json`).then(r => r.json());
    const info = data.info;
    return { name: info.name, version: info.version, description: info.summary, license: info.license, author: info.author, projectUrl: `https://pypi.org/project/${info.name}`, requiresPython: info.requires_python };
  }
  if (path === '/github') {
    const user = url.searchParams.get('user'), repo = url.searchParams.get('repo');
    if (repo) {
      const d = await fetch(`https://api.github.com/repos/${repo}`, { headers: { 'User-Agent': 'DesireAPI' } }).then(r => r.json());
      return { name: d.full_name, description: d.description, stars: d.stargazers_count, forks: d.forks_count, language: d.language, license: d.license?.name, topics: d.topics, openIssues: d.open_issues_count, url: d.html_url, createdAt: d.created_at };
    }
    if (!user) throw new Error('user or repo param required');
    const d = await fetch(`https://api.github.com/users/${user}`, { headers: { 'User-Agent': 'DesireAPI' } }).then(r => r.json());
    return { login: d.login, name: d.name, bio: d.bio, avatar: d.avatar_url, followers: d.followers, following: d.following, publicRepos: d.public_repos, location: d.location, url: d.html_url };
  }
  if (path === '/scholar') {
    if (!q) throw new Error('q param required');
    const xml = await fetch(`https://export.arxiv.org/search/?searchtype=all&query=${encodeURIComponent(q)}&start=0&max_results=5`).then(r => r.text());
    const entries = []; const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi; let m;
    while ((m = entryRegex.exec(xml)) !== null) {
      const get = (tag) => m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1]?.trim();
      entries.push({ title: get('title'), summary: get('summary')?.slice(0,200), published: get('published'), id: get('id') });
    }
    return { query: q, count: entries.length, papers: entries };
  }
  if (path === '/hackernews' || path === '/hackernews/top') {
    const ids = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json').then(r => r.json());
    const stories = await Promise.all(ids.slice(0,10).map(id => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json())));
    return { stories: stories.map(s => ({ title: s.title, url: s.url, score: s.score, comments: s.descendants, author: s.by, time: new Date(s.time*1000).toISOString() })) };
  }
  throw new Error(`Unknown endpoint: ${path}`);
}

// ============================================================
// SECURITY & VALIDATION
// ============================================================

async function handleSecurity(path, url) {
  if (path === '/validate/email') {
    const email = url.searchParams.get('email'); if (!email) throw new Error('email param required');
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const domain = email.split('@')[1]; let mxValid = false;
    if (valid && domain) { try { const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=MX`, { headers: { 'Accept': 'application/dns-json' } }).then(r => r.json()); mxValid = (r.Answer?.length || 0) > 0; } catch {} }
    const disposable = ['mailinator.com','guerrillamail.com','temp-mail.org','yopmail.com','tempmail.com','10minutemail.com'];
    return { email, valid, domain, mxValid, isDisposable: disposable.includes(domain?.toLowerCase()) };
  }
  if (path === '/validate/url') {
    const inputUrl = url.searchParams.get('url'); if (!inputUrl) throw new Error('url param required');
    try { const p = new URL(inputUrl); return { url: inputUrl, valid: true, protocol: p.protocol, hostname: p.hostname, path: p.pathname, normalized: p.href }; }
    catch { return { url: inputUrl, valid: false, error: 'Invalid URL format' }; }
  }
  if (path === '/validate/phone') {
    const phone = url.searchParams.get('phone'); if (!phone) throw new Error('phone param required');
    const clean = phone.replace(/\s|-|\(|\)/g,'');
    const kenyaLocal = /^0[17]\d{8}$/.test(clean), kenyaIntl = /^\+254[17]\d{8}$/.test(clean);
    return { phone, cleaned: clean, valid: /^\+[1-9]\d{6,14}$/.test(clean) || kenyaLocal, isMpesa: kenyaLocal || kenyaIntl, country: kenyaIntl || kenyaLocal ? 'Kenya' : 'Unknown' };
  }
  if (path === '/ssl') {
    const domain = url.searchParams.get('domain'); if (!domain) throw new Error('domain param required');
    try { const res = await fetch(`https://${domain}`, { method: 'HEAD' }); return { domain, hasSSL: true, redirectsToHttps: res.url.startsWith('https'), finalUrl: res.url, status: res.status }; }
    catch (e) { return { domain, hasSSL: false, error: e.message }; }
  }
  if (path === '/spam') {
    const ip = url.searchParams.get('ip'); if (!ip) throw new Error('ip param required');
    const data = await fetch(`http://ip-api.com/json/${ip}?fields=proxy,hosting,query`).then(r => r.json());
    return { ip, likelySpam: data.proxy || data.hosting, isProxy: data.proxy, isHosting: data.hosting };
  }
  if (path === '/hosting') {
    const domain = url.searchParams.get('domain'); if (!domain) throw new Error('domain param required');
    const dns = await fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=A`, { headers: { 'Accept': 'application/dns-json' } }).then(r => r.json());
    const ip = dns.Answer?.[0]?.data; if (!ip) throw new Error('Could not resolve domain');
    const info = await fetch(`http://ip-api.com/json/${ip}?fields=isp,org,as,hosting`).then(r => r.json());
    return { domain, ip, isp: info.isp, org: info.org, isHosting: info.hosting };
  }
  if (path === '/email/disposable') {
    const email = url.searchParams.get('email'); if (!email) throw new Error('email param required');
    const domain = email.split('@')[1]?.toLowerCase();
    const disposable = ['mailinator.com','guerrillamail.com','temp-mail.org','yopmail.com','tempmail.com','10minutemail.com','fakeinbox.com','trashmail.com'];
    return { email, domain, isDisposable: disposable.includes(domain), isValid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) };
  }
  throw new Error(`Unknown endpoint: ${path}`);
}

// ============================================================
// AI ENDPOINTS
// ============================================================

async function handleAI(path, url) {
  if (path === '/ai/chat' || path === '/ai') {
    const message = url.searchParams.get('message') || url.searchParams.get('q'); if (!message) throw new Error('message param required');
    const data = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(message)}&format=json&no_html=1`).then(r => r.json());
    return { message, answer: data.Answer || data.Abstract || 'No direct answer found. Try a more specific question.', source: data.AbstractSource || null, url: data.AbstractURL || null };
  }
  if (path === '/ai/summarize') {
    const text = url.searchParams.get('text') || url.searchParams.get('url'); if (!text) throw new Error('text or url param required');
    let content = text;
    if (text.startsWith('http')) { const html = await fetch(text, { headers: { 'User-Agent': 'DesireAPI/1.0' } }).then(r => r.text()); content = html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,2000); }
    const sentences = content.match(/[^.!?]+[.!?]+/g) || [];
    return { originalLength: content.length, summary: sentences.slice(0,3).join(' '), sentencesExtracted: 3 };
  }
  if (path === '/ai/sentiment') {
    const text = url.searchParams.get('text'); if (!text) throw new Error('text param required');
    const pos = ['good','great','excellent','amazing','love','best','happy','perfect','awesome','brilliant'], neg = ['bad','terrible','awful','horrible','hate','worst','poor','sad','angry','useless'];
    const words = text.toLowerCase().split(/\W+/); let score = 0; const p = [], n = [];
    for (const w of words) { if (pos.includes(w)) { score++; p.push(w); } if (neg.includes(w)) { score--; n.push(w); } }
    return { sentiment: score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral', score, positiveWords: [...new Set(p)], negativeWords: [...new Set(n)] };
  }
  if (path === '/ai/toxicity') {
    const text = url.searchParams.get('text'); if (!text) throw new Error('text param required');
    const toxic = ['hate','kill','die','stupid','idiot','moron','dumb','trash','garbage'];
    const found = toxic.filter(w => text.toLowerCase().includes(w));
    return { isToxic: found.length > 0, score: Math.min(found.length*0.3, 1).toFixed(2), toxicWords: found };
  }
  if (path === '/ai/classify') {
    const text = url.searchParams.get('text'); if (!text) throw new Error('text param required');
    const categories = { technology: ['code','software','computer','internet','app','data','ai','tech','algorithm'], sports: ['football','basketball','soccer','tennis','match','score','player','team'], politics: ['government','election','president','policy','vote','minister','law'], business: ['market','stock','company','revenue','profit','economy','trade'], health: ['doctor','medicine','hospital','disease','health','drug','medical'], science: ['research','study','experiment','physics','chemistry','biology'] };
    const words = text.toLowerCase().split(/\W+/); const scores = {};
    for (const [cat, keywords] of Object.entries(categories)) scores[cat] = words.filter(w => keywords.includes(w)).length;
    const sorted = Object.entries(scores).sort((a,b) => b[1]-a[1]);
    return { category: sorted[0][1] > 0 ? sorted[0][0] : 'general', scores };
  }
  if (path === '/ai/ocr') {
    const imageUrl = url.searchParams.get('url'); if (!imageUrl) throw new Error('url param required');
    const data = await fetch('https://api.ocr.space/parse/imageurl', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `url=${encodeURIComponent(imageUrl)}&apikey=helloworld&language=eng` }).then(r => r.json());
    return { imageUrl, text: data.ParsedResults?.[0]?.ParsedText || 'No text found', isError: data.IsErroredOnProcessing };
  }
  if (path === '/ai/entities') {
    const text = url.searchParams.get('text'); if (!text) throw new Error('text param required');
    return { entities: { names: [...new Set(text.split(/\s+/).filter(w => /^[A-Z][a-z]+/.test(w) && w.length > 2))].slice(0,10), numbers: [...new Set(text.match(/\b\d+(?:\.\d+)?%?\b/g) || [])], emails: [...new Set(text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g) || [])], urls: [...new Set(text.match(/https?:\/\/[^\s]+/g) || [])] } };
  }
  if (path === '/ai/fake') {
    const text = url.searchParams.get('text'); if (!text) throw new Error('text param required');
    const redFlags = ['BREAKING','SHOCKING','SHARE BEFORE DELETED','EXPOSED','SECRET','BANNED'];
    const found = redFlags.filter(f => text.toUpperCase().includes(f));
    const allCaps = (text.match(/\b[A-Z]{4,}\b/g) || []).length;
    return { fakeNewsScore: Math.min(found.length*0.2 + allCaps*0.05, 1).toFixed(2), verdict: found.length > 2 ? 'Likely misleading' : found.length > 0 ? 'Suspicious' : 'Appears normal', redFlags: found };
  }
  throw new Error(`Unknown AI endpoint: ${path}`);
}

// ============================================================
// CONTENT & MEDIA
// ============================================================

async function handleContent(path, url) {
  if (path === '/news') {
    const topic = url.searchParams.get('topic') || url.searchParams.get('q') || 'world';
    const xml = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en&gl=US&ceid=US:en`).then(r => r.text());
    const items = []; const itemRegex = /<item>([\s\S]*?)<\/item>/gi; let m;
    while ((m = itemRegex.exec(xml)) !== null && items.length < 10) {
      const get = (tag) => m[1].match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i'))?.[1]?.trim();
      items.push({ title: get('title'), link: get('link'), pubDate: get('pubDate'), source: get('source') });
    }
    return { topic, count: items.length, news: items };
  }
  if (path === '/movie') {
    const title = url.searchParams.get('title') || url.searchParams.get('q'); if (!title) throw new Error('title param required');
    const data = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(title)}&apikey=trilogy`).then(r => r.json());
    if (data.Response === 'False') throw new Error(data.Error || 'Movie not found');
    return { title: data.Title, year: data.Year, genre: data.Genre, director: data.Director, actors: data.Actors, plot: data.Plot, rating: data.imdbRating, runtime: data.Runtime, awards: data.Awards, poster: data.Poster };
  }
  if (path === '/book') {
    const title = url.searchParams.get('title') || url.searchParams.get('q'); if (!title) throw new Error('title param required');
    const data = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=3`).then(r => r.json());
    return { results: data.docs?.slice(0,3).map(b => ({ title: b.title, author: b.author_name?.[0], year: b.first_publish_year, pages: b.number_of_pages_median, coverUrl: b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg` : null })) };
  }
  if (path === '/anime') {
    const title = url.searchParams.get('title') || url.searchParams.get('q'); if (!title) throw new Error('title param required');
    const data = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=3`).then(r => r.json());
    return { results: data.data?.slice(0,3).map(a => ({ title: a.title, titleEnglish: a.title_english, episodes: a.episodes, status: a.status, score: a.score, genres: a.genres?.map(g => g.name), synopsis: a.synopsis?.slice(0,200), image: a.images?.jpg?.image_url })) };
  }
  if (path === '/recipe') {
    const dish = url.searchParams.get('dish') || url.searchParams.get('q'); if (!dish) throw new Error('dish param required');
    const data = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(dish)}`).then(r => r.json());
    if (!data.meals) throw new Error('No recipes found');
    const meal = data.meals[0]; const ingredients = [];
    for (let i = 1; i <= 20; i++) { const ing = meal[`strIngredient${i}`], measure = meal[`strMeasure${i}`]; if (ing?.trim()) ingredients.push(`${measure?.trim()} ${ing}`.trim()); }
    return { name: meal.strMeal, category: meal.strCategory, area: meal.strArea, instructions: meal.strInstructions?.slice(0,500), ingredients, image: meal.strMealThumb, youtube: meal.strYoutube };
  }
  if (path === '/joke') {
    const category = url.searchParams.get('category') || 'Any';
    const data = await fetch(`https://v2.jokeapi.dev/joke/${category}?blacklistFlags=nsfw,racist,sexist`).then(r => r.json());
    return { category: data.category, joke: data.type === 'single' ? data.joke : null, setup: data.setup, delivery: data.delivery };
  }
  if (path === '/quote') { const data = await fetch('https://zenquotes.io/api/random').then(r => r.json()); return { quote: data[0]?.q, author: data[0]?.a }; }
  if (path === '/meme') { const data = await fetch('https://meme-api.com/gimme').then(r => r.json()); return { title: data.title, url: data.url, subreddit: data.subreddit, upvotes: data.ups }; }
  if (path === '/gif') { const q = url.searchParams.get('query') || url.searchParams.get('q') || 'funny'; const data = await fetch(`https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ&limit=5`).then(r => r.json()); return { query: q, gifs: data.results?.map(r => ({ title: r.title, url: r.media_formats?.gif?.url })) }; }
  if (path === '/youtube') { const videoUrl = url.searchParams.get('url') || url.searchParams.get('id'); if (!videoUrl) throw new Error('url param required'); const videoId = videoUrl.match(/(?:v=|\/embed\/|youtu\.be\/)([^&?/]+)/)?.[1] || videoUrl; const data = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`).then(r => r.json()); return { videoId, title: data.title, channel: data.author_name, thumbnail: data.thumbnail_url }; }
  if (path === '/game') { const title = url.searchParams.get('title') || url.searchParams.get('q'); if (!title) throw new Error('title param required'); const data = await fetch(`https://api.rawg.io/api/games?search=${encodeURIComponent(title)}&key=demo&page_size=3`).then(r => r.json()); return { results: data.results?.slice(0,3).map(g => ({ name: g.name, released: g.released, rating: g.rating, genres: g.genres?.map(x => x.name), platforms: g.platforms?.map(p => p.platform.name) })) }; }
  throw new Error(`Unknown endpoint: ${path}`);
}

// ============================================================
// FUN & RANDOM
// ============================================================

async function handleFun(path, url) {
  if (path === '/coinflip') { const result = Math.random() < 0.5 ? 'Heads' : 'Tails'; return { result, emoji: result === 'Heads' ? '🪙' : '🎯' }; }
  if (path === '/dice') { const sides = parseInt(url.searchParams.get('sides') || '6'), count = Math.min(parseInt(url.searchParams.get('count') || '1'), 10); const rolls = Array.from({ length: count }, () => Math.floor(Math.random()*sides)+1); return { sides, rolls, total: rolls.reduce((a,b) => a+b, 0) }; }
  if (path === '/8ball') { const answers = ['It is certain.','Without a doubt.','Yes definitely.','Most likely.','Outlook good.','Yes.','Reply hazy, try again.','Ask again later.','Cannot predict now.','Don\'t count on it.','My reply is no.','Very doubtful.']; return { question: url.searchParams.get('q'), answer: answers[Math.floor(Math.random()*answers.length)], emoji: '🎱' }; }
  if (path === '/random/number') { const min = parseInt(url.searchParams.get('min') || '1'), max = parseInt(url.searchParams.get('max') || '100'); return { min, max, number: Math.floor(Math.random()*(max-min+1))+min }; }
  if (path === '/random/color') { const r = Math.floor(Math.random()*256), g = Math.floor(Math.random()*256), b = Math.floor(Math.random()*256); return { hex: '#'+[r,g,b].map(x => x.toString(16).padStart(2,'0')).join('').toUpperCase(), rgb: {r,g,b} }; }
  if (path === '/random/name') { const data = await fetch('https://randomuser.me/api/?inc=name&results=3').then(r => r.json()); return { names: data.results?.map(r => ({ full: `${r.name.first} ${r.name.last}`, first: r.name.first, last: r.name.last })) }; }
  if (path === '/fact' || path === '/random/fact') { const data = await fetch('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en').then(r => r.json()); return { fact: data.text, source: data.source_url }; }
  if (path === '/advice') { const data = await fetch('https://api.adviceslip.com/advice').then(r => r.json()); return { advice: data.slip?.advice }; }
  if (path === '/affirmation') { const list = ['You are capable of amazing things.','Every day is a new opportunity to grow.','You have the strength to overcome any challenge.','Your hard work will pay off.','You are enough, exactly as you are.','Progress, not perfection.','You are becoming the best version of yourself.']; return { affirmation: list[Math.floor(Math.random()*list.length)] }; }
  if (path === '/cat') { const data = await fetch('https://api.thecatapi.com/v1/images/search').then(r => r.json()); return { url: data[0]?.url }; }
  if (path === '/dog') { const data = await fetch('https://dog.ceo/api/breeds/image/random').then(r => r.json()); return { url: data.message }; }
  if (path === '/fox') { const data = await fetch('https://randomfox.ca/floof/').then(r => r.json()); return { url: data.image }; }
  if (path === '/tarot') { const cards = ['The Fool','The Magician','The High Priestess','The Empress','The Emperor','The Hierophant','The Lovers','The Chariot','Strength','The Hermit','Wheel of Fortune','Justice','The Hanged Man','Death','Temperance','The Devil','The Tower','The Star','The Moon','The Sun','Judgement','The World']; const card = cards[Math.floor(Math.random()*cards.length)]; const reversed = Math.random() > 0.5; return { card, reversed, position: reversed ? 'Reversed' : 'Upright', emoji: '🃏' }; }
  if (path === '/horoscope') { const sign = url.searchParams.get('sign') || 'aries'; return { sign, note: `Daily horoscope for ${sign}`, checkUrl: `https://www.astrology.com/horoscope/daily/${sign.toLowerCase()}.html` }; }
  throw new Error(`Unknown endpoint: ${path}`);
}

// ============================================================
// HEALTH & SPACE
// ============================================================

async function handleHealth(path, url) {
  if (path === '/bmi') {
    const weight = parseFloat(url.searchParams.get('weight')), height = parseFloat(url.searchParams.get('height')), unit = url.searchParams.get('unit') || 'metric';
    if (!weight || !height) throw new Error('weight and height params required');
    const bmi = unit === 'imperial' ? (weight*703)/(height*height) : weight/((height > 10 ? height/100 : height)**2);
    const category = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal weight' : bmi < 30 ? 'Overweight' : 'Obese';
    return { weight, height, unit, bmi: parseFloat(bmi.toFixed(1)), category };
  }
  if (path === '/calories' || path === '/nutrition') {
    const food = url.searchParams.get('food') || url.searchParams.get('q'); if (!food) throw new Error('food param required');
    const data = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(food)}&pageSize=3&api_key=DEMO_KEY`).then(r => r.json());
    return { food, results: data.foods?.slice(0,3).map(f => ({ name: f.description, calories: f.foodNutrients?.find(n => n.nutrientName === 'Energy')?.value, protein: f.foodNutrients?.find(n => n.nutrientName === 'Protein')?.value, carbs: f.foodNutrients?.find(n => n.nutrientName?.includes('Carbohydrate'))?.value, fat: f.foodNutrients?.find(n => n.nutrientName === 'Total lipid (fat)')?.value, unit: 'per 100g' })) };
  }
  if (path === '/drug') {
    const name = url.searchParams.get('name') || url.searchParams.get('q'); if (!name) throw new Error('name param required');
    const data = await fetch(`https://api.fda.gov/drug/label.json?search=openfda.brand_name:"${name}"&limit=1`).then(r => r.json());
    const result = data.results?.[0]; if (!result) throw new Error('Drug not found');
    return { name, brandName: result.openfda?.brand_name?.[0], genericName: result.openfda?.generic_name?.[0], manufacturer: result.openfda?.manufacturer_name?.[0], purpose: result.purpose?.[0]?.slice(0,200), warnings: result.warnings?.[0]?.slice(0,300) };
  }
  throw new Error(`Unknown endpoint: ${path}`);
}

async function handleSpace(path, url) {
  if (path === '/space/iss' || path === '/space') { const data = await fetch('https://api.wheretheiss.at/v1/satellites/25544').then(r => r.json()); return { name: 'ISS', latitude: data.latitude, longitude: data.longitude, altitude: data.altitude, velocity: data.velocity, visibility: data.visibility }; }
  if (path === '/space/apod') { const data = await fetch('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY').then(r => r.json()); return { date: data.date, title: data.title, explanation: data.explanation?.slice(0,300), url: data.url }; }
  if (path === '/space/launches') { const data = await fetch('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?format=json&limit=5').then(r => r.json()); return { launches: data.results?.map(l => ({ name: l.name, net: l.net, status: l.status?.name, rocket: l.rocket?.configuration?.name, site: l.pad?.name })) }; }
  if (path === '/planets') { return { planets: [{name:'Mercury',distanceFromSun:'57.9M km',diameter:'4,879 km',moons:0},{name:'Venus',distanceFromSun:'108.2M km',diameter:'12,104 km',moons:0},{name:'Earth',distanceFromSun:'149.6M km',diameter:'12,756 km',moons:1},{name:'Mars',distanceFromSun:'227.9M km',diameter:'6,792 km',moons:2},{name:'Jupiter',distanceFromSun:'778.5M km',diameter:'142,984 km',moons:95},{name:'Saturn',distanceFromSun:'1.43B km',diameter:'120,536 km',moons:146},{name:'Uranus',distanceFromSun:'2.87B km',diameter:'51,118 km',moons:28},{name:'Neptune',distanceFromSun:'4.5B km',diameter:'49,528 km',moons:16}] }; }
  if (path === '/asteroids' || path === '/asteroids/today') { const today = new Date().toISOString().split('T')[0]; const data = await fetch(`https://api.nasa.gov/neo/rest/v1/feed?start_date=${today}&end_date=${today}&api_key=DEMO_KEY`).then(r => r.json()); const asteroids = data.near_earth_objects?.[today] || []; return { date: today, count: asteroids.length, asteroids: asteroids.slice(0,5).map(a => ({ name: a.name, hazardous: a.is_potentially_hazardous_asteroid, diameter: a.estimated_diameter?.meters, closeApproach: a.close_approach_data?.[0]?.close_approach_date, missDistance: a.close_approach_data?.[0]?.miss_distance?.kilometers + ' km' })) }; }
  throw new Error(`Unknown endpoint: ${path}`);
}

// ============================================================
// MISC: Social, Music, Travel, Education
// ============================================================

async function handleMisc(path, url) {
  // Social
  if (path === '/reddit') { const sub = url.searchParams.get('name') || url.searchParams.get('sub') || 'technology'; const data = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=10`, { headers: { 'User-Agent': 'DesireAPI/1.0' } }).then(r => r.json()); return { subreddit: sub, posts: data.data?.children?.map(p => ({ title: p.data.title, score: p.data.score, url: p.data.url, comments: p.data.num_comments })) }; }
  if (path === '/github/trending') { const data = await fetch('https://api.github.com/search/repositories?q=stars:>1000&sort=stars&order=desc&per_page=10', { headers: { 'User-Agent': 'DesireAPI' } }).then(r => r.json()); return { trending: data.items?.map(r => ({ name: r.full_name, stars: r.stargazers_count, language: r.language, description: r.description })) }; }
  // Music
  if (path === '/radio') { const country = url.searchParams.get('country') || 'Kenya'; const data = await fetch(`https://de1.api.radio-browser.info/json/stations/bycountry/${encodeURIComponent(country)}?limit=10&order=votes&reverse=true`).then(r => r.json()); return { country, stations: data.slice(0,10).map(s => ({ name: s.name, streamUrl: s.url, genre: s.tags, language: s.language })) }; }
  if (path === '/lyrics') { const song = url.searchParams.get('song') || url.searchParams.get('q'), artist = url.searchParams.get('artist'); if (!song) throw new Error('song param required'); const query = artist ? `${artist} ${song}` : song; const data = await fetch(`https://api.lyrics.ovh/suggest/${encodeURIComponent(query)}`).then(r => r.json()); const track = data.data?.[0]; if (!track) throw new Error('Song not found'); const lyricsData = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(track.artist.name)}/${encodeURIComponent(track.title)}`).then(r => r.json()); return { title: track.title, artist: track.artist.name, lyrics: lyricsData.lyrics?.slice(0,1000) }; }
  // Travel
  if (path === '/airport') { const code = url.searchParams.get('code'); if (!code) throw new Error('code param required'); const airports = { NBO: { name: 'Jomo Kenyatta International', city: 'Nairobi', country: 'Kenya' }, MBA: { name: 'Moi International', city: 'Mombasa', country: 'Kenya' }, LHR: { name: 'Heathrow', city: 'London', country: 'UK' }, JFK: { name: 'John F Kennedy', city: 'New York', country: 'USA' }, DXB: { name: 'Dubai International', city: 'Dubai', country: 'UAE' }, ADD: { name: 'Bole International', city: 'Addis Ababa', country: 'Ethiopia' }, LAX: { name: 'Los Angeles International', city: 'Los Angeles', country: 'USA' } }; return airports[code.toUpperCase()] || { code: code.toUpperCase(), note: 'Airport not in local DB. Check https://ourairports.com' }; }
  if (path === '/shipping') { const carrier = url.searchParams.get('carrier'), tracking = url.searchParams.get('tracking'); if (!carrier || !tracking) throw new Error('carrier and tracking params required'); const urls = { dhl: `https://www.dhl.com/en/express/tracking.html?AWB=${tracking}`, fedex: `https://www.fedex.com/fedextrack/?tracknumbers=${tracking}`, ups: `https://www.ups.com/track?tracknum=${tracking}`, aramex: `https://www.aramex.com/en/track/${tracking}` }; return { carrier, trackingNumber: tracking, trackingUrl: urls[carrier.toLowerCase()] || `Search "${carrier} tracking ${tracking}"` }; }
  // Education
  if (path === '/university') { const name = url.searchParams.get('name') || url.searchParams.get('q'); if (!name) throw new Error('name param required'); const data = await fetch(`http://universities.hipolabs.com/search?name=${encodeURIComponent(name)}`).then(r => r.json()); return { query: name, count: data.length, universities: data.slice(0,10).map(u => ({ name: u.name, country: u.country, webPages: u.web_pages })) }; }
  if (path === '/quiz') { const data = await fetch('https://opentdb.com/api.php?amount=5&type=multiple').then(r => r.json()); return { questions: data.results?.map(q => ({ question: q.question, difficulty: q.difficulty, correct: q.correct_answer, options: [...q.incorrect_answers, q.correct_answer].sort(() => Math.random()-0.5) })) }; }
  if (path === '/course') { const topic = url.searchParams.get('topic') || url.searchParams.get('q'); if (!topic) throw new Error('topic param required'); return { topic, platforms: [{ name: 'Khan Academy', url: `https://www.khanacademy.org/search?page_search_query=${encodeURIComponent(topic)}` }, { name: 'Coursera', url: `https://www.coursera.org/search?query=${encodeURIComponent(topic)}` }, { name: 'YouTube', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(topic+' tutorial')}` }, { name: 'MIT OCW', url: `https://ocw.mit.edu/search/?q=${encodeURIComponent(topic)}` }] }; }
  throw new Error(`Unknown endpoint: ${path}`);
}

// ============================================================
// MAIN ROUTER
// ============================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();

    // CORS preflight
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    // Root - API info
    if (path === '/' || path === '') {
      return success('/', {
        name: 'DesireAPI', version: '1.0.0',
        tagline: 'One key. Everything.',
        auth: 'Pass X-API-Key header or ?apikey= param',
        categories: ['web','location','finance','weather','text','utils','search','security','ai','content','social','music','travel','health','space','education','fun'],
        totalEndpoints: '250+',
        example: `${url.origin}/weather?city=Nairobi&apikey=YOUR_KEY`,
        docs: `${url.origin}/`,
      }, 0);
    }

    // No-auth endpoints
    if (path === '/ping') return success('/ping', { pong: true, ts: Date.now() }, 0);

    // Auth check
    if (!validateKey(request, env)) return fail('Invalid or missing API key. Pass ?apikey= or X-API-Key header.', 401);

    const start = Date.now();
    try {
      let data;
      // Route to correct handler
      if (['/fetch','/scrape','/meta','/links','/images','/headers','/status','/readability','/rss','/sitemap','/robots','/tech','/redirect','/archive','/pagespeed'].includes(path)) {
        data = await handleWeb(path, url, request);
      } else if (['/ip','/myip','/dns','/whois','/geo','/country','/timezone','/distance','/elevation','/isp','/vpn','/port'].includes(path)) {
        data = await handleLocation(path, url, request);
      } else if (['/exchange','/crypto','/crypto/trending','/stocks','/gold','/forex','/inflation','/mpesa','/mpesa/rates'].includes(path)) {
        data = await handleFinance(path, url);
      } else if (['/weather','/airquality','/uv','/sunrise','/moon','/earthquake','/storm','/wildfires','/floods'].includes(path)) {
        data = await handleWeather(path, url);
      } else if (['/translate','/detect','/sentiment','/grammar','/readinglevel','/keywords','/define','/synonym','/antonym','/rhyme','/pronounce','/emoji'].includes(path)) {
        data = await handleText(path, url);
      } else if (['/qr','/hash','/encode','/decode','/uuid','/uuid/v5','/password','/time','/timestamp','/cron','/regex','/color','/markdown','/diff','/useragent'].includes(path)) {
        data = await handleUtils(path, url, request);
      } else if (['/search','/wiki','/wiki/random','/npm','/pypi','/github','/scholar','/hackernews','/hackernews/top'].includes(path)) {
        data = await handleSearch(path, url);
      } else if (['/validate/email','/validate/url','/validate/phone','/validate/iban','/ssl','/malware','/spam','/hosting','/breach','/email/disposable'].includes(path)) {
        data = await handleSecurity(path, url);
      } else if (path.startsWith('/ai')) {
        data = await handleAI(path, url);
      } else if (['/news','/movie','/book','/anime','/game','/recipe','/joke','/quote','/meme','/gif','/lyrics','/youtube'].includes(path)) {
        data = await handleContent(path, url);
      } else if (['/bmi','/calories','/nutrition','/drug'].includes(path)) {
        data = await handleHealth(path, url);
      } else if (path.startsWith('/space') || ['/planets','/asteroids','/asteroids/today'].includes(path)) {
        data = await handleSpace(path, url);
      } else if (['/coinflip','/dice','/8ball','/random/number','/random/color','/random/name','/random/fact','/fact','/advice','/affirmation','/cat','/dog','/fox','/tarot','/horoscope'].includes(path)) {
        data = await handleFun(path, url);
      } else if (['/reddit','/github/trending','/radio','/lyrics','/airport','/shipping','/university','/quiz','/course'].includes(path)) {
        data = await handleMisc(path, url);
      } else {
        return fail(`Unknown endpoint: ${path}. Visit ${url.origin}/ for all available endpoints.`, 404);
      }
      return success(path, data, Date.now() - start);
    } catch (e) {
      return fail(e.message, 500);
    }
  }
};
