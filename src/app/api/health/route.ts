import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    framework: 'Next.js',
    version: '16.3.0',
    mode: 'App Router',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
}
