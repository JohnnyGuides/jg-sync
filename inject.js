// JG Sync bookmarklet: this is the entirety of what runs on the video page.
(() => {
  'use strict';

  if (window.__jgSync) {
    window.__jgSync.show();
    return;
  }

  const PANEL_ORIGIN = 'https://johnnyguides.com';
  const PROTOCOL = 1;

  const touch = matchMedia('(pointer:coarse)').matches && innerWidth < 950;
  const viewportWidth = () => window.visualViewport?.width || innerWidth;

  // On a phone: bottom right of what's visible (less than the window when zoomed in or typing).
  const placeTouch = () => {
    if (!touch) return;

    if (frame.offsetHeight > roomHeight()) frame.style.height = roomHeight() + 'px';
    if (frame.offsetWidth > viewportWidth() - 12) frame.style.width = viewportWidth() - 12 + 'px';

    const viewport = window.visualViewport;
    const hiddenRight = innerWidth - viewportWidth() - (viewport?.offsetLeft || 0);
    const hiddenBelow = innerHeight - (viewport?.height || innerHeight) - (viewport?.offsetTop || 0);

    // A closed pill sits above the player's control bar (volume, fullscreen, menu) when that
    // bar is near the bottom of the screen, so it never covers them.
    let lift = 0;
    if (video && !panelOpen) {
      const player = video.getBoundingClientRect();
      const visibleBottom = innerHeight - Math.max(0, hiddenBelow);
      const controlsTop = player.bottom - 56;
      if (player.bottom > visibleBottom - 60 && controlsTop < visibleBottom && controlsTop > 0) {
        lift = visibleBottom - controlsTop;
      }
    }

    frame.style.top = 'auto';
    frame.style.right = Math.max(6, hiddenRight + 6) + 'px';
    frame.style.bottom = lift
      ? Math.max(0, hiddenBelow) + lift + 6 + 'px'
      : `calc(${Math.max(0, hiddenBelow)}px + max(12px, env(safe-area-inset-bottom)))`;
  };

  const frame = document.createElement('iframe');
  // The run id lets the panel remember its Pause when moving the frame reloads it.
  frame.src = PANEL_ORIGIN + '/sync/panel#run=' + Math.random().toString(36).slice(2, 12);
  frame.title = 'Johnny Guides sync';
  frame.allow = 'clipboard-write';
  frame.setAttribute('allowtransparency', 'true');

  // Until a video plays the panel floats in the top right corner, below the site's sticky
  // header if there is one (avatar, menus).
  const floatTop = () => {
    for (const el of document.elementsFromPoint(innerWidth - 60, 8)) {
      if (el === frame || el === document.body || el === document.documentElement) continue;

      for (let ancestor = el; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const position = getComputedStyle(ancestor).position;
        if (position !== 'fixed' && position !== 'sticky') continue;

        const bottom = ancestor.getBoundingClientRect().bottom;
        if (bottom > 0 && bottom < 160) return Math.round(bottom) + 8;
      }
    }
    return 6;
  };
  let floatingTop = floatTop();

  Object.assign(frame.style, {
    position: 'fixed',
    top: floatingTop + 'px',
    right: '6px',
    width: '200px',
    height: '40px',
    border: '0',
    margin: '0',
    padding: '0',
    background: 'transparent',
    colorScheme: 'normal',
    zIndex: '2147483646',
    transition: 'opacity .25s',
  });
  if (touch) {
    frame.style.top = 'auto';
    frame.style.bottom = 'max(12px, env(safe-area-inset-bottom))';
  }

  // The video being synced, and the element around it that the panel sits in.
  let video = null;
  let box = null;

  let panelReady = false;
  let panelOpen = false;
  let panelHovered = false;
  let pillShown = true;

  let lastMove = 0;
  const wake = () => { lastMove = Date.now(); };

  const MEDIA_EVENTS = [
    'play', 'playing', 'pause', 'seeking', 'seeked', 'waiting',
    'ratechange', 'ended', 'timeupdate', 'emptied', 'error',
  ];

  // Where the ids come from:
  //   OnlyFans   player class "video-<media>-<post>-dimensions", or the post link /<id>/<user>
  //   Fansly     data-media-id, and the post link /post/<id>
  //   ManyVids   /Video/<id>
  //   Pornhub    ?viewkey=
  //   JohnnyGuides.com    /watch/<slug>
  // In a feed it's the one post link around the player, on a post's own page the URL.
  const POST_LINK = /^\/(?:post\/(\d+)|(\d+)\/[^/]+\/?)$/;

  // Walks up from an element to the single post link around it. Once a container holds a
  // second video or a second post, we are out of the post and in the feed.
  const postAround = (start) => {
    let el = start;

    for (let depth = 0; el && el !== document.body && depth < 14; depth++) {
      if (hasMultipleVideos(el)) break;

      const ids = postIds(el);
      if (ids.size > 1) break;
      if (ids.size === 1) return [...ids][0];

      el = el.parentElement;
    }
    return null;
  };

  // don't cache this. feeds reuse the same <video> for other posts and links show up late
  const linkedPost = (v) => postAround(v.parentElement);

  // Fansly's media viewer has no post link at all. Take the post that was clicked to open it
  // (within a minute) and keep it for as long as the same source plays.
  let clicked = null;
  let viewed = null;

  // When the viewer last clicked or pressed a key. A play right after that is theirs
  // and not autoplay.
  let lastInput = 0;

  const onPointerDown = (e) => {
    lastInput = Date.now();

    const id = e.target instanceof Element && postAround(e.target);
    if (id) clicked = { id, at: Date.now() };
  };

  const onKeyDown = () => {
    lastInput = Date.now();
  };

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);

  const viewerPost = (v) => {
    if (viewed && viewed.v === v && viewed.src === v.currentSrc) return viewed.id;

    if (v !== video || !clicked || Date.now() - clicked.at >= 60000) return null;
    if (!v.closest('[class*="modal"]')) return null;

    viewed = { v, src: v.currentSrc, id: clicked.id };
    clicked = null;
    return viewed.id;
  };

  const idsOf = (v) => {
    const player = v && v.closest('.video-js');
    const inClass = /(?:^|\s)video-(\d+)-(\d+)-dimensions(?:\s|$)/.exec(player && player.className || '');
    if (inClass) return { mediaId: inClass[1], postId: inClass[2] };

    // Fansly: the media id is on every attachment, the post id comes from the links around it
    const attachment = v && v.closest('[data-media-id]');
    const attachmentId = attachment ? attachment.getAttribute('data-media-id') : '';
    const mediaId = /^\d+$/.test(attachmentId) ? attachmentId : null;

    const linked = v && (linkedPost(v) || viewerPost(v));
    if (linked) return { mediaId, postId: linked };

    const path = location.pathname;
    const inPath = (pattern) => (pattern.exec(path) || [])[1];
    const postId = inPath(/\/post\/(\d+)/)
      || inPath(/^\/Video\/(\d+)/i)
      || new URLSearchParams(location.search).get('viewkey')
      || inPath(/^\/watch\/([a-z0-9_-]+)/i)
      || inPath(/^\/(\d+)\/[^/]+\/?$/);

    return { mediaId, postId: postId || null };
  };

  const inPlayer = () => box && frame.parentNode === box;

  // Height the panel has inside the player, which leaves about 64px at the bottom for the
  // seek bar and buttons.
  const playerRoom = () => box.clientHeight - 6 - 64;

  // The open card is often taller than the player. Then the frame goes into the browser's top
  // layer, where it can hang out below the player without anything on the page clipping it.
  const canPopOut = !touch && 'popover' in frame;
  const poppedOut = () => frame.matches(':popover-open');

  // Height the panel can have: the window's when the frame can pop out, else the player's.
  // In fullscreen it stays inside the player.
  const roomHeight = () => {
    let height = innerHeight - floatingTop - 12;
    if (touch) height = (visualViewport?.height || innerHeight) - 90;
    else if (inPlayer() && canPopOut && !document.fullscreenElement) height = Math.max(height, playerRoom());
    else if (inPlayer()) height = playerRoom();

    return Math.max(40, Math.round(height));
  };

  // How far the frame sits from the player's right edge. dodge() moves it.
  let inset = 6;

  // Puts the frame in the player's top right corner. Popped out it is placed against the
  // page instead, on that same corner, so it still scrolls along with the player.
  const placeFrame = () => {
    if (touch || !inPlayer()) return;

    const tooTall = frame.offsetHeight > playerRoom();

    // Once out it stays out until the card closes, so it doesn't flip while the card changes height.
    const out = canPopOut && !document.fullscreenElement && (tooTall || (poppedOut() && panelOpen));

    if (!out) {
      frame.removeAttribute('popover');
      Object.assign(frame.style, {
        position: 'absolute',
        top: '6px',
        right: inset + 'px',
        bottom: '',
        left: '',
      });
      return;
    }

    if (!poppedOut()) {
      frame.popover = 'manual';
      frame.showPopover();
    }

    const boxRect = box.getBoundingClientRect();
    const right = document.documentElement.clientWidth - boxRect.right - scrollX + inset;

    // Some pages can't scroll, so the whole card has to fit on screen. When the player sits
    // low, the card moves up just far enough.
    const lowest = innerHeight - frame.offsetHeight - 12;
    const top = Math.max(floatingTop, Math.min(boxRect.top + 6, lowest));

    Object.assign(frame.style, {
      position: 'absolute',
      top: top + scrollY + 'px',
      right: right + 'px',
      bottom: 'auto',
      left: 'auto',
    });
  };

  // The page scrolling moves the frame by itself. This is for players inside a scrolling element.
  const followPlayer = () => {
    if (poppedOut()) placeFrame();
  };

  document.addEventListener('scroll', followPlayer, true);

  // The width matters because the settings open beside the card on a short, wide player.
  const roomWidth = () => {
    let width = viewportWidth() - 12;
    if (!touch) width = Math.min(640, inPlayer() ? box.clientWidth - 12 : innerWidth - 12);

    return Math.max(40, Math.round(width));
  };

  // The id lookup walks the page, which is slow on long feeds. Once a second is enough
  // (the time goes out much more often).
  let idCache = null;
  const idsNow = (v) => {
    const fresh = idCache
      && idCache.v === v
      && idCache.src === v.currentSrc
      && Date.now() - idCache.at <= 1000;
    if (!fresh) idCache = { v, src: v.currentSrc, at: Date.now(), ...idsOf(v) };

    return { mediaId: idCache.mediaId, postId: idCache.postId };
  };

  const send = () => {
    if (!panelReady || !frame.contentWindow) return;

    const state = {
      type: 'state',
      v: PROTOCOL,
      postId: null,
      mediaId: null,
      t: 0,
      rate: 1,
      paused: true,
      waiting: false,
      room: roomHeight(),
      roomW: roomWidth(),
      viewportWidth: viewportWidth(),
    };

    if (video) {
      Object.assign(state, idsNow(video));
      state.t = video.currentTime;
      state.rate = video.playbackRate;
      state.paused = video.paused || video.ended;
      // a media error freezes the picture without pausing it, the toy has to stop then too
      state.waiting = video.seeking || video.readyState < 3 || !!video.error;
    }

    frame.contentWindow.postMessage(state, PANEL_ORIGIN);
  };

  // Hover previews and teaser clips are skipped, their timeline isn't the video's.
  const isMainVideo = (v) => {
    if (/videoPreviewEl|Teaser/i.test(v.className)) return false;
    return v.getBoundingClientRect().width >= 320;
  };

  const playingVideo = () => [...document.querySelectorAll('video')].find((v) => !v.paused && isMainVideo(v));

  // Some players (Fansly) put click-catching layers next to the video. Go up to the outermost
  // ancestor that's still the video's size, so the panel ends up above them.
  const playerBox = (v) => {
    const videoRect = v.getBoundingClientRect();
    let best = v.parentElement;

    for (let el = best; el && el !== document.body; el = el.parentElement) {
      const rect = el.getBoundingClientRect();
      if (Math.abs(rect.width - videoRect.width) > 4) break;
      if (Math.abs(rect.height - videoRect.height) > 60) break;
      best = el;
    }
    return best;
  };

  // Moving an iframe reloads it (the panel then reconnects, if the viewer had connected).
  // moveBefore doesn't reload, but only Chrome 133+ has it.
  // Afterwards slide the frame from the old spot to the new one.
  let slideFrom = null;

  const moveTo = (parent) => {
    slideFrom = frame.isConnected ? frame.getBoundingClientRect() : null;

    if (frame.isConnected && parent.moveBefore) {
      try {
        parent.moveBefore(frame, null);
        return;
      } catch {
        // didn't work here, so it's the reload after all
      }
    }

    panelReady = false;
    slideFrom = null;
    parent.appendChild(frame);
  };

  const glide = () => {
    if (!slideFrom) return;

    const to = frame.getBoundingClientRect();
    const dx = slideFrom.left - to.left;
    const dy = slideFrom.top - to.top;
    slideFrom = null;

    if (Math.abs(dx) + Math.abs(dy) > 2) {
      frame.animate(
        [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }],
        { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
  };

  // Subtitles and credit links are drawn inside the player box, so they show in fullscreen too.
  // The panel sends cues as [startMs, endMs, text] and links as { url, label, shown: [[startMs, endMs]] }.
  let cues = null;
  let links = null;
  let paintRequest = 0;
  let captionStyled = '';
  let look = {
    color: '#ffffff',
    size: 100,
    text: 100,
    back: 50,
    place: 'bottom',
    lift: 10,
    delay: 0,
  };

  const caption = document.createElement('div');
  const captionText = caption.appendChild(document.createElement('span'));

  const creditLink = document.createElement('a');
  creditLink.target = '_blank';
  creditLink.rel = 'noopener noreferrer';
  Object.assign(creditLink.style, {
    position: 'absolute',
    left: '8px',
    top: '8px',
    zIndex: '2147483645',
    padding: '5px 11px',
    borderRadius: '999px',
    background: 'rgba(20,20,22,.8)',
    color: '#fff',
    font: '600 13px/1.3 system-ui,sans-serif',
    textDecoration: 'none',
    boxShadow: '0 2px 8px rgba(0,0,0,.35)',
  });

  // a click on the link shouldn't pause the video
  for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick']) {
    creditLink.addEventListener(type, (e) => e.stopPropagation());
  }

  const rgba = (hex, alpha) => {
    const red = parseInt(hex.slice(1, 3), 16);
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);
    return `rgba(${red},${green},${blue},${alpha})`;
  };

  const clamp = (value, min, max, fallback) => {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  };

  const timeRanges = (list) => {
    if (!Array.isArray(list)) return [];

    return list.filter((range) => Array.isArray(range)
      && Number.isFinite(range[0])
      && Number.isFinite(range[1])
      && range[1] > range[0]);
  };

  const drawCaption = (text) => {
    if (caption.parentNode !== box) box.append(caption);
    if (captionText.textContent !== text) captionText.textContent = text;

    // The styles only need setting again when the look or the player's height changed.
    const fontSize = Math.max(12, Math.round(box.clientHeight * 0.045 * look.size / 100));
    const key = JSON.stringify(look) + fontSize;
    if (captionStyled === key) return;
    captionStyled = key;

    Object.assign(caption.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      top: '',
      bottom: '',
      [look.place]: look.lift + '%',
      padding: '0 5%',
      textAlign: 'center',
      pointerEvents: 'none',
      zIndex: '2147483645',
    });

    Object.assign(captionText.style, {
      whiteSpace: 'pre-line',
      font: `600 ${fontSize}px/1.3 system-ui,sans-serif`,
      color: rgba(look.color, look.text / 100),
      background: `rgba(0,0,0,${look.back / 100})`,
      padding: '.08em .35em',
      borderRadius: '.2em',
      webkitBoxDecorationBreak: 'clone',
      boxDecorationBreak: 'clone',
      textShadow: `0 1px 3px rgba(0,0,0,${0.9 * look.text / 100})`,
    });
  };

  const paint = () => {
    paintRequest = cues || links ? requestAnimationFrame(paint) : 0;

    // Without a mounted video the time is NaN, and then nothing below matches.
    const now = video && box ? video.currentTime * 1000 : NaN;

    const cueTime = now - look.delay;
    const text = cues
      ? cues.filter((cue) => cue[0] <= cueTime && cueTime < cue[1]).map((cue) => cue[2]).join('\n')
      : '';
    if (text) drawCaption(text);
    else caption.remove();

    const credit = links && links.find((link) => link.shown.some(([start, end]) => start <= now && now < end));
    if (!credit) {
      creditLink.remove();
      return;
    }

    if (creditLink.parentNode !== box) box.append(creditLink);
    if (creditLink.getAttribute('href') !== credit.url) creditLink.href = credit.url;
    if (creditLink.textContent !== credit.label) creditLink.textContent = credit.label;
  };

  const repaint = () => {
    if (!paintRequest && (cues || links)) paintRequest = requestAnimationFrame(paint);
    if (!cues) caption.remove();
    if (!links) creditLink.remove();
  };

  const mount = (v, into) => {
    video = v;

    if (box) box.removeEventListener('pointermove', wake, true);
    box = into || playerBox(v);
    box.addEventListener('pointermove', wake, true);
    wake();
    makePositioned(box);

    // On a phone the frame stays fixed to the screen, it only has to be inside whatever
    // is fullscreen.
    const parent = touch ? (into || document.body) : box;
    if (frame.parentNode !== parent) moveTo(parent);

    if (touch) {
      frame.style.position = 'fixed';
      frame.style.top = 'auto';
      frame.style.bottom = 'max(12px, env(safe-area-inset-bottom))';
    } else {
      placeFrame();
    }

    glide();
    send();
  };

  const onMedia = (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;

    if (e.type === 'play' && v !== video && isMainVideo(v)) {
      mount(v);
      return;
    }
    if (v !== video) return;

    // viewer pressed play, tell the panel so its Pause lifts too
    if (e.type === 'play' && panelReady && Date.now() - lastInput < 1500) {
      frame.contentWindow?.postMessage({ type: 'played' }, PANEL_ORIGIN);
    }

    send();
  };

  for (const type of MEDIA_EVENTS) {
    document.addEventListener(type, onMedia, true);
  }

  const resizeFrame = (message) => {
    panelOpen = !!message.open;

    const width = Math.max(+message.w || 0, 40);
    const height = Math.max(+message.h || 0, 30);
    const maxWidth = touch ? viewportWidth() - 12 : roomWidth();

    frame.style.width = Math.min(width, maxWidth) + 'px';
    frame.style.height = Math.min(height, roomHeight()) + 'px';
    placeTouch();
    placeFrame();

    // The player may have resized while paused.
    send();
  };

  const applySettings = (message) => {
    known = new Set(message.ids.map((id) => String(id).toLowerCase()));

    if (message.marks === 'on' || message.marks === 'off') badgeOn = message.marks === 'on';
    if (Number.isFinite(message.outline)) outlineAmount = Math.min(100, Math.max(0, message.outline));
    if (message.area === 'post' || message.area === 'video') outlineArea = message.area;
    if (['tl', 'tr', 'bl', 'br'].includes(message.corner)) corner = message.corner;
    if (COLORS[message.color]) [accent, glow] = COLORS[message.color];

    if (['around', 'whole', 'off'].includes(message.preview)) {
      preview = message.preview;
      strip.style.opacity = '0';
    }

    mark();
  };

  const readLook = (sent) => ({
    color: /^#[0-9a-f]{6}$/i.test(sent.color) ? sent.color : '#ffffff',
    size: clamp(sent.size, 50, 200, 100),
    text: clamp(sent.text, 10, 100, 100),
    back: clamp(sent.back, 0, 100, 50),
    place: sent.place === 'top' ? 'top' : 'bottom',
    lift: clamp(sent.lift, 0, 45, 10),
    delay: clamp(sent.delay, -500, 500, 0),
  });

  const readCredits = (sent) => {
    if (!Array.isArray(sent)) return null;

    return sent
      .filter((link) => link && typeof link.url === 'string' && typeof link.label === 'string')
      .filter((link) => /^https:\/\/[^\s"<>]+$/.test(link.url))
      .map((link) => ({
        url: link.url,
        label: link.label.slice(0, 80) + ' \u2197',
        shown: timeRanges(link.shown),
      }));
  };

  const onMessage = (e) => {
    if (e.source !== frame.contentWindow || e.origin !== PANEL_ORIGIN) return;

    const message = e.data || {};

    switch (message.type) {
      case 'hello':
        panelReady = true;
        send();
        break;

      case 'size':
        resizeFrame(message);
        break;

      case 'hover':
        panelHovered = !!message.on;
        break;

      case 'ids':
        if (Array.isArray(message.ids)) applySettings(message);
        break;

      case 'heat':
        heat = null;
        if (Array.isArray(message.acts) && message.acts.length >= 4) {
          heat = Float64Array.from(message.acts, Number);
        }
        strip.dataset.key = '';
        break;

      case 'subs':
        cues = null;
        if (Array.isArray(message.cues)) {
          cues = message.cues.filter((cue) => timeRanges([cue]).length && typeof cue[2] === 'string');
        }
        repaint();
        break;

      case 'look':
        if (message.look) look = readLook(message.look);
        break;

      case 'credits':
        links = readCredits(message.links);
        repaint();
        break;

      case 'pause':
        video?.pause();
        break;

      case 'play':
        video?.play()?.catch(() => {});
        break;

      case 'close':
        teardown();
        break;
    }
  };

  window.addEventListener('message', onMessage);

  frame.addEventListener('load', () => {
    panelReady = true;
    send();
  });

  // Sync badge on every video, Fansly attachment and thumbnail that has a script.
  // The playing video has the pill instead.
  let known = new Set();
  const isKnown = (id) => !!id && known.has(String(id).toLowerCase());

  // Both go from an element on the page to what we added inside it. For an outline that
  // element is the media box, the player or the whole post.
  const badges = new Map();
  const rings = new Map();

  const WAVE_ICON = '<svg viewBox="0 0 24 24" width="1.25em" height="1.25em" fill="none" stroke="#fff" '
    + 'stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M2 12c2.2-6 4.4-6 6.6 0s4.4 6 6.6 0 4.4-6 6.6 0"/></svg>';

  const COLORS = {
    blue: ['#2b7bff', '43,123,255'],
    pink: ['#e70d9e', '231,13,158'],
  };

  // these all come from the panel's Look settings
  let [accent, glow] = COLORS.pink;
  let badgeOn = true;
  let outlineAmount = 75;
  let outlineArea = 'video';
  let corner = 'tr';

  // The outline grows out of the badge's corner in two arms, one along each edge, and each
  // arm fades out at its end. outlineAmount is how far they get (at 100 they meet).
  const styleRing = (ring, el, fromCorner, rect = null) => {
    const elRect = el.getBoundingClientRect();
    const width = (rect || elRect).width;
    const height = (rect || elRect).height;

    const amount = outlineAmount / 100;
    const armLength = amount * (width + height);
    const fadeLength = amount >= 1 ? 0 : Math.min(160, armLength * 0.7);
    const clear = `rgba(${glow},0)`;

    // One side of the box as a gradient. An arm covers two sides, and `already` is how
    // much of the arm was used up on the first.
    const side = (direction, position, size, already) => {
      if (armLength > already) {
        const solid = Math.max(0, armLength - fadeLength - already);
        const gradient = `linear-gradient(${direction},${accent} 0,${accent} ${solid}px,${clear} ${armLength - already}px)`;
        return `${gradient} ${position}/${size} no-repeat,`;
      }
      return '';
    };

    // Mirrored for whichever corner the badge is in.
    const top = fromCorner[0] === 't';
    const left = fromCorner[1] === 'l';
    const across = left ? 'to right' : 'to left';
    const down = top ? 'to bottom' : 'to top';

    const glowX = Math.max(20, Math.min(width, armLength) * 0.5);
    const glowY = Math.max(20, Math.min(height, armLength) * 0.5);
    const cornerGlow = `radial-gradient(${Math.round(glowX)}px ${Math.round(glowY)}px at `
      + `${left ? 'left' : 'right'} ${top ? 'top' : 'bottom'},rgba(${glow},.28),${clear})`;

    const background = side(across, `0 ${top ? 0 : '100%'}`, '100% 3px', 0)
      + side(down, `${left ? '100%' : 0} 0`, '3px 100%', width)
      + side(down, `${left ? 0 : '100%'} 0`, '3px 100%', 0)
      + side(across, `0 ${top ? '100%' : 0}`, '100% 3px', height)
      + cornerGlow;

    Object.assign(ring.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      borderRadius: 'inherit',
      pointerEvents: 'none',
      zIndex: '2147483644',
      background,
      boxShadow: `inset 0 0 36px rgba(${glow},${(0.3 * amount * amount).toFixed(3)})`,
    });

    if (rect) {
      Object.assign(ring.style, {
        left: Math.round(rect.left - elRect.left - el.clientLeft) + 'px',
        top: Math.round(rect.top - elRect.top - el.clientTop) + 'px',
        width: Math.round(width) + 'px',
        height: Math.round(height) + 'px',
        borderRadius: '8px',
      });
    }
  };

  // leaves only (text, images, icons, buttons), wrappers would add their padding
  const isContent = (el) => {
    if (el.children.length) return /^(SVG|BUTTON|PICTURE)$/i.test(el.tagName);
    return el.textContent.trim() || /^(IMG|SVG|VIDEO|CANVAS|BUTTON|PICTURE)$/i.test(el.tagName);
  };

  // What you actually see of a post: its media plus the header, caption and likes, as wide as the
  // media. Padding and OnlyFans' blurred backdrop are left out so the outline sits tight.
  const postBox = (post, media) => {
    // OnlyFans draws the line between posts with .b-post::after, above the post's bottom padding.
    // So the visible post goes from the previous post's line to its own.
    const onlyFansPost = post.querySelector('.b-post');
    if (onlyFansPost) {
      const rect = post.getBoundingClientRect();
      const padding = parseFloat(getComputedStyle(onlyFansPost).paddingBottom) || 0;
      return { left: rect.left, top: rect.top - padding, width: rect.width, height: rect.height };
    }

    const mediaRect = media.getBoundingClientRect();
    const postRect = post.getBoundingClientRect();
    let top = mediaRect.top;
    let bottom = mediaRect.bottom;

    for (const el of post.querySelectorAll('*')) {
      if (media.contains(el) || rings.get(post) === el) continue;
      if (!isContent(el)) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (rect.right <= mediaRect.left || rect.left >= mediaRect.right) continue;
      if (rect.top < postRect.top - 1 || rect.bottom > postRect.bottom + 1) continue;

      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
    }

    // plus a little room around the content
    top = Math.max(postRect.top, top - 8);
    bottom = Math.min(postRect.bottom, bottom + 8);

    return { left: mediaRect.left, top, width: mediaRect.width, height: bottom - top };
  };

  // During one mark() pass, remember each ancestor's links and video count. Without it a Fansly ffeed whose post links haven't rendered yet gets rescanned for every single card.
  let idMemo = null;
  let videoMemo = null;

  const hasMultipleVideos = (el) => {
    if (videoMemo && videoMemo.has(el)) return videoMemo.get(el);

    let count = 0;
    for (const v of el.querySelectorAll('video')) {
      if (isMainVideo(v)) count++;
      if (count > 1) break;
    }

    const multiple = count > 1;
    if (videoMemo) videoMemo.set(el, multiple);
    return multiple;
  };

  const postIds = (el) => {
    const remembered = idMemo && idMemo.get(el);
    if (remembered) return remembered;

    const ids = new Set();
    for (const link of el.querySelectorAll('a[href]')) {
      if (link.host !== location.host) continue;

      const match = POST_LINK.exec(link.pathname);
      if (match) ids.add(match[1] || match[2]);
    }

    if (idMemo) idMemo.set(el, ids);
    return ids;
  };

  // the post around a media box: outermost ancestor with exactly one post link
  const cardOf = (mediaBox) => {
    let card = null;
    let el = mediaBox.parentElement;

    for (let depth = 0; el && el !== document.body && depth < 14; depth++) {
      const count = postIds(el).size;
      if (count > 1) break;
      if (count === 1) card = el;

      el = el.parentElement;
    }
    return card;
  };

  const styleBadge = (badge, el, kind) => {
    const rect = el.getBoundingClientRect();

    // Roughly 12% of a thumbnail's height, and 6% of a player's.
    let fontSize = Math.max(14, Math.min(34, Math.round(rect.height * 0.06)));
    if (kind === 'thumb') fontSize = Math.max(12, Math.round(rect.height * 0.12));

    const inset = kind === 'thumb' ? 6 : Math.max(10, Math.round(rect.width * 0.02));
    const atTop = corner[0] === 't';
    const atLeft = corner[1] === 'l';

    // In a player's bottom corners the badge goes above the control bar.
    const lift = !atTop && kind === 'player' ? 56 : 0;

    Object.assign(badge.style, {
      position: 'absolute',
      left: atLeft ? inset + 'px' : '',
      right: atLeft ? '' : inset + 'px',
      top: atTop ? inset + 'px' : '',
      bottom: atTop ? '' : inset + lift + 'px',
      display: 'flex',
      alignItems: 'center',
      gap: '.35em',
      boxSizing: 'border-box',
      padding: '.32em .75em .32em .55em',
      borderRadius: '999px',
      background: accent,
      boxShadow: '0 1px 6px rgba(0,0,0,.35)',
      color: '#fff',
      whiteSpace: 'nowrap',
      font: `600 ${fontSize}px system-ui,-apple-system,"Segoe UI",sans-serif`,
      pointerEvents: 'none',
      zIndex: '2147483645',
    });
  };

  // Badges and outlines are positioned inside the element they mark, so that element can't
  // stay position:static. Its old inline value is kept and put back on Quit.
  const positioned = new Map();

  const makePositioned = (el) => {
    if (getComputedStyle(el).position !== 'static') return;

    if (!positioned.has(el)) positioned.set(el, el.style.position);
    el.style.position = 'relative';
  };

  const fadeOut = (el) => {
    const fade = el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }], { duration: 200 });
    const remove = () => el.remove();
    fade.finished.then(remove, remove);
  };

  const posterBox = (card) => {
    const area = (img) => {
      const rect = img.getBoundingClientRect();
      return rect.width * rect.height;
    };

    const images = [...card.querySelectorAll('img')].filter((img) => img.getBoundingClientRect().width >= 200);
    const biggest = images.sort((a, b) => area(b) - area(a))[0];

    const maxWidth = card.getBoundingClientRect().width + 1;
    let wrapper = biggest && biggest.parentElement;
    while (wrapper && wrapper !== card && wrapper.getBoundingClientRect().width > maxWidth) {
      wrapper = wrapper.parentElement;
    }
    return wrapper;
  };

  const findTargets = (targets) => {
    const add = (el, kind, post, exact = false) => {
      const ringAt = outlineArea === 'post' && post ? post : el;
      targets.set(el, { kind, ringAt, exact });
    };

    // On Fansly the post element's own box is the visible post. Everywhere else
    // postBox() has to measure it.
    const addPlayer = (el) => {
      const fanslyPost = el.closest('.feed-item-content') || el.closest('app-post');
      add(el, 'player', fanslyPost || cardOf(el), !!fanslyPost);
    };

    // Fansly attachments. The <video> is hidden until play, so the media box gets the badge
    for (const el of document.querySelectorAll('[data-media-id]')) {
      const v = el.querySelector('video');
      if (!v || (video && el.contains(video)) || el.getBoundingClientRect().width < 120) continue;
      if (!isKnown(el.getAttribute('data-media-id')) && !isKnown(idsOf(v).postId)) continue;

      addPlayer(el);
    }

    for (const v of document.querySelectorAll('video')) {
      if (v === video || !isMainVideo(v) || v.closest('[data-media-id]')) continue;

      const { mediaId, postId } = idsOf(v);
      if (isKnown(mediaId) || isKnown(postId)) addPlayer(playerBox(v));
    }

    // OnlyFans only adds the <video> on play. Before that, badge the post's biggest image.
    // (posts with a player or a Fansly media box were done above)
    for (const link of document.querySelectorAll('a[href]')) {
      const match = POST_LINK.exec(link.pathname);
      const id = match && (match[1] || match[2]);
      if (!id || link.host !== location.host || !isKnown(id)) continue;

      let card = null;
      let el = link.parentElement;
      for (let depth = 0; el && el !== document.body && depth < 14; depth++) {
        if (postIds(el).size > 1) break;
        card = el;
        el = el.parentElement;
      }
      if (!card || [...card.querySelectorAll('video')].some(isMainVideo) || card.querySelector('[data-media-id]')) continue;

      const poster = posterBox(card);
      if (poster) add(poster, 'poster', card);
    }

    // thumbnail grids: Pornhub ?viewkey= and ManyVids /Video/<id> links
    for (const link of document.querySelectorAll('a[href*="viewkey="], a[href*="/Video/"]')) {
      const viewkey = new URL(link.href, location.href).searchParams.get('viewkey');
      const id = viewkey || (/\/Video\/(\d+)/.exec(link.pathname) || [])[1];

      const img = isKnown(id) && link.querySelector('img');
      if (img && img.parentElement && img.getBoundingClientRect().width >= 80) add(img.parentElement, 'thumb');
    }
  };

  const drawBadges = (targets) => {
    const ringTargets = new Set();
    const mediaOfPost = new Map();
    const exactPosts = new Set();

    for (const [el, target] of targets) {
      if (outlineAmount > 0) ringTargets.add(target.ringAt);
      if (target.ringAt === el) continue;

      if (target.exact) exactPosts.add(target.ringAt);
      else mediaOfPost.set(target.ringAt, el);
    }

    for (const [el, badge] of badges) {
      if (targets.has(el)) continue;
      badges.delete(el);
      fadeOut(badge);
    }

    for (const [el, ring] of rings) {
      if (ringTargets.has(el)) continue;
      rings.delete(el);
      fadeOut(ring);
    }

    for (const el of ringTargets) {
      let ring = rings.get(el);

      if (!ring) {
        makePositioned(el);
        ring = document.createElement('div');
        ring.setAttribute('aria-hidden', 'true');
        el.append(ring);
        rings.set(el, ring);

        // fade in, pulse a couple of times, then hold
        ring.animate(
          [{ opacity: 0 }, { opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }],
          { duration: 3000, easing: 'ease-in-out' },
        );
      }

      // An outline around a whole post always starts top left.
      if (mediaOfPost.has(el)) styleRing(ring, el, 'tl', postBox(el, mediaOfPost.get(el)));
      else styleRing(ring, el, exactPosts.has(el) ? 'tl' : corner);
    }

    for (const [el, { kind }] of targets) {
      let badge = badges.get(el);

      if (!badge) {
        makePositioned(el);
        badge = document.createElement('div');
        badge.innerHTML = WAVE_ICON + '<span>Sync</span>';
        badge.setAttribute('aria-hidden', 'true');
        el.append(badge);
        badges.set(el, badge);

        badge.animate(
          [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }],
          { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1.2)' },
        );
      }

      styleBadge(badge, el, kind);
    }
  };

  const mark = () => {
    const targets = new Map();

    if (badgeOn) {
      idMemo = new Map();
      videoMemo = new Map();
      try {
        findTargets(targets);
      } finally {
        idMemo = null;
        videoMemo = null;
      }
    }

    drawBadges(targets);
  };

  // Fansly's viewer has its own close and menu buttons in that corner.
  // Slide left past whatever button sits under the pill.
  const dodge = () => {
    if (!inPlayer()) return;

    const boxRect = box.getBoundingClientRect();
    let right = 6;

    for (let attempt = 0; attempt < 4; attempt++) {
      const x = boxRect.right - right - 12;
      const underPill = [
        ...document.elementsFromPoint(x, boxRect.top + 14),
        ...document.elementsFromPoint(x, boxRect.top + 26),
      ];

      const button = underPill
        .map((el) => el.closest('button,[role="button"],a,svg'))
        .find((el) => el && !frame.contains(el));
      if (!button) break;

      right = Math.max(right, Math.round(boxRect.right - button.getBoundingClientRect().left + 6));
    }

    inset = right;
    frame.style.right = right + 'px';
    placeFrame();
  };

  // Seek bar preview: the script drawn above the bar while you hover it, coloured by speed
  // (grey when barely moving, then blue, green, yellow, red). "Around" shows 15 s either side
  // of the pointer in a popup, "Whole" is the full script along the bar.
  //
  // heat is the script as one flat list: time in ms, position, time, position and so on.
  let heat = null;
  let preview = 'whole';

  const strip = document.createElement('canvas');
  strip.setAttribute('aria-hidden', 'true');

  let seekBarEl = null;
  let seekBarCheckedAt = 0;

  // Players name their seek bar all sorts of things. Take the widest thin element in the
  // lower half of the player that sounds like one, and look again once a second at most.
  const seekBar = () => {
    if (Date.now() - seekBarCheckedAt < 1000 && seekBarEl && seekBarEl.isConnected) return seekBarEl;

    seekBarCheckedAt = Date.now();
    seekBarEl = null;
    if (!box) return null;

    const boxRect = box.getBoundingClientRect();
    const candidates = box.querySelectorAll(
      '.vjs-progress-holder, [class*="progress" i], [class*="seek" i], [class*="timeline" i], input[type=range]',
    );
    let widest = 0;

    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const barShaped = rect.width > boxRect.width * 0.4 && rect.height < 40;
      const inLowerHalf = rect.top > boxRect.top + boxRect.height / 2 && rect.bottom <= boxRect.bottom + 1;

      if (barShaped && inLowerHalf && rect.width > widest) {
        widest = rect.width;
        seekBarEl = el;
      }
    }
    return seekBarEl;
  };

  const speedColor = (speed) => {
    if (speed < 15) return 'rgba(150,150,160,.6)';
    return `hsl(${Math.max(0, 225 - speed * 0.5)},92%,55%)`;
  };

  // index of the last action at or before a time
  const before = (time) => {
    let low = 0;
    let high = heat.length / 2 - 1;

    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (heat[2 * middle] <= time) low = middle;
      else high = middle - 1;
    }
    return low;
  };

  const speedAt = (i) => {
    if (i + 1 >= heat.length / 2) return 0;

    const travel = Math.abs(heat[2 * i + 3] - heat[2 * i + 1]);
    const duration = heat[2 * i + 2] - heat[2 * i];
    return duration > 0 ? travel / (duration / 1000) : 0;
  };

  const drawWaves = (ctx, width, height, start, end, pointerTime) => {
    const x = (time) => ((time - start) / (end - start)) * width;
    const y = (pos) => 3 + (1 - pos / 100) * (height - 6);
    const count = heat.length / 2;

    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';

    for (let i = Math.max(0, before(start)); i + 1 < count && heat[2 * i] < end; i++) {
      ctx.strokeStyle = speedColor(speedAt(i));
      ctx.beginPath();
      ctx.moveTo(x(heat[2 * i]), y(heat[2 * i + 1]));
      ctx.lineTo(x(heat[2 * i + 2]), y(heat[2 * i + 3]));
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillRect(Math.round(x(pointerTime)) - 1, 0, 2, height);
  };

  // Whole video in one strip. Each pixel column shows how far the stroke goes in that
  // slice of time, coloured by how fast it moves.
  const drawWhole = (ctx, width, height, duration) => {
    const count = heat.length / 2;
    const lastTime = heat[2 * count - 2];

    for (let x = 0; x < width; x++) {
      const start = (x / width) * duration;
      const end = ((x + 1) / width) * duration;
      if (start >= lastTime) break;

      let low = 100;
      let high = 0;
      let distance = 0;

      for (let i = before(start); i + 1 < count && heat[2 * i] < end; i++) {
        const fromTime = heat[2 * i];
        const fromPos = heat[2 * i + 1];
        const toTime = heat[2 * i + 2];
        const toPos = heat[2 * i + 3];

        const sliceStart = Math.max(start, fromTime);
        const sliceEnd = Math.min(end, toTime);
        if (sliceEnd <= sliceStart || toTime <= fromTime) continue;

        const posAt = (t) => fromPos + (toPos - fromPos) * ((t - fromTime) / (toTime - fromTime));
        const a = posAt(sliceStart);
        const b = posAt(sliceEnd);
        low = Math.min(low, a, b);
        high = Math.max(high, a, b);
        distance += Math.abs(b - a);
      }
      if (high < low) continue;

      ctx.fillStyle = speedColor(distance / ((end - start) / 1000));
      const top = 1 + (1 - high / 100) * (height - 2);
      const bottom = 1 + (1 - low / 100) * (height - 2);
      ctx.fillRect(x, top, 1, Math.max(1.5, bottom - top));
    }
  };

  const showStrip = (pointerX, pointerY) => {
    const hasDuration = video && Number.isFinite(video.duration) && video.duration > 0;
    const bar = preview !== 'off' && heat && box && hasDuration && seekBar();
    const barRect = bar && bar.getBoundingClientRect();

    const nearBar = barRect
      && pointerX >= barRect.left
      && pointerX <= barRect.right
      && pointerY >= barRect.top - 24
      && pointerY <= barRect.bottom + 16;
    if (!nearBar) {
      strip.style.opacity = '0';
      return;
    }

    const boxRect = box.getBoundingClientRect();
    const duration = video.duration * 1000;
    const around = preview === 'around';

    const width = around ? Math.min(280, Math.round(boxRect.width - 16)) : Math.round(barRect.width);
    const height = around ? 54 : 18;
    const pointerTime = Math.max(0, Math.min(1, (pointerX - barRect.left) / barRect.width)) * duration;

    // only redraw when something changed
    const key = around ? `a:${width}:${Math.round(pointerTime / 50)}` : `w:${width}:${duration}`;
    if (strip.dataset.key !== key) {
      strip.dataset.key = key;

      const scale = devicePixelRatio || 1;
      strip.width = Math.round(width * scale);
      strip.height = Math.round(height * scale);

      const ctx = strip.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, width, height);

      if (around) drawWaves(ctx, width, height, pointerTime - 15000, pointerTime + 15000, pointerTime);
      else drawWhole(ctx, width, height, duration);
    }

    if (strip.parentNode !== box) box.append(strip);

    let left = barRect.left - boxRect.left;
    if (around) left = Math.max(8, Math.min(boxRect.width - width - 8, pointerX - boxRect.left - width / 2));
    const top = barRect.top - boxRect.top - height - (around ? 40 : 10);

    Object.assign(strip.style, {
      position: 'absolute',
      left: Math.round(left) + 'px',
      top: Math.round(top) + 'px',
      width: width + 'px',
      height: height + 'px',
      borderRadius: '6px',
      background: 'rgba(14,14,16,.82)',
      boxShadow: '0 0 0 1px rgba(255,255,255,.12),0 2px 8px rgba(0,0,0,.4)',
      pointerEvents: 'none',
      zIndex: '2147483645',
      opacity: '1',
      transition: 'opacity .15s',
    });
  };

  const onPointerMove = (e) => {
    if (box && box.contains(e.target)) showStrip(e.clientX, e.clientY);
    else strip.style.opacity = '0';
  };

  document.addEventListener('pointermove', onPointerMove, true);

  // The pill hides after 2.5 s without the pointer moving over the player (in fullscreen also
  // while paused). video.js has an idle class for that. Elsewhere we time it ourselves,
  // Fansly's overlay swallows the mouse moves.
  const pointerIdle = () => {
    const player = video && video.closest('.video-js');
    if (player && /\bvjs-user-(in)?active\b/.test(player.className)) {
      return player.classList.contains('vjs-user-inactive');
    }
    return Date.now() - lastMove > 2500;
  };

  const showOrHidePill = (fullscreen) => {
    const inFullscreen = fullscreen && fullscreen.contains(video);
    const idle = video && (!video.paused || inFullscreen) && pointerIdle();

    // there's no hover on touch, so it stays
    const hide = !touch && idle && !panelHovered && !panelOpen;

    if (pillShown && hide) {
      pillShown = false;
    } else if (!pillShown && !hide) {
      pillShown = true;
      if (panelReady && frame.contentWindow) frame.contentWindow.postMessage({ type: 'shown' }, PANEL_ORIGIN);
    }

    // Invisible until the panel has loaded, which also makes it fade in after every move.
    frame.style.opacity = hide || !panelReady ? '0' : '1';
    frame.style.pointerEvents = hide ? 'none' : 'auto';
  };

  let ticks = 0;

  const tick = setInterval(() => {
    if (video && !video.isConnected) {
      video = null;
      box = null;
    }

    // The site re-rendered and threw the frame out (navigation inside a single-page app).
    if (!frame.isConnected) reattach();

    // follow the video into fullscreen, and into viewers that move it (Fansly)
    const fullscreen = document.fullscreenElement;
    if (video) {
      if (fullscreen && fullscreen !== video && fullscreen.contains(video) && !fullscreen.contains(frame)) {
        mount(video, fullscreen);
      } else if (!fullscreen && box && !box.contains(video)) {
        mount(video);
      }
    }

    showOrHidePill(fullscreen);
    send();
    placeTouch();
    dodge();

    // New posts keep loading while you scroll, so look for them once a second.
    if (known.size) {
      ticks++;
      if (ticks % 4 === 0) mark();
    }
  }, 250);

  function teardown() {
    clearInterval(tick);
    cancelAnimationFrame(paintRequest);
    paintRequest = 0;

    if (box) box.removeEventListener('pointermove', wake, true);
    for (const type of MEDIA_EVENTS) {
      document.removeEventListener(type, onMedia, true);
    }
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('scroll', followPlayer, true);
    window.removeEventListener('message', onMessage);

    frame.remove();
    caption.remove();
    creditLink.remove();
    strip.remove();
    for (const badge of badges.values()) badge.remove();
    for (const ring of rings.values()) ring.remove();

    for (const [el, position] of positioned) {
      el.style.position = position;
    }

    badges.clear();
    rings.clear();
    positioned.clear();
    known = new Set();
    cues = null;
    links = null;
    heat = null;
    video = null;
    box = null;
    seekBarEl = null;
    clicked = null;
    viewed = null;
    idCache = null;

    delete window.__jgSync;
  }

  // the site replaced the part of the page the panel was in, put it back
  function reattach() {
    const v = video && video.isConnected ? video : playingVideo();
    if (v) {
      box = null;
      mount(v);
      return;
    }

    video = null;
    box = null;
    moveTo(document.body);

    floatingTop = floatTop();
    frame.removeAttribute('popover');
    frame.style.position = 'fixed';
    frame.style.top = touch ? 'auto' : floatingTop + 'px';
    frame.style.right = '6px';
    frame.style.left = '';
    glide();
  }

  window.__jgSync = {
    show() {
      frame.style.display = '';
      if (!frame.isConnected) reattach();
    },

    // stop() is for the player on johnnyguides.com, which calls it when you leave the watch page
    stop: teardown,
  };

  const playing = playingVideo();
  if (playing) mount(playing);
  else document.body.appendChild(frame);
})();
