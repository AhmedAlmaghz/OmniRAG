import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore
import { getSubtitles } from 'youtube-captions-scraper';

export const dynamic = 'force-dynamic';

function extractVideoId(url: string): string | null {
  if (!url) return null;
  const regExp = /^.*(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.trim().match(regExp);
  return match && match[1].length === 11 ? match[1] : null;
}

function extractCaptionsFromHtml(html: string, targetLang: string = 'ar'): any {
  try {
    const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]*?});\s*<\/script>/) || 
                                html.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]*?})\s*<\/script>/) ||
                                html.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]*?});/) || 
                                html.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]*?})\s*</);
    if (!playerResponseMatch) return null;
    
    const playerResponse = JSON.parse(playerResponseMatch[1]);
    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    
    if (!captionTracks || !Array.isArray(captionTracks) || captionTracks.length === 0) {
      return null;
    }

    // Priority:
    // 1. Exact match with targetLang (e.g., 'ar')
    // 2. Starts with targetLang (e.g., 'ar-EG')
    // 3. Fallback to English ('en')
    // 4. Any English track ('en-US', etc.)
    // 5. First track
    let selectedTrack = captionTracks.find((track: any) => track.languageCode === targetLang);
    if (!selectedTrack) {
      selectedTrack = captionTracks.find((track: any) => track.languageCode?.startsWith(targetLang));
    }
    if (!selectedTrack) {
      selectedTrack = captionTracks.find((track: any) => track.languageCode === 'en');
    }
    if (!selectedTrack) {
      selectedTrack = captionTracks.find((track: any) => track.languageCode?.startsWith('en'));
    }
    if (!selectedTrack) {
      selectedTrack = captionTracks[0];
    }

    return selectedTrack;
  } catch (e) {
    console.error('Error extracting captions from playerResponse:', e);
    return null;
  }
}

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
      
      text = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' '); // strip inline tags & collapse spaces
      
      if (text) {
        const totalSecs = Math.floor(parseFloat(match[1]));
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        const timestampStr = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}] `;
        captions.push(`${timestampStr}${text}`);
      }
    }

    return captions.length > 0 ? captions.join('\n') : null;
  } catch (e) {
    console.error('Error fetching/parsing XML captions:', e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { url, lang = 'ar' } = await req.json();

    if (!url) {
      return NextResponse.json({ error: 'يرجى تقديم رابط فيديو يوتيوب صحيح (YouTube Video URL)' }, { status: 400 });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: 'رابط فيديو يوتيوب غير صالح. يرجى التنسيق مثل: https://www.youtube.com/watch?v=VIDEO_ID' },
        { status: 400 }
      );
    }

    const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
    let videoTitle = `فيديو يوتيوب (${videoId})`;
    let channelName = 'YouTube Video';
    let durationStr = 'غير محدد';
    let thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    let transcriptText = '';
    let fetchedHtml = '';

    // Fetch video metadata & prepare player response
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

        // Extract Title
        const titleMatch = fetchedHtml.match(/<title>(.*?)<\/title>/i) || fetchedHtml.match(/"title":"(.*?)"/);
        if (titleMatch && titleMatch[1]) {
          videoTitle = titleMatch[1].replace(' - YouTube', '').trim();
        }

        // Extract Channel Name
        const channelMatch = fetchedHtml.match(/"author":"(.*?)"/) || fetchedHtml.match(/"ownerChannelName":"(.*?)"/);
        if (channelMatch && channelMatch[1]) {
          channelName = channelMatch[1].trim();
        }

        // Extract duration from playerResponse if available
        const playerResponseMatch = fetchedHtml.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]*?});\s*<\/script>/) || 
                                    fetchedHtml.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]*?})\s*<\/script>/) ||
                                    fetchedHtml.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]*?});/) || 
                                    fetchedHtml.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]*?})\s*</);
        if (playerResponseMatch) {
          try {
            const playerResponse = JSON.parse(playerResponseMatch[1]);
            if (playerResponse.videoDetails) {
              videoTitle = playerResponse.videoDetails.title || videoTitle;
              channelName = playerResponse.videoDetails.author || channelName;
              const lengthSecs = parseInt(playerResponse.videoDetails.lengthSeconds || '0');
              if (lengthSecs > 0) {
                const m = Math.floor(lengthSecs / 60);
                const s = lengthSecs % 60;
                durationStr = `${m}:${s.toString().padStart(2, '0')}`;
              }
            }
          } catch (e) {
            console.warn('Failed to parse metadata in playerResponse:', e);
          }
        }
      }
    } catch (e) {
      console.warn('Error fetching YouTube metadata:', e);
    }

    // 1. FIRST ATTEMPT: Try direct extraction of available player caption tracks
    if (fetchedHtml) {
      console.log(`[YouTube Local Direct Parser] Trying to find caption tracks for: ${videoId}`);
      const track = extractCaptionsFromHtml(fetchedHtml, lang);
      if (track && track.baseUrl) {
        console.log(`[YouTube Local Direct Parser] Found track: ${track.languageCode} (${track.name?.simpleText || 'unknown'})`);
        const parsedTranscript = await fetchAndParseXmlCaptions(track.baseUrl);
        if (parsedTranscript) {
          transcriptText = parsedTranscript;
          console.log(`[YouTube Local Direct Parser] Successfully extracted transcript!`);
        }
      }
    }

    // 2. SECOND ATTEMPT: Fallback to local youtube-captions-scraper if the direct parser didn't succeed
    if (!transcriptText || transcriptText.trim().length === 0) {
      console.log(`[youtube-captions-scraper] Running fallback for video: ${videoId}`);
      try {
        const captions = await getSubtitles({
          videoID: videoId,
          lang: lang || 'ar',
        });
        
        if (captions && captions.length > 0) {
          transcriptText = captions
            .map((c: any) => {
              const totalSecs = Math.floor(parseFloat(c.start));
              const mins = Math.floor(totalSecs / 60);
              const secs = totalSecs % 60;
              const timestampStr = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}] `;
              return `${timestampStr}${c.text}`;
            })
            .join('\n');
          console.log(`[youtube-captions-scraper] Extracted ${captions.length} lines (lang: ${lang})`);
        }
      } catch (scraperErr: any) {
        console.warn(`[youtube-captions-scraper] Failed for lang ${lang}. Trying English fallback...`);
        try {
          const captionsEn = await getSubtitles({
            videoID: videoId,
            lang: 'en',
          });
          if (captionsEn && captionsEn.length > 0) {
            transcriptText = captionsEn
              .map((c: any) => {
                const totalSecs = Math.floor(parseFloat(c.start));
                const mins = Math.floor(totalSecs / 60);
                const secs = totalSecs % 60;
                const timestampStr = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}] `;
                return `${timestampStr}${c.text}`;
              })
              .join('\n');
            console.log(`[youtube-captions-scraper] Extracted ${captionsEn.length} lines (lang: en)`);
          }
        } catch (scraperErr2: any) {
          console.error('[youtube-captions-scraper] Failed to find English subtitles as well.');
        }
      }
    }

    if (!transcriptText || transcriptText.trim().length === 0) {
      return NextResponse.json(
        { 
          error: lang === 'ar'
            ? 'لم نتمكن من العثور على أي تفريغ نصي لهذا الفيديو باستخدام أداة yt-caption محلياً. يرجى التأكد من أن الفيديو يحتوي على ترجمات وشروح مصاحبة (Captions/Subtitles) مفعلة على اليوتيوب.'
            : 'No captions/subtitles could be found for this video using the local yt-caption tool. Please ensure captions are enabled on YouTube for this video.'
        },
        { status: 404 }
      );
    }

    const words = transcriptText.trim().split(/\s+/).length;

    return NextResponse.json({
      success: true,
      videoId,
      title: videoTitle,
      channel: channelName,
      duration: durationStr,
      thumbnail,
      videoUrl: targetUrl,
      transcript: transcriptText,
      wordCount: words,
      extractedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('YouTube transcript route error:', error);
    return NextResponse.json(
      { error: error.message || 'حدث خطأ أثناء معالجة تفريغ فيديو يوتيوب عبر الأداة المحلية' },
      { status: 500 }
    );
  }
}
