const { createClient } = require('@supabase/supabase-js');
require('dotenv').config(); // 👈 เพิ่มบรรทัดนี้ เพื่อให้มันอ่านไฟล์ .env ได้

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

module.exports = supabase;