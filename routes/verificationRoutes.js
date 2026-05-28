const express = require('express');
const router = express.Router();
const db = require('../config/supabase'); 
const crypto = require('crypto');
const { sendVerificationEmail } = require('./emailService');

// Endpoint ที่ผู้ใช้จะถูกส่งมาเมื่อคลิกลิงก์ในอีเมล
router.get('/verify-email', async (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.status(400).send('Verification token is missing.');
    }

    try {
        // Hash token ที่ได้รับมาเพื่อเปรียบเทียบกับใน DB
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        // ค้นหาผู้ใช้ด้วย hashed token และเช็คว่า token ยังไม่หมดอายุ
        const { data: user, error } = await db
            .from('users')
            .select('*')
            .eq('verification_token', hashedToken)
            .gt('verification_token_expires', new Date().toISOString())
            .single();

        if (error || !user) {
            return res.status(400).send('Token ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาลองใหม่อีกครั้ง');
        }

        // อัปเดตสถานะผู้ใช้
        const { data: updatedData, error: updateError } = await db
            .from('users')
            .update({
                is_verified: true,
                verification_token: null,
                verification_token_expires: null,
            })
            .eq('email', user.email)
            .select(); // ใส่ .select() เพื่อให้ส่งข้อมูลที่อัปเดตกลับมาตรวจสอบ

        if (updateError || !updatedData || updatedData.length === 0) {
            console.error('Update Error:', updateError);
            return res.status(500).send('<h1 style="color:red;">เกิดข้อผิดพลาด!</h1><p>ไม่สามารถอัปเดตสถานะในฐานข้อมูลได้ (อาจติดระบบความปลอดภัย RLS ของ Supabase)</p>');
        }

        // ส่งหน้าเว็บแจ้งว่าสำเร็จ (หรือจะ redirect ไปหน้า login ในแอปก็ได้)
        res.send('<h1>การยืนยันอีเมลสำเร็จ!</h1><p>คุณสามารถกลับไปที่แอปและเข้าสู่ระบบได้เลย</p>');

    } catch (err) {
        console.error('Email verification error:', err);
        res.status(500).send('เกิดข้อผิดพลาดในระบบ');
    }
});

// Endpoint สำหรับยืนยัน OTP จากแอป
router.post('/verify-otp', async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
    }

    try {
        const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

        // ค้นหาผู้ใช้ด้วย email และ hashed otp
        const { data: user, error } = await db
            .from('users')
            .select('*')
            .eq('email', email)
            .eq('verification_token', hashedOtp)
            .gt('verification_token_expires', new Date().toISOString())
            .single();

        if (error || !user) {
            return res.status(400).json({ error: 'รหัส OTP ไม่ถูกต้องหรือหมดอายุแล้ว' });
        }

        // อัปเดตสถานะผู้ใช้
        await db.from('users').update({
            is_verified: true,
            verification_token: null,
            verification_token_expires: null,
        }).eq('email', user.email);

        res.status(200).json({ message: 'ยืนยันอีเมลสำเร็จ' });

    } catch (err) {
        console.error('OTP verification error:', err);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// Endpoint สำหรับขอส่งอีเมลยืนยันอีกครั้ง
router.post('/resend-verification', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'กรุณาระบุอีเมล' });
    }

    const { data: user, error } = await db.from('users').select('*').eq('email', email).single();

    if (!user || user.is_verified) {
        return res.status(400).json({ error: 'ไม่พบอีเมลนี้ในระบบ หรือบัญชีนี้ถูกยืนยันแล้ว' });
    }

    // สร้าง OTP 6 หลักใหม่
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedToken = crypto.createHash('sha256').update(otp).digest('hex');
    const tokenExpires = new Date(Date.now() + 3600000); // 1 ชั่วโมง

    await db.from('users').update({
        verification_token: hashedToken,
        verification_token_expires: tokenExpires.toISOString(),
    }).eq('email', email);

    // ส่งอีเมล
    await sendVerificationEmail(email, otp);

    res.status(200).json({ message: 'ส่งอีเมลยืนยันอีกครั้งสำเร็จ' });
});

module.exports = router;