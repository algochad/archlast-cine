const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

let browser = null;

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
  }
  return browser;
}

// AllAnime stream resolver
app.post('/resolve/allanime', async (req, res) => {
  const { showId, episode, translationType = 'sub' } = req.body;
  
  if (!showId || !episode) {
    return res.status(400).json({ error: 'Missing showId or episode' });
  }

  try {
    const b = await getBrowser();
    const page = await b.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate to AllAnime watch page (correct format: /anime/{id}/{ep})
    const playerUrl = `https://allanime.day/anime/${showId}/${episode}`;
    console.log(`[AllAnime] Navigating to ${playerUrl}`);
    
    // Wait for video element or network idle
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return video && (video.src || video.currentSrc);
    }, { timeout: 25000 }).catch(() => {});
    
    // Extract stream URLs from the page
    const streams = await page.evaluate(() => {
      const sources = [];
      
      // Check for video element src/currentSrc
      const video = document.querySelector('video');
      if (video) {
        if (video.src) sources.push({ url: video.src, quality: 'auto', type: 'direct' });
        if (video.currentSrc) sources.push({ url: video.currentSrc, quality: 'auto', type: 'direct' });
      }
      
      // Check for source elements
      const sourceElements = document.querySelectorAll('video source');
      sourceElements.forEach(source => {
        if (source.src) {
          sources.push({
            url: source.src,
            quality: source.getAttribute('label') || 'auto',
            type: source.getAttribute('type') || 'unknown'
          });
        }
      });
      
      // Check for HLS streams in window variables (common patterns)
      if (window.playerConfig && window.playerConfig.sources) {
        window.playerConfig.sources.forEach(s => {
          sources.push({ url: s.file, quality: s.label || 'auto', type: 'hls' });
        });
      }
      if (window.videoSources) {
        window.videoSources.forEach(s => {
          sources.push({ url: s.url || s.src, quality: s.quality || 'auto', type: 'hls' });
        });
      }
      
      return sources;
    });
    
    // Debug: log page title and HTML snippet if no streams found
    if (streams.length === 0) {
      const title = await page.title();
      const html = await page.content();
      console.log(`[AllAnime] No streams found. Title: ${title}`);
      console.log(`[AllAnime] HTML snippet: ${html.substring(0, 500)}`);
    }
    
    await page.close();
    
    if (streams.length === 0) {
      return res.status(404).json({ error: 'No streams found' });
    }
    
    res.json({ streams });
  } catch (error) {
    console.error('AllAnime resolve error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// AnimePahe stream resolver with DDoS-Guard bypass
app.post('/resolve/animepahe', async (req, res) => {
  const { session, episode } = req.body;
  
  if (!session || !episode) {
    return res.status(400).json({ error: 'Missing session or episode' });
  }

  try {
    const b = await getBrowser();
    const page = await b.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate to AnimePahe play page
    const playUrl = `https://animepahe.pw/play/${session}/${episode}`;
    await page.goto(playUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for DDoS-Guard challenge to complete (if present)
    await page.waitForFunction(() => {
      return !document.title.includes('DDoS-Guard') && !document.title.includes('Just a moment');
    }, { timeout: 15000 }).catch(() => {});
    
    // Extract Kwik embed URLs
    const kwikUrls = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button[data-src*="kwik.cx"]');
      return Array.from(buttons).map(btn => ({
        url: btn.getAttribute('data-src'),
        resolution: btn.getAttribute('data-resolution'),
        audio: btn.getAttribute('data-audio')
      }));
    });
    
    if (kwikUrls.length === 0) {
      await page.close();
      return res.status(404).json({ error: 'No Kwik embeds found' });
    }
    
    // Resolve first Kwik URL to get actual stream
    const kwikPage = await b.newPage();
    await kwikPage.goto(kwikUrls[0].url, { waitUntil: 'networkidle2', timeout: 20000 });
    
    // Extract M3U8 URL from Kwik page
    const m3u8Url = await kwikPage.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        const match = text.match(/(https:\/\/[a-zA-Z0-9\-\.\/]+\.m3u8)/);
        if (match) return match[1];
      }
      return null;
    });
    
    await kwikPage.close();
    await page.close();
    
    if (!m3u8Url) {
      return res.status(404).json({ error: 'No M3U8 URL found in Kwik embed' });
    }
    
    res.json({
      streams: [{
        url: m3u8Url,
        quality: kwikUrls[0].resolution || 'auto',
        type: 'hls'
      }]
    });
  } catch (error) {
    console.error('AnimePahe resolve error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', browser: !!browser });
});

const PORT = process.env.SCRAPER_PORT || 9798;
app.listen(PORT, () => {
  console.log(`Anime scraper sidecar listening on http://127.0.0.1:${PORT}`);
});

// Cleanup on exit
process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (browser) await browser.close();
  process.exit(0);
});