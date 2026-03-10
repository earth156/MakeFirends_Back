const express = require('express');
const supabase = require('../config/supabase');
const upload = require('../middlewares/upload');
const router = express.Router();

// --- 1. GET: ดึงประวัติข้อความแชทของกิจกรรม ---
router.get('/activities/:id/messages', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('messages')
            .select(`
                *,
                sender:users!sender_email(name, profile_image)
            `)
            .eq('activity_id', id)
            .order('created_at', { ascending: true }); // เรียงจากข้อความเก่าไปใหม่

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error("Fetch Messages Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 2. POST: ส่งข้อความใหม่ (รองรับการแนบรูปภาพ 1 รูป) ---
router.post('/messages', upload.single('image'), async (req, res) => {
    try {
        const { activity_id, sender_email, text, is_system_message } = req.body;
        const file = req.file;
        let imageUrl = null;

        // หากมีการส่งรูปภาพมาด้วย ให้อัปโหลดขึ้น Storage
        if (file) {
            const extension = file.originalname.split('.').pop();
            const fileName = `chat_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`; 
            
            const { error: uploadError } = await supabase.storage
                .from('chat_images') // ตรวจสอบว่าคุณสร้าง Bucket ชื่อนี้ใน Supabase แล้ว
                .upload(fileName, file.buffer, { contentType: file.mimetype });

            if (uploadError) throw uploadError;

            // ดึง Public URL ของรูปภาพ
            const { data: urlData } = supabase.storage.from('chat_images').getPublicUrl(fileName);
            imageUrl = urlData.publicUrl;
        }

        // บันทึกข้อมูลลงตาราง messages
        const { error } = await supabase
            .from('messages')
            .insert([{ 
                activity_id, 
                sender_email, 
                text: text || '', // กรณีส่งแต่รูป ข้อความจะเป็นค่าว่าง
                image_url: imageUrl,
                is_system_message: is_system_message === 'true' // แปลงจาก String เป็น Boolean
            }]);

        if (error) throw error;
        res.status(201).json({ message: 'ส่งข้อความสำเร็จ' });
    } catch (err) {
        console.error("Send Message Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;