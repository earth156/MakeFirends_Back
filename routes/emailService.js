const { Resend } = require('resend');

// ดึง API Key จาก Environment Variables หรือใส่แทนที่ 're_xxx' ได้เลย
const resend = new Resend(process.env.RESEND_API_KEY || 're_ใส่รหัสAPI_ของคุณที่นี่');

/**
 * ส่งอีเมลยืนยันการสมัครสมาชิก
 * @param {string} toEmail - อีเมลผู้รับ
 * @param {string} otp - รหัส OTP 6 หลัก
 */
const sendVerificationEmail = async (toEmail, otp) => {
    try {
        const data = await resend.emails.send({
            from: 'onboarding@resend.dev', // ในช่วงทดสอบใช้เมลนี้ฟรีครับ
            to: toEmail,
            subject: 'รหัส OTP ยืนยันอีเมลของคุณสำหรับ Activity Hub',
            html: `
                <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px;">
                    <h2>ยินดีต้อนรับสู่ Activity Hub!</h2>
                    <p>ขอบคุณที่สมัครสมาชิก กรุณานำรหัส OTP ด้านล่างไปกรอกในแอปพลิเคชันเพื่อยืนยันอีเมลของคุณ:</p>
                    <div style="background-color: #f3f0ff; color: #6210CC; padding: 15px 25px; border-radius: 5px; display: inline-block; margin-top: 20px; font-size: 24px; font-weight: bold; letter-spacing: 5px;">
                        ${otp}
                    </div>
                    <p style="margin-top: 20px; color: #888;">รหัสนี้มีอายุการใช้งาน 1 ชั่วโมง</p>
                    <p style="margin-top: 20px;">หากคุณไม่ได้สมัครสมาชิก กรุณาเพิกเฉยอีเมลฉบับนี้</p>
                </div>
            `
        });
        console.log('✅ Email sent successfully via Resend to', toEmail, '| Response:', data.id);
    } catch (error) {
        console.error('❌ Failed to send email via Resend to', toEmail, '| Error:', error.message);
        throw error; // โยน Error กลับไปให้ authRoutes.js จัดการลบ User ทิ้ง
    }
};

module.exports = { sendVerificationEmail };