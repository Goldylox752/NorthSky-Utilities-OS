(function(global) {
  'use strict';

  // ================= CONFIGURATION =================
  const CONFIG = {
    // Your backend API base URL (without trailing slash)
    apiBase: 'https://your-api.com',        // ← UPDATE THIS
    // Endpoint paths
    eventPath: '/api/event',
    hotLeadPath: '/hot-lead',               // adjust if your backend uses different
    // Scoring weights for different event types
    weights: {
      page_view: 1,
      click: 3,
      funnel: 8,
      checkout: 20,
      lead: 10
    },
    // Score threshold to trigger hot lead action
    hotScoreThreshold: 15,
    // Where to redirect when hot lead threshold is reached
    hotRedirectUrl: '/skymaster-offer.html',
    // Batch settings
    batchMaxSize: 5,        // send batch when queue reaches this size
    batchMaxWaitMs: 3000,   // or after this many milliseconds
    // Retry settings
    maxRetries: 3,
    retryBackoffMs: 1000,
    // Debounce click tracking (ms)
    clickDebounceMs: 500
  };

  // Allow overriding configuration via window.NorthSkyConfig before this script loads
  if (global.NorthSkyConfig) {
    Object.assign(CONFIG, global.NorthSkyConfig);
  }

  // ================= HELPER: Storage with fallback =================
  const storage = (function() {
    try {
      const test = '__northsky_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return localStorage;
    } catch (e) {
      // In-memory fallback if localStorage is disabled
      const memory = new Map();
      return {
        getItem: (k) => memory.get(k) || null,
        setItem: (k, v) => memory.set(k, v),
        removeItem: (k) => memory.delete(k)
      };
    }
  })();

  function getOrCreateId(key) {
    let id = storage.getItem(key);
    if (!id) {
      // Use crypto.randomUUID if available, else fallback to timestamp+random
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        id = crypto.randomUUID();
      } else {
        id = Date.now() + '-' + Math.random().toString(36).substring(2);
      }
      storage.setItem(key, id);
    }
    return id;
  }

  // ================= SESSION & USER IDS =================
  const sessionId = getOrCreateId('ns_session_id');
  const userId = getOrCreateId('ns_user_id');

  // ================= SCORE MANAGEMENT =================
  function getScore() {
    const val = storage.getItem('ns_score');
    return val !== null ? Number(val) : 0;
  }

  function setScore(newScore) {
    storage.setItem('ns_score', String(newScore));
    return newScore;
  }

  // ================= EVENT QUEUE & BATCHING =================
  let eventQueue = [];
  let batchTimer = null;

  function flushQueue() {
    if (eventQueue.length === 0) return;
    const eventsToSend = [...eventQueue];
    eventQueue = [];

    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }

    sendEvents(eventsToSend);
  }

  function queueEvent(eventData) {
    eventQueue.push(eventData);
    if (eventQueue.length >= CONFIG.batchMaxSize) {
      flushQueue();
    } else if (!batchTimer) {
      batchTimer = setTimeout(flushQueue, CONFIG.batchMaxWaitMs);
    }
  }

  // ================= RETRYABLE FETCH WITH OFFLINE QUEUE =================
  let pendingRetries = [];

  async function sendWithRetry(url, payload, retriesLeft = CONFIG.maxRetries) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch (err) {
      if (retriesLeft > 0 && navigator.onLine !== false) {
        const delay = CONFIG.retryBackoffMs * (CONFIG.maxRetries - retriesLeft + 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        return sendWithRetry(url, payload, retriesLeft - 1);
      } else {
        // Store in offline queue
        const offlineQueue = JSON.parse(storage.getItem('ns_offline_queue') || '[]');
        offlineQueue.push({ url, payload, timestamp: Date.now() });
        storage.setItem('ns_offline_queue', JSON.stringify(offlineQueue));
        console.warn('[NorthSky] Event saved for later (offline/retry failed)', payload);
        return false;
      }
    }
  }

  // Process offline queue when back online
  function processOfflineQueue() {
    const raw = storage.getItem('ns_offline_queue');
    if (!raw) return;
    const queue = JSON.parse(raw);
    if (queue.length === 0) return;
    storage.setItem('ns_offline_queue', '[]');
    for (const item of queue) {
      sendWithRetry(item.url, item.payload, 1).catch(e => console.error);
    }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', processOfflineQueue);
  }

  // ================= SEND EVENTS (BATCH OR SINGLE) =================
  async function sendEvents(events) {
    if (!events.length) return;
    const url = CONFIG.apiBase + CONFIG.eventPath;
    // If only one event, send as object; otherwise send array
    const payload = events.length === 1 ? events[0] : events;
    await sendWithRetry(url, payload);
  }

  // ================= TRACKING CORE =================
  let hotLeadTriggered = false;  // prevent multiple redirects

  async function track(eventType, customData = {}) {
    const weight = CONFIG.weights[eventType] || 0;
    let currentScore = getScore();
    const newScore = currentScore + weight;
    setScore(newScore);

    const eventPayload = {
      event: eventType,
      data: customData,
      user_id: userId,
      session_id: sessionId,
      score: newScore,
      url: window.location.href,
      time: new Date().toISOString()
    };

    queueEvent(eventPayload);

    // Hot lead detection
    if (!hotLeadTriggered && newScore >= CONFIG.hotScoreThreshold) {
      hotLeadTriggered = true;
      triggerHotLead(newScore);
    }
  }

  async function triggerHotLead(score) {
    try {
      // Notify backend about hot lead
      const hotUrl = CONFIG.apiBase + CONFIG.hotLeadPath;
      await sendWithRetry(hotUrl, {
        user_id: userId,
        session_id: sessionId,
        score: score,
        url: window.location.href
      }, 1); // one retry only, don't block redirect
    } catch (e) {
      // ignore error – still proceed with redirect
    }
    // Redirect to offer page
    if (CONFIG.hotRedirectUrl) {
      window.location.href = CONFIG.hotRedirectUrl;
    }
  }

  // ================= CLICK DEBOUNCE =================
  let lastClickTime = 0;
  let lastClickTargetKey = '';

  function handleClick(event) {
    const el = event.target.closest('a, button');
    if (!el) return;

    const now = Date.now();
    // Generate a simple key for the element to debounce rapid clicks on same element
    const targetKey = el.tagName + (el.href || '') + (el.innerText || '');
    if (now - lastClickTime < CONFIG.clickDebounceMs && targetKey === lastClickTargetKey) {
      return;
    }
    lastClickTime = now;
    lastClickTargetKey = targetKey;

    track('click', {
      text: el.innerText?.substring(0, 200),
      href: el.href || null,
      tag: el.tagName
    });
  }

  // ================= PAGE VIEW ON LOAD =================
  function init() {
    document.addEventListener('click', handleClick);
    track('page_view');
    // Process any offline queue from previous session
    processOfflineQueue();
  }

  // ================= EXPOSE PUBLIC API =================
  const NorthSky = {
    track,
    getScore,
    config: CONFIG   // readonly access (optional)
  };

  // Attach to global window
  global.NorthSky = NorthSky;

  // Auto‑init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);