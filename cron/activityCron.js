const cron = require('node-cron');
const supabase = require('../config/supabase');

const startCronJobs = () => {
    // ทำงานทุกๆ 1 นาที
    cron.schedule('* * * * *', async () => {
        const nowISO = new Date().toISOString();
        console.log(`[Cron] ตรวจสอบกิจกรรม ณ เวลา: ${nowISO}`);

        try {
            // --- ส่วนที่ 1: ตรวจสอบกิจกรรมที่ถึงเวลาเริ่ม (upcoming -> in_progress) ---
            const { data: activitiesToStart } = await supabase
                .from('activities')
                .select('id, title')
                .eq('status', 'upcoming')
                .lte('start_datetime', nowISO);

            if (activitiesToStart && activitiesToStart.length > 0) {
                for (const activity of activitiesToStart) {
                    await supabase.from('activities').update({ status: 'in_progress' }).eq('id', activity.id);
                    
                    const { data: participants } = await supabase.from('activity_participants').select('user_email').eq('activity_id', activity.id);
                    if (participants && participants.length > 0) {
                        const notifications = participants.map(p => ({
                            user_email: p.user_email,
                            title: "กิจกรรมเริ่มขึ้นแล้ว!",
                            message: `กิจกรรม "${activity.title}" เริ่มต้นขึ้นแล้ว เข้าไปร่วมสนุกกันเลย`,
                            activity_id: activity.id,
                            type: 'activity_started'
                        }));
                        await supabase.from('notifications').insert(notifications);
                    }
                    console.log(`[Cron] กิจกรรมเริ่มสำเร็จ: ${activity.title}`);
                }
            }

            // --- ส่วนที่ 2: ตรวจสอบกิจกรรมที่ถึงเวลาสิ้นสุด (in_progress/upcoming -> completed) ---
            // เราตรวจสอบกิจกรรมที่ end_datetime มาถึงแล้ว แต่สถานะยังไม่ใช่ completed
            const { data: activitiesToComplete } = await supabase
                .from('activities')
                .select('id, title')
                .neq('status', 'completed')
                .lte('end_datetime', nowISO);

            if (activitiesToComplete && activitiesToComplete.length > 0) {
                for (const activity of activitiesToComplete) {
                    // 1. อัปเดตสถานะเป็น completed
                    await supabase.from('activities').update({ status: 'completed' }).eq('id', activity.id);
                    
                    // 2. ดึงรายชื่อสมาชิกเพื่อส่งแจ้งเตือนให้ไปรีวิว/ให้คะแนน
                    const { data: participants } = await supabase.from('activity_participants').select('user_email').eq('activity_id', activity.id);
                    
                    if (participants && participants.length > 0) {
                        const endNotifications = participants.map(p => ({
                            user_email: p.user_email,
                            title: "กิจกรรมสิ้นสุดลงแล้ว!",
                            message: `กิจกรรม "${activity.title}" จบลงแล้ว มาให้คะแนนเพื่อนในทริปกันเถอะ`,
                            activity_id: activity.id,
                            type: 'rating_prompt'
                        }));
                        await supabase.from('notifications').insert(endNotifications);
                    }
                    console.log(`[Cron] กิจกรรมสิ้นสุดสำเร็จ: ${activity.title}`);
                }
            }

        } catch (err) {
            console.error("[Cron Error]:", err.message);
        }
    });
};

module.exports = startCronJobs;