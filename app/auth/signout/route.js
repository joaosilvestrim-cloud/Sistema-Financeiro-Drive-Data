import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

export async function POST(request) {
  const supabase = await supabaseServer()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 })
}
