'use strict';
// Autoblow Ultra, through Autoblow's own API. Beta: not verified on real hardware yet.
// panel.html uses this as window.AutoblowDevice.

const LATENCY_ORIGIN = 'https://latency.autoblowapi.com';

// where the device token may go: the latency host above and these clusters
const CLUSTERS = new Set([
  'us-east-1.autoblowapi.com',
  'us-east-2.autoblowapi.com',
  'us-west-1.autoblowapi.com',
  'us-west-2.autoblowapi.com',
  'ca-central-1.autoblowapi.com',
  'ap-southeast-2.autoblowapi.com',
  'eu-west-2.autoblowapi.com',
  'eu-central-1.autoblowapi.com',
]);

const MAX_ACTIONS = 100_000;
const MAX_AT = 16_777_214;

const IDLE = [
  'ONLINE_CONNECTED',
  'REST_AT_TOP',
  'SYNC_SCRIPT_PAUSED',
  'LOCAL_SCRIPT_PAUSED',
  'OSCILLATOR_PAUSED',
];

function autoblowError(message, details) {
  return Object.assign(new Error(message), details);
}

function isAutoblowOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:' || url.origin !== origin) return false;
  if (url.pathname !== '/' || url.search || url.hash) return false;

  return origin === LATENCY_ORIGIN || CLUSTERS.has(url.hostname);
}

// Autoblow names the cluster either as a bare host or as its https origin.
function autoblowClusterOrigin(named) {
  let url;
  try {
    url = new URL(named.startsWith('https://') ? named : `https://${named}`);
  } catch {
    throw new Error('Autoblow returned an invalid cluster.');
  }

  const bareOrigin = url.protocol === 'https:'
    && url.pathname === '/'
    && !url.search
    && !url.hash
    && url.origin === `https://${url.hostname}`;
  const writtenPlainly = [url.hostname, url.origin, `${url.origin}/`].includes(named);

  if (!bareOrigin || !writtenPlainly || !CLUSTERS.has(url.hostname)) {
    throw new Error('Autoblow returned an unsupported cluster.');
  }
  return url.origin;
}

class AutoblowDevice {
  constructor(token, request) {
    if (typeof token !== 'string' || !token.trim() || token.length > 512 || /[\u0000-\u001f\u007f]/.test(token)) {
      throw new Error('Enter your Autoblow device token.');
    }

    this.token = token.trim();
    this.request = request;
    this.cluster = null;
    this.connected = false;
    this.ready = false;
  }

  async call(origin, path, { method = 'GET', body, timeout = 6000 } = {}, signal) {
    if (!isAutoblowOrigin(origin)) throw new Error('Autoblow cluster is not allowed.');

    const headers = { 'x-device-token': this.token };
    const options = {
      method,
      headers,
      credentials: 'omit',
      redirect: 'error',
    };

    if (body instanceof FormData) {
      options.body = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    let result;
    try {
      result = await this.request(`${origin}${path}`, options, signal, timeout);
    } catch {
      if (signal && signal.aborted) throw autoblowError('Autoblow request cancelled.', { cancelled: true });
      throw autoblowError('Autoblow is unavailable.', { service: 'unavailable' });
    }

    const { res, data } = result;
    if (!res.ok) {
      const status = res.status;
      if (status === 401 || status === 403) throw autoblowError('Autoblow denied access.', { service: 'access', status });
      if (status === 429) throw autoblowError('Autoblow is busy. Retry in a minute.', { service: 'busy', status });
      if (status >= 500) throw autoblowError('Autoblow is unavailable.', { service: 'unavailable', status });
      throw autoblowError(`Autoblow request failed (${status}).`, { status });
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Autoblow returned an invalid response.');
    }
    return data;
  }

  async command(path, body, signal) {
    if (!this.connected || !this.cluster) throw new Error('Connect Autoblow first.');
    return this.call(this.cluster, path, { method: 'PUT', body }, signal);
  }

  safeState(data, expected) {
    const mode = data.operationalMode;
    if (typeof mode !== 'string' || !expected.includes(mode)) {
      throw new Error(`Autoblow is in an unexpected state (${String(mode).slice(0, 40)}).`);
    }
    return data;
  }

  async stopActiveMode(origin, state, signal) {
    const stopPaths = {
      SYNC_SCRIPT_PLAYING: ['/autoblow/sync-script/stop', 'SYNC_SCRIPT_PAUSED'],
      LOCAL_SCRIPT_PLAYING: ['/autoblow/local-script/stop', 'LOCAL_SCRIPT_PAUSED'],
      OSCILLATOR_PLAYING: ['/autoblow/oscillate/stop', 'OSCILLATOR_PAUSED'],
    };
    const mode = state.operationalMode;

    if (stopPaths[mode]) {
      const [path, paused] = stopPaths[mode];
      const stopped = await this.call(origin, path, { method: 'PUT' }, signal);
      return this.safeState(stopped, [paused]);
    }

    if (IDLE.includes(mode)) return state;
    throw new Error('Autoblow is busy with something else. Stop it in the Autoblow app first.');
  }

  async connect(signal) {
    this.connected = false;
    this.ready = false;
    this.cluster = null;

    const found = await this.call(LATENCY_ORIGIN, '/autoblow/connected', {}, signal);
    if (found.connected !== true) throw new Error('Autoblow is offline.');
    if (found.deviceType !== 'autoblow-ultra') throw new Error('Works with the Autoblow Ultra only.');
    if (typeof found.cluster !== 'string') throw new Error('Autoblow returned an invalid cluster.');

    const origin = autoblowClusterOrigin(found.cluster);
    let state = await this.call(origin, '/autoblow/state', {}, signal);
    state = await this.stopActiveMode(origin, state, signal);

    this.cluster = origin;
    this.connected = true;

    try {
      // the panel does the offset itself, so the device's own has to be 0
      state = await this.command('/autoblow/sync-script/offset', { offsetTimeMs: 0 }, signal);
      this.safeState(state, IDLE);

      if (state.syncScriptToken) {
        state = await this.command('/autoblow/sync-script/loop', { loop: false }, signal);
        this.safeState(state, IDLE);
        if (state.syncScriptLoop !== false) throw new Error('Autoblow didn’t turn looping off.');
      }

      if (state.syncScriptOffsetTime !== 0) throw new Error('Autoblow didn’t reset its timing offset.');
      return state;
    } catch (error) {
      this.connected = false;
      this.cluster = null;
      throw error;
    }
  }

  async prepare(funscript, signal) {
    if (!this.connected) throw new Error('Connect Autoblow first.');

    const actions = funscript && funscript.actions;
    if (!Array.isArray(actions) || actions.length === 0 || actions.length > MAX_ACTIONS) {
      throw new Error('Script needs 1 to 100,000 actions.');
    }

    let previous = -1;
    for (const action of actions) {
      const timeOk = action
        && Number.isSafeInteger(action.at)
        && action.at >= 0
        && action.at <= MAX_AT
        && action.at >= previous;
      const posOk = timeOk && Number.isFinite(action.pos) && action.pos >= 0 && action.pos <= 100;

      if (!posOk) throw new Error('Script actions aren’t sorted or have bad values.');
      previous = action.at;
    }

    const file = new Blob([JSON.stringify({ actions })], { type: 'application/json' });
    const form = new FormData();
    form.append('file', file, 'script.funscript');

    // uploads get a lot longer than the usual 6 s
    const upload = { method: 'PUT', body: form, timeout: 65_000 };
    const data = await this.call(this.cluster, '/autoblow/sync-script/upload-funscript', upload, signal);
    this.safeState(data, ['SYNC_SCRIPT_PAUSED']);
    if (typeof data.syncScriptToken !== 'string' || !data.syncScriptToken) {
      throw new Error('Autoblow didn’t take the script.');
    }

    const paused = await this.command('/autoblow/sync-script/loop', { loop: false }, signal);
    this.safeState(paused, ['SYNC_SCRIPT_PAUSED']);
    if (paused.syncScriptLoop !== false) throw new Error('Autoblow didn’t turn looping off.');

    this.ready = true;
    return data;
  }

  async play(startMs, signal) {
    if (!this.connected || !this.ready) throw new Error('Load a script before playing.');
    if (!Number.isSafeInteger(startMs) || startMs < 0) throw new Error('Bad start time.');

    const state = await this.command('/autoblow/sync-script/start', { startTimeMs: startMs }, signal);
    return this.safeState(state, ['SYNC_SCRIPT_PLAYING']);
  }

  async stop(signal) {
    if (!this.connected || !this.cluster) throw new Error('Connect Autoblow first.');

    const state = await this.call(this.cluster, '/autoblow/state', {}, signal);
    return this.stopActiveMode(this.cluster, state, signal);
  }
}

globalThis.AutoblowDevice = AutoblowDevice;
