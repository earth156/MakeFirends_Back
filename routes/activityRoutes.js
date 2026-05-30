const express = require('express');
const supabase = require('../config/supabase');
const upload = require('../middlewares/upload');
const router = express.Router();

// --- ฟังก์ชันคำนวณระยะทาง (Haversine Formula) ---
function getDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371; // รัศมีโลก (กิโลเมตร)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // คืนค่าเป็นกิโลเมตร
}

// --- 1. GET: ดึงรายการกิจกรรมทั้งหมด (Discovery Feed) ---
router.get('/activities', async (req, res) => {
    try {
        const { search, category, province, user_interests, lat, lng, radius } = req.query;
        const now = new Date().toISOString(); 

        let query = supabase
            .from('activities')
            .select(`
                *,
                creator:users!creator_email(name, profile_image, banned_until),
                participants:activity_participants(user_email, status, user:users(name, profile_image, banned_until))
            `)
            .gt('end_datetime', now) // แสดงเฉพาะกิจกรรมที่ยังไม่จบ
            .neq('status', 'suspended'); // ซ่อนกิจกรรมที่ถูกระงับ

        if (search) query = query.ilike('title', `%${search}%`);
        if (category && category !== 'ทั้งหมด') query = query.contains('category_tags', [category]);
        if (province && province !== 'ทั้งหมด') query = query.eq('province', province);

        const { data, error } = await query.order('start_datetime', { ascending: true });
        if (error) throw error;

        let finalData = data || [];

        // ตรรกะการกรองด้วยระยะทาง GPS (ถ้าแอปส่งพิกัดมา)
        if (lat && lng && radius) {
            const userLat = parseFloat(lat);
            const userLng = parseFloat(lng);
            const radiusKm = parseFloat(radius);
            finalData = finalData.filter(act => {
                const dist = getDistance(userLat, userLng, act.latitude, act.longitude);
                if (dist === null) return false;
                act.distance_km = parseFloat(dist.toFixed(2)); // แนบระยะทางไปให้ Frontend แสดงผล
                return dist <= radiusKm;
            });
        }

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
                // เรียงลำดับ: ถ้ามีข้อมูลระยะทาง ให้กิจกรรมที่อยู่ใกล้ขึ้นก่อน
                if (lat && lng) {
                     finalData.sort((a, b) => (a.distance_km || 9999) - (b.distance_km || 9999));
                }
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
router.post('/activities', upload.array('images', 5), async (req, res) => {
    try {
        const { title, description, start_datetime, end_datetime, province, max_participants, category_tags, creator_email, min_age, max_age, gender_preference, min_rating, latitude, longitude, require_approval } = req.body;
        const files = req.files;
        let imageUrls = []; 

        const parsedMaxParticipants = parseInt(max_participants);
        if (isNaN(parsedMaxParticipants) || parsedMaxParticipants <= 1) {
            return res.status(400).json({ error: 'จำนวนผู้เข้าร่วมต้องมากกว่า 1 คนขึ้นไป' });
        }

        // --- ตรวจสอบว่าถูกแบนอยู่หรือไม่ ---
        const { data: userCheck } = await supabase.from('users').select('banned_until').eq('email', creator_email).single();
        if (userCheck && userCheck.banned_until) {
            const banDate = new Date(userCheck.banned_until);
            if (banDate > new Date()) {
                return res.status(403).json({ error: `บัญชีของคุณถูกระงับการสร้างกิจกรรมจนถึงวันที่ ${banDate.toLocaleDateString('th-TH')}` });
            }
        }

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
                creator_email, status: 'upcoming', // แก้ไข: เพิ่มคอมม่าที่ขาดไป
            min_age: min_age ? parseInt(min_age) : null,
            max_age: max_age ? parseInt(max_age) : null,
            gender_preference: gender_preference || 'ทั้งหมด',
            min_rating: min_rating ? parseFloat(min_rating) : null,
            latitude: latitude ? parseFloat(latitude) : null,
            longitude: longitude ? parseFloat(longitude) : null,
            require_approval: require_approval === 'true'
            }])
            .select();

        if (dbError) throw dbError;

        // บันทึกเจ้าของกิจกรรมลงตารางสมาชิกด้วย เพื่อให้เห็นแชทตัวเอง
        await supabase.from('activity_participants').insert([{ 
            activity_id: activityData[0].id, 
            user_email: creator_email,
            status: 'joined'
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
                creator:users!creator_email(name, profile_image, banned_until),
                participants:activity_participants(user_email, status, user:users(name, profile_image, banned_until))
            `)
            .eq('id', req.params.id)
            .single();

        if (error) throw error;

        // ตรวจสอบว่ากิจกรรมเริ่มไปแล้วหรือยัง
        const now = new Date();
        const isStarted = new Date(data.start_datetime) <= now;

        // ดึงข้อมูลผู้ใช้ที่อยู่ในคิวสำรองสิทธิ์
        const { data: waitlistData, count: waitlistCount, error: waitlistError } = await supabase
            .from('activity_waitlists')
            .select('id, user_email, created_at, user:users(name, profile_image, email, banned_until)', { count: 'exact' })
            .eq('activity_id', req.params.id)
            .order('created_at', { ascending: true }); // เรียงจากคนที่มากดคิวก่อน
            
        if (!waitlistError) {
            // ถ้าระบบพบว่ากิจกรรม "เริ่มแล้ว" แต่ยังมีคิวค้างอยู่ ให้เคลียร์คิวและส่งแจ้งเตือนอัตโนมัติ
            if (isStarted && waitlistData && waitlistData.length > 0) {
                const notifications = waitlistData.map(w => ({
                    user_email: w.user_email,
                    title: 'คิวสำรองสิทธิ์ถูกยกเลิก',
                    message: `กิจกรรม "${data.title}" ที่คุณต่อคิวไว้ได้เริ่มขึ้นแล้ว คิวของคุณจึงถูกยกเลิกอัตโนมัติ`,
                    type: 'waitlist_cancelled',
                    activity_id: data.id,
                    is_read: false
                }));
                supabase.from('activity_waitlists').delete().eq('activity_id', data.id).then();
                supabase.from('notifications').insert(notifications).then();
                data.waitlist_count = 0;
                data.waitlist = [];
            } else {
                data.waitlist_count = waitlistCount || 0;
                data.waitlist = waitlistData || [];
            }
        }

        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 4. PUT: แก้ไขกิจกรรม ---
router.put('/activities/:id', upload.array('images', 5), async (req, res) => {
    try {
        const { id } = req.params;

        const { 
            title, description, province, start_datetime, end_datetime, max_participants, 
            category_tags, email, existing_images, min_age, max_age, gender_preference, min_rating, latitude, longitude, require_approval
        } = req.body;

        // 1. ดึงข้อมูลกิจกรรมเพื่อตรวจสอบสิทธิ์และสถานะ
        const { data: activity, error: activityError } = await supabase.from('activities').select('creator_email, status, title').eq('id', id).single();
        if (activityError || !activity) return res.status(404).json({ error: "ไม่พบกิจกรรม" });
        if (!activity || activity.creator_email !== email) return res.status(403).json({ error: "ไม่มีสิทธิ์แก้ไข" });
        // --- เพิ่มเงื่อนไข: แก้ไขได้เฉพาะกิจกรรมที่ยังไม่เริ่ม (upcoming) ---
        if (activity.status !== 'upcoming') {
            return res.status(400).json({ error: "ไม่สามารถแก้ไขกิจกรรมที่เริ่มไปแล้วหรือจบแล้วได้" });
        }

        // ตรวจสอบจำนวน max_participants ใหม่ ว่าน้อยกว่าคนที่มีอยู่แล้วหรือไม่
        const parsedMaxParticipants = parseInt(max_participants);
        if (isNaN(parsedMaxParticipants) || parsedMaxParticipants < 1) {
            return res.status(400).json({ error: "จำนวนผู้เข้าร่วมต้องไม่น้อยกว่า 1 คน" });
        }

        const { count: currentParticipants } = await supabase
            .from('activity_participants')
            .select('*', { count: 'exact', head: true })
            .eq('activity_id', id)
            .eq('status', 'joined');

        if (parsedMaxParticipants < (currentParticipants || 0)) {
            return res.status(400).json({ error: `ไม่สามารถลดจำนวนผู้เข้าร่วมให้ต่ำกว่าสมาชิกปัจจุบันที่มีอยู่แล้ว (${currentParticipants} คน) ได้` });
        }

        // 2. จัดการรูปภาพ
        let imageUrls = existing_images ? JSON.parse(existing_images) : [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const fileName = `act_${Date.now()}_${file.originalname}`;
                await supabase.storage.from('activity_images').upload(fileName, file.buffer, { contentType: file.mimetype });
                const { data: urlData } = supabase.storage.from('activity_images').getPublicUrl(fileName);
                imageUrls.push(urlData.publicUrl);
            }
        }

        // 3. สร้าง object สำหรับอัปเดต (ไม่รวมวันเวลา)
        const updatePayload = {
            title, description, province, start_datetime, end_datetime,
            max_participants: parsedMaxParticipants,
            category_tags: JSON.parse(category_tags),
            image_urls: imageUrls,
            min_age: (min_age && min_age !== '') ? parseInt(min_age) : null,
            max_age: (max_age && max_age !== '') ? parseInt(max_age) : null,
            gender_preference: gender_preference || 'ทั้งหมด',
            min_rating: (min_rating && min_rating !== '') ? parseFloat(min_rating) : null,
            latitude: latitude ? parseFloat(latitude) : null,
            longitude: longitude ? parseFloat(longitude) : null,
            require_approval: require_approval === 'true'
        };

        // 4. อัปเดตข้อมูล
        const { error: updateError } = await supabase.from('activities').update(updatePayload).eq('id', id);
        if (updateError) {
            console.error("Error updating activity:", updateError);
            throw updateError;
        }
        
        console.log(`Activity ${id} updated successfully. Now attempting to send notifications.`);

        // ==========================================
        // 4.5 [เพิ่มใหม่] โค้ดระบบเลื่อนคิวสำรองอัตโนมัติ
        // ==========================================
        try {
            // คำนวณหาที่ว่างที่เพิ่มขึ้น (ใช้จาก updatePayload และ currentParticipants ที่ดึงมาแล้ว)
            const availableSlots = updatePayload.max_participants - (currentParticipants || 0);

            // ถ้ามีที่ว่าง ให้ดึงคนจากตารางคิวสำรอง (activity_waitlists) ตามจำนวนโควตาที่ว่าง
            if (availableSlots > 0) {
                const { data: waitlistUsers } = await supabase
                    .from('activity_waitlists')
                    .select('*')
                    .eq('activity_id', id)
                    .order('created_at', { ascending: true }) // ดึงคนที่คิวแรกสุดมาก่อน
                    .limit(availableSlots);

                if (waitlistUsers && waitlistUsers.length > 0) {
                    for (const user of waitlistUsers) {
                        // ย้ายคนจากคิวเข้ากลุ่ม (ถ้าต้องรออนุมัติให้เป็น pending ถ้าไม่ต้องให้เป็น joined)
                        await supabase
                            .from('activity_participants')
                            .insert([{
                                activity_id: id,
                                user_email: user.user_email,
                                status: updatePayload.require_approval ? 'pending' : 'joined'
                            }]);

                        // ลบรายชื่อออกจากตารางคิวสำรองสิทธิ์
                        await supabase
                            .from('activity_waitlists')
                            .delete()
                            .eq('id', user.id);

                        // ส่งการแจ้งเตือนไปบอกผู้ใช้คนนั้น
                        await supabase.from('notifications').insert([{
                            user_email: user.user_email,
                            title: "คุณได้สิทธิ์เข้าร่วมกิจกรรม!",
                            message: `มีการขยายจำนวนผู้เข้าร่วมในกิจกรรม "${title}" และคุณได้รับการเลื่อนคิวแล้ว`,
                            type: 'activity_joined',
                            activity_id: id,
                            is_read: false
                        }]);
                    }
                }
            }
        } catch (waitlistErr) {
            console.error("Auto promote waitlist error:", waitlistErr);
            // ไม่ต้อง throw error เพื่อไม่ให้ขัดจังหวะการบันทึกกิจกรรมหลัก
        }
        // ==========================================

        // 5. ส่งแจ้งเตือนไปยังผู้เข้าร่วมกิจกรรม (ยกเว้นคนแก้ไข)
        const { data: participants, error: participantsError } = await supabase
            .from('activity_participants')
            .select('user_email')
            .eq('activity_id', id)
            .neq('user_email', email);

        if (participantsError) {
            console.error("Error fetching participants for notification:", participantsError);
        }

        // --- เพิ่ม LOG สำหรับตรวจสอบ ---
        console.log(`[Notification] Found ${participants ? participants.length : 0} participants to notify for activity ID: ${id}.`);
        if (participants && participants.length > 0) {
            console.log('[Notification] Participants list:', JSON.stringify(participants.map(p => p.user_email)));
        }
        console.log(`[Notification] Creator (excluded): ${email}`);
        // --- จบส่วน LOG ---

        if (participants && participants.length > 0) {
            // ใช้ title จาก request body ถ้ามี, หรือใช้ title เดิมจากฐานข้อมูลเป็น fallback
            const activityTitleForNotif = title || activity.title;
            const notifications = participants.map(p => ({
                user_email: p.user_email,
                title: "กิจกรรมมีการอัปเดต",
                message: `กิจกรรม "${activityTitleForNotif}" ที่คุณเข้าร่วมมีการอัปเดตข้อมูล`,
                type: 'activity_updated',
                activity_id: id,
                is_read: false
            }));
            
            console.log(`[Notification] Preparing to insert ${notifications.length} notification(s).`);

            // ส่งแจ้งเตือนทั้งหมด
            const { error: notifError } = await supabase.from('notifications').insert(notifications);
            if (notifError) {
                console.error("[Notification] CRITICAL: Error inserting notifications into database:", notifError);
            } else {
                console.log(`[Notification] Successfully inserted ${notifications.length} notification(s).`);
            }
        }


        res.json({ message: "แก้ไขสำเร็จ" });
    } catch (err) {
        console.error("Error in PUT /activities/:id :", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 5. DELETE: ยกเลิกกิจกรรม ---
router.delete('/activities/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;

        // 1. ดึงข้อมูลกิจกรรมเพื่อตรวจสอบสิทธิ์และสถานะ
        const { data: activity, error: activityError } = await supabase
            .from('activities')
            .select('title, creator_email, status')
            .eq('id', id)
            .single();

        if (activityError || !activity) {
            return res.status(404).json({ error: "ไม่พบกิจกรรม" });
        }

        if (activity.creator_email !== email) {
            return res.status(403).json({ error: "คุณไม่มีสิทธิ์ยกเลิกกิจกรรมนี้" });
        }

        // --- เพิ่มเงื่อนไข: ยกเลิกได้เฉพาะกิจกรรมที่ยังไม่เริ่ม (upcoming) ---
        if (activity.status !== 'upcoming') {
            return res.status(400).json({ error: "ไม่สามารถยกเลิกกิจกรรมที่เริ่มไปแล้วหรือจบแล้วได้" });
        }

        // 2. ดึงรายชื่อผู้เข้าร่วมทั้งหมด (ยกเว้นเจ้าของ) เพื่อส่งแจ้งเตือน
        const { data: participants } = await supabase
            .from('activity_participants')
            .select('user_email')
            .eq('activity_id', id)
            .neq('user_email', email);

        // 3. สร้างรายการแจ้งเตือน
        if (participants && participants.length > 0) {
            const notifications = participants.map(p => ({
                user_email: p.user_email,
                title: "กิจกรรมถูกยกเลิก",
                message: `กิจกรรม "${activity.title}" ที่คุณเข้าร่วมได้ถูกยกเลิกโดยผู้สร้าง`,
                type: 'activity_cancelled', // ประเภทแจ้งเตือนใหม่
                activity_id: id,
                is_read: false
            }));

            // 4. ส่งแจ้งเตือนทั้งหมด
            await supabase.from('notifications').insert(notifications);
        }

        // 5. ลบข้อมูลที่เกี่ยวข้องทั้งหมด
        // (เรียงลำดับจากตารางลูกไปหาตารางแม่เพื่อไม่ให้เกิด Foreign Key Constraint Error)
        await supabase.from('messages').delete().eq('activity_id', id);
        await supabase.from('activity_participants').delete().eq('activity_id', id);
        await supabase.from('activity_reports').delete().eq('activity_id', id);
        await supabase.from('reviews').delete().eq('activity_id', id);
        
        // 6. ลบกิจกรรมหลัก
        await supabase.from('activities').delete().eq('id', id);
        res.json({ message: "ยกเลิกกิจกรรมสำเร็จ" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 6. POST: เข้าร่วมกิจกรรม / สำรองสิทธิ์ ---
router.post('/join_activity', async (req, res) => {
    try {
        const { activity_id, user_email, is_waitlist } = req.body;

        // --- ตรวจสอบข้อมูลผู้ใช้ (แบน, อายุ, เพศ, เรทติ้ง) ---
        const { data: user, error: userError } = await supabase.from('users').select('name, dob, gender, rating, banned_until').eq('email', user_email).single();
        if (userError || !user) return res.status(404).json({ error: 'ไม่พบข้อมูลผู้ใช้' });

        if (user.banned_until) {
            const banDate = new Date(user.banned_until);
            if (banDate > new Date()) {
                return res.status(403).json({ error: `บัญชีของคุณถูกระงับการเข้าร่วมกิจกรรมจนถึงวันที่ ${banDate.toLocaleDateString('th-TH')}` });
            }
        }

        // --- ตรวจสอบเงื่อนไขของกิจกรรม ---
        const { data: activity } = await supabase.from('activities').select('min_age, max_age, gender_preference, min_rating, max_participants, title, require_approval, creator_email').eq('id', activity_id).single();
        if (activity) {
            // 1. ตรวจสอบอายุ
            if (activity.min_age || activity.max_age) {
                if (!user.dob) return res.status(403).json({ error: 'กรุณาระบุวันเกิดในโปรไฟล์ก่อนเข้าร่วมกิจกรรม' });
                const birthDate = new Date(user.dob);
                const today = new Date();
                let age = today.getFullYear() - birthDate.getFullYear();
                const m = today.getMonth() - birthDate.getMonth();
                if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                    age--;
                }
                if (activity.min_age && age < activity.min_age) return res.status(403).json({ error: `กิจกรรมนี้จำกัดอายุขั้นต่ำ ${activity.min_age} ปี (อายุของคุณ: ${age} ปี)` });
                if (activity.max_age && age > activity.max_age) return res.status(403).json({ error: `กิจกรรมนี้จำกัดอายุไม่เกิน ${activity.max_age} ปี (อายุของคุณ: ${age} ปี)` });
            }

            // 2. ตรวจสอบเพศ
            if (activity.gender_preference && activity.gender_preference !== 'ทั้งหมด' && activity.gender_preference !== 'ไม่ระบุ') {
                if (!user.gender) return res.status(403).json({ error: 'กรุณาระบุเพศในโปรไฟล์ก่อนเข้าร่วมกิจกรรม' });
                if (user.gender !== activity.gender_preference) return res.status(403).json({ error: `กิจกรรมนี้จำกัดเฉพาะเพศ${activity.gender_preference}เท่านั้น` });
            }

            // 3. ตรวจสอบเรทติ้ง
            if (activity.min_rating) {
                const userRating = user.rating || 0;
                if (userRating < activity.min_rating) return res.status(403).json({ error: `กิจกรรมนี้จำกัดเรทติ้งขั้นต่ำ ${activity.min_rating} ดาว (ของคุณ: ${userRating.toFixed(1)} ดาว)` });
            }
        }

        const { data: existing } = await supabase.from('activity_participants').select('*').eq('activity_id', activity_id).eq('user_email', user_email);
        if (existing.length > 0) return res.status(400).json({ error: 'คุณเข้าร่วมไปแล้ว' });

        // --- ตรวจสอบจำนวนคน (เช็คเต็ม) ---
        const { count: participantCount, error: countError } = await supabase
            .from('activity_participants')
            .select('*', { count: 'exact', head: true })
            .eq('activity_id', activity_id)
            .eq('status', 'joined');

        if (countError) throw countError;

        if (activity && participantCount >= activity.max_participants) {
            if (!is_waitlist) {
                // แจ้งให้แอปทราบว่าเต็ม เพื่อให้แอปไปถามผู้ใช้ว่าจะสำรองสิทธิ์ไหม
                return res.status(400).json({ error: 'กิจกรรมนี้เต็มแล้ว', is_full: true });
            } else {
                // ผู้ใช้ต้องการสำรองสิทธิ์
                const { data: existingWaitlist } = await supabase.from('activity_waitlists')
                    .select('*').eq('activity_id', activity_id).eq('user_email', user_email);
                
                if (existingWaitlist && existingWaitlist.length > 0) {
                    return res.status(400).json({ error: 'คุณอยู่ในคิวสำรองสิทธิ์แล้ว' });
                }

                await supabase.from('activity_waitlists').insert([{ activity_id, user_email }]);
                return res.status(200).json({ message: 'บันทึกการสำรองสิทธิ์เรียบร้อยแล้ว' });
            }
        }

        // --- กรณีคนยังไม่เต็ม ตรวจสอบว่าต้องรอการอนุมัติหรือไม่ ---
        if (activity && activity.require_approval) {
            // ลงชื่อเข้าร่วมแบบรอตรวจสอบ
            await supabase.from('activity_participants').insert([{ activity_id, user_email, status: 'pending' }]);
            
            // แจ้งเตือนเจ้าของกิจกรรม
            await supabase.from('notifications').insert([{
                user_email: activity.creator_email,
                title: "มีคำขอเข้าร่วมกิจกรรมใหม่",
                message: `ผู้ใช้ ${user.name} ได้ส่งคำขอเข้าร่วมกิจกรรม "${activity.title}" ของคุณ โปรดตรวจสอบและอนุมัติ`,
                type: 'join_request',
                activity_id: activity_id,
                is_read: false
            }]);
            
            res.status(200).json({ message: 'ส่งคำขอเข้าร่วมสำเร็จ กรุณารอการอนุมัติจากผู้จัด' });
        } else {
            // เข้าร่วมปกติ (อนุมัติอัตโนมัติ)
            await supabase.from('activity_participants').insert([{ activity_id, user_email, status: 'joined' }]);
            
            await supabase.from('messages').insert([{
                activity_id, 
                sender_email: user_email, 
                text: `${user.name} เข้าร่วมกลุ่ม`, 
                is_system_message: true,
                chat_type: 'group'
            }]);

            res.status(200).send('Joined');
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 6.4 PUT: อนุมัติคำขอเข้าร่วมกิจกรรม ---
router.put('/activities/:id/approve_request', async (req, res) => {
    try {
        const { id } = req.params;
        const { user_email, creator_email } = req.body;

        // ตรวจสอบว่าเป็นเจ้าของกิจกรรมหรือไม่
        const { data: activity } = await supabase.from('activities').select('creator_email, title, max_participants').eq('id', id).single();
        if (!activity || activity.creator_email !== creator_email) return res.status(403).json({ error: "ไม่มีสิทธิ์ดำเนินการ" });

        // ตรวจสอบว่าคนเต็มหรือยัง
        const { count: currentCount } = await supabase.from('activity_participants').select('*', { count: 'exact', head: true }).eq('activity_id', id).eq('status', 'joined');
        if (currentCount >= activity.max_participants) return res.status(400).json({ error: "สมาชิกกิจกรรมเต็มแล้ว" });

        // อัปเดตสถานะเป็น 'joined'
        const { error: updateError } = await supabase.from('activity_participants').update({ status: 'joined' }).eq('activity_id', id).eq('user_email', user_email);
        if (updateError) throw updateError;

        // แจ้งในแชทกลุ่ม
        const { data: user } = await supabase.from('users').select('name').eq('email', user_email).single();
        await supabase.from('messages').insert([{ activity_id: id, sender_email: user_email, text: `${user ? user.name : 'สมาชิก'} เข้าร่วมกลุ่มจากการอนุมัติ`, is_system_message: true, chat_type: 'group' }]);

        // ส่งแจ้งเตือนไปหาผู้ใช้
        await supabase.from('notifications').insert([{ user_email, title: "คำขอเข้าร่วมได้รับการอนุมัติ", message: `คำขอเข้าร่วมกิจกรรม "${activity.title}" ของคุณได้รับการอนุมัติแล้ว`, type: 'activity_joined', activity_id: id, is_read: false }]);

        // --- เพิ่มเติม: ตรวจสอบว่าหลังจากรับคนนี้แล้ว กิจกรรมเต็มหรือยัง ---
        const { count: newCount } = await supabase.from('activity_participants').select('*', { count: 'exact', head: true }).eq('activity_id', id).eq('status', 'joined');
        if (newCount >= activity.max_participants) {
            // ดึงรายชื่อคนที่ยังรออนุมัติอยู่ (pending)
            const { data: pendingUsers } = await supabase.from('activity_participants').select('user_email').eq('activity_id', id).eq('status', 'pending');
            if (pendingUsers && pendingUsers.length > 0) {
                const pendingEmails = pendingUsers.map(p => p.user_email);
                
                // ลบคำขอที่ยังค้างอยู่ออก
                await supabase.from('activity_participants').delete().eq('activity_id', id).eq('status', 'pending');
                
                // ส่งการแจ้งเตือนให้คนที่โดนปัดตกทราบ และถามเรื่องสำรองสิทธิ์
                const waitlistNotifications = pendingEmails.map(email => ({
                    user_email: email, title: "กิจกรรมเต็มแล้ว", message: `กิจกรรม "${activity.title}" ที่คุณขอเข้าร่วมมีคนเต็มแล้ว คุณต้องการสำรองสิทธิ์หรือไม่? (กดที่นี่เพื่อเข้าไปจองคิว)`, type: 'system_alert', activity_id: id, is_read: false
                }));
                await supabase.from('notifications').insert(waitlistNotifications);
            }
        }

        res.json({ message: "อนุมัติสำเร็จ" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 6.5 PUT: ปฏิเสธคำขอเข้าร่วมกิจกรรม ---
router.put('/activities/:id/reject_request', async (req, res) => {
    try {
        const { id } = req.params;
        const { user_email, creator_email } = req.body;

        // ตรวจสอบสิทธิ์
        const { data: activity } = await supabase.from('activities').select('creator_email, title').eq('id', id).single();
        if (!activity || activity.creator_email !== creator_email) return res.status(403).json({ error: "ไม่มีสิทธิ์ดำเนินการ" });

        // ลบข้อมูลคำขอออกจากฐานข้อมูล
        const { error: deleteError } = await supabase.from('activity_participants').delete().eq('activity_id', id).eq('user_email', user_email);
        if (deleteError) throw deleteError;

        // แจ้งเตือนผู้ใช้ว่าถูกปฏิเสธ
        await supabase.from('notifications').insert([{ user_email, title: "คำขอเข้าร่วมถูกปฏิเสธ", message: `คำขอเข้าร่วมกิจกรรม "${activity.title}" ของคุณถูกปฏิเสธโดยผู้จัด`, type: 'system_alert', is_read: false }]);

        res.json({ message: "ปฏิเสธสำเร็จ" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 6.6 PUT: อนุมัติคำขอเข้าร่วมกิจกรรมทั้งหมด (Approve All) ---
router.put('/activities/:id/approve_all_requests', async (req, res) => {
    try {
        const { id } = req.params;
        const { creator_email } = req.body;

        // ตรวจสอบว่าเป็นเจ้าของกิจกรรมหรือไม่
        const { data: activity } = await supabase.from('activities').select('creator_email, title, max_participants').eq('id', id).single();
        if (!activity || activity.creator_email !== creator_email) return res.status(403).json({ error: "ไม่มีสิทธิ์ดำเนินการ" });

        // ตรวจสอบว่าคนเต็มหรือยัง
        const { count: currentCount } = await supabase.from('activity_participants').select('*', { count: 'exact', head: true }).eq('activity_id', id).eq('status', 'joined');
        const availableSlots = activity.max_participants - (currentCount || 0);

        if (availableSlots <= 0) return res.status(400).json({ error: "สมาชิกกิจกรรมเต็มแล้ว ไม่สามารถรับเพิ่มได้" });

        // ดึงคนที่รออนุมัติทั้งหมด
        const { data: pendingUsers } = await supabase.from('activity_participants').select('user_email').eq('activity_id', id).eq('status', 'pending');
        if (!pendingUsers || pendingUsers.length === 0) return res.status(400).json({ error: "ไม่มีคำขอให้รออนุมัติ" });

        // เลือกเฉพาะจำนวนคนที่ไม่เกินสิทธิ์ที่ว่าง
        const usersToApprove = pendingUsers.slice(0, availableSlots).map(p => p.user_email);

        // อัปเดตสถานะเป็น 'joined' ให้ทุกคนที่ได้รับเลือก
        const { error: updateError } = await supabase.from('activity_participants').update({ status: 'joined' }).eq('activity_id', id).in('user_email', usersToApprove);
        if (updateError) throw updateError;

        // ดึงชื่อผู้ใช้เพื่อส่งข้อความแจ้งในแชทกลุ่มและแจ้งเตือนเข้าแอป
        const { data: users } = await supabase.from('users').select('email, name').in('email', usersToApprove);
        const messages = users.map(u => ({ activity_id: id, sender_email: u.email, text: `${u.name || 'สมาชิก'} เข้าร่วมกลุ่มจากการอนุมัติ`, is_system_message: true, chat_type: 'group' }));
        await supabase.from('messages').insert(messages);

        const notifications = usersToApprove.map(email => ({ user_email: email, title: "คำขอเข้าร่วมได้รับการอนุมัติ", message: `คำขอเข้าร่วมกิจกรรม "${activity.title}" ของคุณได้รับการอนุมัติแล้ว`, type: 'activity_joined', activity_id: id, is_read: false }));
        await supabase.from('notifications').insert(notifications);

        // --- เพิ่มเติม: ตรวจสอบว่าหลังจากรับคนทั้งหมดแล้ว กิจกรรมเต็มหรือยัง ---
        const { count: newCount } = await supabase.from('activity_participants').select('*', { count: 'exact', head: true }).eq('activity_id', id).eq('status', 'joined');
        if (newCount >= activity.max_participants) {
            // ดึงรายชื่อคนที่ยังรออนุมัติอยู่ (pending) ที่เหลืออยู่จากการรับครั้งนี้
            const { data: leftPendingUsers } = await supabase.from('activity_participants').select('user_email').eq('activity_id', id).eq('status', 'pending');
            if (leftPendingUsers && leftPendingUsers.length > 0) {
                const pendingEmails = leftPendingUsers.map(p => p.user_email);
                
                // ลบคำขอที่ยังค้างอยู่ออก
                await supabase.from('activity_participants').delete().eq('activity_id', id).eq('status', 'pending');
                
                // ส่งการแจ้งเตือน
                const waitlistNotifications = pendingEmails.map(email => ({
                    user_email: email, title: "กิจกรรมเต็มแล้ว", message: `กิจกรรม "${activity.title}" ที่คุณขอเข้าร่วมมีคนเต็มแล้ว คุณต้องการสำรองสิทธิ์หรือไม่? (กดที่นี่เพื่อเข้าไปจองคิว)`, type: 'system_alert', activity_id: id, is_read: false
                }));
                await supabase.from('notifications').insert(waitlistNotifications);
            }
        }

        res.json({ message: usersToApprove.length < pendingUsers.length ? `รับเพิ่มได้ ${usersToApprove.length} คน (ที่นั่งเต็ม)` : `อนุมัติสำเร็จทั้งหมด ${usersToApprove.length} คน` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 6.7 PUT: เตะผู้ใช้ออกจากกิจกรรม (Kick User) ---
router.put('/activities/:id/kick_user', async (req, res) => {
    try {
        const { id } = req.params;
        const { creator_email, target_user_email } = req.body;

        // 1. ตรวจสอบสิทธิ์
        const { data: activity } = await supabase.from('activities').select('creator_email, title, status').eq('id', id).single();
        if (!activity) return res.status(404).json({ error: "ไม่พบกิจกรรม" });
        if (activity.creator_email !== creator_email) return res.status(403).json({ error: "ไม่มีสิทธิ์ดำเนินการ (เฉพาะผู้จัดเท่านั้น)" });
        if (activity.status !== 'upcoming') return res.status(400).json({ error: "ไม่สามารถเตะผู้ใช้ได้เนื่องจากกิจกรรมเริ่มหรือจบไปแล้ว" });

        // 2. ดึงชื่อคนที่จะเตะ
        const { data: targetUser } = await supabase.from('users').select('name').eq('email', target_user_email).single();

        // 3. ลบคนนั้นออกจากผู้เข้าร่วม
        const { error: deleteError } = await supabase.from('activity_participants').delete().eq('activity_id', id).eq('user_email', target_user_email);
        if (deleteError) throw deleteError;

        // 4. แจ้งในแชทกลุ่มว่ามีคนถูกเตะ
        await supabase.from('messages').insert([{
            activity_id: id, 
            sender_email: creator_email, 
            text: `${targetUser ? targetUser.name : 'สมาชิก'} ถูกนำออกจากกลุ่มโดยผู้จัด`, 
            is_system_message: true,
            chat_type: 'group'
        }]);

        // 5. แจ้งเตือนผู้ใช้ว่าถูกเตะ
        await supabase.from('notifications').insert([{ 
            user_email: target_user_email, 
            title: "คุณถูกนำออกจากกิจกรรม", 
            message: `คุณถูกนำออกจากกิจกรรม "${activity.title}" โดยผู้จัดกิจกรรม`, 
            type: 'system_alert', 
            activity_id: id,
            is_read: false 
        }]);

        // 6. ไปเช็คว่ามีคนรอในคิวสำรองสิทธิ์ไหม (ดึงคนที่เก่าที่สุด 1 คน)
        const { data: waitlist } = await supabase.from('activity_waitlists').select('*').eq('activity_id', id).order('created_at', { ascending: true }).limit(1);

        if (waitlist && waitlist.length > 0) {
            const nextUserEmail = waitlist[0].user_email;
            const { data: nextUserRecord } = await supabase.from('users').select('name').eq('email', nextUserEmail).single();

            // ย้ายคนในคิวเข้าตาราง participants
            await supabase.from('activity_participants').insert([{ activity_id: id, user_email: nextUserEmail, status: 'joined' }]);
            await supabase.from('activity_waitlists').delete().eq('id', waitlist[0].id);

            // แจ้งเตือนผู้ที่ได้เลื่อนคิว
            await supabase.from('messages').insert([{ activity_id: id, sender_email: nextUserEmail, text: `${nextUserRecord ? nextUserRecord.name : 'สมาชิก'} เข้าร่วมกลุ่ม (เลื่อนจากคิวสำรองสิทธิ์)`, is_system_message: true, chat_type: 'group' }]);
            await supabase.from('notifications').insert([{ user_email: nextUserEmail, title: "เลื่อนคิวสำเร็จ!", message: `กิจกรรม "${activity.title}" มีที่ว่าง คุณได้รับการเลื่อนคิวเข้าร่วมกิจกรรมแล้ว!`, type: 'activity_joined', activity_id: id, is_read: false }]);
        }

        res.json({ message: "นำผู้ใช้ออกจากกิจกรรมสำเร็จ" });
    } catch (err) {
        console.error("Kick User Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 6.1 POST: ออกจากกิจกรรม (และเลื่อนคิวสำรองสิทธิ์อัตโนมัติ) ---
router.post('/leave_activity', async (req, res) => {
    try {
        const { activity_id, user_email } = req.body;

        // 1. ดึงข้อมูลกิจกรรมและตรวจสอบสิทธิ์
        const { data: activity } = await supabase.from('activities').select('title, creator_email').eq('id', activity_id).single();
        if (!activity) return res.status(404).json({ error: 'ไม่พบกิจกรรม' });

        if (activity.creator_email === user_email) {
            return res.status(400).json({ error: 'เจ้าของกิจกรรมไม่สามารถออกจากกิจกรรมได้ ต้องใช้เมนูยกเลิกกิจกรรมแทน' });
        }

        const { data: user } = await supabase.from('users').select('name').eq('email', user_email).single();

        // 2. ลบตัวเองออกจากผู้เข้าร่วม
        const { error: deleteError } = await supabase.from('activity_participants')
            .delete().eq('activity_id', activity_id).eq('user_email', user_email);
        
        if (deleteError) throw deleteError;

        // แจ้งในแชทกลุ่มว่ามีคนออก
        await supabase.from('messages').insert([{
            activity_id, 
            sender_email: user_email, 
            text: `${user ? user.name : 'สมาชิก'} ออกจากกลุ่ม`, 
            is_system_message: true,
            chat_type: 'group'
        }]);

        // 3. ไปเช็คว่ามีคนรอในคิวสำรองสิทธิ์ไหม (ดึงคนที่เก่าที่สุด 1 คน)
        const { data: waitlist } = await supabase.from('activity_waitlists')
            .select('*')
            .eq('activity_id', activity_id)
            .order('created_at', { ascending: true })
            .limit(1);

        if (waitlist && waitlist.length > 0) {
            const nextUserEmail = waitlist[0].user_email;

            // ดึงชื่อคนที่ได้สิทธิ์
            const { data: nextUserRecord } = await supabase.from('users').select('name').eq('email', nextUserEmail).single();

            // ย้ายคนในคิวเข้าตาราง participants
            await supabase.from('activity_participants').insert([{ activity_id, user_email: nextUserEmail }]);
            
            // ลบคนนั้นออกจากคิว waitlists
            await supabase.from('activity_waitlists').delete().eq('id', waitlist[0].id);

            // แจ้งเตือนผู้ที่ได้เลื่อนคิวในแชทกลุ่ม
            await supabase.from('messages').insert([{
                activity_id, 
                sender_email: nextUserEmail, 
                text: `${nextUserRecord ? nextUserRecord.name : 'สมาชิก'} เข้าร่วมกลุ่ม (เลื่อนจากคิวสำรองสิทธิ์)`, 
                is_system_message: true,
                chat_type: 'group'
            }]);

            // ส่งการแจ้งเตือน Notification ไปบอกผู้ใช้ที่ได้เลื่อนคิว
            await supabase.from('notifications').insert([{
                user_email: nextUserEmail,
                title: "เลื่อนคิวสำเร็จ!",
                message: `กิจกรรม "${activity.title}" มีที่ว่าง คุณได้รับการเลื่อนคิวเข้าร่วมกิจกรรมแล้ว!`,
                type: 'activity_joined',
                activity_id: activity_id,
                is_read: false
            }]);
        }

        res.status(200).json({ message: 'ออกจากกิจกรรมสำเร็จ' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 6.2 POST: ยกเลิกสำรองสิทธิ์ ---
router.post('/leave_waitlist', async (req, res) => {
    try {
        const { activity_id, user_email } = req.body;
        
        // ลบข้อมูลการสำรองสิทธิ์
        const { data, error } = await supabase
            .from('activity_waitlists')
            .delete()
            .eq('activity_id', activity_id)
            .eq('user_email', user_email)
            .select();
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            return res.status(400).json({ error: 'ไม่พบรายการสำรองสิทธิ์' });
        }

        // ดึงจำนวนผู้สำรองสิทธิ์ที่เหลืออยู่เพื่อใช้อัปเดต UI 
        const { count } = await supabase
            .from('activity_waitlists')
            .select('*', { count: 'exact', head: true })
            .eq('activity_id', activity_id);

        res.status(200).json({ 
            message: 'ยกเลิกคิวสำรองสิทธิ์สำเร็จ',
            status: 'cancelled',
            waitlist_count: count || 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 6.3 POST: อัปเดตเวลาที่อ่านแชทล่าสุด (Mark as read) ---
router.post('/chat/read', async (req, res) => {
    try {
        const { user_email, chat_type, reference_id } = req.body;
        const refStr = reference_id.toString();

        // เช็คว่ามี record เดิมอยู่หรือไม่
        const { data: existing } = await supabase
            .from('chat_reads')
            .select('id')
            .eq('user_email', user_email)
            .eq('chat_type', chat_type)
            .eq('reference_id', refStr)
            .single();

        let error;
        if (existing) {
            // มีข้อมูลอยู่แล้วให้อัปเดตเวลา
            const { error: updateError } = await supabase.from('chat_reads').update({ last_read_at: new Date().toISOString() }).eq('id', existing.id);
            error = updateError;
        } else {
            // เข้าแชทครั้งแรกให้ insert ข้อมูลใหม่
            const { error: insertError } = await supabase.from('chat_reads').insert([{ user_email, chat_type, reference_id: refStr, last_read_at: new Date().toISOString() }]);
            error = insertError;
        }

        if (error) throw error;
        res.status(200).json({ message: "Marked as read" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 7. POST: เชิญเพื่อนเข้าร่วมกิจกรรม ---
router.post('/activities/invite', async (req, res) => {
    try {
        const { activity_id, inviter_email, invitee_email } = req.body;

        // 1. ตรวจสอบข้อมูล
        if (!activity_id || !inviter_email || !invitee_email) {
            return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
        }

        // 2. ดึงข้อมูลกิจกรรมและผู้เชิญ
        const { data: activity, error: activityError } = await supabase
            .from('activities')
            .select('id, title, status, participants:activity_participants(user_email)')
            .eq('id', activity_id)
            .single();
        
        if (activityError || !activity) return res.status(404).json({ error: 'ไม่พบกิจกรรม' });

        const { data: inviter, error: inviterError } = await supabase
            .from('users')
            .select('name')
            .eq('email', inviter_email)
            .single();
        
        if (inviterError || !inviter) return res.status(404).json({ error: 'ไม่พบผู้เชิญ' });

        // 3. ตรวจสอบเงื่อนไข
        if (activity.status !== 'upcoming') {
            return res.status(400).json({ error: 'กิจกรรมนี้เริ่มไปแล้วหรือจบแล้ว ไม่สามารถเชิญได้' });
        }

        const participantEmails = activity.participants.map(p => p.user_email);

        if (!participantEmails.includes(inviter_email)) {
            return res.status(403).json({ error: 'คุณไม่ใช่สมาชิกของกิจกรรมนี้ จึงไม่สามารถเชิญได้' });
        }

        if (participantEmails.includes(invitee_email)) {
            return res.status(400).json({ error: 'ผู้ใช้คนนี้เป็นสมาชิกของกิจกรรมอยู่แล้ว' });
        }

        // 4. สร้างและส่งการแจ้งเตือน
        const { error: notifError } = await supabase.from('notifications').insert([{
            user_email: invitee_email,
            title: 'คำเชิญเข้าร่วมกิจกรรม',
            message: `${inviter.name} ได้เชิญคุณเข้าร่วมกิจกรรม "${activity.title}"`,
            type: 'activity_invitation',
            activity_id: activity_id,
            is_read: false
        }]);

        if (notifError) throw notifError;

        res.status(200).json({ message: 'ส่งคำเชิญสำเร็จ' });

    } catch (err) {
        console.error("Invite friend error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 7.1 POST: ตอบรับคำเชิญเข้าร่วมกิจกรรม ---
router.post('/activities/invite/accept', async (req, res) => {
    try {
        const { notification_id, activity_id, user_email } = req.body;

        // 1. ดึงข้อมูลกิจกรรมเพื่อเช็คสถานะและจำนวนคน
        const { data: activity, error: actError } = await supabase
            .from('activities')
            .select('max_participants, status, min_age, max_age, gender_preference, min_rating')
            .eq('id', activity_id)
            .single();
            
        if (actError || !activity) return res.status(404).json({ error: 'ไม่พบข้อมูลกิจกรรม' });
        if (activity.status !== 'upcoming') return res.status(400).json({ error: 'กิจกรรมนี้ไม่สามารถเข้าร่วมได้ในขณะนี้' });

        // 2. ดึงข้อมูลผู้ใช้เพื่อตรวจสอบเงื่อนไขและแบน
        const { data: user, error: userError } = await supabase.from('users').select('name, dob, gender, rating, banned_until').eq('email', user_email).single();
        if (userError || !user) return res.status(404).json({ error: 'ไม่พบข้อมูลผู้ใช้' });

        if (user.banned_until) {
            const banDate = new Date(user.banned_until);
            if (banDate > new Date()) {
                return res.status(403).json({ error: `บัญชีของคุณถูกระงับการเข้าร่วมกิจกรรมจนถึงวันที่ ${banDate.toLocaleDateString('th-TH')}` });
            }
        }

        // 3. ตรวจสอบเงื่อนไขของกิจกรรม (อายุ, เพศ, เรทติ้ง)
        if (activity.min_age || activity.max_age) {
            if (!user.dob) return res.status(403).json({ error: 'กรุณาระบุวันเกิดในโปรไฟล์ก่อนตอบรับคำเชิญ' });
            const birthDate = new Date(user.dob);
            const today = new Date();
            let age = today.getFullYear() - birthDate.getFullYear();
            const m = today.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
            
            if (activity.min_age && age < activity.min_age) return res.status(403).json({ error: `กิจกรรมนี้จำกัดอายุขั้นต่ำ ${activity.min_age} ปี (อายุของคุณ: ${age} ปี)` });
            if (activity.max_age && age > activity.max_age) return res.status(403).json({ error: `กิจกรรมนี้จำกัดอายุไม่เกิน ${activity.max_age} ปี (อายุของคุณ: ${age} ปี)` });
        }
        if (activity.gender_preference && activity.gender_preference !== 'ทั้งหมด' && activity.gender_preference !== 'ไม่ระบุ') {
            if (!user.gender) return res.status(403).json({ error: 'กรุณาระบุเพศในโปรไฟล์ก่อนตอบรับคำเชิญ' });
            if (user.gender !== activity.gender_preference) return res.status(403).json({ error: `กิจกรรมนี้จำกัดเฉพาะเพศ${activity.gender_preference}เท่านั้น` });
        }
        if (activity.min_rating) {
            const userRating = user.rating || 0;
            if (userRating < activity.min_rating) return res.status(403).json({ error: `กิจกรรมนี้จำกัดเรทติ้งขั้นต่ำ ${activity.min_rating} ดาว (ของคุณ: ${userRating.toFixed(1)} ดาว)` });
        }

        // 4. ตรวจสอบจำนวนผู้เข้าร่วม (ป้องกันคนล้น)
        const { count: currentCount, error: countError } = await supabase
            .from('activity_participants')
            .select('*', { count: 'exact', head: true })
            .eq('activity_id', activity_id)
            .eq('status', 'joined');
            
        if (currentCount >= activity.max_participants) {
            return res.status(400).json({ error: 'กิจกรรมนี้มีผู้เข้าร่วมเต็มแล้ว' });
        }

        // 5. เพิ่มผู้ใช้เข้าเป็นผู้เข้าร่วมกิจกรรม
        const { data: existing } = await supabase.from('activity_participants').select('id').eq('activity_id', activity_id).eq('user_email', user_email).single();
        if (!existing) {
            await supabase.from('activity_participants').insert([{ activity_id, user_email, status: 'joined' }]);
            
            // แจ้งในแชทกลุ่มว่ามีคนเข้าร่วม
            await supabase.from('messages').insert([{
                activity_id, 
                sender_email: user_email, 
                text: `${user.name || 'สมาชิก'} เข้าร่วมกลุ่มจากการเชิญ`, 
                is_system_message: true,
                chat_type: 'group'
            }]);
        }

        // 6. อัปเดตการแจ้งเตือนว่า "ตอบรับแล้ว"
        await supabase.from('notifications')
            .update({ is_read: true, type: 'activity_invite_accepted' })
            .eq('id', notification_id);

        res.status(200).json({ message: 'เข้าร่วมกิจกรรมสำเร็จ' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 7.2 POST: ปฏิเสธคำเชิญเข้าร่วมกิจกรรม ---
router.post('/activities/invite/reject', async (req, res) => {
    try {
        const { notification_id } = req.body;
        
        await supabase.from('notifications')
            .update({ is_read: true, type: 'activity_invite_rejected' })
            .eq('id', notification_id);
            
        res.status(200).json({ message: 'ปฏิเสธคำเชิญสำเร็จ' });
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
                    creator:users!creator_email(name, profile_image, banned_until),
                    participants:activity_participants(user_email, status)
                )
            `)
            .eq('user_email', email); // ดึงทุกกิจกรรมที่เราเป็นสมาชิก (รวมถึงที่สร้างเอง)

        if (error) {
            console.error("Supabase Error (joined activities):", error);
            throw error;
        }

        // แก้ไข: กรองเอาเฉพาะข้อมูลกิจกรรมที่ไม่เป็น null (ลบฟิลเตอร์ที่กันเจ้าของออกแล้ว)
        // ซ่อนกิจกรรมที่ถูกระงับทั้งหมด ไม่ให้แสดงในหน้าแชทลิสต์
        const filteredData = (data || [])
            .map(item => item.activity)
            .filter(a => a !== null && a.status !== 'suspended');
            
        // --- เพิ่มการดึงข้อความล่าสุด ---
        const activityIds = filteredData.map(a => a.id);
        if (activityIds.length > 0) {
            const { data: messages } = await supabase
                .from('messages')
                .select('activity_id, text, image_url, created_at, sender_email, sender:users!sender_email(name, banned_until)')
                .in('activity_id', activityIds)
                .eq('chat_type', 'group')
                .order('created_at', { ascending: false });
                
            const { data: chatReads } = await supabase
                .from('chat_reads')
                .select('reference_id, last_read_at')
                .eq('user_email', email)
                .eq('chat_type', 'group');
                
            const readsMap = {};
            (chatReads || []).forEach(cr => {
                readsMap[cr.reference_id] = new Date(cr.last_read_at);
            });
                
            filteredData.forEach(act => {
                const actMessages = (messages || []).filter(m => m.activity_id === act.id);
                const lastMsg = actMessages[0]; // ข้อความล่าสุด (เนื่องจาก Order DESC มาแล้ว)
                
                if (lastMsg) {
                    let msgText = lastMsg.text || '';
                    if (!msgText && lastMsg.image_url) msgText = '[รูปภาพ]';
                    const senderName = lastMsg.sender ? lastMsg.sender.name : 'ระบบ';
                    act.last_message = `${senderName}: ${msgText}`;
                    act.last_message_time = lastMsg.created_at;
                }
                
                // คำนวณจำนวน Unread โดยนับข้อความที่เกิดหลังจากการอ่านล่าสุด (และต้องไม่ใช่ข้อความที่เราส่งเอง)
                const lastRead = readsMap[act.id.toString()] || new Date(0);
                act.unread_count = actMessages.filter(m => 
                    m.sender_email !== email && 
                    new Date(m.created_at) > lastRead
                ).length;
            });
        }
            
        // เรียงลำดับแชทที่มีข้อความล่าสุดขึ้นก่อน
        filteredData.sort((a, b) => {
            const timeA = a.last_message_time ? new Date(a.last_message_time).getTime() : 0;
            const timeB = b.last_message_time ? new Date(b.last_message_time).getTime() : 0;
            return timeB - timeA;
        });

        res.json(filteredData);
    } catch (err) {
        console.error("API Error (joined activities):", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 8. GET: กิจกรรมที่สร้างเอง ---
router.get('/activities/created/:email', async (req, res) => {
    const { data } = await supabase
        .from('activities')
        .select('*, creator:users!creator_email(name, profile_image, banned_until), participants:activity_participants(user_email, status, user:users(profile_image, banned_until))')
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

// --- 10. PUT: ระงับกิจกรรม (สำหรับ Admin) ---
router.put('/activities/:id/suspend', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'กรุณาระบุเหตุผลในการระงับกิจกรรม' });
        }

        // 1. ดึงข้อมูลกิจกรรมเพื่อไปตรวจสอบและนำไปแจ้งเตือน
        const { data: activity, error: fetchError } = await supabase
            .from('activities')
            .select('id, title, creator_email, start_datetime')
            .eq('id', id)
            .single();

        if (fetchError || !activity) return res.status(404).json({ error: "ไม่พบกิจกรรม" });

        // 2. อัปเดตสถานะกิจกรรมเป็น 'suspended'
        const { error: updateError } = await supabase
            .from('activities')
            .update({ status: 'suspended' })
            .eq('id', id);

        if (updateError) throw updateError;

        // [เพิ่มใหม่] 2.5 อัปเดตสถานะรายงานทั้งหมดที่เกี่ยวข้องกับกิจกรรมนี้ให้เป็น 'resolved' (จัดการแล้ว)
        await supabase
            .from('activity_reports')
            .update({ status: 'resolved' })
            .eq('activity_id', id)
            .eq('report_type', 'activity');

        const notifications = [];
        
        // 3. แจ้งเตือนไปยังเจ้าของกิจกรรม (พร้อมเหตุผล)
        notifications.push({
            user_email: activity.creator_email,
            title: "กิจกรรมของคุณถูกระงับ",
            message: `กิจกรรม "${activity.title}" ถูกระงับเนื่องจาก: ${reason}`,
            type: 'activity_suspended',
            activity_id: id,
            is_read: false
        });

        // 4. แจ้งเตือนไปยังผู้เข้าร่วมกิจกรรม (ถ้ากิจกรรมยังไม่เริ่ม)
        const now = new Date();
        const startTime = new Date(activity.start_datetime);

        if (startTime > now) {
            const { data: participants } = await supabase
                .from('activity_participants')
                .select('user_email')
                .eq('activity_id', id)
                .neq('user_email', activity.creator_email); // ไม่ต้องแจ้งเตือนเจ้าของซ้ำ

            if (participants && participants.length > 0) {
                for (const p of participants) {
                    notifications.push({
                        user_email: p.user_email,
                        title: "กิจกรรมถูกระงับ",
                        message: `กิจกรรม "${activity.title}" ที่คุณเข้าร่วมถูกระงับโดยผู้ดูแลระบบ`,
                        type: 'activity_suspended',
                        activity_id: id,
                        is_read: false
                    });
                }
            }
        }

        // 5. บันทึกการแจ้งเตือนทั้งหมดลงฐานข้อมูล
        if (notifications.length > 0) {
            const { error: notifError } = await supabase.from('notifications').insert(notifications);
            if (notifError) {
                console.error("Insert Notification Error:", notifError);
                throw new Error("ข้อผิดพลาดในการบันทึกแจ้งเตือน: " + notifError.message);
            }
        }

        // 6. ลบข้อความแชททั้งหมดของกิจกรรมที่ถูกระงับ
        await supabase.from('messages').delete().eq('activity_id', id);

        res.json({ message: "ระงับกิจกรรมและส่งการแจ้งเตือนสำเร็จ" });
    } catch (err) {
        console.error("Suspend Activity Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 11. ส่วนระบบแชทกลุ่ม (Group Chat)
// ==========================================

// --- GET: ดึงข้อความแชทกลุ่ม ---
router.get('/activities/:id/messages', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('messages')
            .select('*, sender:users!sender_email(name, profile_image, banned_until)')
            .eq('activity_id', id)
            .eq('chat_type', 'group') // กรองให้แน่ใจว่าเป็นของกลุ่ม
            .order('created_at', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error("Fetch Group Messages Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- POST: ส่งข้อความแชทกลุ่ม ---
router.post('/messages', upload.single('image'), async (req, res) => {
    try {
        const { activity_id, sender_email, text, is_system_message } = req.body;
        const file = req.file;
        let imageUrl = null;

        if (file) {
            const fileName = `group_chat_${Date.now()}_${Math.floor(Math.random() * 1000)}.${file.originalname.split('.').pop()}`;
            const { error: uploadError } = await supabase.storage
                .from('chat_images')
                .upload(fileName, file.buffer, { contentType: file.mimetype });

            if (uploadError) throw uploadError;
            const { data: urlData } = supabase.storage.from('chat_images').getPublicUrl(fileName);
            imageUrl = urlData.publicUrl;
        }

        const { data, error } = await supabase
            .from('messages')
            // เซฟค่า activity_id ลงไป ส่วน receiver_email จะเป็น null โดยอัตโนมัติ
            .insert([{ 
                activity_id, 
                sender_email, 
                text, 
                is_system_message: is_system_message === 'true' || is_system_message === true, 
                image_url: imageUrl, 
                chat_type: 'group' 
            }])
            .select();

        if (error) throw error;
        res.status(201).json(data[0]);
    } catch (err) {
        console.error("Send Group Message Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 12. GET: กิจกรรมที่ผู้ใช้กดสำรองสิทธิ์ไว้ ---
router.get('/activities/waitlisted/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const { data, error } = await supabase
            .from('activity_waitlists')
            .select(`
                id,
                activity:activities (
                    *,
                    creator:users!creator_email(name, profile_image, banned_until),
                    participants:activity_participants(user_email),
                    waitlists:activity_waitlists(user_email, created_at)
                )
            `)
            .eq('user_email', email)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const now = new Date();
        const expiredIds = [];
        const notifications = [];

        const enhancedData = (data || []).map(item => {
            const act = item.activity;
            if (!act || act.status === 'suspended') return null;

            // หากกิจกรรมไหนเริ่มไปแล้ว เราจะเก็บ ID ไว้ไปลบ และไม่ส่งกลับไปให้หน้าแอป
            const isStarted = new Date(act.start_datetime) <= now;
            if (isStarted) {
                expiredIds.push(item.id);
                notifications.push({
                    user_email: email,
                    title: 'คิวสำรองสิทธิ์ถูกยกเลิก',
                    message: `กิจกรรม "${act.title}" ที่คุณต่อคิวไว้ได้เริ่มขึ้นแล้ว คิวของคุณจึงถูกยกเลิกอัตโนมัติ`,
                    type: 'waitlist_cancelled',
                    activity_id: act.id,
                    is_read: false
                });
                return null;
            }

            const allWaitlists = act.waitlists || [];
            allWaitlists.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            const position = allWaitlists.findIndex(w => w.user_email === email) + 1;

            return {
                ...act,
                waitlist_position: position
            };
        }).filter(item => item !== null);

        // ดำเนินการลบคิวและส่งการแจ้งเตือนแบบ Background
        if (expiredIds.length > 0) {
            supabase.from('activity_waitlists').delete().in('id', expiredIds).then();
            supabase.from('notifications').insert(notifications).then();
        }

        res.json(enhancedData);
    } catch (err) {
        console.error("API Error (waitlisted activities):", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 13. ระบบ Background Task: แจ้งเตือนล่วงหน้า 1 ชั่วโมง
// ==========================================
setInterval(async () => {
    try {
        const now = new Date();
        // ค้นหากิจกรรมที่จะเริ่มในช่วง 60 - 65 นาทีข้างหน้า
        const fromTime = new Date(now.getTime() + 60 * 60 * 1000);
        const toTime = new Date(now.getTime() + 65 * 60 * 1000);

        // 1. ดึงข้อมูลกิจกรรมที่อยู่ในช่วงเวลาดังกล่าว
        const { data: activities, error } = await supabase
            .from('activities')
            .select('id, title, start_datetime')
            .eq('status', 'upcoming')
            .gte('start_datetime', fromTime.toISOString())
            .lte('start_datetime', toTime.toISOString());

        if (error || !activities || activities.length === 0) return;

        for (const act of activities) {
            // 2. เช็คว่าเคยส่งแจ้งเตือนเตือนความจำกิจกรรมนี้ไปหรือยัง (ป้องกันส่งซ้ำ)
            const { data: existingNotif } = await supabase
                .from('notifications')
                .select('id')
                .eq('activity_id', act.id)
                .eq('type', 'activity_reminder')
                .limit(1);

            if (existingNotif && existingNotif.length > 0) continue;

            // 3. ดึงรายชื่อผู้เข้าร่วมเพื่อส่งการแจ้งเตือน
            const { data: participants } = await supabase
                .from('activity_participants')
                .select('user_email')
                .eq('activity_id', act.id);

            if (participants && participants.length > 0) {
                const notifications = participants.map(p => ({
                    user_email: p.user_email,
                    title: 'กิจกรรมกำลังจะเริ่ม!',
                    message: `เตรียมตัวให้พร้อม! กิจกรรม "${act.title}" กำลังจะเริ่มในอีก 1 ชั่วโมง`,
                    type: 'activity_reminder',
                    activity_id: act.id,
                    is_read: false
                }));
                
                await supabase.from('notifications').insert(notifications);
                console.log(`[System] ส่งแจ้งเตือนล่วงหน้า 1 ชม. สำหรับกิจกรรม: ${act.title}`);
            }
        }
    } catch (err) {
        console.error('[System] Error checking upcoming activities:', err.message);
    }
}, 5 * 60 * 1000); // ทำงานทุกๆ 5 นาที (300,000 ms)

module.exports = router;