const express = require('express');
const supabase = require('../config/supabase');
const upload = require('../middlewares/upload');
const router = express.Router();

// --- 1. GET: ดึงข้อมูลโปรไฟล์ล่าสุดรายบุคคล (เพื่อให้หน้า Profile แสดงผล Interests ล่าสุด) ---
router.get('/users/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(404).json({ error: "ไม่พบข้อมูลผู้ใช้" });
        }

        // ส่งกลับข้อมูลครบถ้วน รวมถึงคอลัมน์ interests และ bio
        res.status(200).json(user);
    } catch (err) {
        console.error("Fetch User Error:", err.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// --- 2. PUT: อัปเดตข้อมูลโปรไฟล์ (Bio, University, DOB, Gender, Interests, Image) ---
router.put('/users/update-profile', upload.single('profile_image'), async (req, res) => {
    try {
        const { email, name, bio, university, dob, gender, interests } = req.body;
        const file = req.file;
        let profileImageUrl = req.body.existing_profile_image;

        // หากมีการอัปโหลดรูปใหม่
        if (file) {
            const fileName = `profile_${Date.now()}_${Math.floor(Math.random() * 1000)}.${file.originalname.split('.').pop()}`;
            
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('profile_images') // ตรวจสอบว่ามี Bucket ชื่อนี้ใน Supabase
                .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: true });

            if (uploadError) throw uploadError;

            const { data: urlData } = supabase.storage.from('profile_images').getPublicUrl(fileName);
            profileImageUrl = urlData.publicUrl;
        }

        // อัปเดตข้อมูลลงฐานข้อมูล
        const { data, error } = await supabase
            .from('users')
            .update({
                name,
                bio,
                university,
                dob,
                gender,
                interests: interests ? JSON.parse(interests) : [], // แปลง String กลับเป็น Array
                profile_image: profileImageUrl
            })
            .eq('email', email)
            .select();

        if (error) throw error;

        res.status(200).json(data[0]);
    } catch (err) {
        console.error("Update Profile Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 3. GET: ดึงรายการห้องแชท (กิจกรรมทั้งหมดที่ผู้ใช้เป็นสมาชิกอยู่) ---
router.get('/users/:email/chats', async (req, res) => {
    try {
        const { email } = req.params;
        
        // ดึงจาก activity_participants จะได้ทั้งกิจกรรมที่สร้างเองและเข้าร่วม
        const { data, error } = await supabase
            .from('activity_participants')
            .select(`
                activity:activities (
                    *,
                    creator:users!creator_email(name, profile_image),
                    participants:activity_participants(user:users(profile_image))
                )
            `)
            .eq('user_email', email);

        if (error) throw error;

        // จัดรูปแบบข้อมูล: กรองตัวที่อาจถูกลบออก และเรียงลำดับใหม่
        const chatRooms = data
            .map(item => item.activity)
            .filter(a => a !== null)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        res.json(chatRooms);
    } catch (err) {
        console.error("Fetch Chats Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;