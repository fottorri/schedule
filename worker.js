// FOTORO 예약 스케줄 관리 - Cloudflare Worker
// - "/"와 기타 정적 파일: public/ 폴더 그대로 서빙 (Static Assets)
// - "/api/data" GET: KV에 저장된 예약 데이터를 반환
// - "/api/data" PUT: 관리자(Google 로그인)만 KV에 데이터 저장 가능

var ADMIN_EMAIL = 'doiry92@gmail.com';
var GOOGLE_CLIENT_ID = '240115668485-9fem1jvpv98svus152m49a2qr8954mgf.apps.googleusercontent.com';
var KV_KEY = 'app-data';

export default {
  async fetch(request, env) {
    var url = new URL(request.url);

    if (url.pathname === '/api/data') {
      if (request.method === 'GET') {
        return handleGet(env);
      }
      if (request.method === 'PUT') {
        return handlePut(request, env);
      }
      return new Response('Method not allowed', { status: 405 });
    }

    // 그 외 요청은 전부 정적 파일(public/index.html 등)로 위임
    return env.ASSETS.fetch(request);
  }
};

async function handleGet(env) {
  try {
    var data = await env.BOOKINGS_KV.get(KV_KEY, 'json');
    return new Response(JSON.stringify(data || {}), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'kv_read_failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handlePut(request, env) {
  var authHeader = request.headers.get('Authorization') || '';
  var idToken = authHeader.replace(/^Bearer\s+/i, '');
  var email = await verifyGoogleIdToken(idToken);

  if (!email || email !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    await env.BOOKINGS_KV.put(KV_KEY, JSON.stringify(body));
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'kv_write_failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Google이 발급한 ID 토큰을 구글 서버에 직접 검증 요청 (서명/만료/대상(aud) 확인)
async function verifyGoogleIdToken(idToken) {
  if (!idToken) return null;
  try {
    var res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
    if (!res.ok) return null;
    var info = await res.json();

    if (info.aud !== GOOGLE_CLIENT_ID) return null;
    if (info.email_verified !== 'true' && info.email_verified !== true) return null;

    var now = Math.floor(Date.now() / 1000);
    if (info.exp && parseInt(info.exp, 10) < now) return null;

    return info.email;
  } catch (e) {
    return null;
  }
}
