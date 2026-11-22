# JG Sync Bookmarklet

This is the code for the JG Sync Bookmarklet. It syncs your stroker (the [Handy](https://www.thehandy.com/?ref=johnny_guides&utm_source=johnny_guides&utm_medium=affiliate&utm_campaign=General+Affiliate+program&tap_s=10629959-8bfa33) or Autoblow Ultra) to my videos on OnlyFans, Pornhub, Fansly or ManyVids whenever there’s a sync script for a video.

Some fans wanted their toys to follow mine while watching my videos, without having to download the video, download the script, or install a separate player. So here's JG Sync.

## How to use

1. Drag the **JG Sync** button from [JohnnyGuides.com/toy-sync](https://johnnyguides.com/toy-sync) to your bookmarks bar.
2. Click it while you're watching one of my videos on a supported site.
3. For Handy, enter your [connection key](https://intercom.help/ohdoki/en/articles/8212628-finding-your-connection-key) and press **Connect**. For Autoblow, open **Settings**, choose **Autoblow Ultra (beta)** under **Device**, then enter your device token and press **Connect**.
4. Enjoy.

### What's a bookmarklet?

It's a bookmark that runs a bit of code on the page you have open when you click it.

### Remember across sites

If you turn on **Remember across sites**, you can use the same Handy key or Autoblow token on another supported site without typing it again. The panel saves it in a cookie if your browser allows it. Your browser can send that cookie to my site when the panel opens. Turning this off stops the panel from using the shared key or token on that site.

## Troubleshooting

Open **Troubleshooting** in the JG Sync panel and choose **Copy report**. The report is generated in your browser. If your browser blocks clipboard access, select and copy the report text. Tell me what’s going wrong and paste the report into a message to me on any platform, or email both to [johnnyguides.feedback@gmail.com](mailto:johnnyguides.feedback@gmail.com) with whatever issue(s) you're having.

## Privacy

### Funscripts and privacy

I host the funscripts and subtitles on my site. When the panel needs a funscript, it asks my site for that file and passes the movement data to Handy or Autoblow. That download still works with analytics off. My server sees the requested file and your connection’s IP address when it serves the download. JG Sync doesn’t save a download history.

### Optional analytics

Analytics are off by default. If you opt in, JG Sync reports things like which platform and toy you use, how long you sync, and which settings or features you use. It also records sync errors and broad categories like your device type, browser and operating system. I use that to decide what to improve.

To stop one connection sending too many reports, the server keeps a temporary counter in memory for each IP address. I don’t save the IP in the analytics record. The record also leaves out your name, account, connection key, and which video or script you used. Records older than 25 months are deleted automatically. You can change your choice under **Settings → Device → Help improve JG Sync**.

## What the button does

Here's the bookmarklet code. When you click the bookmarklet, it loads [`inject.js`](inject.js) from this repo.

```javascript
javascript:/*JG_Sync_by_Johnny_Guides*/(d => {
  fetch('https://raw.githubusercontent.com/JohnnyGuides/jg-sync/main/inject.js', { referrerPolicy: 'no-referrer' })
    .then(r => { if (!r.ok) throw r.status; return r.text() })
    .then(js => {
      const s = d.createElement('script');
      s.textContent = js;
      d.body.append(s);
    })
    .catch(() => alert('JG Sync failed to load. Try again in a minute.'))
})(document)
```

That script [opens the JG Sync panel](inject.js#L1442) from [johnnyguides.com/sync/panel](https://johnnyguides.com/sync/panel) inside the video page.

### What runs in your browser

- [`inject.js`](inject.js) runs on the video page. It opens `johnnyguides.com/sync/panel` (panel.html) in a small window inside that page and tells the panel which video is playing and where you are in it. It doesn’t read your cookies, messages or account details.
- [`panel.html`](panel.html) contains the controls. The window belongs to `johnnyguides.com`, so the video site can’t read the key or token you type there.
- [`autoblow.js`](autoblow.js) connects the panel to the Autoblow Ultra service.

### How do I check which panel is running?

If your panel has a **View source** link, it takes you to the GitHub commit that panel came from. You can compare the source of the panel’s URL with the **Raw** view of `panel.html` at that commit. They should match exactly. My site supplies the Handy app ID and supported sites separately.

[`loader.html`](loader.html) was the page that fetched the panel code from GitHub. The panel with the **View source** link is served directly.

## License

Copyright © 2026 Johnny Guides.

JG Sync is available under the [PolyForm Strict License 1.0.0](LICENSE).
