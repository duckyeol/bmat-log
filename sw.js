// B-MAT LOG Service Worker
// 전략: Network First (네트워크 우선, 실패 시 캐시 사용)

const CACHE_VERSION = 'bmat-log-v1';
const CACHE_NAME = `bmat-cache-${CACHE_VERSION}`;

// 앱 셸 (필수 정적 리소스)
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/favicon-32.png'
];

// 설치 시: 앱 셸 캐싱
self.addEventListener('install', (event) => {
  console.log('[SW] Install:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching app shell');
        // 개별 추가 시 실패해도 다른 건 캐싱되도록
        return Promise.allSettled(
          APP_SHELL.map(url => 
            cache.add(url).catch(err => console.warn('[SW] Cache add failed:', url, err))
          )
        );
      })
      .then(() => self.skipWaiting()) // 즉시 활성화
  );
});

// 활성화 시: 옛날 캐시 삭제
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate:', CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter(name => name.startsWith('bmat-') && name !== CACHE_NAME)
            .map(name => {
              console.log('[SW] Delete old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim()) // 모든 탭 즉시 제어
  );
});

// Fetch 핸들러: Network First 전략
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // GET 요청만 처리
  if (request.method !== 'GET') return;
  
  // chrome-extension 등 비정상 스킴 무시
  if (!url.protocol.startsWith('http')) return;
  
  // Firebase / Google API 요청은 캐시하지 않음 (실시간 데이터 + Auth 토큰 등)
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('google.com') ||
      url.hostname.includes('gstatic.com') ||
      url.hostname.includes('firebasestorage.app') ||
      url.hostname.includes('cloudfunctions.net') ||
      url.hostname.includes('firebaseapp.com')) {
    // 그냥 네트워크로 통과
    return;
  }
  
  // index.html 같은 HTML: Network First, 실패 시 캐시
  if (request.mode === 'navigate' || 
      request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          // 응답이 정상이면 캐시 갱신
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseClone).catch(() => {});
            });
          }
          return response;
        })
        .catch(() => {
          // 네트워크 실패 → 캐시
          return caches.match(request).then(cached => {
            return cached || caches.match('./index.html') || caches.match('./');
          });
        })
    );
    return;
  }
  
  // 정적 리소스 (이미지, 아이콘 등): Cache First, 없으면 네트워크
  if (url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf)$/i) ||
      url.pathname.includes('/icons/')) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseClone).catch(() => {});
            });
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }
  
  // 그 외: Network First
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok && url.origin === self.location.origin) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseClone).catch(() => {});
          });
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// 메시지 핸들러: 수동 캐시 클리어 등
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(names => {
      names.forEach(name => caches.delete(name));
    });
  }
});
