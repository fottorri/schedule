// FOTORO 예약 스케줄 관리 - Cloudflare Worker
// - "/"와 기타 정적 파일: public/ 폴더 그대로 서빙 (Static Assets)
// - "/api/data" GET: KV에 저장된 예약 데이터를 반환
// - "/api/data" PUT: 관리자(Google 로그인)만 KV에 데이터 저장 가능
// - "/mcp" POST: Claude가 예약을 조회/등록/수정/삭제할 수 있는 MCP 서버

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

    if (url.pathname === '/mcp') {
      if (request.method === 'POST') {
        return handleMcp(request, env);
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

/* ================================================================== */
/* MCP 서버 — Claude가 예약을 조회/등록/수정/삭제하는 도구             */
/* ================================================================== */

var TOOLS = [
  {
    name: 'list_bookings',
    description: 'FOTORO 예약 목록을 조회합니다. month를 지정하면 그 달만, 지정하지 않으면 전체를 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: '조회할 연월, 형식 YYYY-MM (예: 2026-09). 생략하면 전체 예약을 반환합니다.' }
      }
    }
  },
  {
    name: 'add_booking',
    description: '새 예약을 등록합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '촬영일, YYYY-MM-DD 형식' },
        name: { type: 'string', description: '예약자명' },
        city: { type: 'string', description: '도시 (florence/tuscany/dolomites 등)' },
        product: { type: 'string', description: '예약 상품 (예: 노을 3, 새벽 3 등)' },
        addon: { type: 'string', description: '패키지 종류 (없음/헤메단품/드레스)' },
        meetingPlace: { type: 'string', description: '미팅장소' },
        timeStart: { type: 'string', description: '촬영 시작시간, HH:MM (24시간제)' },
        timeEnd: { type: 'string', description: '촬영 종료시간, HH:MM (24시간제)' },
        deposit: { type: 'number', description: '예약금(원)' },
        balance: { type: 'number', description: '잔금(유로)' },
        packageWon: { type: 'number', description: '패키지 금액(원)' },
        note: { type: 'string', description: '비고' }
      },
      required: ['date', 'name']
    }
  },
  {
    name: 'update_booking',
    description: '기존 예약을 수정합니다. id로 대상을 지정하고, 바꿀 필드만 넘기면 됩니다.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '수정할 예약의 id (list_bookings 결과에서 확인 가능)' },
        date: { type: 'string' },
        name: { type: 'string' },
        city: { type: 'string' },
        product: { type: 'string' },
        addon: { type: 'string' },
        meetingPlace: { type: 'string' },
        timeStart: { type: 'string' },
        timeEnd: { type: 'string' },
        deposit: { type: 'number' },
        balance: { type: 'number' },
        packageWon: { type: 'number' },
        note: { type: 'string' }
      },
      required: ['id']
    }
  },
  {
    name: 'delete_booking',
    description: '예약을 삭제합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '삭제할 예약의 id' }
      },
      required: ['id']
    }
  },
  {
    name: 'get_summary',
    description: '특정 달(또는 전체)의 예약 건수와 예약금/잔금/패키지/완납 합계를 계산해서 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: '집계할 연월, 형식 YYYY-MM. 생략하면 전체 기간을 집계합니다.' }
      }
    }
  }
];

async function handleMcp(request, env) {
  var body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonRpcError(null, -32700, 'Parse error');
  }

  var id = body.id !== undefined ? body.id : null;
  var method = body.method;
  var params = body.params || {};

  try {
    if (method === 'initialize') {
      return jsonRpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fotoro-schedule', version: '1.0.0' }
      });
    }

    if (method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }

    if (method === 'tools/list') {
      return jsonRpcResult(id, { tools: TOOLS });
    }

    if (method === 'tools/call') {
      var toolName = params.name;
      var args = params.arguments || {};
      var resultText = await callTool(toolName, args, env);
      return jsonRpcResult(id, {
        content: [{ type: 'text', text: resultText }]
      });
    }

    return jsonRpcError(id, -32601, 'Method not found');
  } catch (e) {
    return jsonRpcError(id, -32603, 'Internal error: ' + e.message);
  }
}

function jsonRpcResult(id, result) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: id, result: result }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
function jsonRpcError(id, code, message) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: id, error: { code: code, message: message } }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function loadAppData(env) {
  var data = await env.BOOKINGS_KV.get(KV_KEY, 'json');
  if (!data || typeof data !== 'object') data = {};
  if (!Array.isArray(data.bookings)) data.bookings = [];
  if (typeof data.rate !== 'number') data.rate = 1400;
  if (!Array.isArray(data.blockedPeriods)) data.blockedPeriods = [];
  if (!data.excludedMonths || typeof data.excludedMonths !== 'object') data.excludedMonths = {};
  return data;
}

async function saveAppData(env, data) {
  await env.BOOKINGS_KV.put(KV_KEY, JSON.stringify(data));
}

function genId() {
  return 'b_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

async function callTool(name, args, env) {
  var data = await loadAppData(env);

  if (name === 'list_bookings') {
    var list = data.bookings;
    if (args.month) {
      list = list.filter(function (b) { return b.date && b.date.slice(0, 7) === args.month; });
    }
    list = list.slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    return JSON.stringify(list, null, 2);
  }

  if (name === 'add_booking') {
    var booking = Object.assign({ id: genId() }, args);
    data.bookings.push(booking);
    await saveAppData(env, data);
    return '예약이 등록되었어요. id: ' + booking.id + '\n' + JSON.stringify(booking, null, 2);
  }

  if (name === 'update_booking') {
    var idx = data.bookings.findIndex(function (b) { return b.id === args.id; });
    if (idx === -1) return '해당 id의 예약을 찾을 수 없어요: ' + args.id;
    var fields = Object.assign({}, args);
    delete fields.id;
    data.bookings[idx] = Object.assign({}, data.bookings[idx], fields);
    await saveAppData(env, data);
    return '예약이 수정되었어요.\n' + JSON.stringify(data.bookings[idx], null, 2);
  }

  if (name === 'delete_booking') {
    var before = data.bookings.length;
    data.bookings = data.bookings.filter(function (b) { return b.id !== args.id; });
    if (data.bookings.length === before) return '해당 id의 예약을 찾을 수 없어요: ' + args.id;
    await saveAppData(env, data);
    return '예약이 삭제되었어요. id: ' + args.id;
  }

  if (name === 'get_summary') {
    var target = data.bookings;
    if (args.month) {
      target = target.filter(function (b) { return b.date && b.date.slice(0, 7) === args.month; });
    }
    var sum = { count: target.length, deposit: 0, balance: 0, packageWon: 0, completed: 0 };
    target.forEach(function (b) {
      sum.deposit += Number(b.deposit) || 0;
      sum.balance += Number(b.balance) || 0;
      sum.packageWon += Number(b.packageWon) || 0;
      sum.completed += Number(b.completed) || 0;
    });
    return JSON.stringify(sum, null, 2);
  }

  return '알 수 없는 도구예요: ' + name;
}
