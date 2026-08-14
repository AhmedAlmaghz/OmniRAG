import { YoutubeTranscript } from 'youtube-transcript';
// @ts-ignore
import { getSubtitles } from 'youtube-captions-scraper';

/**
 * Extracts standard 11-character YouTube video ID from various URL formats.
 */
function extractVideoId(url: string): string | null {
  if (!url) return null;
  const regExp = /^.*(?:youtu\.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.trim().match(regExp);
  return match && match[1].length === 11 ? match[1] : null;
}

/**
 * Extracts a JSON variable assignment from YouTube page HTML.
 */
function extractJsonFromHtml(html: string, varName: string): any {
  if (!html) return null;
  let idx = html.indexOf(varName + ' = ');
  if (idx === -1) {
    idx = html.indexOf(varName + '=');
    if (idx === -1) return null;
    idx += (varName + '=').length;
  } else {
    idx += (varName + ' = ').length;
  }

  const startBrace = html.indexOf('{', idx);
  if (startBrace === -1 || startBrace > idx + 40) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startBrace; i < html.length; i++) {
    const char = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\' && inString) {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          const jsonStr = html.substring(startBrace, i + 1);
          try {
            return JSON.parse(jsonStr);
          } catch (e) {
            return null;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Parses caption tracks directly from YouTube player initial response JSON.
 */
function extractCaptionsFromHtml(html: string, targetLang: string = 'ar'): any {
  try {
    const playerResponse = extractJsonFromHtml(html, 'ytInitialPlayerResponse');
    if (!playerResponse) return null;

    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || !Array.isArray(captionTracks) || captionTracks.length === 0) return null;

    let selectedTrack = captionTracks.find((track: any) => track.languageCode === targetLang);
    if (!selectedTrack) selectedTrack = captionTracks.find((track: any) => track.languageCode?.startsWith(targetLang));
    if (!selectedTrack) selectedTrack = captionTracks.find((track: any) => track.languageCode === 'en');
    if (!selectedTrack) selectedTrack = captionTracks.find((track: any) => track.languageCode?.startsWith('en'));
    if (!selectedTrack) selectedTrack = captionTracks[0];

    return selectedTrack;
  } catch (e) {
    return null;
  }
}

/**
 * Fetches and parses raw XML captions from YouTube's caption track URL.
 */
async function fetchAndParseXmlCaptions(baseUrl: string): Promise<string | null> {
  try {
    const res = await fetch(baseUrl);
    if (!res.ok) return null;
    const xml = await res.text();

    const matches = xml.matchAll(/<text start="([^"]+)"[^>]*>([\s\S]*?)<\/text>/gi);
    const captions: string[] = [];

    for (const match of matches) {
      let text = match[2]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x2F;/g, '/')
        .trim();
      text = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
      if (text) {
        const totalSecs = Math.floor(parseFloat(match[1]));
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        captions.push(`[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}] ${text}`);
      }
    }
    return captions.length > 0 ? captions.join('\n') : null;
  } catch (e) {
    return null;
  }
}

/**
 * Strategy 1: Professional youtube-transcript dependency
 */
async function fetchWithYoutubeTranscriptPackage(
  videoId: string,
  lang: string
): Promise<{ text: string; method: string } | null> {
  try {
    if (lang) {
      try {
        const res = await YoutubeTranscript.fetchTranscript(videoId, { lang });
        if (res && res.length > 0) {
          const formatted = res
            .map((item) => {
              const totalSecs = Math.floor(item.offset / 1000);
              const mins = Math.floor(totalSecs / 60);
              const secs = totalSecs % 60;
              const timeStr = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
              const cleanText = item.text
                .replace(/&amp;/g, '&')
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .trim();
              return `${timeStr} ${cleanText}`;
            })
            .join('\n');
          return { text: formatted, method: `youtube-transcript (${lang})` };
        }
      } catch (errLang) {
        // Fallback if target lang fails
      }
    }

    try {
      const res = await YoutubeTranscript.fetchTranscript(videoId);
      if (res && res.length > 0) {
        const formatted = res
          .map((item) => {
            const totalSecs = Math.floor(item.offset / 1000);
            const mins = Math.floor(totalSecs / 60);
            const secs = totalSecs % 60;
            const timeStr = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
            const cleanText = item.text
              .replace(/&amp;/g, '&')
              .replace(/&#39;/g, "'")
              .replace(/&quot;/g, '"')
              .trim();
            return `${timeStr} ${cleanText}`;
          })
          .join('\n');
        return { text: formatted, method: 'youtube-transcript (default)' };
      }
    } catch (errDef) {
      // Fallback if default fails
    }

    if (lang !== 'en') {
      try {
        const res = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
        if (res && res.length > 0) {
          const formatted = res
            .map((item) => {
              const totalSecs = Math.floor(item.offset / 1000);
              const mins = Math.floor(totalSecs / 60);
              const secs = totalSecs % 60;
              const timeStr = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
              const cleanText = item.text
                .replace(/&amp;/g, '&')
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .trim();
              return `${timeStr} ${cleanText}`;
            })
            .join('\n');
          return { text: formatted, method: 'youtube-transcript (en)' };
        }
      } catch (errEn) {
        // Ignored
      }
    }
  } catch (e) {
    // Strategy 1 failed
  }
  return null;
}

/**
 * Strategy 2: youtube-captions-scraper dependency
 */
async function fetchWithCaptionsScraper(
  videoId: string,
  lang: string
): Promise<{ text: string; method: string } | null> {
  try {
    const langsToTry = [lang, 'ar', 'en'].filter((v, i, a) => v && a.indexOf(v) === i);
    for (const l of langsToTry) {
      try {
        const captions = await getSubtitles({ videoID: videoId, lang: l });
        if (captions && captions.length > 0) {
          const formatted = captions
            .map((c: any) => {
              const totalSecs = Math.floor(parseFloat(c.start));
              const mins = Math.floor(totalSecs / 60);
              const secs = totalSecs % 60;
              const timeStr = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
              const cleanText = (c.text || '')
                .replace(/&amp;/g, '&')
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .trim();
              return `${timeStr} ${cleanText}`;
            })
            .join('\n');
          return { text: formatted, method: `youtube-captions-scraper (${l})` };
        }
      } catch (err) {
        // Try next language
      }
    }
  } catch (e) {
    // Strategy 2 failed
  }
  return null;
}

/**
 * Main YouTube Transcript extraction processor.
 * Strictly relies on professional transcript extraction libraries (youtube-transcript, youtube-captions-scraper, XML tracks).
 * NEVER uses an AI model to synthesize or generate fake transcripts.
 */
export async function processYoutubeTranscript(url: string, lang: string = 'ar') {
  if (!url) {
    throw new Error('يرجى تقديم رابط فيديو يوتيوب صحيح (YouTube Video URL)');
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error('رابط فيديو يوتيوب غير صالح. يُرجى استخدام تنسيق مثل: https://www.youtube.com/watch?v=VIDEO_ID');
  }

  const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let videoTitle = `فيديو يوتيوب (${videoId})`;
  let channelName = 'YouTube Video';
  let durationStr = 'غير محدد';
  let thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  let transcriptText = '';
  let extractionMethod = 'none';
  let fetchedHtml = '';

  // 1. Fetch metadata from YouTube page
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
      },
    });

    if (response.ok) {
      fetchedHtml = await response.text();
      const titleMatch = fetchedHtml.match(/<title>(.*?)<\/title>/i) || fetchedHtml.match(/"title":"(.*?)"/);
      if (titleMatch && titleMatch[1]) {
        videoTitle = titleMatch[1].replace(' - YouTube', '').trim();
      }
      const channelMatch = fetchedHtml.match(/"author":"(.*?)"/) || fetchedHtml.match(/"ownerChannelName":"(.*?)"/);
      if (channelMatch && channelMatch[1]) {
        channelName = channelMatch[1].trim();
      }

      const playerResponse = extractJsonFromHtml(fetchedHtml, 'ytInitialPlayerResponse');
      if (playerResponse && playerResponse.videoDetails) {
        videoTitle = playerResponse.videoDetails.title || videoTitle;
        channelName = playerResponse.videoDetails.author || channelName;
        const lengthSecs = parseInt(playerResponse.videoDetails.lengthSeconds || '0');
        if (lengthSecs > 0) {
          const m = Math.floor(lengthSecs / 60);
          const s = lengthSecs % 60;
          durationStr = `${m}:${s.toString().padStart(2, '0')}`;
        }
      }
    }
  } catch (e) {
    console.warn('Warning: Could not fetch YouTube HTML metadata:', e);
  }

  // 2. Strategy 1: Try youtube-transcript package
  const res1 = await fetchWithYoutubeTranscriptPackage(videoId, lang);
  if (res1 && res1.text && res1.text.trim().length > 0) {
    transcriptText = res1.text;
    extractionMethod = res1.method;
  }

  // 3. Strategy 2: Try youtube-captions-scraper package if Strategy 1 failed
  if (!transcriptText) {
    const res2 = await fetchWithCaptionsScraper(videoId, lang);
    if (res2 && res2.text && res2.text.trim().length > 0) {
      transcriptText = res2.text;
      extractionMethod = res2.method;
    }
  }

  // 4. Strategy 3: Try HTML Player Response XML track parsing if Strategy 1 & 2 failed
  if (!transcriptText && fetchedHtml) {
    const track = extractCaptionsFromHtml(fetchedHtml, lang);
    if (track && track.baseUrl) {
      const parsedTranscript = await fetchAndParseXmlCaptions(track.baseUrl);
      if (parsedTranscript && parsedTranscript.trim().length > 0) {
        transcriptText = parsedTranscript;
        extractionMethod = 'youtube-player-xml';
      }
    }
  }

  // 5. Final check: Strictly verify transcript text exists (NO AI FALLBACK)
  if (!transcriptText || transcriptText.trim().length === 0) {
    const errMsg =
      lang === 'ar'
        ? `لم يتم العثور على تفريغ نصي (ترجمة) متاح لهذا الفيديو على يوتيوب. يرجى التأكد من أن الفيديو يحتوي على ترجمة أو تفريغ نصي (Subtitles/Captions) مفعل.`
        : `No transcript or subtitles available for this YouTube video. Please choose a video with enabled captions/subtitles.`;
    throw new Error(errMsg);
  }

  const words = transcriptText.trim().split(/\s+/).length;

  return {
    success: true,
    videoId,
    title: videoTitle,
    channel: channelName,
    duration: durationStr,
    thumbnail,
    videoUrl: targetUrl,
    transcript: transcriptText,
    wordCount: words,
    extractionMethod,
    extractedAt: new Date().toISOString(),
  };
}
