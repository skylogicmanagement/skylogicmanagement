import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

let urlIsValid = false
let supabaseConfigError = ''

if (supabaseUrl && supabasePublishableKey) {
  try {
    const parsedUrl = new URL(supabaseUrl)
    urlIsValid = parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:'
    if (!urlIsValid) supabaseConfigError = 'VITE_SUPABASE_URL debe usar HTTP o HTTPS.'
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    supabaseConfigError = 'VITE_SUPABASE_URL no contiene una URL válida.'
  }
}

if (!supabaseUrl || !supabasePublishableKey) {
  supabaseConfigError = 'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY.'
}

export { supabaseConfigError }

export const supabase =
  urlIsValid && supabaseUrl && supabasePublishableKey
    ? createClient<Database>(supabaseUrl, supabasePublishableKey)
    : null
