const express = require('express');
const supabase = require('../config/supabase');
const upload = require('../middlewares/upload');
const router = express.Router();

// --- 1. GET: ดึงข้อมูลโปรไฟล์รายบุคคล ---
router.get('/users/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) return res.status(404).json({ error: "ไม่พบข้อมูลผู้ใช้" });
        res.status(200).json(user);
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// --- 2. PUT: อัปเดตข้อมูลโปรไฟล์ ---
router.put('/users/update-profile', upload.single('profile_image'), async (req, res) => {
    try {
        const { email, name, bio, university, dob, gender, interests } = req.body;
        const file = req.file;
        let profileImageUrl = req.body.existing_profile_image;

        if (file) {
            const fileName = `profile_${Date.now()}_${Math.floor(Math.random() * 1000)}.${file.originalname.split('.').pop()}`;
            const { error: uploadError } = await supabase.storage
                .from('profile_images')
                .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: true });

            if (uploadError) throw uploadError;
            const { data: urlData } = supabase.storage.from('profile_images').getPublicUrl(fileName);
            profileImageUrl = urlData.publicUrl;
        }

        const { data, error } = await supabase
            .from('users')
            .update({
                name, bio, university, dob, gender,
                interests: interests ? (typeof interests === 'string' ? JSON.parse(interests) : interests) : [],
                profile_image: profileImageUrl
            })
            .eq('email', email)
            .select();

        if (error) throw error;
        res.status(200).json(data[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 3. GET: รายการการแจ้งเตือน (สำคัญสำหรับ Flutter) ---
router.get('/notifications/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_email', email)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 4. PUT: ทำเครื่องหมายว่าอ่านแล้ว ---
router.put('/notifications/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', id);

        if (error) throw error;
        res.json({ message: "Marked as read" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/friend-request', async (req, res) => {
    try {
        const { sender_email, receiver_email } = req.body;
        
        // 1. Insert ลงตาราง friend_requests
        const { data: requestData, error: requestError } = await supabase
            .from('friend_requests')
            .insert([{ sender_email, receiver_email, status: 'pending' }])
            .select();

        if (requestError) {
            console.error("Error inserting friend request:", requestError);
            throw requestError;
        }

        const friendRequestId = requestData[0].id; // นี่คือเลข ID (เช่น เลข 7)

        // 2. Insert ลงตาราง notifications (จุดที่เคยพัง)
        const { error: notifError } = await supabase.from('notifications').insert([{
            user_email: receiver_email,
            title: "คำขอเพิ่มเพื่อน",
            message: `มีคนส่งคำขอเป็นเพื่อนถึงคุณ`,
            type: 'friend_request',
            activity_id: friendRequestId, // ตอนนี้ช่องนี้ใน DB ต้องเป็น int8 แล้วนะ!
            is_read: false
        }]);

        if (notifError) {
            console.error("Error inserting notification:", notifError);
            throw notifError;
        }

        res.status(201).json({ message: "ส่งคำขอสำเร็จ" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 6. POST: ตอบรับเพื่อน (Accept) ---
router.post('/friend-request/accept', async (req, res) => {
    try {
        const { request_id, notification_id } = req.body;
        
        // 1. ดึงข้อมูลคำขอ
        const { data: reqData } = await supabase.from('friend_requests').select('*').eq('id', request_id).single();
        if (!reqData) return res.status(404).json({ error: "ไม่พบข้อมูลคำขอ" });

        // 2. อัปเดตสถานะคำขอ
        await supabase.from('friend_requests').update({ status: 'accepted' }).eq('id', request_id);
        
        // 3. เพิ่มลงตารางเพื่อน (Friendship)
        await supabase.from('friends').insert([{ user_email_1: reqData.sender_email, user_email_2: reqData.receiver_email }]);
        
        // 4. เปลี่ยนสถานะการแจ้งเตือนเดิมเป็นอ่านแล้ว
        await supabase.from('notifications').update({ is_read: true }).eq('id', notification_id);

        // 5. แจ้งเตือนกลับไปหาผู้ส่งเดิม (Optional แต่ควรมี)
        const { data: receiver } = await supabase.from('users').select('name').eq('email', reqData.receiver_email).single();
        await supabase.from('notifications').insert([{
            user_email: reqData.sender_email,
            title: "รับคำขอเป็นเพื่อนแล้ว",
            message: `${receiver.name} ยอมรับคำขอเป็นเพื่อนของคุณแล้ว`,
            type: 'friend_accepted',
            is_read: false
        }]);

        res.json({ message: "ยอมรับคำขอแล้ว" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 7. POST: ปฏิเสธเพื่อน (Reject) ---
router.post('/friend-request/reject', async (req, res) => {
    try {
        const { request_id, notification_id } = req.body;
        await supabase.from('friend_requests').update({ status: 'rejected' }).eq('id', request_id);
        await supabase.from('notifications').update({ is_read: true }).eq('id', notification_id);
        res.json({ message: "ปฏิเสธคำขอแล้ว" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 8. GET: รายชื่อเพื่อนทั้งหมด ---
router.get('/users/:email/friends', async (req, res) => {
    try {
        const { email } = req.params;
        const { data, error } = await supabase.from('friends')
            .select('u1:users!user_email_1(name, profile_image, email), u2:users!user_email_2(name, profile_image, email)')
            .or(`user_email_1.eq.${email},user_email_2.eq.${email}`);

        if (error) throw error;
        const friendsList = data.map(f => f.u1.email === email ? f.u2 : f.u1);
        res.json(friendsList);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;