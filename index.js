const express = require('express');
const cors = require('cors');
const startCronJobs = require('./cron/activityCron');

const app = express();
const port = 3000;

// --- 1. ตั้งค่า Middleware ---
app.use(cors());
app.use(express.json());

// --- 2. นำเข้าและใช้งาน Routes ---
// การใช้ app.use('/', ...) จะทำให้ URL ของแอป Flutter ทำงานได้เหมือนเดิมโดยไม่ต้องแก้ไขโค้ดฝั่งแอปครับ

// จัดการการ Login และ Register
app.use('/', require('./routes/authRoutes'));

// จัดการโปรไฟล์ผู้ใช้ และข้อมูลส่วนตัว (รวมถึงความสนใจ)
app.use('/', require('./routes/userRoutes'));

// จัดการกิจกรรมทั้งหมด (สร้าง, แก้ไข, ลบ, ดึงข้อมูล, เข้าร่วม)
app.use('/', require('./routes/activityRoutes'));

// จัดการระบบแชทในกลุ่มกิจกรรม
app.use('/', require('./routes/messageRoutes'));

// จัดการระบบแจ้งเตือน, รีวิว และหมวดหมู่กิจกรรม
app.use('/', require('./routes/notificationRoutes'));

// --- 3. Route สำหรับเช็คสถานะการทำงานของ Server ---
app.get('/', (req, res) => {
    res.send('Server Activity Hub พร้อมใช้งานแล้ว! (โครงสร้างใหม่แบบแยกส่วนเป็นระเบียบ)');
});

// --- 4. เริ่มระบบ Cron Jobs (การทำงานเบื้องหลัง) ---
// ตรวจสอบและเริ่มกิจกรรมอัตโนมัติทุกๆ 1 นาที
startCronJobs();

// --- 5. เริ่มรัน Server ---
app.listen(port, () => {
    console.log('---------------------------------------------');
    console.log(`Server is running at http://localhost:${port}`);
    console.log('Status: Online');
    console.log('Database: Connected to Supabase');
    console.log('---------------------------------------------');
});