const multer = require('multer');
// ใช้ multer เก็บไฟล์ไว้ใน Memory ชั่วคราวก่อนส่งไป Supabase
const upload = multer({ storage: multer.memoryStorage() });

module.exports = upload;