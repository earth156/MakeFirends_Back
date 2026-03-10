const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://hehypwffandecnrqjdtc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlaHlwd2ZmYW5kZWNucnFqZHRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3Mzg5NSwiZXhwIjoyMDg3MjQ5ODk1fQ.6sssu0rkEI0X_FWjWgygg5roVf8HaRI6uvdWqSM2uDA'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = supabase;