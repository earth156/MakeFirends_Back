const express = require('express');
const supabase = require('../config/supabase');
const upload = require('../middlewares/upload');
const router = express.Router();
const bcrypt = require('bcrypt'); // เพิ่มไลบรารีสำหรับเข้ารหัสผ่าน

// --- 1. GET: ค้นหาสมาชิกทั้งหมด ---
router.get('/users', async (req, res) => {
    try {
        const { search, exclude_email } = req.query;
        let query = supabase
            .from('users')
            .select('name, email, profile_image, university, bio, banned_until, is_online, last_active')
            .neq('role', 'admin') // ซ่อนบัญชี admin ไม่ให้แสดงในการค้นหาเพิ่มเพื่อน
            .order('name', { ascending: true });

        if (exclude_email) {
            query = query.neq('email', exclude_email);
        }

        if (search && search.trim()) {
            const searchTerm = search.trim();
            query = query.or(`name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
        }

        const { data: users, error: usersError } = await query.limit(50);
        if (usersError) {
            console.error('Supabase query error:', usersError);
            throw usersError;
        }

        let enhancedUsers = users || [];

        if (exclude_email) {
            const currentEmail = exclude_email;

            const { data: friendData, error: friendError } = await supabase
                .from('friends')
                .select('user_email_1, user_email_2')
                .or(`user_email_1.eq.${currentEmail},user_email_2.eq.${currentEmail}`);

            if (friendError) throw friendError;

            const friendEmails = new Set(
                (friendData || []).map(f =>
                    f.user_email_1 === currentEmail ? f.user_email_2 : f.user_email_1
                )
            );

            const { data: requestData, error: requestError } = await supabase
                .from('friend_requests')
                .select('sender_email, receiver_email, status')
                .or(`sender_email.eq.${currentEmail},receiver_email.eq.${currentEmail}`)
                .eq('status', 'pending');

            if (requestError) throw requestError;

            const pendingSent = new Set(
                (requestData || [])
                    .filter(r => r.sender_email === currentEmail)
                    .map(r => r.receiver_email)
            );
            const pendingReceived = new Set(
                (requestData || [])
                    .filter(r => r.receiver_email === currentEmail)
                    .map(r => r.sender_email)
            );

            enhancedUsers = (enhancedUsers || []).map(user => {
                const relation = friendEmails.has(user.email)
                    ? 'friend'
                    : pendingSent.has(user.email)
                        ? 'request_sent'
                        : pendingReceived.has(user.email)
                            ? 'request_received'
                            : 'none';
                return {
                    ...user,
                    relationship_status: relation,
                };
            });
        }

        res.status(200).json(enhancedUsers);
    } catch (err) {
        console.error('API error:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- 2. GET: ดึงข้อมูลโปรไฟล์รายบุคคล ---
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

// --- GET: ดึงข้อมูลรีวิวของผู้ใช้งาน ---
router.get('/users/:email/reviews', async (req, res) => {
    try {
        const { email } = req.params;
        const { data, error } = await supabase
            .from('reviews')
            .select('*, reviewer:users!reviewer_email(name, profile_image, email, banned_until)')
            .eq('reviewee_email', email)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.status(200).json(data || []);
    } catch (err) {
        console.error("Fetch Reviews Error:", err);
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการดึงข้อมูลรีวิว" });
    }
});

// --- 3. PUT: อัปเดตข้อมูลโปรไฟล์ ---
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

// --- 4. PUT: อัปเดตข้อมูลผู้ใช้งาน (แก้ไขชื่อ และ รหัสผ่าน) ---
router.put('/users/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const { name, password } = req.body;

        let updateData = {};
        if (name) updateData.name = name;
        
        // หากมีการส่งรหัสผ่านใหม่มาด้วย ให้เข้ารหัสก่อนบันทึกลงฐานข้อมูล
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            updateData.password = hashedPassword;
        }

        const { data, error } = await supabase
            .from('users')
            .update(updateData)
            .eq('email', email)
            .select();

        if (error) throw error;
        res.status(200).json(data[0]);
    } catch (err) {
        console.error("Update Admin Profile Error:", err);
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล" });
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

        if (!sender_email || !receiver_email) {
            return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
        }

        if (sender_email === receiver_email) {
            return res.status(400).json({ error: 'ไม่สามารถส่งคำขอให้ตัวเองได้' });
        }

        // ตรวจสอบว่าผู้ส่งหรือผู้รับเป็น admin หรือไม่
        const { data: usersRoles, error: roleError } = await supabase
            .from('users')
            .select('email, role')
            .in('email', [sender_email, receiver_email]);

        if (roleError) throw roleError;
        const hasAdmin = (usersRoles || []).some(user => user.role === 'admin');
        if (hasAdmin) {
            return res.status(403).json({ error: 'Admin ไม่สามารถส่งหรือรับคำขอเป็นเพื่อนได้' });
        }

        const { data: existingFriend, error: existingFriendError } = await supabase.from('friends')
            .select('*')
            .or(`and(user_email_1.eq.${sender_email},user_email_2.eq.${receiver_email}),and(user_email_1.eq.${receiver_email},user_email_2.eq.${sender_email})`);

        if (existingFriendError) {
            console.error('Error checking existing friendship:', existingFriendError);
            throw existingFriendError;
        }

        const isAlreadyFriend = (existingFriend || []).length > 0;

        if (isAlreadyFriend) {
            return res.status(400).json({ error: 'คุณเป็นเพื่อนกับคนนี้อยู่แล้ว' });
        }

        const { data: existingRequest, error: existingRequestError } = await supabase.from('friend_requests')
            .select('*')
            .or(`and(sender_email.eq.${sender_email},receiver_email.eq.${receiver_email}),and(sender_email.eq.${receiver_email},receiver_email.eq.${sender_email})`)
            .eq('status', 'pending');

        if (existingRequestError) {
            console.error('Error checking existing friend requests:', existingRequestError);
            throw existingRequestError;
        }

        const duplicateRequest = (existingRequest || [])[0];

        if (duplicateRequest) {
            if (duplicateRequest.sender_email === sender_email) {
                return res.status(400).json({ error: 'คุณได้ส่งคำขอนี้ไปแล้ว' });
            }
            return res.status(400).json({ error: 'ผู้ใช้คนนี้ได้ส่งคำขอเป็นเพื่อนถึงคุณแล้ว' });
        }

        const { data: requestData, error: requestError } = await supabase
            .from('friend_requests')
            .insert([{ sender_email, receiver_email, status: 'pending' }])
            .select();

        if (requestError) {
            console.error("Error inserting friend request:", requestError);
            throw requestError;
        }

        const friendRequestId = requestData[0].id; // นี่คือเลข ID (เช่น เลข 7)

        const { error: notifError } = await supabase.from('notifications').insert([{
            user_email: receiver_email,
            title: "คำขอเพิ่มเพื่อน",
            message: `มีคนส่งคำขอเป็นเพื่อนถึงคุณ`,
            type: 'friend_request',
            friend_request_id: friendRequestId,
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
        
        // 1. ดึงข้อมูลจากตาราง friends
        const { data: friendsData, error: friendsError } = await supabase.from('friends')
            .select('user_email_1, user_email_2')
            .or(`user_email_1.eq.${email},user_email_2.eq.${email}`);

        if (friendsError) {
            console.error("Supabase Error (fetch friends 1):", friendsError);
            throw friendsError;
        }
        if (!friendsData || friendsData.length === 0) return res.json([]);

        // 2. หาอีเมลของเพื่อน
        const friendEmails = friendsData.map(f => f.user_email_1 === email ? f.user_email_2 : f.user_email_1);

        // 3. ดึงข้อมูลโปรไฟล์ของเพื่อนจากอีเมลที่หาได้
        const { data: usersData, error: usersError } = await supabase.from('users')
            .select('name, profile_image, email, banned_until, is_online, last_active')
            .in('email', friendEmails);
            
        if (usersError) {
            console.error("Supabase Error (fetch friends 2):", usersError);
            throw usersError;
        }

        // 4. ดึงข้อความส่วนตัวล่าสุด
        const { data: messages } = await supabase
            .from('messages')
            .select('sender_email, receiver_email, text, image_url, created_at')
            .eq('chat_type', 'private')
            .or(`sender_email.eq.${email},receiver_email.eq.${email}`)
            .order('created_at', { ascending: false });

        // 5. ดึงข้อมูลการอ่านล่าสุดของแชทส่วนตัว (chat_reads)
        const { data: chatReads } = await supabase
            .from('chat_reads')
            .select('reference_id, last_read_at')
            .eq('user_email', email)
            .eq('chat_type', 'private');
            
        const readsMap = {};
        (chatReads || []).forEach(cr => {
            readsMap[cr.reference_id] = new Date(cr.last_read_at);
        });

        const enhancedUsers = (usersData || []).map(user => {
            const friendEmail = user.email;
            // กรองเฉพาะข้อความที่คุยกับเพื่อนคนนี้
            const chatMessages = (messages || []).filter(m => 
                (m.sender_email === email && m.receiver_email === friendEmail) ||
                (m.sender_email === friendEmail && m.receiver_email === email)
            );
            
            const lastMsg = chatMessages[0]; // ข้อความล่าสุด
            
            let lastMessageText = null;
            if (lastMsg) {
                lastMessageText = lastMsg.text || '';
                if (!lastMessageText && lastMsg.image_url) lastMessageText = '[รูปภาพ]';
                if (lastMsg.sender_email === email) lastMessageText = `คุณ: ${lastMessageText}`;
            }

            // คำนวณจำนวน Unread สำหรับแชทส่วนตัว
            const lastRead = readsMap[friendEmail] || new Date(0);
            const unreadCount = chatMessages.filter(m => 
                m.sender_email === friendEmail && // ต้องเป็นข้อความที่เพื่อนส่งมา
                new Date(m.created_at) > lastRead // เวลาส่งต้องใหม่กว่าเวลาที่เราอ่านล่าสุด
            ).length;

            return {
                ...user,
                last_message: lastMessageText,
                last_message_time: lastMsg ? lastMsg.created_at : null,
                unread_count: unreadCount
            };
        });

        // เรียงลำดับแชทที่มีข้อความล่าสุดขึ้นก่อน
        enhancedUsers.sort((a, b) => {
            const timeA = a.last_message_time ? new Date(a.last_message_time).getTime() : 0;
            const timeB = b.last_message_time ? new Date(b.last_message_time).getTime() : 0;
            return timeB - timeA;
        });

        res.json(enhancedUsers);
    } catch (err) {
        console.error("Fetch Friends Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 9. GET: ดึงข้อมูลคำขอเพื่อน ---
router.get('/friend-request/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('friend_requests')
            .select('*, sender:users!sender_email(name, profile_image, email, banned_until)')
            .eq('id', id)
            .single();

        if (error || !data) return res.status(404).json({ error: "ไม่พบข้อมูลคำขอ" });
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



// ==========================================
// 10. ส่วนระบบแชทส่วนตัว (Private Chat)
// ==========================================

// --- GET: ดึงข้อความแชทระหว่างเพื่อน 2 คน ---
router.get('/private_messages/:email1/:email2', async (req, res) => {
    try {
        const { email1, email2 } = req.params;
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('chat_type', 'private') // กรองเฉพาะแชทส่วนตัว
            .or(`and(sender_email.eq.${email1},receiver_email.eq.${email2}),and(sender_email.eq.${email2},receiver_email.eq.${email1})`)
            .order('created_at', { ascending: true }); // เรียงจากเก่าไปใหม่

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error("Fetch Private Messages Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- POST: ส่งข้อความแชทส่วนตัว ---
router.post('/private_messages', upload.single('image'), async (req, res) => {
    try {
        const { sender_email, receiver_email, text } = req.body;
        const file = req.file;
        let imageUrl = null;

        if (file) {
            const fileName = `private_chat_${Date.now()}_${Math.floor(Math.random() * 1000)}.${file.originalname.split('.').pop()}`;
            const { error: uploadError } = await supabase.storage
                .from('chat_images')
                .upload(fileName, file.buffer, { contentType: file.mimetype });

            if (uploadError) throw uploadError;
            const { data: urlData } = supabase.storage.from('chat_images').getPublicUrl(fileName);
            imageUrl = urlData.publicUrl;
        }

        const { data, error } = await supabase
            .from('messages')
            // เซฟค่า receiver_email ลงไป ส่วน activity_id จะเป็น null โดยอัตโนมัติ
            .insert([{ sender_email, receiver_email, text, image_url: imageUrl, chat_type: 'private' }])
            .select();

        if (error) throw error;
        res.status(201).json(data[0]);
    } catch (err) {
        console.error("Send Private Message Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- POST: ขอรีเซ็ตรหัสผ่าน (ลืมรหัสผ่าน) ---
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "กรุณาระบุอีเมล" });

        // 1. ตรวจสอบว่ามีอีเมลนี้ในระบบหรือไม่
        const { data: user, error } = await supabase.from('users').select('*').eq('email', email).single();
        if (error || !user) {
            return res.status(404).json({ error: "ไม่พบอีเมลนี้ในระบบ" });
        }

        // 2. สร้างรหัส OTP 6 หลัก
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // 3. บันทึก OTP ลงในฐานข้อมูลชั่วคราว
        await supabase.from('users').update({ reset_otp: otp }).eq('email', email);

        // 4. ตั้งค่าบริการส่งอีเมลผ่าน Brevo HTTP API
        const BREVO_API_KEY = process.env.BREVO_API_KEY;

        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': BREVO_API_KEY,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                sender: { 
                    name: 'Make Friends App', 
                    email: 'earthjirawat1567@gmail.com' 
                },
                to: [{ email: email }],
                subject: 'รหัส OTP สำหรับรีเซ็ตรหัสผ่าน - Make Friends App',
                htmlContent: `
                    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; padding: 30px; background-color: #f4f4f9; border-radius: 10px;">
                        <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
                            <h2 style="color: #6210CC; margin-bottom: 20px;">รีเซ็ตรหัสผ่าน</h2>
                            <p style="color: #555; font-size: 16px;">รหัส OTP สำหรับตั้งรหัสผ่านใหม่ของคุณคือ:</p>
                            <div style="background-color: #f3f0ff; border: 2px dashed #6210CC; color: #6210CC; padding: 20px 30px; border-radius: 8px; display: inline-block; margin: 25px 0; font-size: 36px; font-weight: bold; letter-spacing: 10px;">
                                ${otp}
                            </div>
                            <p style="color: #888; font-size: 14px;">รหัสนี้มีอายุการใช้งาน 1 ชั่วโมง</p>
                        </div>
                    </div>
                `
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(JSON.stringify(errData));
        }
        console.log('✅ Forgot Password Email Sent via Brevo HTTP API to:', email);

        res.status(200).json({ message: "ส่งรหัส OTP ไปยังอีเมลแล้ว" });

    } catch (err) {
        console.error("Forgot Password Error:", err);
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการส่งอีเมล: " + err.message });
    }
});

// --- POST: ยืนยัน OTP และตั้งรหัสผ่านใหม่ ---
router.post('/reset-password', async (req, res) => {
    try {
        const { email, otp, new_password } = req.body;
        if (!email || !otp || !new_password) {
            return res.status(400).json({ error: "กรุณากรอกข้อมูลให้ครบถ้วน" });
        }

        const { data: user, error } = await supabase.from('users').select('reset_otp').eq('email', email).single();
        
        if (error || !user) return res.status(404).json({ error: "ไม่พบผู้ใช้งาน" });
        if (user.reset_otp !== otp) return res.status(400).json({ error: "รหัส OTP ไม่ถูกต้อง" });

        // เข้ารหัสรหัสผ่านใหม่
        const hashedPassword = await bcrypt.hash(new_password, 10);

        // อัปเดตรหัสผ่านและล้างค่า OTP กลับเป็น null
        await supabase.from('users').update({ password: hashedPassword, reset_otp: null }).eq('email', email);

        res.status(200).json({ message: "เปลี่ยนรหัสผ่านสำเร็จ" });
    } catch (err) {
        console.error("Reset Password Error:", err);
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน" });
    }
});

// ==========================================
// 11. ระบบผู้ดูแลระบบ (Admin)
// ==========================================

// --- POST: สร้างบัญชีผู้ดูแลระบบ (Admin) ใหม่ ---
router.post('/admin/create', async (req, res) => {
    try {
        const { email, name, password, creator_email } = req.body;

        if (!email || !name || !password || !creator_email) {
            return res.status(400).json({ error: "กรุณากรอกข้อมูลให้ครบถ้วน" });
        }

        // 1. ตรวจสอบว่าผู้ที่กดสร้าง เป็น admin จริงหรือไม่
        const { data: creator } = await supabase.from('users').select('role').eq('email', creator_email).single();
        if (!creator || creator.role !== 'admin') {
            return res.status(403).json({ error: "คุณไม่มีสิทธิ์สร้างบัญชีผู้ดูแลระบบ" });
        }

        // 2. เช็คว่าอีเมลมีซ้ำในระบบหรือไม่
        const { data: existingUser } = await supabase.from('users').select('email').eq('email', email).single();
        if (existingUser) {
            return res.status(400).json({ error: "อีเมลนี้มีอยู่ในระบบแล้ว" });
        }

        // 3. เข้ารหัสรหัสผ่าน และบันทึกลงตาราง users พร้อมตั้งค่า role = 'admin' และผ่านการยืนยันแล้ว
        const hashedPassword = await bcrypt.hash(password, 10);
        const { error: insertError } = await supabase.from('users').insert([{ email, name, password: hashedPassword, role: 'admin', is_verified: true }]);
        if (insertError) throw insertError;

        res.status(201).json({ message: "สร้างบัญชีผู้ดูแลระบบสำเร็จ" });
    } catch (err) {
        console.error("Create Admin Error:", err);
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการสร้างบัญชี" });
    }
});

// เส้นทาง: PUT /users/:email/change-password
router.put('/users/:email/change-password', async (req, res) => {
    const { email } = req.params;
    const { old_password, new_password } = req.body;

    try {
        // 1. ดึงข้อมูลรหัสผ่านที่เข้ารหัสไว้ (Hash) จาก Supabase
        const { data: user, error: fetchError } = await supabase
            .from('users')
            .select('password')
            .eq('email', email)
            .single();
            
        if (fetchError || !user) return res.status(404).json({ error: "ไม่พบข้อมูลผู้ใช้งาน" });

        // 2. เช็คว่ารหัสเดิมตรงไหม (ใช้ bcrypt.compare)
        const isMatch = await bcrypt.compare(old_password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: "รหัสผ่านเดิมไม่ถูกต้อง" });
        }

        // 3. ถ้าตรง ให้เข้ารหัส (Hash) รหัสผ่านใหม่ แล้วอัปเดตลง Database
        const hashedNewPassword = await bcrypt.hash(new_password, 10);
        const { error: updateError } = await supabase
            .from('users')
            .update({ password: hashedNewPassword })
            .eq('email', email);
            
        if (updateError) throw updateError;

        res.json({ message: "เปลี่ยนรหัสผ่านสำเร็จ" });
    } catch (error) {
        console.error("Change Password Error:", error);
        res.status(500).json({ error: "เซิร์ฟเวอร์เกิดข้อผิดพลาด: " + error.message });
    }
});


// --- POST: Heartbeat (อัปเดตสถานะออนไลน์) ---
router.post('/users/heartbeat', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const { error } = await supabase
            .from('users')
            .update({ 
                is_online: true, 
                last_active: new Date().toISOString() 
            })
            .eq('email', email);

        if (error) throw error;
        res.status(200).json({ message: 'Heartbeat updated' });
    } catch (err) {
        console.error("Heartbeat Error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ==========================================
// ระบบ Background Task: เช็คผู้ใช้ออฟไลน์อัตโนมัติ
// ==========================================
setInterval(async () => {
    try {
        // เวลาปัจจุบัน ลบด้วย 5 นาที
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        
        // หากมีผู้ใช้ที่ is_online = true แต่ไม่มีการส่ง Heartbeat มาอัปเดตเกิน 5 นาที จะถูกปรับเป็นออฟไลน์
        const { error } = await supabase
            .from('users')
            .update({ is_online: false })
            .eq('is_online', true)
            .lt('last_active', fiveMinutesAgo);

        if (error) {
            console.error('[System] Error updating offline users:', error.message);
        }
    } catch (err) {
        console.error('[System] Error in offline check cron:', err.message);
    }
}, 60 * 1000); // รันระบบตรวจสอบนี้ทุกๆ 1 นาที

// --- POST: ตรวจสอบสถานะผู้ใช้ (สำหรับ Real-time Ban) ---
router.post('/users/status/check', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const { data: user, error } = await supabase
            .from('users')
            .select('banned_until')
            .eq('email', email)
            .single();

        if (error || !user) {
            // หากไม่พบผู้ใช้ อาจเป็นเพราะถูกลบไปแล้ว
            return res.status(404).json({ error: 'User not found' });
        }

        // ตรวจสอบว่าการแบนยังไม่หมดอายุ
        const isBanned = user.banned_until && new Date(user.banned_until) > new Date();

        if (isBanned) {
            return res.status(403).json({ 
                banned: true, 
                message: 'บัญชีของคุณถูกระงับการใช้งาน',
                banned_until: user.banned_until
            });
        }
        res.status(200).json({ banned: false });
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;