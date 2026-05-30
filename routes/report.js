const express = require('express');
const supabase = require('../config/supabase');
const upload = require('../middlewares/upload');
const router = express.Router();

// --- POST: สร้างรายงาน (รองรับรายงานกิจกรรมและผู้เข้าร่วม + แนบภาพ) ---
router.post('/reports', upload.single('image'), async (req, res) => {
    try {
        const { reporter_email, report_type, target_id, reason, activity_id } = req.body;
        const file = req.file;

        if (!reporter_email || !report_type || !target_id || !reason || !activity_id) {
            return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน (ต้องการ reporter_email, report_type, target_id, reason, activity_id)' });
        }

        // 1. ดึงข้อมูลกิจกรรม
        const { data: activity, error: activityError } = await supabase
            .from('activities')
            .select('id, creator_email')
            .eq('id', activity_id)
            .single();

        if (activityError || !activity) return res.status(404).json({ error: 'ไม่พบกิจกรรม' });

        // 2. ดึงรายชื่อผู้เข้าร่วมทั้งหมด
        const { data: participants, error: participantsError } = await supabase
            .from('activity_participants')
            .select('user_email')
            .eq('activity_id', activity_id);

        if (participantsError) throw participantsError;
        
        const participantEmails = participants.map(item => item.user_email);
        const isReporterCreator = reporter_email === activity.creator_email;
        const isReporterParticipant = participantEmails.includes(reporter_email);

        let reported_user_email = null;

        // --- ตรวจสอบเงื่อนไขการรายงาน ---
        if (report_type === 'activity') {
            if (isReporterCreator) {
                return res.status(403).json({ error: 'เจ้าของกิจกรรมไม่สามารถรายงานกิจกรรมตัวเองได้' });
            }
        } else if (report_type === 'user') {
            reported_user_email = target_id; // target_id จะเป็นอีเมลของคนที่ถูกรายงาน

            if (reporter_email === reported_user_email) {
                return res.status(400).json({ error: 'ไม่สามารถรายงานตัวเองได้' });
            }

            const isReportedCreator = reported_user_email === activity.creator_email;
            const isReportedParticipant = participantEmails.includes(reported_user_email);

            if (!isReporterCreator && !isReporterParticipant) {
                return res.status(403).json({ error: 'คุณไม่ได้อยู่ในกิจกรรมนี้' });
            }
            if (!isReportedCreator && !isReportedParticipant) {
                return res.status(400).json({ error: 'ผู้ถูกรายงานไม่ได้อยู่ในกิจกรรมนี้' });
            }
        } else {
            return res.status(400).json({ error: 'ประเภทการรายงานไม่ถูกต้อง' });
        }

        // --- อัปโหลดรูปภาพหลักฐาน (ถ้ามี) ---
        let imageUrl = null;
        if (file) {
            const extension = file.originalname.split('.').pop();
            const fileName = `report_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
            const { error: uploadError } = await supabase.storage
                .from('report_images')
                .upload(fileName, file.buffer, { contentType: file.mimetype });

            if (uploadError) throw uploadError;
            const { data: urlData } = supabase.storage.from('report_images').getPublicUrl(fileName);
            imageUrl = urlData.publicUrl;
        }

        // --- บันทึกข้อมูลลงฐานข้อมูล ---
        const { data: reportData, error: reportError } = await supabase
            .from('activity_reports')
            .insert([{ activity_id, reporter_email, report_type, reported_user_email, reason, image_url: imageUrl, status: 'pending' }])
            .select();

        if (reportError) throw reportError;

        res.status(201).json(reportData[0]);
    } catch (err) {
        console.error('Report Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- GET: ดึงรายงานทั้งหมดของกิจกรรม ---
router.get('/reports/activity/:activity_id', async (req, res) => {
    try {
        const { activity_id } = req.params;
        
        // ใช้ Supabase Query ดึงข้อมูล 3 ส่วน (Activity, Creator, Reports + Reporters) ในครั้งเดียว
        const { data: activityData, error } = await supabase
            .from('activities')
            .select(`
                id, title, description, image_urls, start_datetime, status,
                creator:users!creator_email (name, email, profile_image),
                reporters:activity_reports (
                    id, reason, image_url, created_at, status,
                    reporter:users!activity_reports_reporter_email_fkey (name, email)
                )
            `)
            .eq('id', activity_id)
            .single();

        if (error) throw error;
        if (!activityData) return res.status(404).json({ error: 'ไม่พบกิจกรรม' });

        // จัดรูปแบบ JSON Response ตามโครงสร้างที่ต้องการ
        const responseData = {
            activity: {
                id: activityData.id,
                title: activityData.title,
                description: activityData.description,
                cover_image: activityData.image_urls && activityData.image_urls.length > 0 ? activityData.image_urls[0] : null,
                start_datetime: activityData.start_datetime,
                status: activityData.status,
                creator: activityData.creator
            },
            reporters: (activityData.reporters || []).map(r => ({
                report_id: r.id,
                reason: r.reason,
                evidence_image: r.image_url,
                reported_at: r.created_at,
                status: r.status,
                reporter_name: r.reporter?.name || 'ไม่ระบุตัวตน',
                reporter_email: r.reporter?.email
            })).sort((a, b) => new Date(b.reported_at) - new Date(a.reported_at)) // เรียงจากใหม่ไปเก่า
        };

        res.json(responseData);
    } catch (err) {
        console.error('Fetch Activity Report Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- GET: ดึงประวัติการรายงานของผู้ใช้แบบละเอียด (สำหรับ Admin) ---
router.get('/reports/target-user/:email', async (req, res) => {
    try {
        const { email } = req.params;

        // ใช้ Supabase Query ดึงข้อมูลผู้ใช้ที่ถูกรายงาน พร้อมรายการคนที่รายงาน (JOIN 3 แหล่ง)
        const { data: targetUser, error } = await supabase
            .from('users')
            .select(`
                email, name, profile_image, banned_until, rating,
                reports:activity_reports!activity_reports_reported_user_email_fkey (
                    id, reason, image_url, created_at, status,
                    reporter:users!activity_reports_reporter_email_fkey (name, email, profile_image)
                )
            `)
            .eq('email', email)
            .single();

        if (error) throw error;
        if (!targetUser) return res.status(404).json({ error: 'ไม่พบข้อมูลผู้ใช้' });

        // จัดรูปแบบ JSON Response ให้มีโปรไฟล์ผู้ใช้หลัก และ Array ของ Repoters
        const responseData = {
            user: {
                email: targetUser.email,
                name: targetUser.name,
                profile_image: targetUser.profile_image,
                banned_until: targetUser.banned_until,
                rating: targetUser.rating,
                status: targetUser.banned_until && new Date(targetUser.banned_until) > new Date() ? 'banned' : 'active'
            },
            reporters: (targetUser.reports || [])
                .map(r => ({
                    report_id: r.id,
                    reason: r.reason,
                    evidence_image: r.image_url,
                    reported_at: r.created_at,
                    status: r.status,
                    reporter_name: r.reporter?.name || 'ไม่ระบุตัวตน',
                    reporter_email: r.reporter?.email,
                    reporter_image: r.reporter?.profile_image
                }))
                .sort((a, b) => new Date(b.reported_at) - new Date(a.reported_at)) // เรียงล่าสุดขึ้นก่อน
        };

        res.json(responseData);
    } catch (err) {
        console.error('Fetch Target User Report Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- GET: ดึงรายการรายงานตามผู้รายงานหรือผู้ถูกรายงาน (แสดงในประวัติแอดมินหรือโปรไฟล์) ---
router.get('/reports/user/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const { data, error } = await supabase
            .from('activity_reports')
            .select(`
                *,
                reporter:users!activity_reports_reporter_email_fkey(name, profile_image),
                reported_user:users!activity_reports_reported_user_email_fkey(name, profile_image),
                activity:activities(title, start_datetime, end_datetime)
            `)
            .or(`reporter_email.eq.${email},reported_user_email.eq.${email}`)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- GET: ดึงรายการรายงานทั้งหมด (สำหรับ Admin) ---
router.get('/reports', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('activity_reports')
            .select(`
                *,
                reporter:users!activity_reports_reporter_email_fkey(name, profile_image, email),
                reported_user:users!activity_reports_reported_user_email_fkey(name, profile_image, email),
                activity:activities(id, title)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- PUT: อัปเดตสถานะรายงาน (สำหรับ Admin) ---
router.put('/reports/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'resolved', 'rejected', หรือ 'ignored'

        // 1. ดึงข้อมูลรายงานเพื่อหาอีเมลผู้รายงาน
        const { data: report, error: fetchError } = await supabase
            .from('activity_reports')
            .select('reporter_email, report_type')
            .eq('id', id)
            .single();
            
        if (fetchError || !report) return res.status(404).json({ error: "ไม่พบข้อมูลรายงาน" });

        const { data, error } = await supabase
            .from('activity_reports')
            .update({ status })
            .eq('id', id)
            .select();

        if (error) throw error;

        // 2. ส่งแจ้งเตือนไปยังผู้รายงาน
        let statusText = 'ได้รับการตรวจสอบแล้ว';
        if (status === 'resolved') {
            statusText = 'ได้รับการดำเนินการแล้ว';
        } else if (status === 'rejected' || status === 'ignored') {
            statusText = 'ถูกเพิกเฉย/ปัดตก';
        }
        const reportTypeText = report.report_type === 'activity' ? 'กิจกรรม' : 'ผู้ใช้';
        await supabase.from('notifications').insert([{
            user_email: report.reporter_email,
            title: "อัปเดตสถานะการรายงาน",
            type: "system_alert",
            is_read: false,
            message: `รายงาน${reportTypeText}ของคุณ ${statusText} โดยผู้ดูแลระบบ ขอบคุณที่ช่วยดูแลชุมชนของเรา`
        }]);

        res.json(data[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- PUT: ลงโทษผู้ใช้ที่ถูกรายงาน (หัก 1 ดาว + ระงับการใช้งาน) ---
router.put('/reports/:id/punish', async (req, res) => {
    try {
        const { id } = req.params;
        const { ban_days } = req.body;

        // 1. ดึงข้อมูลรายงานเพื่อหาอีเมลผู้ที่ถูกรายงาน
        const { data: report, error: reportErr } = await supabase
            .from('activity_reports')
            .select('*')
            .eq('id', id)
            .single();
            
        if (reportErr || !report) return res.status(404).json({ error: "ไม่พบข้อมูลรายงาน" });
        const targetEmail = report.reported_user_email;
        const reporterEmail = report.reporter_email;
        if (!targetEmail) return res.status(400).json({ error: "รายงานนี้ไม่ได้ระบุเป้าหมายเป็นผู้ใช้งาน" });

        // 2. ดึงข้อมูลผู้ใช้เพื่อคำนวณดาวปัจจุบัน
        const { data: user, error: userErr } = await supabase
            .from('users')
            .select('rating')
            .eq('email', targetEmail)
            .single();
            
        if (userErr || !user) return res.status(404).json({ error: "ไม่พบข้อมูลผู้ใช้" });

        // 3. ลด 1 ดาว (ต่ำสุดคือ 0) และคำนวณวันปลดแบน
        const currentRating = user.rating || 5; 
        const newRating = Math.max(0, currentRating - 1);
        
        let bannedUntil = null;
        if (ban_days && ban_days > 0) {
            const date = new Date();
            date.setDate(date.getDate() + parseInt(ban_days));
            bannedUntil = date.toISOString();
        }

        // 4. อัปเดตข้อมูลผู้ใช้
        const updateData = { rating: newRating };
        if (bannedUntil) updateData.banned_until = bannedUntil;

        await supabase.from('users').update(updateData).eq('email', targetEmail);

        // [อัปเดตใหม่] 5. เปลี่ยนสถานะใบรายงาน "ทั้งหมด" ของผู้ใช้นี้ให้เป็น 'resolved' อัตโนมัติ
        await supabase
            .from('activity_reports')
            .update({ status: 'resolved' })
            .eq('reported_user_email', targetEmail)
            .eq('report_type', 'user');

        // 6. ส่งแจ้งเตือนบอกผู้ใช้
        await supabase.from('notifications').insert([{
            user_email: targetEmail, title: "บัญชีถูกแบนและลงโทษ", type: "system_alert", is_read: false,
            message: `คุณถูกหัก 1 ดาว และถูกระงับการใช้งานแอปเป็นเวลา ${ban_days || 0} วัน เนื่องจากฝ่าฝืนกฎชุมชน`
        }]);

        // 7. ดึงรายชื่อผู้ที่เคยกดรายงานผู้ใช้นี้ทุกคน เพื่อส่งแจ้งเตือนกลับว่าจัดการให้แล้ว
        const { data: reporters } = await supabase
            .from('activity_reports')
            .select('reporter_email')
            .eq('reported_user_email', targetEmail)
            .eq('report_type', 'user');

        if (reporters && reporters.length > 0) {
            // กรองอีเมลที่ซ้ำกันออก (เผื่อ 1 คนรายงานหลายรอบ)
            const uniqueReporters = [...new Set(reporters.map(r => r.reporter_email))];
            const notifs = uniqueReporters.map(email => ({
                user_email: email,
                title: "อัปเดตสถานะการรายงาน",
                type: "system_alert",
                is_read: false,
                message: `รายงานผู้ใช้ที่คุณแจ้งเข้ามา ได้รับการพิจารณาและระงับบัญชีผู้กระทำผิดแล้ว ขอบคุณที่ช่วยดูแลชุมชนของเรา`
            }));
            await supabase.from('notifications').insert(notifs);
        }

        res.json({ message: "ลงโทษผู้ใช้และจัดการรายงานทั้งหมดสำเร็จ" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
