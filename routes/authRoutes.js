const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // เพิ่ม JWT
const crypto = require('crypto'); // เพิ่มสำหรับการสร้าง token ยืนยันอีเมล
const { sendVerificationEmail } = require('./emailService'); // นำเข้าฟังก์ชันส่งอีเมล
const supabase = require('../config/supabase');
const upload = require('../middlewares/upload');
const router = express.Router();

// คีย์ลับสำหรับสร้าง Token (ในอนาคตควรเก็บในไฟล์ .env)
const JWT_SECRET = 'your_activity_hub_secret_key_2026';

// --- 1. ROUTE: สมัครสมาชิก (REGISTER) ---
router.post('/users', upload.single('image'), async (req, res) => {
    try {
        const { email, password, name, phone, dob, interests } = req.body;
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

        let parsedInterests = [];
        if (interests) {
            parsedInterests = typeof interests === 'string' ? JSON.parse(interests) : interests;
        }

        // --- สร้าง OTP 6 หลัก สำหรับยืนยันอีเมล ---
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedVerificationToken = crypto.createHash('sha256').update(otp).digest('hex');
        const tokenExpires = new Date(Date.now() + 3600000).toISOString(); // หมดอายุใน 1 ชั่วโมง

        const { error: dbError } = await supabase
            .from('users')
            .insert([
                { 
                    email, 
                    password: hashedPassword, 
                    name, 
                    phone, 
                    dob, 
                    interests: parsedInterests,
                    profile_image: imageUrl,
                    role: 'user',
                    is_verified: false,
                    verification_token: hashedVerificationToken,
                    verification_token_expires: tokenExpires
                }
            ]);

        if (dbError) throw dbError;

        // --- ส่งอีเมลยืนยัน ---
        try {
            await sendVerificationEmail(email, otp);
        } catch (emailErr) {
            console.error("Send email error:", emailErr);
            // หากส่งอีเมลไม่สำเร็จ ให้ลบข้อมูลที่พึ่งบันทึกไปทิ้ง (Rollback)
            await supabase.from('users').delete().eq('email', email);
            return res.status(500).json({ error: "ไม่สามารถส่งอีเมลยืนยันได้ โปรดตรวจสอบว่าอีเมลถูกต้องและมีอยู่จริง" });
        }

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

        // --- เช็คว่าผู้ใช้ยืนยันอีเมลหรือยัง ก่อนที่จะอนุญาตให้ล็อกอิน (ยกเว้น Admin) ---
        if (user.role !== 'admin' && user.is_verified === false) {
            return res.status(403).json({ error: 'Email not verified' });
        }

        // --- อัปเดตสถานะเป็นออนไลน์ ---
        await supabase.from('users').update({ is_online: true }).eq('email', user.email);

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

// --- 3. ROUTE: ออกจากระบบ (LOGOUT) ---
router.post('/logout', async (req, res) => {
    try {
        const { email } = req.body;
        if (email) {
            // --- อัปเดตสถานะเป็นออฟไลน์ ---
            await supabase.from('users').update({ is_online: false }).eq('email', email);
        }
        res.status(200).json({ message: 'Logged out successfully' });
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;