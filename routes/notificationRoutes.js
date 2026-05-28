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
                reviewer:users!reviewer_email(name, profile_image, banned_until)
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

// --- GET: ดึงข้อมูลรีวิวของกิจกรรม ---
router.get('/activities/:id/reviews', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('reviews')
            .select(`
                id,
                rating,
                comment,
                created_at,
                reviewer_email,
                reviewer:users!reviewer_email(name, profile_image, banned_until)
            `)
            .eq('activity_id', id)
            .is('reviewee_email', null)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error("Fetch Activity Reviews Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- GET: ดึงข้อมูลรีวิวของสมาชิกที่เกิดขึ้นในกิจกรรมนั้น ---
router.get('/activities/:id/user_reviews', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('reviews')
            .select(`
                id,
                rating,
                comment,
                created_at,
                reviewer_email,
                reviewer:users!reviewer_email(name, profile_image, banned_until)
            `)
            .eq('activity_id', id)
            .not('reviewee_email', 'is', null)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error("Fetch User Reviews Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- POST: บันทึกรีวิวใหม่ สำหรับรีวิวสมาชิก ---
router.post('/reviews', async (req, res) => {
    try {
        const { activity_id, reviewer_email, reviewee_email, rating, comment } = req.body;

        if (!activity_id || !reviewer_email || !reviewee_email || rating == null) {
            return res.status(400).json({ error: 'activity_id, reviewer_email, reviewee_email, and rating are required' });
        }

        if (reviewer_email === reviewee_email) {
            return res.status(400).json({ error: 'ไม่สามารถรีวิวตัวเองได้' });
        }

        const { data: activity, error: activityError } = await supabase
            .from('activities')
            .select('id, creator_email, status')
            .eq('id', activity_id)
            .single();

        if (activityError || !activity) {
            return res.status(404).json({ error: 'ไม่พบกิจกรรม' });
        }

        if (activity.status !== 'completed') {
            return res.status(403).json({ error: 'กิจกรรมยังไม่เสร็จสิ้น' });
        }

        const isReviewerCreator = reviewer_email === activity.creator_email;
        const isRevieweeCreator = reviewee_email === activity.creator_email;

        const { data: reviewerParticipation, error: reviewerParticipationError } = await supabase
            .from('activity_participants')
            .select('*')
            .eq('activity_id', activity_id)
            .eq('user_email', reviewer_email)
            .single();

        if (!isReviewerCreator && (reviewerParticipationError || !reviewerParticipation)) {
            return res.status(403).json({ error: 'ผู้ใช้นี้ไม่ใช่ผู้เข้าร่วมกิจกรรม' });
        }

        if (!isRevieweeCreator) {
            const { data: revieweeParticipation, error: revieweeParticipationError } = await supabase
                .from('activity_participants')
                .select('*')
                .eq('activity_id', activity_id)
                .eq('user_email', reviewee_email)
                .single();

            if (revieweeParticipationError || !revieweeParticipation) {
                return res.status(403).json({ error: 'คนที่ถูกรีวิวต้องเป็นผู้เข้าร่วมกิจกรรมเดียวกัน' });
            }
        }

        const { error: reviewError } = await supabase
            .from('reviews')
            .insert([{ activity_id, reviewer_email, reviewee_email, rating, comment }]);

        if (reviewError) throw reviewError;

        // --- คำนวณเรทติ้งของผู้ใช้ (User Rating) จากรีวิวส่วนตัว ---
        const { data: userReviews } = await supabase
            .from('reviews')
            .select('rating')
            .eq('reviewee_email', reviewee_email);

        if (userReviews && userReviews.length > 0) {
            const sum = userReviews.reduce((total, r) => total + r.rating, 0);
            const avgRating = sum / userReviews.length;

            await supabase
                .from('users')
                .update({ rating: avgRating })
                .eq('email', reviewee_email);
        }

        res.json({ message: "บันทึกรีวิวและอัปเดตเรตติ้งผู้ใช้สำเร็จ" });
    } catch (err) {
        console.error("Save Review Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- POST: บันทึกรีวิวกิจกรรมใหม่ ---
router.post('/activity_reviews', async (req, res) => {
    try {
        const { activity_id, reviewer_email, rating, comment } = req.body;
        if (!activity_id || !reviewer_email || rating == null) {
            return res.status(400).json({ error: 'activity_id, reviewer_email, and rating are required' });
        }

        // ตรวจสอบว่ากิจกรรมมีอยู่จริง
        const { data: activity, error: activityError } = await supabase
            .from('activities')
            .select('id, creator_email')
            .eq('id', activity_id)
            .single();

        if (activityError || !activity) {
            return res.status(404).json({ error: 'ไม่พบกิจกรรม' });
        }

        // เจ้าของกิจกรรมไม่สามารถรีวิวกิจกรรมเองได้
        if (activity.creator_email === reviewer_email) {
            return res.status(403).json({ error: 'เจ้าของกิจกรรมไม่สามารถรีวิวกิจกรรมได้' });
        }

        // ตรวจสอบว่าเป็นผู้เข้าร่วมกิจกรรม
        const { data: participant, error: participantError } = await supabase
            .from('activity_participants')
            .select('*')
            .eq('activity_id', activity_id)
            .eq('user_email', reviewer_email)
            .single();

        if (participantError || !participant) {
            return res.status(403).json({ error: 'ผู้ใช้นี้ไม่ใช่ผู้เข้าร่วมกิจกรรม' });
        }

        // บันทึกรีวิวกิจกรรมลงตาราง reviews โดยให้ reviewee_email เป็น null (เพื่อแยกแยะว่าเป็นรีวิวกิจกรรม)
        const { error: reviewError } = await supabase
            .from('reviews')
            .insert([{ activity_id, reviewer_email, reviewee_email: null, rating, comment }]);

        if (reviewError) throw reviewError;

        // --- คำนวณเรทติ้งของกิจกรรม (Activity Rating) ---
        const { data: actReviews } = await supabase
            .from('reviews')
            .select('rating')
            .eq('activity_id', activity_id)
            .is('reviewee_email', null);

        if (actReviews && actReviews.length > 0) {
            const sum = actReviews.reduce((total, r) => total + r.rating, 0);
            const avgRating = sum / actReviews.length;
            await supabase
                .from('activities')
                .update({ activity_rating: avgRating })
                .eq('id', activity_id);
        }

        res.json({ message: 'บันทึกรีวิวกิจกรรมและอัปเดตคะแนนกิจกรรมสำเร็จ' });
    } catch (err) {
        console.error('Save Activity Review Error:', err.message);
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

module.exports = router;