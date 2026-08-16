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
    // Validation errors carry a user-facing Arabic message (e.g. invalid URL) → 400.
    const isValidation = typeof error?.message === 'string' && error.message.includes('صحيح');
    if (isValidation) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'حدث خطأ أثناء معالجة تفريغ فيديو يوتيوب', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
});
