const express = require('express');
const supabase = require('../config/supabase');
const upload = require('../middlewares/upload');
const router = express.Router();

// --- 1. GET: ดึงรายการกิจกรรมทั้งหมด (Discovery Feed) ---
router.get('/activities', async (req, res) => {
    try {
        const { search, category, province, user_interests } = req.query;
        const now = new Date().toISOString(); 

        let query = supabase
            .from('activities')
            .select(`
                *,
                creator:users!creator_email(name, profile_image),
                participants:activity_participants(user_email, user:users(name, profile_image))
            `)
            .gt('end_datetime', now); // แสดงเฉพาะกิจกรรมที่ยังไม่จบ

        if (search) query = query.ilike('title', `%${search}%`);
        if (category && category !== 'ทั้งหมด') query = query.contains('category_tags', [category]);
        if (province && province !== 'ทั้งหมด') query = query.eq('province', province);

        const { data, error } = await query.order('start_datetime', { ascending: true });
        if (error) throw error;

        let finalData = data || [];

        // ตรรกะการเรียงตามความสนใจ (Personalized Feed)
        if (user_interests && user_interests !== 'undefined') {
            try {
                const interestsArray = JSON.parse(user_interests);
                finalData.sort((a, b) => {
                    const aMatches = a.category_tags.filter(tag => interestsArray.includes(tag)).length;
                    const bMatches = b.category_tags.filter(tag => interestsArray.includes(tag)).length;
                    if (aMatches !== bMatches) return bMatches - aMatches;
                    return new Date(a.start_datetime) - new Date(b.start_datetime);
                });
            } catch (e) {
                console.error("Sorting failed", e);
            }
        }
        res.json(finalData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 2. POST: สร้างกิจกรรมใหม่ ---
router.post('/activities', upload.array('images', 3), async (req, res) => {
    try {
        const { title, description, start_datetime, end_datetime, province, max_participants, category_tags, creator_email } = req.body;
        const files = req.files;
        let imageUrls = []; 

        if (files && files.length > 0) {
            for (const file of files) {
                const fileName = `act_${Date.now()}_${Math.floor(Math.random() * 1000)}_${file.originalname}`;
                const { error: uploadError } = await supabase.storage
                    .from('activity_images')
                    .upload(fileName, file.buffer, { contentType: file.mimetype });

                if (uploadError) throw uploadError;
                const { data: urlData } = supabase.storage.from('activity_images').getPublicUrl(fileName);
                imageUrls.push(urlData.publicUrl);
            }
        }

        const { data: activityData, error: dbError } = await supabase
            .from('activities')
            .insert([{
                title, description, image_urls: imageUrls, start_datetime, end_datetime, 
                province, max_participants: parseInt(max_participants),
                category_tags: JSON.parse(category_tags),
                creator_email, status: 'upcoming'
            }])
            .select();

        if (dbError) throw dbError;

        // บันทึกเจ้าของกิจกรรมลงตารางสมาชิกด้วย เพื่อให้เห็นแชทตัวเอง
        await supabase.from('activity_participants').insert([{ 
            activity_id: activityData[0].id, 
            user_email: creator_email 
        }]);

        res.status(201).json(activityData[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 3. GET: รายละเอียดกิจกรรมรายตัว ---
router.get('/activities/:id/details', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('activities')
            .select(`
                *,
                creator:users!creator_email(name, profile_image),
                participants:activity_participants(user_email, user:users(name, profile_image))
            `)
            .eq('id', req.params.id)
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 4. PUT: แก้ไขกิจกรรม ---
router.put('/activities/:id', upload.array('images', 3), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, province, start_datetime, end_datetime, max_participants, category_tags, email, existing_images } = req.body;

        const { data: activity } = await supabase.from('activities').select('creator_email').eq('id', id).single();
        if (!activity || activity.creator_email !== email) return res.status(403).json({ error: "ไม่มีสิทธิ์แก้ไข" });

        let imageUrls = existing_images ? JSON.parse(existing_images) : [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const fileName = `act_${Date.now()}_${file.originalname}`;
                await supabase.storage.from('activity_images').upload(fileName, file.buffer, { contentType: file.mimetype });
                const { data: urlData } = supabase.storage.from('activity_images').getPublicUrl(fileName);
                imageUrls.push(urlData.publicUrl);
            }
        }

        await supabase.from('activities').update({
            title, description, province, start_datetime, end_datetime, 
            max_participants: parseInt(max_participants),
            category_tags: JSON.parse(category_tags),
            image_urls: imageUrls
        }).eq('id', id);

        res.json({ message: "แก้ไขสำเร็จ" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 5. DELETE: ลบกิจกรรม ---
router.delete('/activities/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;

        const { data: activity } = await supabase.from('activities').select('title, creator_email').eq('id', id).single();
        if (!activity || activity.creator_email !== email) return res.status(403).json({ error: "ไม่มีสิทธิ์ลบ" });

        await supabase.from('activity_participants').delete().eq('activity_id', id);
        await supabase.from('activities').delete().eq('id', id);
        res.json({ message: "ลบสำเร็จ" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 6. POST: เข้าร่วมกิจกรรม ---
router.post('/join_activity', async (req, res) => {
    try {
        const { activity_id, user_email } = req.body;
        const { data: existing } = await supabase.from('activity_participants').select('*').eq('activity_id', activity_id).eq('user_email', user_email);
        if (existing.length > 0) return res.status(400).json({ error: 'คุณเข้าร่วมไปแล้ว' });

        await supabase.from('activity_participants').insert([{ activity_id, user_email }]);
        
        const { data: user } = await supabase.from('users').select('name').eq('email', user_email).single();
        await supabase.from('messages').insert([{
            activity_id, sender_email: user_email, text: `${user.name} เข้าร่วมกลุ่ม`, is_system_message: true
        }]);

        res.status(200).send('Joined');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 7. GET: กิจกรรมที่ผู้ใช้เข้าร่วม (สำหรับหน้า Chat List) ---
router.get('/activities/joined/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const { data, error } = await supabase
            .from('activity_participants')
            .select(`
                activity:activities (
                    *,
                    creator:users!creator_email(name, profile_image),
                    participants:activity_participants(user:users(profile_image))
                )
            `)
            .eq('user_email', email); // ดึงทุกกิจกรรมที่เราเป็นสมาชิก (รวมถึงที่สร้างเอง)

        if (error) throw error;

        // แก้ไข: กรองเอาเฉพาะข้อมูลกิจกรรมที่ไม่เป็น null (ลบฟิลเตอร์ที่กันเจ้าของออกแล้ว)
        const filteredData = data
            .map(item => item.activity)
            .filter(a => a !== null);
            
        res.json(filteredData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 8. GET: กิจกรรมที่สร้างเอง ---
router.get('/activities/created/:email', async (req, res) => {
    const { data } = await supabase
        .from('activities')
        .select('*, creator:users!creator_email(name, profile_image), participants:activity_participants(user:users(profile_image))')
        .eq('creator_email', req.params.email)
        .order('created_at', { ascending: false });
    res.json(data);
});

// --- 9. PUT: สั่งจบกิจกรรม ---
router.put('/activities/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;
        await supabase.from('activities').update({ status: 'completed' }).eq('id', id).eq('creator_email', email);
        res.json({ message: "Completed" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;