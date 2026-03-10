const cron = require('node-cron');
const supabase = require('../config/supabase');

const startCronJobs = () => {
    cron.schedule('* * * * *', async () => {
        const nowISO = new Date().toISOString();
        console.log(`[Cron] ตรวจสอบกิจกรรม ณ เวลา: ${nowISO}`);
        try {
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
        } catch (err) {
            console.error("[Cron Error]:", err.message);
        }
    });
};

module.exports = startCronJobs;