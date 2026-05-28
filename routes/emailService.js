const nodemailer = require('nodemailer');

// ตั้งค่า transporter (ตัวส่งอีเมล)
// คำแนะนำ: ในโหมด Development เราจะใช้ Gmail ไปก่อน
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: 'earthjirawat156@gmail.com', // 👈 ใส่อีเมล Gmail ของคุณ
        pass: 'nvemhaoklqvgumaj'      // 👈 ใส่ App Password (รหัสผ่านแอป) 16 หลัก
    }
});

// --- ทดสอบการเชื่อมต่อกับ Gmail เมื่อ Server เริ่มทำงาน ---
transporter.verify((error, success) => {
    if (error) {
        console.error('❌ ตั้งค่า Gmail ผิดพลาด (ตรวจสอบ App Password หรือการตั้งค่าความปลอดภัย):', error.message);
    } else {
        console.log('✅ ระบบพร้อมส่งอีเมลผ่าน Gmail แล้ว');
    }
});

/**
 * ส่งอีเมลยืนยันการสมัครสมาชิก
 * @param {string} toEmail - อีเมลผู้รับ
 * @param {string} otp - รหัส OTP 6 หลัก
 */
const sendVerificationEmail = async (toEmail, otp) => {
    const mailOptions = {
        from: '"Activity Hub" <earthjirawat156@gmail.com>', // 👈 ใส่อีเมลของคุณตรงนี้ด้วย
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
    };

    try {
        // รอให้ส่งเสร็จและรับค่า info กลับมา
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email sent successfully to', toEmail, '| Response:', info.response);
    } catch (error) {
        console.error('❌ Failed to send email to', toEmail, '| Error:', error.message);
        throw error; // โยน Error กลับไปให้ authRoutes.js จัดการลบ User ทิ้ง
    }
};

module.exports = { sendVerificationEmail };