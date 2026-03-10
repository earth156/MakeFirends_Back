const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // เพิ่ม JWT
const supabase = require('../config/supabase');
const upload = require('../middlewares/upload');
const router = express.Router();

// คีย์ลับสำหรับสร้าง Token (ในอนาคตควรเก็บในไฟล์ .env)
const JWT_SECRET = 'your_activity_hub_secret_key_2026';

// --- 1. ROUTE: สมัครสมาชิก (REGISTER) ---
router.post('/users', upload.single('image'), async (req, res) => {
    try {
        const { email, password, name, phone, dob } = req.body;
        const file = req.file;

        // --- ตรวจสอบว่าอีเมลหรือเบอร์โทรซ้ำหรือไม่ ---
        const { data: existingUser } = await supabase
            .from('users')
            .select('email, phone')
            .or(`email.eq.${email},phone.eq.${phone}`)
            .maybeSingle();

        if (existingUser) {
            if (existingUser.email === email) return res.status(400).json({ error: "อีเมลนี้ถูกใช้งานไปแล้ว" });
            if (existingUser.phone === phone) return res.status(400).json({ error: "เบอร์โทรศัพท์นี้ถูกใช้งานไปแล้ว" });
        }

        // --- จัดการรูปโปรไฟล์ ---
        let imageUrl = '';
        if (file) {
            const extension = file.originalname.split('.').pop();
            const fileName = `profile_${Date.now()}.${extension}`; 

            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(fileName, file.buffer, {
                    contentType: file.mimetype,
                    upsert: true
                });

            if (uploadError) throw uploadError;

            const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
            imageUrl = urlData.publicUrl;
        }

        // --- เข้ารหัสผ่านและบันทึกข้อมูล ---
        const hashedPassword = await bcrypt.hash(password, 10);

        const { error: dbError } = await supabase
            .from('users')
            .insert([
                { 
                    email, 
                    password: hashedPassword, 
                    name, 
                    phone, 
                    dob, 
                    profile_image: imageUrl,
                    role: 'user'
                }
            ]);

        if (dbError) throw dbError;

        res.status(201).json({ message: 'ลงทะเบียนสำเร็จ' });
    } catch (err) {
        console.error('Registration Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();
        if (error || !user) {
            return res.status(401).json({ error: "ไม่พบผู้ใช้งานนี้ในระบบ" });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        
        if (!isMatch) {
            return res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" });
        }
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role || 'user' },
            JWT_SECRET,
            { expiresIn: '1d' }
        );
        res.status(200).json({
            message: "Success",
            token: token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role || 'user',
                profile_image: user.profile_image,
                interests: user.interests || []
            }
        });
    } catch (err) {
        console.error('Login Error:', err.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;