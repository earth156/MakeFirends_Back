const express = require('express');
const supabase = require('../config/supabase');
const router = express.Router();

// ==========================================
// 1. ส่วนการแจ้งเตือน (NOTIFICATIONS)
// ==========================================

// --- GET: ดึงรายการแจ้งเตือนทั้งหมดของผู้ใช้ ---
router.get('/notifications/:email', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_email', req.params.email)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error("Fetch Notifications Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- GET: นับจำนวนการแจ้งเตือนที่ยังไม่ได้อ่าน (สำหรับจุดสีแดงบนกระดิ่ง) ---
router.get('/notifications/:email/unread-count', async (req, res) => {
    try {
        const { count, error } = await supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_email', req.params.email)
            .eq('is_read', false); // กรองเฉพาะที่ยังไม่ได้อ่าน

        if (error) throw error;
        // ส่งกลับในรูปแบบที่ Flutter HomePage รอรับ
        res.json({ unread_count: count || 0 });
    } catch (err) {
        console.error("Unread Count Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- PUT: อัปเดตสถานะแจ้งเตือนว่าอ่านแล้ว ---
router.put('/notifications/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', id)
            .select();

        if (error) throw error;
        res.json({ success: true, notification: data[0] });
    } catch (err) {
        console.error("Update Read Status Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// ==========================================
// 2. ส่วนรีวิว (REVIEWS & RATING)
// ==========================================

// --- GET: ดึงข้อมูลรีวิวของบุคคลนั้นๆ (ใช้แสดงในหน้า Profile) ---
router.get('/users/:email/reviews', async (req, res) => {
    try {
        const { email } = req.params;
        const { data, error } = await supabase
            .from('reviews')
            .select(`
                id,
                rating,
                comment,
                created_at,
                reviewer:users!reviewer_email(name, profile_image)
            `)
            .eq('reviewee_email', email)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error("Fetch Reviews Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- POST: บันทึกรีวิวใหม่ และคำนวณคะแนนเฉลี่ยอัปเดตลงตาราง Users ---
router.post('/reviews', async (req, res) => {
    try {
        const { activity_id, reviewer_email, reviewee_email, rating, comment } = req.body;
        
        // 1. บันทึกรีวิวลงตาราง reviews
        const { error: reviewError } = await supabase
            .from('reviews')
            .insert([{ activity_id, reviewer_email, reviewee_email, rating, comment }]);

        if (reviewError) throw reviewError;

        // 2. ดึงเรตติ้งทั้งหมดของคนที่ถูกรีวิวมาคำนวณค่าเฉลี่ยใหม่
        const { data: allReviews } = await supabase
            .from('reviews')
            .select('rating')
            .eq('reviewee_email', reviewee_email);

        if (allReviews && allReviews.length > 0) {
            const sum = allReviews.reduce((total, r) => total + r.rating, 0);
            const avgRating = sum / allReviews.length;

            // 3. อัปเดตค่าเรตติ้งเฉลี่ยกลับไปที่ตาราง users
            await supabase
                .from('users')
                .update({ rating: avgRating })
                .eq('email', reviewee_email);
        }

        res.json({ message: "บันทึกรีวิวและอัปเดตเรตติ้งสำเร็จ" });
    } catch (err) {
        console.error("Save Review Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// ==========================================
// 3. ส่วนข้อมูลพื้นฐาน (GENERAL)
// ==========================================

// --- GET: ดึงรายการหมวดหมู่กิจกรรมทั้งหมด ---
router.get('/categories', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('categories') 
            .select('*')
            .order('name', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error("Fetch Categories Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});
// ใน notificationRoutes.js (ตรวจสอบจุดนี้)
router.get('/notifications/:email', async (req, res) => {
    const { data, error } = await supabase
        .from('notifications')
        .select('*') // มั่นใจว่าได้เลือกทุกคอลัมน์รวมถึง 'type' และ 'activity_id'
        .eq('user_email', req.params.email)
        .order('created_at', { ascending: false });
    res.json(data);
});


module.exports = router;