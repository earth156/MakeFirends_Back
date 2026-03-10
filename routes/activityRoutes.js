const express = require('express');
const supabase = require('../config/supabase');
const upload = require('../middlewares/upload');
const router = express.Router();

// --- 1. GET: ดึงรายการกิจกรรมทั้งหมด (รองรับ Search, Filter และ Personalized Sorting) ---
router.get('/activities', async (req, res) => {
    try {
        const { search, category, province, user_interests } = req.query;
        let query = supabase
            .from('activities')
            .select(`
                *,
                creator:users!creator_email(name, profile_image),
                participants:activity_participants(user_email, user:users(name, profile_image))
            `);

        if (search) query = query.ilike('title', `%${search}%`);
        if (category && category !== 'ทั้งหมด') query = query.contains('category_tags', [category]);
        if (province && province !== 'ทั้งหมด') query = query.eq('province', province);

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;

        let finalData = data || [];

        // ตรรกะการเรียงลำดับตามความสนใจของผู้ใช้ (Personalized Feed)
        if (user_interests) {
            const interestsArray = JSON.parse(user_interests);
            finalData.sort((a, b) => {
                const aMatches = a.category_tags.filter(tag => interestsArray.includes(tag)).length;
                const bMatches = b.category_tags.filter(tag => interestsArray.includes(tag)).length;
                if (aMatches !== bMatches) return bMatches - aMatches;
                return new Date(b.created_at) - new Date(a.created_at);
            });
        }
        res.json(finalData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 2. POST: สร้างกิจกรรมใหม่ (พร้อมอัปโหลดรูปสูงสุด 3 รูป) ---
router.post('/activities', upload.array('images', 3), async (req, res) => {
    try {
        const { title, description, start_datetime, duration, province, max_participants, category_tags, creator_email } = req.body;
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
                title, description, image_urls: imageUrls, start_datetime, duration, province,
                max_participants: parseInt(max_participants),
                category_tags: JSON.parse(category_tags),
                creator_email,
                status: 'upcoming'
            }])
            .select();

        if (dbError) throw dbError;

        // ให้ผู้สร้างเข้าร่วมกิจกรรมตัวเองโดยอัตโนมัติ
        await supabase.from('activity_participants').insert([{ 
            activity_id: activityData[0].id, 
            user_email: creator_email 
        }]);

        res.status(201).json(activityData[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 3. GET: ดึงรายละเอียดกิจกรรมรายตัว ---
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

// --- 4. PUT: แก้ไขกิจกรรม (พร้อมแจ้งเตือนสมาชิก) ---
router.put('/activities/:id', upload.array('images', 3), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, province, start_datetime, duration, max_participants, category_tags, email, existing_images } = req.body;

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

        const { error: updateError } = await supabase
            .from('activities')
            .update({
                title, description, province, start_datetime, duration, 
                max_participants: parseInt(max_participants),
                category_tags: JSON.parse(category_tags),
                image_urls: imageUrls
            })
            .eq('id', id);

        if (updateError) throw updateError;

        // ส่งแจ้งเตือนสมาชิก
        const { data: participants } = await supabase.from('activity_participants').select('user_email').eq('activity_id', id).neq('user_email', email);
        if (participants && participants.length > 0) {
            const notifs = participants.map(p => ({
                user_email: p.user_email,
                title: "กิจกรรมมีการเปลี่ยนแปลง",
                message: `กิจกรรม "${title}" อัปเดตข้อมูลใหม่ โปรดตรวจสอบ`,
                activity_id: id,
                type: 'activity_updated'
            }));
            await supabase.from('notifications').insert(notifs);
        }

        res.json({ message: "แก้ไขสำเร็จ" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 5. DELETE: ลบกิจกรรม (พร้อมแจ้งเตือนสมาชิกว่าถูกยกเลิก) ---
router.delete('/activities/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;

        const { data: activity } = await supabase.from('activities').select('title, creator_email, status').eq('id', id).single();
        if (!activity || activity.creator_email !== email) return res.status(403).json({ error: "ไม่มีสิทธิ์ลบ" });

        const { data: participants } = await supabase.from('activity_participants').select('user_email').eq('activity_id', id).neq('user_email', email);
        if (participants && participants.length > 0) {
            const notifs = participants.map(p => ({
                user_email: p.user_email,
                title: "กิจกรรมถูกยกเลิก",
                message: `กิจกรรม "${activity.title}" ถูกลบโดยผู้สร้าง`,
                type: 'activity_cancelled'
            }));
            await supabase.from('notifications').insert(notifs);
        }

        await supabase.from('activity_participants').delete().eq('activity_id', id);
        await supabase.from('activities').delete().eq('id', id);
        res.json({ message: "ลบสำเร็จ" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 6. POST: เข้าร่วมกิจกรรม (พร้อมส่ง System Message เข้าแชท) ---
router.post('/join_activity', async (req, res) => {
    try {
        const { activity_id, user_email } = req.body;
        const { data: existing } = await supabase.from('activity_participants').select('*').eq('activity_id', activity_id).eq('user_email', user_email);
        if (existing.length > 0) return res.status(400).json({ error: 'คุณเข้าร่วมไปแล้ว' });

        await supabase.from('activity_participants').insert([{ activity_id, user_email }]);
        
        const { data: user } = await supabase.from('users').select('name').eq('email', user_email).single();
        await supabase.from('messages').insert([{
            activity_id, sender_email: user_email, text: `${user.name} joined group`, is_system_message: true
        }]);

        res.status(200).send('Joined');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 7. GET: กิจกรรมที่ผู้ใช้สร้าง / เข้าร่วม ---
router.get('/activities/created/:email', async (req, res) => {
    const { data } = await supabase.from('activities').select('*, creator:users!creator_email(name, profile_image), participants:activity_participants(user:users(profile_image))').eq('creator_email', req.params.email).order('created_at', { ascending: false });
    res.json(data);
});

router.get('/activities/joined/:email', async (req, res) => {
    const { data } = await supabase.from('activity_participants').select('activity:activities(*, creator:users!creator_email(name, profile_image), participants:activity_participants(user:users(profile_image)))').eq('user_email', req.params.email).neq('activity.creator_email', req.params.email);
    res.json(data.map(i => i.activity).filter(a => a !== null));
});

// --- 8. PUT: จบกิจกรรมโดย Manual ---
router.put('/activities/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;
        const { data: act } = await supabase.from('activities').update({ status: 'completed' }).eq('id', id).eq('creator_email', email).select();
        
        if (act.length > 0) {
            const { data: members } = await supabase.from('activity_participants').select('user_email').eq('activity_id', id);
            const notifs = members.map(m => ({
                user_email: m.user_email,
                title: "กิจกรรมสิ้นสุดลงแล้ว!",
                message: `มาให้คะแนนเพื่อนในกิจกรรม "${act[0].title}" กันเถอะ`,
                activity_id: id,
                type: 'rating_prompt'
            }));
            await supabase.from('notifications').insert(notifs);
        }
        res.json({ message: "Completed" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;