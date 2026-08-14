import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse } from 'next/server';
import { processYoutubeTranscript } from '@/lib/youtube/transcriptParser';

export const dynamic = 'force-dynamic';

export const POST = withAuthAndRateLimit(async (req, authCtx, props) => {
  try {
    const { url, lang = 'ar' } = await req.json();

    const result = await processYoutubeTranscript(url, lang);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('YouTube transcript route error:', error);
    return NextResponse.json(
      { error: error.message || 'حدث خطأ أثناء معالجة تفريغ فيديو يوتيوب' },
      { status: error.message && error.message.includes('صحيح') ? 400 : 500 }
    );
  }
});
