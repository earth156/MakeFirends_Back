// const { createClient } = require('@supabase/supabase-js');

// //ของเท็น
// // const SUPABASE_URL = 'https://hehypwffandecnrqjdtc.supabase.co';
// // const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlaHlwd2ZmYW5kZWNucnFqZHRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTY3Mzg5NSwiZXhwIjoyMDg3MjQ5ODk1fQ.6sssu0rkEI0X_FWjWgygg5roVf8HaRI6uvdWqSM2uDA'; 

// const SUPABASE_URL = 'https://xpyozcyfnhepxhbtvzie.supabase.co';

// // ⚠️ ใช้ Service Role Key (secret) ในฝั่ง Backend เพื่อให้สามารถแก้ไขข้อมูลและข้ามกฎ RLS ได้อัตโนมัติ
// const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhweW96Y3lmbmhlcHhoYnR2emllIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODUxMTUzNywiZXhwIjoyMDk0MDg3NTM3fQ.LpNVPo5qlhtILc3xarzZpVRXxxTp32y3NYbVQR-tCXY'; 

// const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// module.exports = supabase;

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config(); // 👈 เพิ่มบรรทัดนี้ เพื่อให้มันอ่านไฟล์ .env ได้

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

module.exports = supabase;