/**
 * ส่งอีเมลยืนยันการสมัครสมาชิก
 * @param {string} userEmail - อีเมลผู้รับ
 * @param {string} otp - รหัส OTP 6 หลัก
 */
const sendVerificationEmail = async (userEmail, otp) => {
    const BREVO_API_KEY = process.env.BREVO_API_KEY;

    try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': BREVO_API_KEY,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                sender: { 
                    name: 'Make Friends App', 
                    email: 'earthjirawat1567@gmail.com' 
                },
                to: [{ email: userEmail }],
                subject: 'รหัส OTP ยืนยันอีเมลของคุณสำหรับ Make Friends App',
                htmlContent: `
                    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; padding: 30px; background-color: #f4f4f9; border-radius: 10px;">
                        <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
                            <h2 style="color: #6210CC; margin-bottom: 20px;">ยินดีต้อนรับสู่ Make Friends App!</h2>
                            <p style="color: #555; font-size: 16px; line-height: 1.5;">ขอบคุณที่ร่วมเป็นส่วนหนึ่งกับเรา<br>กรุณานำรหัส OTP ด้านล่างไปกรอกในแอปพลิเคชันเพื่อยืนยันอีเมลของคุณ:</p>
                            <div style="background-color: #f3f0ff; border: 2px dashed #6210CC; color: #6210CC; padding: 20px 30px; border-radius: 8px; display: inline-block; margin: 25px 0; font-size: 36px; font-weight: bold; letter-spacing: 10px;">
                                ${otp}
                            </div>
                            <p style="color: #888; font-size: 14px;">รหัสนี้มีอายุการใช้งาน 1 ชั่วโมง</p>
                            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                            <p style="color: #aaa; font-size: 12px;">หากคุณไม่ได้ทำการสมัครสมาชิก กรุณาเพิกเฉยต่ออีเมลฉบับนี้</p>
                        </div>
                    </div>
                `
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(JSON.stringify(errData));
        }
        console.log('✅ Email sent successfully via Brevo HTTP API to', userEmail);
    } catch (error) {
        console.error('❌ Failed to send email via Brevo to', userEmail, '| Error:', error.message);
        throw error; 
    }
};

module.exports = { sendVerificationEmail };